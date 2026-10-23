/** Inventory logic: FEFO allocation (F5), expiry-waste projection (F5) and rebalancing (F4). Pure functions. */
import { DAY_MS } from '../utils/dates';

export interface StockLineInput {
  id?: string;
  batchNo: string;
  bin: string;
  expiryDate?: Date | string | null;
  quantity: number;
  createdAt?: Date | string | null;
}

export interface Allocation {
  lineId?: string;
  batchNo: string;
  bin: string;
  expiryDate: Date | null;
  quantity: number;
}

function time(v: Date | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Earliest-expiring first; undated lines last; ties broken by oldest createdAt. */
export function sortFEFO<T extends StockLineInput>(lines: T[]): T[] {
  return [...lines].sort((a, b) => {
    const ea = time(a.expiryDate);
    const eb = time(b.expiryDate);
    if (ea !== eb) {
      if (ea === null) return 1;
      if (eb === null) return -1;
      return ea - eb;
    }
    return (time(a.createdAt) ?? 0) - (time(b.createdAt) ?? 0);
  });
}

export function allocateFEFO(lines: StockLineInput[], qty: number): Allocation[] {
  if (!(qty > 0)) throw new RangeError('Quantity must be greater than 0');
  const available = lines.filter((l) => l.quantity > 0);
  const have = available.reduce((s, l) => s + l.quantity, 0);
  if (have < qty) throw new RangeError(`Insufficient stock: have ${have}, requested ${qty}`);
  const out: Allocation[] = [];
  let remaining = qty;
  for (const line of sortFEFO(available)) {
    if (remaining <= 0) break;
    const take = Math.min(line.quantity, remaining);
    out.push({
      lineId: line.id,
      batchNo: line.batchNo,
      bin: line.bin,
      expiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
      quantity: take,
    });
    remaining -= take;
  }
  return out;
}

export interface ExpiryWasteLine {
  id?: string;
  batchNo: string;
  bin: string;
  expiryDate: Date;
  quantity: number;
  daysLeft: number;
  sellThrough: number;
  wasteUnits: number;
  valueAtRisk: number;
}

export interface ExpiryWasteResult {
  lines: ExpiryWasteLine[];
  totalWasteUnits: number;
  totalValueAtRisk: number;
}

/**
 * Projects units that will expire unsold, assuming FEFO sales at a constant daily demand.
 * Undated lines are ignored.
 */
export function projectExpiryWaste(
  lines: StockLineInput[],
  dailyDemand: number,
  now: Date = new Date(),
  unitCost = 0,
): ExpiryWasteResult {
  const dated = lines
    .filter((l) => l.expiryDate && l.quantity > 0)
    .map((l) => ({ ...l, expiry: new Date(l.expiryDate as Date), daysLeft: 0 }))
    .map((l) => ({ ...l, daysLeft: Math.max(0, (l.expiry.getTime() - now.getTime()) / DAY_MS) }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
  let soldSoFar = 0;
  const out: ExpiryWasteLine[] = [];
  for (const l of dated) {
    const demandByExpiry = Math.max(0, dailyDemand) * l.daysLeft;
    const sellThrough = Math.min(l.quantity, Math.max(0, demandByExpiry - soldSoFar));
    soldSoFar += sellThrough;
    const wasteUnits = Math.ceil(l.quantity - sellThrough - 1e-9);
    out.push({
      id: l.id,
      batchNo: l.batchNo,
      bin: l.bin,
      expiryDate: l.expiry,
      quantity: l.quantity,
      daysLeft: l.daysLeft,
      sellThrough,
      wasteUnits: Math.max(0, wasteUnits),
      valueAtRisk: Math.max(0, wasteUnits) * unitCost,
    });
  }
  return {
    lines: out,
    totalWasteUnits: out.reduce((s, l) => s + l.wasteUnits, 0),
    totalValueAtRisk: out.reduce((s, l) => s + l.valueAtRisk, 0),
  };
}

export interface RebalancePosition {
  warehouse: string;
  onHand: number;
  onOrder: number;
  /** Optional per-warehouse reorder point; defaults to the shared reorderPoint. */
  reorderPoint?: number;
}

export interface RebalanceInput {
  positions: RebalancePosition[];
  reorderPoint: number;
  keepFactor?: number;
}

export interface RebalanceNeed {
  warehouse: string;
  deficit: number;
  covered: number;
  uncovered: number;
}

export interface RebalanceTransfer {
  from: string;
  to: string;
  quantity: number;
}

export interface RebalanceResult {
  keep: number;
  needs: RebalanceNeed[];
  transfers: RebalanceTransfer[];
  totalSurplus: number;
}

/** F4: move surplus from warehouses above keepFactor x ROP to warehouses at or below ROP. */
export function planRebalance({ positions, reorderPoint, keepFactor = 1.5 }: RebalanceInput): RebalanceResult {
  const keep = Math.ceil(keepFactor * reorderPoint);
  const ropOf = (p: RebalancePosition) => p.reorderPoint ?? reorderPoint;
  const keepOf = (p: RebalancePosition) => Math.ceil(keepFactor * ropOf(p));
  const needy = positions
    .filter((p) => p.onHand + p.onOrder <= ropOf(p))
    .map((p) => ({ warehouse: p.warehouse, deficit: ropOf(p) + 1 - (p.onHand + p.onOrder) }))
    .filter((n) => n.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit);
  const donors = positions
    .filter((p) => p.onHand - keepOf(p) > 0)
    .map((p) => ({ warehouse: p.warehouse, surplus: p.onHand - keepOf(p) }));
  const totalSurplus = donors.reduce((s, d) => s + d.surplus, 0);

  const needs: RebalanceNeed[] = [];
  const transfers: RebalanceTransfer[] = [];
  for (const n of needy) {
    let remaining = n.deficit;
    while (remaining > 0) {
      const donor = donors
        .filter((d) => d.surplus > 0 && d.warehouse !== n.warehouse)
        .sort((a, b) => b.surplus - a.surplus)[0];
      if (!donor) break;
      const qty = Math.min(donor.surplus, remaining);
      donor.surplus -= qty;
      remaining -= qty;
      const existing = transfers.find((t) => t.from === donor.warehouse && t.to === n.warehouse);
      if (existing) existing.quantity += qty;
      else transfers.push({ from: donor.warehouse, to: n.warehouse, quantity: qty });
    }
    needs.push({ warehouse: n.warehouse, deficit: n.deficit, covered: n.deficit - remaining, uncovered: remaining });
  }
  return { keep, needs, transfers, totalSurplus };
}

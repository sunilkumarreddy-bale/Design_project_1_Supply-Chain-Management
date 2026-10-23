/**
 * Self-Healing Recovery Engine (M5) plus minimum and transferable stock (3.6). Pure functions.
 * Compares transfers from other warehouses with alternative suppliers and ranks feasible recovery plans.
 */
import { fmt, rupees } from '../utils/format';

export function minStockFor(policyMinStock: number | null | undefined, safetyStock: number): number {
  if (policyMinStock !== null && policyMinStock !== undefined) return policyMinStock;
  return Math.ceil(safetyStock);
}

/** transferable(w,p,H) = max(0, onHand - minStock - ceil(d * H)) */
export function transferableUnits(onHand: number, minStock: number, dailyDemand: number, horizonDays: number): number {
  return Math.max(0, onHand - minStock - Math.ceil(dailyDemand * horizonDays));
}

export interface TransferSourceInput {
  warehouseId: string;
  warehouseName: string;
  onHand: number;
  minStock: number;
  dailyDemand: number;
  leadTimeDays: number;
  costPerUnit: number;
  estimatedRoute?: boolean;
}

export interface SupplierOfferInput {
  supplierId: string;
  supplierName: string;
  capacityUnits: number;
  minOrderQty: number;
  leadTimeDays: number;
  unitCost: number;
  offerId?: string;
}

export interface RecoveryInput {
  productName: string;
  targetWarehouseName: string;
  horizonDays: number;
  requiredUnits?: number | null;
  onHand: number;
  inbound: number;
  dailyDemand: number;
  minStock: number;
  transferSources: TransferSourceInput[];
  supplierOffers: SupplierOfferInput[];
}

export interface PlanStep {
  type: 'transfer' | 'purchase';
  fromWarehouse?: string;
  fromWarehouseName?: string;
  supplier?: string;
  supplierName?: string;
  quantity: number;
  unitCost: number;
  leadTimeDays: number;
  cost: number;
}

export interface ConstraintCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface RecoveryOption {
  optionId: string;
  label: string;
  steps: PlanStep[];
  coveredUnits: number;
  shortageLeft: number;
  totalCost: number;
  etaDays: number;
  feasible: boolean;
  constraintChecks: ConstraintCheck[];
  explanation: string[];
  rank: number;
}

export interface EvaluatedSource {
  kind: 'transfer' | 'purchase';
  id: string;
  name: string;
  capacity: number;
  minOrderQty: number;
  leadTimeDays: number;
  unitCost: number;
  feasible: boolean;
  reason: string;
  detail: string;
}

export interface RecoveryContext {
  onHand: number;
  inboundWithinHorizon: number;
  dailyDemand: number;
  minStock: number;
  horizonDays: number;
  requiredUnits: number;
}

export interface RecoveryResult {
  needed: boolean;
  message: string;
  context: RecoveryContext;
  sources: EvaluatedSource[];
  options: RecoveryOption[];
  /** Every distinct candidate before truncation to the top 3. */
  candidateCount: number;
}

export function requiredUnitsFor(
  dailyDemand: number,
  horizonDays: number,
  minStock: number,
  onHand: number,
  inbound: number,
): number {
  return Math.max(0, Math.ceil(dailyDemand * horizonDays) + minStock - (onHand + inbound));
}

export function evaluateSources(input: RecoveryInput): EvaluatedSource[] {
  const H = input.horizonDays;
  const out: EvaluatedSource[] = [];
  for (const t of input.transferSources) {
    const dH = Math.ceil(t.dailyDemand * H);
    const cap = transferableUnits(t.onHand, t.minStock, t.dailyDemand, H);
    const leadOk = t.leadTimeDays <= H;
    const feasible = cap > 0 && leadOk;
    out.push({
      kind: 'transfer',
      id: t.warehouseId,
      name: t.warehouseName,
      capacity: cap,
      minOrderQty: 0,
      leadTimeDays: t.leadTimeDays,
      unitCost: t.costPerUnit,
      feasible,
      reason: feasible
        ? 'ok'
        : cap <= 0
          ? `no transferable stock (stock ${fmt(t.onHand)} - minimum ${fmt(t.minStock)} - ${fmt(t.dailyDemand, 2)}/day x ${fmt(H)} days <= 0)`
          : `lead time ${fmt(t.leadTimeDays)} days exceeds the ${fmt(H)}-day horizon`,
      detail: `stock ${fmt(t.onHand)} - minimum ${fmt(t.minStock)} - ${fmt(t.dailyDemand, 2)}/day x ${fmt(H)} days${
        dH !== t.dailyDemand * H ? ` (${dH})` : ''
      } = ${fmt(cap)} available, ${fmt(t.leadTimeDays)} day${t.leadTimeDays === 1 ? '' : 's'}${
        t.estimatedRoute ? ' (estimated route)' : ''
      }, ${rupees(t.costPerUnit)}/unit`,
    });
  }
  for (const s of input.supplierOffers) {
    const leadOk = s.leadTimeDays <= H;
    const moqOk = s.capacityUnits >= s.minOrderQty && s.capacityUnits > 0;
    const feasible = leadOk && moqOk;
    out.push({
      kind: 'purchase',
      id: s.supplierId,
      name: s.supplierName,
      capacity: s.capacityUnits,
      minOrderQty: s.minOrderQty,
      leadTimeDays: s.leadTimeDays,
      unitCost: s.unitCost,
      feasible,
      reason: feasible
        ? 'ok'
        : !leadOk
          ? `lead time ${fmt(s.leadTimeDays)} days exceeds the ${fmt(H)}-day horizon`
          : `capacity ${fmt(s.capacityUnits)} is below the minimum order ${fmt(s.minOrderQty)}`,
      detail: `capacity ${fmt(s.capacityUnits)}, MOQ ${fmt(s.minOrderQty)}, ${fmt(s.leadTimeDays)} day${
        s.leadTimeDays === 1 ? '' : 's'
      }, ${rupees(s.unitCost)}/unit`,
    });
  }
  return out;
}

/** Greedy fill: takes from each source in order, never above its capacity; purchases are raised to the MOQ. */
function fill(sources: EvaluatedSource[], required: number): PlanStep[] {
  const steps: PlanStep[] = [];
  let remaining = required;
  for (const s of sources) {
    if (remaining <= 0) break;
    let qty = Math.min(s.capacity, remaining);
    if (s.kind === 'purchase' && qty < s.minOrderQty) {
      if (s.capacity >= s.minOrderQty) qty = s.minOrderQty;
      else continue;
    }
    if (qty <= 0) continue;
    steps.push(
      s.kind === 'transfer'
        ? {
            type: 'transfer',
            fromWarehouse: s.id,
            fromWarehouseName: s.name,
            quantity: qty,
            unitCost: s.unitCost,
            leadTimeDays: s.leadTimeDays,
            cost: qty * s.unitCost,
          }
        : {
            type: 'purchase',
            supplier: s.id,
            supplierName: s.name,
            quantity: qty,
            unitCost: s.unitCost,
            leadTimeDays: s.leadTimeDays,
            cost: qty * s.unitCost,
          },
    );
    remaining -= qty;
  }
  return steps;
}

const byCost = (a: EvaluatedSource, b: EvaluatedSource) =>
  a.unitCost - b.unitCost || a.leadTimeDays - b.leadTimeDays || a.name.localeCompare(b.name);
const byLead = (a: EvaluatedSource, b: EvaluatedSource) =>
  a.leadTimeDays - b.leadTimeDays || a.unitCost - b.unitCost || a.name.localeCompare(b.name);

function signature(steps: PlanStep[]): string {
  return steps
    .map((s) => `${s.type}:${s.fromWarehouse ?? s.supplier}:${s.quantity}`)
    .sort()
    .join('|');
}

function buildOption(
  optionId: string,
  label: string,
  steps: PlanStep[],
  required: number,
  sources: EvaluatedSource[],
  input: RecoveryInput,
): RecoveryOption {
  const covered = steps.reduce((s, x) => s + x.quantity, 0);
  const coveredForShortage = Math.min(covered, required);
  const shortageLeft = Math.max(0, required - covered);
  const totalCost = steps.reduce((s, x) => s + x.cost, 0);
  const etaDays = steps.length ? Math.max(...steps.map((s) => s.leadTimeDays)) : 0;
  const srcOf = (st: PlanStep) =>
    sources.find((s) => s.kind === st.type && s.id === (st.type === 'transfer' ? st.fromWarehouse : st.supplier))!;

  const transfers = steps.filter((s) => s.type === 'transfer');
  const purchases = steps.filter((s) => s.type === 'purchase');
  const donorDetails = transfers.map((t) => {
    const src = input.transferSources.find((x) => x.warehouseId === t.fromWarehouse)!;
    const after = src.onHand - t.quantity;
    return { name: t.fromWarehouseName, after, min: src.minStock, ok: after >= src.minStock };
  });
  const checks: ConstraintCheck[] = [
    {
      name: 'donor stays at or above minimum stock',
      passed: donorDetails.every((d) => d.ok),
      detail: donorDetails.length
        ? donorDetails.map((d) => `${d.name}: ${fmt(d.after)} left >= minimum ${fmt(d.min)}`).join('; ')
        : 'no transfers in this plan',
    },
    {
      name: 'lead time within horizon',
      passed: steps.every((s) => s.leadTimeDays <= input.horizonDays),
      detail: `slowest step ${fmt(etaDays)} days vs horizon ${fmt(input.horizonDays)} days`,
    },
    {
      name: 'supplier capacity respected',
      passed: purchases.every((p) => p.quantity <= srcOf(p).capacity),
      detail: purchases.length
        ? purchases.map((p) => `${p.supplierName}: ${fmt(p.quantity)} <= capacity ${fmt(srcOf(p).capacity)}`).join('; ')
        : 'no purchases in this plan',
    },
    {
      name: 'MOQ respected',
      passed: purchases.every((p) => p.quantity >= srcOf(p).minOrderQty),
      detail: purchases.length
        ? purchases.map((p) => `${p.supplierName}: ${fmt(p.quantity)} >= MOQ ${fmt(srcOf(p).minOrderQty)}`).join('; ')
        : 'no purchases in this plan',
    },
  ];

  const explanation: string[] = steps.map((st) =>
    st.type === 'transfer'
      ? `Transfer ${fmt(st.quantity)} units from ${st.fromWarehouseName} (${srcOf(st).detail})`
      : `Buy ${fmt(st.quantity)} units from ${st.supplierName} (${srcOf(st).detail})`,
  );
  explanation.push(
    `Covers ${fmt(coveredForShortage)} of ${fmt(required)} required units; shortage left ${fmt(shortageLeft)}; total cost ${rupees(
      totalCost,
    )}; ETA ${fmt(etaDays)} day${etaDays === 1 ? '' : 's'}`,
  );
  if (covered > required) {
    explanation.push(`Orders ${fmt(covered - required)} extra units to meet a supplier minimum order quantity`);
  }

  return {
    optionId,
    label,
    steps,
    coveredUnits: covered,
    shortageLeft,
    totalCost,
    etaDays,
    feasible: steps.length > 0 && checks.every((c) => c.passed),
    constraintChecks: checks,
    explanation,
    rank: 0,
  };
}

export function analyzeRecovery(input: RecoveryInput): RecoveryResult {
  const H = input.horizonDays;
  const computedRequired = requiredUnitsFor(input.dailyDemand, H, input.minStock, input.onHand, input.inbound);
  const required =
    input.requiredUnits !== null && input.requiredUnits !== undefined
      ? Math.max(0, Math.ceil(input.requiredUnits))
      : computedRequired;
  const context: RecoveryContext = {
    onHand: input.onHand,
    inboundWithinHorizon: input.inbound,
    dailyDemand: input.dailyDemand,
    minStock: input.minStock,
    horizonDays: H,
    requiredUnits: required,
  };
  const sources = evaluateSources(input);
  if (required === 0) {
    return { needed: false, message: 'No shortage within the horizon', context, sources, options: [], candidateCount: 0 };
  }

  const feasible = sources.filter((s) => s.feasible);
  const transfers = feasible.filter((s) => s.kind === 'transfer').sort(byCost);
  const suppliers = feasible.filter((s) => s.kind === 'purchase').sort(byCost);

  const candidates: RecoveryOption[] = [];
  const add = (id: string, label: string, steps: PlanStep[]) => {
    if (steps.length === 0) return;
    candidates.push(buildOption(id, label, steps, required, sources, input));
  };
  add('transfers_only', 'Transfers only', fill(transfers, required));
  for (const s of suppliers) add(`supplier_${s.id}`, `Supplier only: ${s.name}`, fill([s], required));
  add('transfers_then_supplier', 'Transfers first, then cheapest supplier(s)', fill([...transfers, ...suppliers], required));
  add('cheapest_overall', 'Cheapest overall', fill([...feasible].sort(byCost), required));
  add('fastest', 'Fastest', fill([...feasible].sort(byLead), required));

  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const sig = signature(c.steps);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  unique.sort((a, b) => a.shortageLeft - b.shortageLeft || a.totalCost - b.totalCost || a.etaDays - b.etaDays);
  const options = unique.slice(0, 3).map((o, i) => ({ ...o, rank: i + 1 }));

  const message = options.length
    ? options[0].shortageLeft === 0
      ? `Shortage of ${fmt(required)} units can be fully covered`
      : `Best option still leaves ${fmt(options[0].shortageLeft)} of ${fmt(required)} units uncovered`
    : `Shortage of ${fmt(required)} units and no feasible source within ${fmt(H)} days`;
  return { needed: true, message, context, sources, options, candidateCount: unique.length };
}

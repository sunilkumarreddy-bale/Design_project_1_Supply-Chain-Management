/**
 * Expiry-Aware Stock Redistribution (M7). Pure functions.
 * Moves only the quantity each destination can sell before expiry, after transport time, the minimum
 * shelf-life margin and its existing stock.
 */
import { DAY_MS } from '../utils/dates';
import { fmt, rupees } from '../utils/format';

export interface RedistributionBatch {
  stockLevelId?: string;
  productName: string;
  batchNo: string;
  quantity: number;
  expiryDate: Date | string;
  warehouseId: string;
  warehouseName: string;
  unitCost?: number;
}

export interface RedistributionDestination {
  warehouseId: string;
  warehouseName: string;
  leadTimeDays: number;
  costPerUnit: number;
  dailyDemand: number;
  onHand: number;
  onOrder: number;
  maxStock?: number | null;
}

export interface RedistributionInput {
  batch: RedistributionBatch;
  now?: Date;
  minShelfLifeDays: number;
  sourceDailyDemand: number;
  destinations: RedistributionDestination[];
}

export interface DestinationEvaluation {
  warehouseId: string;
  warehouseName: string;
  transferLeadDays: number;
  transferCostPerUnit: number;
  destDailyDemand: number;
  destExistingUnits: number;
  destOnOrder: number;
  sellWindowDays: number;
  capacityUnits: number;
  eligible: boolean;
  reason: string;
}

export interface RedistributionLine {
  toWarehouse: string;
  toWarehouseName: string;
  quantity: number;
  transferLeadDays: number;
  transferCostPerUnit: number;
  sellWindowDays: number;
  destDailyDemand: number;
  destExistingUnits: number;
  capacityUnits: number;
  expectedSoldBeforeExpiry: number;
}

export type ResidualAdvice = 'markdown' | 'donate' | 'dispose' | 'none';

export interface RedistributionResult {
  shelfLifeDaysLeft: number;
  minShelfLifeDays: number;
  sourceDailyDemand: number;
  sourceOwnSalesUnits: number;
  surplusUnits: number;
  destinations: DestinationEvaluation[];
  lines: RedistributionLine[];
  allocatedUnits: number;
  residualUnits: number;
  residualAdvice: ResidualAdvice;
  transportCost: number;
  explanation: string[];
}

export function shelfLifeLeft(expiryDate: Date | string, now: Date): number {
  return Math.floor((new Date(expiryDate).getTime() - now.getTime()) / DAY_MS);
}

export function residualAdviceFor(residual: number, shelfLeft: number, margin: number): ResidualAdvice {
  if (residual <= 0) return 'none';
  if (shelfLeft <= 0) return 'dispose';
  if (shelfLeft > margin) return 'markdown';
  return 'donate';
}

export function analyzeRedistribution(input: RedistributionInput): RedistributionResult {
  const now = input.now ?? new Date();
  const m = Math.max(0, input.minShelfLifeDays);
  const Q = input.batch.quantity;
  const shelfLeft = shelfLifeLeft(input.batch.expiryDate, now);
  const dA = Math.max(0, input.sourceDailyDemand);
  const ownSales = Math.floor(dA * Math.max(0, shelfLeft - m));
  const surplus = Math.max(0, Q - ownSales);

  const explanation: string[] = [
    `Batch ${input.batch.batchNo || '(no batch)'} of ${input.batch.productName} at ${input.batch.warehouseName}: ${fmt(Q)} units, ${fmt(
      shelfLeft,
    )} day${shelfLeft === 1 ? '' : 's'} of shelf life left, minimum shelf life at sale ${fmt(m)} day${m === 1 ? '' : 's'}`,
    `Own sales at ${input.batch.warehouseName} = floor(${fmt(dA, 2)}/day x max(0, ${fmt(shelfLeft)} - ${fmt(m)})) = ${fmt(ownSales)}`,
    `Surplus = max(0, ${fmt(Q)} - ${fmt(ownSales)}) = ${fmt(surplus)}`,
  ];

  const destinations: DestinationEvaluation[] = input.destinations
    .filter((d) => d.warehouseId !== input.batch.warehouseId)
    .map((d) => {
      const window = shelfLeft - d.leadTimeDays - m;
      let capacity = 0;
      let reason = '';
      if (window <= 0) {
        reason = `selling window ${fmt(shelfLeft)} - ${fmt(d.leadTimeDays)} - ${fmt(m)} = ${fmt(window)} days is not positive`;
      } else {
        capacity = Math.max(0, Math.floor(d.dailyDemand * window) - d.onHand - d.onOrder);
        if (d.maxStock !== null && d.maxStock !== undefined) {
          capacity = Math.min(capacity, Math.max(0, d.maxStock - d.onHand));
        }
        reason =
          capacity > 0
            ? 'ok'
            : `existing stock ${fmt(d.onHand + d.onOrder)} already covers ${fmt(d.dailyDemand, 2)}/day x ${fmt(window)} days`;
      }
      return {
        warehouseId: d.warehouseId,
        warehouseName: d.warehouseName,
        transferLeadDays: d.leadTimeDays,
        transferCostPerUnit: d.costPerUnit,
        destDailyDemand: d.dailyDemand,
        destExistingUnits: d.onHand,
        destOnOrder: d.onOrder,
        sellWindowDays: window,
        capacityUnits: capacity,
        eligible: window > 0 && capacity > 0,
        reason,
      };
    });

  const order = destinations
    .filter((d) => d.eligible)
    .sort(
      (a, b) =>
        b.capacityUnits - a.capacityUnits ||
        a.transferCostPerUnit - b.transferCostPerUnit ||
        a.transferLeadDays - b.transferLeadDays ||
        a.warehouseName.localeCompare(b.warehouseName),
    );

  let remaining = surplus;
  const lines: RedistributionLine[] = [];
  for (const d of order) {
    if (remaining <= 0) break;
    const qty = Math.min(remaining, d.capacityUnits);
    remaining -= qty;
    lines.push({
      toWarehouse: d.warehouseId,
      toWarehouseName: d.warehouseName,
      quantity: qty,
      transferLeadDays: d.transferLeadDays,
      transferCostPerUnit: d.transferCostPerUnit,
      sellWindowDays: d.sellWindowDays,
      destDailyDemand: d.destDailyDemand,
      destExistingUnits: d.destExistingUnits,
      capacityUnits: d.capacityUnits,
      expectedSoldBeforeExpiry: qty,
    });
    const existing = d.destExistingUnits + d.destOnOrder;
    explanation.push(
      `${d.warehouseName}: selling window = ${fmt(shelfLeft)} - ${fmt(d.transferLeadDays)} (transfer) - ${fmt(m)} (margin) = ${fmt(
        d.sellWindowDays,
      )} days; capacity = ${fmt(d.destDailyDemand, 2)}/day x ${fmt(d.sellWindowDays)} - ${fmt(existing)} existing = ${fmt(
        d.capacityUnits,
      )}; move ${fmt(qty)} units at ${rupees(d.transferCostPerUnit)}/unit`,
    );
  }
  for (const d of destinations.filter((x) => !x.eligible)) {
    explanation.push(`${d.warehouseName}: not eligible, ${d.reason}`);
  }

  const allocated = surplus - remaining;
  const residual = remaining;
  const advice = residualAdviceFor(residual, shelfLeft, m);
  const adviceText: Record<ResidualAdvice, string> = {
    none: 'nothing left at risk',
    markdown: 'mark down the price to sell it before expiry',
    donate: 'donate it, it is too close to expiry to sell at full price',
    dispose: 'dispose of it, the batch has expired',
  };
  explanation.push(
    `Allocated ${fmt(allocated)} of ${fmt(surplus)} surplus units; residual ${fmt(residual)} stays at ${input.batch.warehouseName}: ${adviceText[advice]}`,
  );

  return {
    shelfLifeDaysLeft: shelfLeft,
    minShelfLifeDays: m,
    sourceDailyDemand: dA,
    sourceOwnSalesUnits: ownSales,
    surplusUnits: surplus,
    destinations,
    lines,
    allocatedUnits: allocated,
    residualUnits: residual,
    residualAdvice: advice,
    transportCost: lines.reduce((s, l) => s + l.quantity * l.transferCostPerUnit, 0),
    explanation,
  };
}

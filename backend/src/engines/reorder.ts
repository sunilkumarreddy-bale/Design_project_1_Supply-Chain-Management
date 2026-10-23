/**
 * Reorder engine (F1 glass-box explanations, F2 inventory-position reordering, F3 supplier lead-time learning).
 * Pure functions: no database access, fully deterministic.
 */
import { fmt } from '../utils/format';

export const DEFAULT_LEAD_TIME_DAYS = 7;
/** Number of virtual deliveries at the promised lead time used to shrink the observed mean (F3). */
export const SHRINKAGE_VIRTUAL_SAMPLES = 3;

export function safetyStock(z: number, leadDays: number, sigmaD: number, d: number, sigmaL = 0): number {
  const variance = leadDays * sigmaD * sigmaD + d * d * sigmaL * sigmaL;
  return z * Math.sqrt(Math.max(0, variance));
}

export function reorderPoint(d: number, leadDays: number, ss: number): number {
  return Math.ceil(d * leadDays + ss);
}

/** Economic order quantity. D = annual demand, S = order cost, H = holding cost per unit per year. */
export function economicOrderQuantity(D: number, S: number, H: number): number {
  if (!(H > 0)) throw new RangeError('Holding cost must be greater than 0');
  if (!(D > 0)) return 0;
  return Math.ceil(Math.sqrt((2 * D * S) / H));
}

export function shouldReorder(d: number, position: number, rop: number): boolean {
  return d > 0 && position <= rop;
}

/** Smallest k*EOQ (k >= 1) that lifts the inventory position above the reorder point. */
export function orderQuantity(position: number, rop: number, eoq: number): number {
  if (eoq <= 0) return Math.max(1, rop + 1 - position);
  const k = Math.max(1, Math.floor((rop - position) / eoq) + 1);
  return k * eoq;
}

export interface LeadTimeAccumulators {
  leadTimeSamples: number;
  leadTimeSum: number;
  leadTimeSumSq: number;
}

export interface SupplierLeadTimeStats {
  mean: number;
  std: number;
  samples: number;
  observedMean: number | null;
  source: 'nominal' | 'blended';
}

export function supplierLeadTimeStats(nominal: number, acc: LeadTimeAccumulators): SupplierLeadTimeStats {
  const n = acc.leadTimeSamples ?? 0;
  if (n <= 0) return { mean: nominal, std: 0, samples: 0, observedMean: null, source: 'nominal' };
  const observedMean = acc.leadTimeSum / n;
  const variance = n > 1 ? Math.max(0, (acc.leadTimeSumSq - n * observedMean * observedMean) / (n - 1)) : 0;
  const mean = (SHRINKAGE_VIRTUAL_SAMPLES * nominal + acc.leadTimeSum) / (SHRINKAGE_VIRTUAL_SAMPLES + n);
  return { mean, std: Math.sqrt(variance), samples: n, observedMean, source: 'blended' };
}

export function applyLeadTimeSample(acc: LeadTimeAccumulators, days: number): LeadTimeAccumulators {
  if (!(days >= 0)) throw new RangeError('Lead time sample must be >= 0');
  return {
    leadTimeSamples: acc.leadTimeSamples + 1,
    leadTimeSum: acc.leadTimeSum + days,
    leadTimeSumSq: acc.leadTimeSumSq + days * days,
  };
}

export type LeadTimeSource = 'override' | 'blended' | 'nominal' | 'default';

export interface ReorderProductInput {
  sku?: string;
  name?: string;
  avgDailyDemand: number;
  demandStdDev: number;
  leadTimeDaysOverride?: number | null;
  serviceLevelZ: number;
  orderCost: number;
  holdingCostPerUnitYear: number;
  annualDemandOverride?: number | null;
}

export interface ReorderSupplierInput extends Partial<LeadTimeAccumulators> {
  name?: string;
  leadTimeDays: number;
}

export interface ResolvedLeadTime {
  leadDays: number;
  sigmaLead: number;
  source: LeadTimeSource;
  samples: number;
}

/** Lead-time precedence: product override > supplier statistics > 7-day default. */
export function resolveLeadTime(
  product: Pick<ReorderProductInput, 'leadTimeDaysOverride'>,
  supplier?: ReorderSupplierInput | null,
): ResolvedLeadTime {
  if (product.leadTimeDaysOverride !== null && product.leadTimeDaysOverride !== undefined) {
    return { leadDays: product.leadTimeDaysOverride, sigmaLead: 0, source: 'override', samples: 0 };
  }
  if (supplier) {
    const stats = supplierLeadTimeStats(supplier.leadTimeDays, {
      leadTimeSamples: supplier.leadTimeSamples ?? 0,
      leadTimeSum: supplier.leadTimeSum ?? 0,
      leadTimeSumSq: supplier.leadTimeSumSq ?? 0,
    });
    return { leadDays: stats.mean, sigmaLead: stats.std, source: stats.source, samples: stats.samples };
  }
  return { leadDays: DEFAULT_LEAD_TIME_DAYS, sigmaLead: 0, source: 'default', samples: 0 };
}

export interface DemandOverride {
  mean: number;
  std: number;
  source: 'history' | 'fallback';
  samples?: number;
}

export interface ExplainReorderInput {
  product: ReorderProductInput;
  supplier?: ReorderSupplierInput | null;
  onHand: number;
  onOrder: number;
  /** Per-warehouse demand estimate; falls back to the product defaults when omitted. */
  demand?: DemandOverride | null;
  /** Multiplies the service-level z (used by what-if tools); default 1. */
  zOverride?: number | null;
}

export interface ReorderExplanation {
  inputs: {
    avgDailyDemand: number;
    demandStdDev: number;
    demandSource: 'history' | 'fallback' | 'product';
    leadDays: number;
    sigmaLead: number;
    leadTimeSource: LeadTimeSource;
    leadTimeSamples: number;
    z: number;
    annualDemand: number;
    orderCost: number;
    holdingCost: number;
    onHand: number;
    onOrder: number;
  };
  policy: { safetyStock: number; reorderPoint: number; economicOrderQuantity: number };
  position: number;
  shouldReorder: boolean;
  orderQuantity: number;
  steps: string[];
}

const LEAD_SOURCE_TEXT: Record<LeadTimeSource, string> = {
  override: 'product override',
  blended: 'learned from received POs, blended with the promise',
  nominal: "supplier's promised lead time (no deliveries observed yet)",
  default: 'default (no supplier)',
};

export function explainReorder(input: ExplainReorderInput): ReorderExplanation {
  const { product, supplier, onHand, onOrder } = input;
  const d = input.demand ? input.demand.mean : product.avgDailyDemand;
  const sigmaD = input.demand ? input.demand.std : product.demandStdDev;
  const demandSource = input.demand ? input.demand.source : 'product';
  const z = input.zOverride ?? product.serviceLevelZ;
  const lt = resolveLeadTime(product, supplier);
  const L = lt.leadDays;
  const sigmaL = lt.sigmaLead;
  const D =
    product.annualDemandOverride !== null && product.annualDemandOverride !== undefined
      ? product.annualDemandOverride
      : d * 365;
  const S = product.orderCost;
  const H = product.holdingCostPerUnitYear;

  const ss = safetyStock(z, L, sigmaD, d, sigmaL);
  const rop = reorderPoint(d, L, ss);
  const eoq = economicOrderQuantity(D, S, H);
  const position = onHand + onOrder;
  const reorder = shouldReorder(d, position, rop);
  const qty = reorder ? orderQuantity(position, rop, eoq) : 0;

  const steps: string[] = [];
  steps.push(
    `Daily demand d = ${fmt(d, 2)} units/day, sigma d = ${fmt(sigmaD, 2)} (${
      demandSource === 'history'
        ? 'last 30 days of dispatches at this warehouse'
        : demandSource === 'fallback'
          ? 'product default, fewer than 7 days of history'
          : 'product default'
    })`,
  );
  steps.push(
    `Lead time L = ${fmt(L, 2)} days, sigma L = ${fmt(sigmaL, 2)} (${LEAD_SOURCE_TEXT[lt.source]}${
      lt.source === 'blended'
        ? `: (3 x ${fmt(supplier!.leadTimeDays, 2)} + ${fmt(supplier!.leadTimeSum ?? 0, 2)}) / (3 + ${lt.samples})`
        : ''
    })`,
  );
  steps.push(
    sigmaL > 0
      ? `Safety stock = ${fmt(z, 2)} x sqrt(${fmt(L, 2)} x ${fmt(sigmaD, 2)}^2 + ${fmt(d, 2)}^2 x ${fmt(sigmaL, 2)}^2) = ${fmt(ss)}`
      : `Safety stock = ${fmt(z, 2)} x ${fmt(sigmaD, 2)} x sqrt(${fmt(L, 2)}) = ${fmt(ss)}`,
  );
  steps.push(`Reorder point = ceil(${fmt(d, 2)} x ${fmt(L, 2)} + ${fmt(ss)}) = ${rop}`);
  steps.push(
    D > 0
      ? `EOQ = ceil(sqrt(2 x ${fmt(D, 1)} x ${fmt(S, 2)} / ${fmt(H, 2)})) = ${eoq}` +
          (product.annualDemandOverride != null ? ' (annual demand override)' : ` (annual demand = ${fmt(d, 2)} x 365)`)
      : 'EOQ = 0 because annual demand is 0',
  );
  steps.push(`Inventory position = on-hand ${fmt(onHand)} + on-order ${fmt(onOrder)} = ${fmt(position)}`);
  if (d <= 0) {
    steps.push('No reorder: daily demand is 0');
  } else if (!reorder) {
    steps.push(`No reorder: position ${fmt(position)} is above the reorder point ${rop}`);
  } else {
    const k = eoq > 0 ? qty / eoq : 0;
    steps.push(`Reorder: position ${fmt(position)} <= reorder point ${rop}`);
    steps.push(
      eoq > 0
        ? `Order quantity = ${k} x EOQ ${eoq} = ${qty} (smallest multiple that lifts the position to ${fmt(position + qty)} > ${rop})`
        : `Order quantity = ${rop} + 1 - ${fmt(position)} = ${qty} (EOQ is 0)`,
    );
  }

  return {
    inputs: {
      avgDailyDemand: d,
      demandStdDev: sigmaD,
      demandSource,
      leadDays: L,
      sigmaLead: sigmaL,
      leadTimeSource: lt.source,
      leadTimeSamples: lt.samples,
      z,
      annualDemand: D,
      orderCost: S,
      holdingCost: H,
      onHand,
      onOrder,
    },
    policy: { safetyStock: ss, reorderPoint: rop, economicOrderQuantity: eoq },
    position,
    shouldReorder: reorder,
    orderQuantity: qty,
    steps,
  };
}

/** Supplier performance score (0..100): share of deliveries that arrived within the promised lead time. */
export function supplierPerformanceScore(onTime: number, late: number): number {
  const total = onTime + late;
  if (total === 0) return 100;
  return Math.round((onTime / total) * 1000) / 10;
}

/** ABC-XYZ classification, service-level recommendation, days of cover and demand estimation. Pure functions. */
import { DAY_MS, startOfUtcDay } from '../utils/dates';

export type AbcClass = 'A' | 'B' | 'C';
export type XyzClass = 'X' | 'Y' | 'Z';

export interface AbcInput {
  id: string;
  annualValue: number;
}

export interface AbcResult {
  id: string;
  annualValue: number;
  share: number;
  cumulativeShareBefore: number;
  abc: AbcClass;
}

/** A while the item starts before 80% of cumulative annual value, B before 95%, else C. */
export function classifyABC(items: AbcInput[]): AbcResult[] {
  const total = items.reduce((s, i) => s + Math.max(0, i.annualValue), 0);
  const sorted = [...items].sort((a, b) => b.annualValue - a.annualValue || a.id.localeCompare(b.id));
  let cumulative = 0;
  return sorted.map((i) => {
    const value = Math.max(0, i.annualValue);
    const share = total > 0 ? value / total : 0;
    const before = cumulative;
    cumulative += share;
    const abc: AbcClass = total <= 0 || value <= 0 ? 'C' : before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C';
    return { id: i.id, annualValue: value, share, cumulativeShareBefore: before, abc };
  });
}

export function coefficientOfVariation(mean: number, std: number): number | null {
  if (!(mean > 0)) return null;
  return std / mean;
}

/** X: CV <= 0.25, Y: CV <= 0.5, else Z. Zero demand is Z. */
export function classifyXYZ(cv: number | null): XyzClass {
  if (cv === null || !Number.isFinite(cv)) return 'Z';
  if (cv <= 0.25) return 'X';
  if (cv <= 0.5) return 'Y';
  return 'Z';
}

export const RECOMMENDED_Z: Record<AbcClass, { z: number; serviceLevel: number }> = {
  A: { z: 2.05, serviceLevel: 0.98 },
  B: { z: 1.65, serviceLevel: 0.95 },
  C: { z: 1.28, serviceLevel: 0.9 },
};

export function recommendedZ(abc: AbcClass): number {
  return RECOMMENDED_Z[abc].z;
}

export function daysOfCover(onHand: number, dailyDemand: number): number | null {
  if (!(dailyDemand > 0)) return null;
  return onHand / dailyDemand;
}

export const POLICY_HINTS: Record<string, string> = {
  AX: 'High value, steady demand: tight continuous review, small frequent orders, low safety stock is enough.',
  AY: 'High value, variable demand: continuous review with careful safety stock; review forecasts weekly.',
  AZ: 'High value, erratic demand: order close to need, consider make-to-order and supplier collaboration.',
  BX: 'Medium value, steady demand: automate reordering with EOQ; periodic policy review.',
  BY: 'Medium value, variable demand: standard reorder point with 95% service level; monthly review.',
  BZ: 'Medium value, erratic demand: keep buffer stock but review often; avoid large batches.',
  CX: 'Low value, steady demand: order in bulk, simple two-bin or periodic replenishment.',
  CY: 'Low value, variable demand: periodic review with generous safety stock; minimise handling effort.',
  CZ: 'Low value, erratic demand: stock only if needed, consider order-on-demand; watch for obsolescence and expiry.',
};

export function policyHint(abc: AbcClass, xyz: XyzClass): string {
  return POLICY_HINTS[`${abc}${xyz}`];
}

export interface DemandPoint {
  date: Date | string;
  quantity: number;
}

export interface DemandEstimate {
  mean: number;
  std: number;
  samples: number;
  source: 'history' | 'fallback';
}

export const MIN_HISTORY_DAYS = 7;

/**
 * Mean and sample standard deviation of daily demand over the `days` full days before `now`
 * (today is excluded because it is still incomplete). Days without a row count as zero.
 * Needs at least 7 distinct days with rows; otherwise the fallback mean and fallback sigma are returned.
 */
export function estimateDemand(
  history: DemandPoint[],
  fallbackDaily: number,
  days = 30,
  now: Date = new Date(),
  fallbackStd = 0,
): DemandEstimate {
  const end = startOfUtcDay(now).getTime();
  const start = end - days * DAY_MS;
  const byDay = new Map<number, number>();
  for (const h of history) {
    const t = startOfUtcDay(new Date(h.date)).getTime();
    if (t >= start && t < end) byDay.set(t, (byDay.get(t) ?? 0) + Math.max(0, h.quantity));
  }
  if (byDay.size < MIN_HISTORY_DAYS) {
    return { mean: fallbackDaily, std: fallbackStd, samples: byDay.size, source: 'fallback' };
  }
  const values: number[] = [];
  for (let t = start; t < end; t += DAY_MS) values.push(byDay.get(t) ?? 0);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.length > 1 ? values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (values.length - 1) : 0;
  return { mean, std: Math.sqrt(variance), samples: byDay.size, source: 'history' };
}

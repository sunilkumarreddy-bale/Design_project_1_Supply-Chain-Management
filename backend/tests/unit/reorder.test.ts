import {
  applyLeadTimeSample,
  economicOrderQuantity,
  explainReorder,
  orderQuantity,
  reorderPoint,
  resolveLeadTime,
  safetyStock,
  shouldReorder,
  supplierLeadTimeStats,
  supplierPerformanceScore,
} from '../../src/engines/reorder';

const product = {
  avgDailyDemand: 40,
  demandStdDev: 6,
  leadTimeDaysOverride: null,
  serviceLevelZ: 1.65,
  orderCost: 20,
  holdingCostPerUnitYear: 2,
  annualDemandOverride: null,
};

describe('safety stock', () => {
  it('equals z * sigmaD * sqrt(L) without lead-time variance', () => {
    expect(safetyStock(1.65, 9, 10, 40, 0)).toBeCloseTo(1.65 * 10 * 3, 10);
  });
  it('includes lead-time variance', () => {
    const ss = safetyStock(1.65, 11.9, 6, 40, 2.1);
    expect(ss).toBeCloseTo(1.65 * Math.sqrt(11.9 * 36 + 1600 * 4.41), 10);
    // the spec's sample text shows 138.4, but its own formula with these inputs gives 142.7
    expect(ss).toBeCloseTo(142.7, 1);
  });
  it('is 0 when demand is certain and lead time fixed', () => {
    expect(safetyStock(2, 5, 0, 10, 0)).toBe(0);
  });
});

describe('reorder point and EOQ', () => {
  it('rounds the reorder point up', () => {
    expect(reorderPoint(40, 11.9, 142.7)).toBe(619);
    expect(reorderPoint(10, 5, 0)).toBe(50);
  });
  it('computes EOQ = ceil(sqrt(2DS/H))', () => {
    expect(economicOrderQuantity(14600, 20, 2)).toBe(541);
    expect(economicOrderQuantity(1000, 50, 4)).toBe(159);
  });
  it('returns 0 when annual demand is 0', () => {
    expect(economicOrderQuantity(0, 20, 2)).toBe(0);
  });
  it('throws when holding cost is not positive', () => {
    expect(() => economicOrderQuantity(100, 20, 0)).toThrow(RangeError);
    expect(() => economicOrderQuantity(100, 20, -1)).toThrow(RangeError);
  });
});

describe('position-based trigger and order quantity', () => {
  it('triggers only when demand > 0 and position <= ROP', () => {
    expect(shouldReorder(10, 50, 50)).toBe(true);
    expect(shouldReorder(10, 51, 50)).toBe(false);
    expect(shouldReorder(0, 0, 50)).toBe(false);
  });
  it('orders the smallest multiple of EOQ that lifts the position above ROP', () => {
    expect(orderQuantity(40, 100, 100)).toBe(100);
    expect(orderQuantity(0, 100, 100)).toBe(200);
    expect(orderQuantity(-50, 100, 60)).toBe(180);
    expect(orderQuantity(100, 100, 30)).toBe(30);
  });
  it('falls back to ROP + 1 - position when EOQ is 0', () => {
    expect(orderQuantity(10, 50, 0)).toBe(41);
  });
  it('counts on-order stock, so a second run does not reorder', () => {
    const first = explainReorder({ product, onHand: 100, onOrder: 0 });
    expect(first.shouldReorder).toBe(true);
    const second = explainReorder({ product, onHand: 100, onOrder: first.orderQuantity });
    expect(second.shouldReorder).toBe(false);
    expect(second.orderQuantity).toBe(0);
  });
});

describe('supplier lead-time statistics (F3)', () => {
  it('uses the promise when there are no samples', () => {
    expect(supplierLeadTimeStats(10, { leadTimeSamples: 0, leadTimeSum: 0, leadTimeSumSq: 0 })).toEqual({
      mean: 10,
      std: 0,
      samples: 0,
      observedMean: null,
      source: 'nominal',
    });
  });
  it('blends observed deliveries with 3 virtual deliveries at the promise', () => {
    let acc = { leadTimeSamples: 0, leadTimeSum: 0, leadTimeSumSq: 0 };
    for (const d of [12, 14, 11, 15, 13, 12]) acc = applyLeadTimeSample(acc, d);
    expect(acc).toEqual({ leadTimeSamples: 6, leadTimeSum: 77, leadTimeSumSq: 999 });
    const s = supplierLeadTimeStats(10, acc);
    expect(s.source).toBe('blended');
    expect(s.mean).toBeCloseTo(107 / 9, 10);
    expect(s.mean).toBeCloseTo(11.9, 1);
    expect(s.observedMean).toBeCloseTo(12.833, 3);
    const variance = (999 - 6 * (77 / 6) ** 2) / 5;
    expect(s.std).toBeCloseTo(Math.sqrt(variance), 10);
  });
  it('has zero std with a single sample', () => {
    const s = supplierLeadTimeStats(5, applyLeadTimeSample({ leadTimeSamples: 0, leadTimeSum: 0, leadTimeSumSq: 0 }, 9));
    expect(s.std).toBe(0);
    expect(s.mean).toBe(6);
  });
  it('rejects negative samples', () => {
    expect(() => applyLeadTimeSample({ leadTimeSamples: 0, leadTimeSum: 0, leadTimeSumSq: 0 }, -1)).toThrow(RangeError);
  });
  it('scores suppliers by on-time share', () => {
    expect(supplierPerformanceScore(0, 0)).toBe(100);
    expect(supplierPerformanceScore(3, 1)).toBe(75);
    expect(supplierPerformanceScore(0, 6)).toBe(0);
  });
});

describe('lead-time precedence', () => {
  const supplier = { leadTimeDays: 10, leadTimeSamples: 6, leadTimeSum: 77, leadTimeSumSq: 999 };
  it('prefers the product override', () => {
    expect(resolveLeadTime({ leadTimeDaysOverride: 4 }, supplier)).toMatchObject({ leadDays: 4, source: 'override' });
  });
  it('then supplier statistics', () => {
    expect(resolveLeadTime({ leadTimeDaysOverride: null }, supplier).source).toBe('blended');
    expect(resolveLeadTime({ leadTimeDaysOverride: null }, { leadTimeDays: 5 })).toMatchObject({
      leadDays: 5,
      source: 'nominal',
    });
  });
  it('then the 7-day default', () => {
    expect(resolveLeadTime({ leadTimeDaysOverride: null }, null)).toMatchObject({ leadDays: 7, source: 'default' });
  });
});

describe('explainReorder (F1)', () => {
  it('returns inputs, policy and steps containing the real numbers', () => {
    const supplier = { name: 'Globex', leadTimeDays: 10, leadTimeSamples: 6, leadTimeSum: 77, leadTimeSumSq: 999 };
    const e = explainReorder({ product, supplier, onHand: 300, onOrder: 100 });
    expect(e.inputs.leadTimeSource).toBe('blended');
    expect(e.inputs.leadDays).toBeCloseTo(11.89, 2);
    expect(e.position).toBe(400);
    expect(e.policy.reorderPoint).toBe(Math.ceil(40 * e.inputs.leadDays + e.policy.safetyStock));
    expect(e.policy.economicOrderQuantity).toBe(541);
    expect(e.shouldReorder).toBe(true);
    expect(e.orderQuantity % 541).toBe(0);
    expect(e.position + e.orderQuantity).toBeGreaterThan(e.policy.reorderPoint);
    expect(e.steps.some((s) => s.startsWith('Safety stock = 1.65 x sqrt(11.89 x 6^2 + 40^2 x'))).toBe(true);
    expect(e.steps.some((s) => s.includes(`Reorder point = ceil(40 x 11.89`))).toBe(true);
    expect(e.steps.some((s) => s.includes('Inventory position = on-hand 300 + on-order 100 = 400'))).toBe(true);
  });
  it('uses the per-warehouse demand estimate when given', () => {
    const e = explainReorder({ product, onHand: 0, onOrder: 0, demand: { mean: 5, std: 1, source: 'history' } });
    expect(e.inputs.avgDailyDemand).toBe(5);
    expect(e.inputs.demandSource).toBe('history');
    expect(e.inputs.leadTimeSource).toBe('default');
  });
  it('explains why there is no reorder when demand is zero', () => {
    const e = explainReorder({ product: { ...product, avgDailyDemand: 0 }, onHand: 0, onOrder: 0 });
    expect(e.shouldReorder).toBe(false);
    expect(e.steps[e.steps.length - 1]).toBe('No reorder: daily demand is 0');
  });
  it('uses the annual demand override for EOQ', () => {
    const e = explainReorder({ product: { ...product, annualDemandOverride: 1000 }, onHand: 0, onOrder: 0 });
    expect(e.inputs.annualDemand).toBe(1000);
    expect(e.policy.economicOrderQuantity).toBe(Math.ceil(Math.sqrt((2 * 1000 * 20) / 2)));
  });
});

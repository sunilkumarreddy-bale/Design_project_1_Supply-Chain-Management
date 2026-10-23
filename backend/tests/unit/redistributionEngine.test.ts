import { analyzeRedistribution, residualAdviceFor, shelfLifeLeft } from '../../src/engines/redistributionEngine';

const now = new Date('2026-05-01T08:00:00Z');
const in6 = new Date(now.getTime() + 6.5 * 24 * 3600 * 1000);
const batch = {
  productName: 'Fresh Milk Packet',
  batchNo: 'MLK-A',
  quantity: 500,
  expiryDate: in6,
  warehouseId: 'A',
  warehouseName: 'Warehouse A',
};
const B = { warehouseId: 'B', warehouseName: 'Warehouse B', leadTimeDays: 1, costPerUnit: 1.5, dailyDemand: 120, onHand: 100, onOrder: 0 };

describe('redistribution engine: Example B', () => {
  it('moves 380 packets to B and leaves 120 at A', () => {
    const r = analyzeRedistribution({ batch, now, minShelfLifeDays: 1, sourceDailyDemand: 0, destinations: [B] });
    expect(r.shelfLifeDaysLeft).toBe(6);
    expect(r.sourceOwnSalesUnits).toBe(0);
    expect(r.surplusUnits).toBe(500);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ toWarehouse: 'B', quantity: 380, sellWindowDays: 4, capacityUnits: 380 });
    expect(r.residualUnits).toBe(120);
    expect(r.residualAdvice).toBe('markdown');
    expect(r.explanation.some((e) => e.includes('selling window = 6 - 1 (transfer) - 1 (margin) = 4 days'))).toBe(true);
    expect(r.explanation.some((e) => e.includes('capacity = 120/day x 4 - 100 existing = 380'))).toBe(true);
  });
  it('moves all 500 with margin 0 and an empty destination', () => {
    const r = analyzeRedistribution({
      batch,
      now,
      minShelfLifeDays: 0,
      sourceDailyDemand: 0,
      destinations: [{ ...B, onHand: 0 }],
    });
    expect(r.lines[0]).toMatchObject({ quantity: 500, capacityUnits: 600, sellWindowDays: 5 });
    expect(r.residualUnits).toBe(0);
    expect(r.residualAdvice).toBe('none');
  });
});

describe('redistribution engine rules', () => {
  it('excludes destinations whose selling window is not positive', () => {
    const r = analyzeRedistribution({
      batch,
      now,
      minShelfLifeDays: 1,
      sourceDailyDemand: 0,
      destinations: [{ ...B, leadTimeDays: 5 }],
    });
    expect(r.destinations[0]).toMatchObject({ eligible: false, sellWindowDays: 0 });
    expect(r.lines).toEqual([]);
    expect(r.residualUnits).toBe(500);
  });
  it('offsets what the source can sell itself', () => {
    const r = analyzeRedistribution({ batch, now, minShelfLifeDays: 1, sourceDailyDemand: 50, destinations: [B] });
    expect(r.sourceOwnSalesUnits).toBe(250);
    expect(r.surplusUnits).toBe(250);
    expect(r.lines[0].quantity).toBe(250);
  });
  it('fills the largest-capacity destination first, ties by cost', () => {
    const r = analyzeRedistribution({
      batch,
      now,
      minShelfLifeDays: 1,
      sourceDailyDemand: 0,
      destinations: [
        { ...B, warehouseId: 'C', warehouseName: 'Warehouse C', dailyDemand: 50, onHand: 0 },
        B,
        { ...B, warehouseId: 'D', warehouseName: 'Warehouse D', dailyDemand: 50, onHand: 0, costPerUnit: 0.5 },
      ],
    });
    expect(r.lines.map((l) => [l.toWarehouse, l.quantity])).toEqual([
      ['B', 380],
      ['D', 120],
    ]);
    expect(r.residualUnits).toBe(0);
  });
  it('caps capacity at the destination max stock', () => {
    const r = analyzeRedistribution({ batch, now, minShelfLifeDays: 1, sourceDailyDemand: 0, destinations: [{ ...B, maxStock: 300 }] });
    expect(r.lines[0].quantity).toBe(200);
  });
  it('subtracts stock already on order at the destination', () => {
    const r = analyzeRedistribution({ batch, now, minShelfLifeDays: 1, sourceDailyDemand: 0, destinations: [{ ...B, onOrder: 80 }] });
    expect(r.lines[0].quantity).toBe(300);
  });
  it('gives residual advice', () => {
    expect(residualAdviceFor(0, 5, 1)).toBe('none');
    expect(residualAdviceFor(10, 5, 1)).toBe('markdown');
    expect(residualAdviceFor(10, 1, 1)).toBe('donate');
    expect(residualAdviceFor(10, 0, 1)).toBe('dispose');
    expect(residualAdviceFor(10, -2, 1)).toBe('dispose');
  });
  it('floors shelf life left to whole days', () => {
    expect(shelfLifeLeft(in6, now)).toBe(6);
    expect(shelfLifeLeft(new Date(now.getTime() - 1000), now)).toBe(-1);
  });
});

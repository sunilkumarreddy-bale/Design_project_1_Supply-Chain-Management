import { allocateFEFO, planRebalance, projectExpiryWaste, sortFEFO } from '../../src/engines/inventoryLogic';

const day = 24 * 3600 * 1000;
const now = new Date('2026-01-01T00:00:00Z');
const at = (d: number) => new Date(now.getTime() + d * day);

describe('FEFO allocation', () => {
  const lines = [
    { id: 'late', batchNo: 'B2', bin: 'A1', expiryDate: at(30), quantity: 50, createdAt: at(-10) },
    { id: 'none', batchNo: 'B0', bin: 'A1', expiryDate: null, quantity: 100, createdAt: at(-20) },
    { id: 'early', batchNo: 'B1', bin: 'A2', expiryDate: at(5), quantity: 20, createdAt: at(-5) },
    { id: 'early-old', batchNo: 'B1b', bin: 'A3', expiryDate: at(5), quantity: 10, createdAt: at(-9) },
    { id: 'empty', batchNo: 'B9', bin: 'A1', expiryDate: at(1), quantity: 0, createdAt: at(-1) },
  ];
  it('sorts by expiry, undated last, ties by oldest createdAt', () => {
    expect(sortFEFO(lines).map((l) => l.id)).toEqual(['empty', 'early-old', 'early', 'late', 'none']);
  });
  it('takes the earliest-expiring batches first, skipping empty lines', () => {
    const a = allocateFEFO(lines, 45);
    expect(a.map((x) => [x.lineId, x.quantity])).toEqual([
      ['early-old', 10],
      ['early', 20],
      ['late', 15],
    ]);
  });
  it('uses undated stock last', () => {
    const a = allocateFEFO(lines, 100);
    expect(a[a.length - 1]).toMatchObject({ lineId: 'none', quantity: 20 });
  });
  it('throws a RangeError when stock is insufficient', () => {
    expect(() => allocateFEFO(lines, 181)).toThrow('Insufficient stock: have 180, requested 181');
  });
  it('requires a positive quantity', () => {
    expect(() => allocateFEFO(lines, 0)).toThrow(RangeError);
  });
});

describe('expiry-waste projection', () => {
  it('projects units that will expire unsold', () => {
    const r = projectExpiryWaste(
      [
        { batchNo: 'A', bin: '', expiryDate: at(5), quantity: 100 },
        { batchNo: 'B', bin: '', expiryDate: at(10), quantity: 100 },
        { batchNo: 'U', bin: '', expiryDate: null, quantity: 999 },
      ],
      10,
      now,
      3,
    );
    // first batch: 10/day x 5 days = 50 sold, 50 wasted; second: 100 - 50 already sold = 50 more sold, 50 wasted
    expect(r.lines.map((l) => [l.batchNo, l.sellThrough, l.wasteUnits])).toEqual([
      ['A', 50, 50],
      ['B', 50, 50],
    ]);
    expect(r.totalWasteUnits).toBe(100);
    expect(r.totalValueAtRisk).toBe(300);
  });
  it('wastes everything when there is no demand and nothing when demand is high', () => {
    expect(projectExpiryWaste([{ batchNo: 'A', bin: '', expiryDate: at(3), quantity: 40 }], 0, now).totalWasteUnits).toBe(40);
    expect(projectExpiryWaste([{ batchNo: 'A', bin: '', expiryDate: at(3), quantity: 40 }], 100, now).totalWasteUnits).toBe(0);
  });
  it('treats expired batches as fully wasted', () => {
    expect(projectExpiryWaste([{ batchNo: 'A', bin: '', expiryDate: at(-1), quantity: 7 }], 100, now).totalWasteUnits).toBe(7);
  });
});

describe('planRebalance (F4)', () => {
  it('moves 61 units North -> South for ROP 100', () => {
    const r = planRebalance({
      positions: [
        { warehouse: 'North', onHand: 400, onOrder: 0 },
        { warehouse: 'South', onHand: 40, onOrder: 0 },
      ],
      reorderPoint: 100,
    });
    expect(r.keep).toBe(150);
    expect(r.totalSurplus).toBe(250);
    expect(r.transfers).toEqual([{ from: 'North', to: 'South', quantity: 61 }]);
    expect(r.needs).toEqual([{ warehouse: 'South', deficit: 61, covered: 61, uncovered: 0 }]);
  });
  it('reports uncovered need when there are no donors', () => {
    const r = planRebalance({
      positions: [
        { warehouse: 'North', onHand: 120, onOrder: 0 },
        { warehouse: 'South', onHand: 10, onOrder: 20 },
      ],
      reorderPoint: 100,
    });
    expect(r.transfers).toEqual([]);
    expect(r.needs).toEqual([{ warehouse: 'South', deficit: 71, covered: 0, uncovered: 71 }]);
  });
  it('supports a reorder point per warehouse', () => {
    const r = planRebalance({
      positions: [
        { warehouse: 'N', onHand: 400, onOrder: 0, reorderPoint: 200 },
        { warehouse: 'S', onHand: 20, onOrder: 0, reorderPoint: 30 },
      ],
      reorderPoint: 0,
    });
    // N keeps 300 so 100 is surplus; S deficit 30 + 1 - 20 = 11
    expect(r.transfers).toEqual([{ from: 'N', to: 'S', quantity: 11 }]);
  });
  it('serves the neediest first from the largest donors', () => {
    const r = planRebalance({
      positions: [
        { warehouse: 'N', onHand: 300, onOrder: 0 },
        { warehouse: 'E', onHand: 200, onOrder: 0 },
        { warehouse: 'S', onHand: 0, onOrder: 0 },
        { warehouse: 'W', onHand: 60, onOrder: 0 },
      ],
      reorderPoint: 100,
    });
    // keep 150: N surplus 150, E surplus 50; S deficit 101, W deficit 41
    expect(r.needs.map((n) => n.warehouse)).toEqual(['S', 'W']);
    expect(r.transfers).toEqual([
      { from: 'N', to: 'S', quantity: 101 },
      { from: 'E', to: 'W', quantity: 41 },
    ]);
  });
});

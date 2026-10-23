import {
  analyzeRecovery,
  minStockFor,
  RecoveryInput,
  requiredUnitsFor,
  transferableUnits,
} from '../../src/engines/recoveryEngine';

const exampleA: RecoveryInput = {
  productName: 'Critical Component X',
  targetWarehouseName: 'Warehouse A',
  horizonDays: 7,
  onHand: 10,
  inbound: 0,
  dailyDemand: 30,
  minStock: 100,
  transferSources: [
    { warehouseId: 'B', warehouseName: 'Warehouse B', onHand: 435, minStock: 200, dailyDemand: 5, leadTimeDays: 1, costPerUnit: 2 },
  ],
  supplierOffers: [
    { supplierId: 'initech', supplierName: 'Initech Supplies', capacityUnits: 100, minOrderQty: 10, leadTimeDays: 3, unitCost: 62 },
  ],
};

describe('minimum and transferable stock (3.6)', () => {
  it('uses the policy minimum, else ceil(safety stock)', () => {
    expect(minStockFor(100, 37.2)).toBe(100);
    expect(minStockFor(null, 37.2)).toBe(38);
    expect(minStockFor(0, 37.2)).toBe(0);
  });
  it('keeps the minimum plus the horizon demand', () => {
    expect(transferableUnits(435, 200, 5, 7)).toBe(200);
    expect(transferableUnits(100, 200, 5, 7)).toBe(0);
    expect(transferableUnits(300, 0, 2.5, 3)).toBe(292);
  });
  it('computes required units', () => {
    expect(requiredUnitsFor(30, 7, 100, 10, 0)).toBe(300);
    expect(requiredUnitsFor(30, 7, 100, 400, 0)).toBe(0);
  });
});

describe('recovery engine: Example A', () => {
  const r = analyzeRecovery(exampleA);
  it('needs 300 units', () => {
    expect(r.needed).toBe(true);
    expect(r.context).toMatchObject({ onHand: 10, dailyDemand: 30, minStock: 100, horizonDays: 7, requiredUnits: 300 });
  });
  it('ranks transfer 200 from B + buy 100 from Initech first with 0 shortage, Rs 6,600, ETA 3 days', () => {
    const top = r.options[0];
    expect(top.rank).toBe(1);
    expect(top.steps.map((s) => [s.type, s.fromWarehouse ?? s.supplier, s.quantity])).toEqual([
      ['transfer', 'B', 200],
      ['purchase', 'initech', 100],
    ]);
    expect(top.shortageLeft).toBe(0);
    expect(top.totalCost).toBe(6600);
    expect(top.etaDays).toBe(3);
    expect(top.feasible).toBe(true);
    expect(top.constraintChecks.every((c) => c.passed)).toBe(true);
    expect(top.explanation[0]).toBe(
      'Transfer 200 units from Warehouse B (stock 435 - minimum 200 - 5/day x 7 days = 200 available, 1 day, Rs 2/unit)',
    );
    expect(top.explanation).toContain(
      'Covers 300 of 300 required units; shortage left 0; total cost Rs 6,600; ETA 3 days',
    );
  });
  it('ranks transfers only second (shortage 100) and supplier only third (shortage 200)', () => {
    expect(r.options).toHaveLength(3);
    expect(r.options[1]).toMatchObject({ optionId: 'transfers_only', shortageLeft: 100, totalCost: 400, etaDays: 1, rank: 2 });
    expect(r.options[2]).toMatchObject({ optionId: 'supplier_initech', shortageLeft: 200, totalCost: 6200, rank: 3 });
  });
  it('de-duplicates identical plans', () => {
    expect(r.candidateCount).toBe(3);
  });
});

describe('recovery engine edge cases', () => {
  it('returns needed:false when there is no shortage', () => {
    const r = analyzeRecovery({ ...exampleA, onHand: 1000 });
    expect(r).toMatchObject({ needed: false, message: 'No shortage within the horizon', options: [] });
  });
  it('excludes sources whose lead time exceeds the horizon', () => {
    const r = analyzeRecovery({
      ...exampleA,
      supplierOffers: [{ ...exampleA.supplierOffers[0], leadTimeDays: 9 }],
    });
    expect(r.sources.find((s) => s.kind === 'purchase')).toMatchObject({ feasible: false });
    expect(r.options.every((o) => o.steps.every((s) => s.type === 'transfer'))).toBe(true);
  });
  it('raises purchases to the MOQ and flags the overshoot', () => {
    const r = analyzeRecovery({
      ...exampleA,
      requiredUnits: 205,
      supplierOffers: [{ ...exampleA.supplierOffers[0], minOrderQty: 50 }],
    });
    const top = r.options[0];
    expect(top.steps.find((s) => s.type === 'purchase')!.quantity).toBe(50);
    expect(top.constraintChecks.find((c) => c.name === 'MOQ respected')!.passed).toBe(true);
    expect(top.explanation.some((e) => e.includes('extra units'))).toBe(true);
  });
  it('skips suppliers whose capacity is below the MOQ', () => {
    const r = analyzeRecovery({ ...exampleA, supplierOffers: [{ ...exampleA.supplierOffers[0], capacityUnits: 5 }] });
    expect(r.sources.find((s) => s.kind === 'purchase')!.feasible).toBe(false);
  });
  it('never takes a donor below its minimum stock plus horizon demand', () => {
    const r = analyzeRecovery({ ...exampleA, requiredUnits: 10000, supplierOffers: [] });
    const t = r.options[0].steps[0];
    expect(t.quantity).toBe(200);
    expect(435 - t.quantity).toBeGreaterThanOrEqual(200);
    expect(r.options[0].constraintChecks[0].passed).toBe(true);
  });
  it('reports when no feasible source exists', () => {
    const r = analyzeRecovery({ ...exampleA, transferSources: [], supplierOffers: [] });
    expect(r.needed).toBe(true);
    expect(r.options).toEqual([]);
    expect(r.message).toMatch(/no feasible source/);
  });
  it('honours a given required quantity', () => {
    expect(analyzeRecovery({ ...exampleA, requiredUnits: 50 }).options[0]).toMatchObject({ coveredUnits: 50, totalCost: 100 });
  });
});

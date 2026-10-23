import {
  applyDisruption,
  buildGraph,
  compareStrategies,
  nodeId,
  sensitivitySweep,
  SimInput,
  simulate,
  StrategySources,
  traverseImpact,
} from '../../src/engines/simulationEngine';

const pos = (w: string, p: string, extra: Partial<SimInput['positions'][number]>) => ({
  key: `${w}:${p}`,
  warehouseId: w,
  warehouseName: `Warehouse ${w}`,
  productId: p,
  productName: p === 'X' ? 'Component X' : 'Assembled Unit',
  sku: p === 'X' ? 'SKU-CMP-010' : 'SKU-ASM-030',
  unitPrice: p === 'X' ? 80 : 500,
  onHand: 0,
  dailyDemand: 0,
  minStock: 0,
  receipts: [],
  ...extra,
});

/** Mirrors the seeded domino demo: Acme makes component X; assembled unit U needs 1 X. */
function dominoInput(durationDays = 5): SimInput {
  return {
    horizonDays: 30,
    backorders: false,
    disruption: { type: 'supplier_stop', supplierId: 'acme', startDay: 0, durationDays },
    positions: [
      pos('A', 'X', { onHand: 10, dailyDemand: 30, minStock: 100, receipts: [{ day: 4, quantity: 300, supplierId: 'acme', reference: 'PO-1' }] }),
      pos('B', 'X', { onHand: 435, dailyDemand: 5, minStock: 200 }),
      pos('A', 'U', { onHand: 5, dailyDemand: 2 }),
      pos('B', 'U', { onHand: 5, dailyDemand: 2 }),
    ],
    dependencies: [{ componentProductId: 'X', finishedProductId: 'U', quantityPer: 1 }],
    orders: [
      { orderId: 'o1', orderNo: 'O1', customerName: 'Alpha', warehouseId: 'A', productId: 'U', quantity: 20, dueDay: 3, priority: 'high' },
      { orderId: 'o2', orderNo: 'O2', customerName: 'Beta', warehouseId: 'A', productId: 'U', quantity: 30, dueDay: 8, priority: 'normal' },
      { orderId: 'o3', orderNo: 'O3', customerName: 'Gamma', warehouseId: 'B', productId: 'U', quantity: 15, dueDay: 5, priority: 'normal' },
      { orderId: 'o4', orderNo: 'O4', customerName: 'Delta', warehouseId: 'B', productId: 'U', quantity: 25, dueDay: 10, priority: 'low' },
    ],
  };
}

const sources: StrategySources = {
  routes: [
    { fromWarehouseId: 'B', toWarehouseId: 'A', leadTimeDays: 1, costPerUnit: 2 },
    { fromWarehouseId: 'A', toWarehouseId: 'B', leadTimeDays: 1, costPerUnit: 2 },
  ],
  offersByProduct: {
    X: [{ supplierId: 'initech', supplierName: 'Initech Supplies', capacityUnits: 100, minOrderQty: 10, leadTimeDays: 3, unitCost: 62 }],
  },
};

describe('dependency graph', () => {
  const graph = buildGraph({
    suppliers: [
      { id: 'acme', name: 'Acme' },
      { id: 'initech', name: 'Initech' },
    ],
    products: [
      { id: 'X', name: 'Component X', sku: 'X', primarySupplierId: 'acme' },
      { id: 'U', name: 'Assembled Unit', sku: 'U', primarySupplierId: null },
      { id: 'S', name: 'Steel', sku: 'S', primarySupplierId: 'initech' },
    ],
    offers: [{ supplierId: 'initech', productId: 'X' }],
    dependencies: [{ componentProductId: 'X', finishedProductId: 'U', quantityPer: 1 }],
    positions: [
      { warehouseId: 'A', warehouseName: 'A', productId: 'X' },
      { warehouseId: 'A', warehouseName: 'A', productId: 'U' },
      { warehouseId: 'A', warehouseName: 'A', productId: 'S' },
    ],
    orders: [{ orderId: 'o1', orderNo: 'O1', warehouseId: 'A', productIds: ['U'] }],
  });
  it('builds nodes and edges of every kind', () => {
    expect(graph.nodes).toHaveLength(2 + 3 + 3 + 1);
    expect(new Set(graph.edges.map((e) => e.kind))).toEqual(
      new Set(['supplies', 'offers', 'component_of', 'stocked_at', 'ordered_by']),
    );
  });
  it('traverses supplier -> component -> finished -> position -> order, not following offers', () => {
    const r = traverseImpact(graph, nodeId.supplier('acme'));
    expect(r.affectedNodeIds).toEqual(
      expect.arrayContaining([nodeId.product('X'), nodeId.product('U'), nodeId.position('A', 'U'), nodeId.order('o1')]),
    );
    expect(r.affectedNodeIds).not.toContain(nodeId.product('S'));
    expect(r.paths[nodeId.order('o1')]).toEqual([
      nodeId.supplier('acme'),
      nodeId.product('X'),
      nodeId.product('U'),
      nodeId.position('A', 'U'),
      nodeId.order('o1'),
    ]);
    expect(traverseImpact(graph, nodeId.supplier('initech')).affectedNodeIds).not.toContain(nodeId.product('X'));
  });
});

describe('disruption of receipts', () => {
  const receipts = [
    { day: 2, quantity: 10, supplierId: 'acme' },
    { day: 6, quantity: 10, supplierId: 'acme' },
    { day: 3, quantity: 10, supplierId: 'other' },
  ];
  it('moves the stopped supplier receipts inside the window to the day after it', () => {
    const r = applyDisruption(receipts, 'X', { type: 'supplier_stop', supplierId: 'acme', startDay: 0, durationDays: 5 });
    expect(r.receipts.map((x) => x.day)).toEqual([6, 6, 3]);
    expect(r.moved).toEqual([{ reference: undefined, quantity: 10, fromDay: 2, toDay: 6 }]);
  });
  it('delays every later receipt of a delayed supplier', () => {
    const r = applyDisruption(receipts, 'X', { type: 'supplier_delay', supplierId: 'acme', startDay: 0, durationDays: 4 });
    expect(r.receipts.map((x) => x.day)).toEqual([6, 10, 3]);
  });
  it('stops receipts of a component product from any supplier', () => {
    const r = applyDisruption(receipts, 'X', { type: 'component_stop', productId: 'X', startDay: 0, durationDays: 5 });
    expect(r.receipts.map((x) => x.day)).toEqual([6, 6, 6]);
    expect(applyDisruption(receipts, 'Y', { type: 'component_stop', productId: 'X', startDay: 0, durationDays: 5 }).moved).toEqual([]);
  });
});

describe('inventory-flow simulation', () => {
  const base = simulate(dominoInput());
  it('never produces negative stock and conserves units', () => {
    for (const p of base.perPosition) {
      for (const d of p.daily) expect(d.stock).toBeGreaterThanOrEqual(0);
    }
    const ax = base.perPosition.find((p) => p.key === 'A:X')!;
    // 10 on hand + 300 received = sold own + consumed by assembly + left
    const au = base.perPosition.find((p) => p.key === 'A:U')!;
    const assembledFromX = au.soldUnits - 5;
    const last = ax.daily[ax.daily.length - 1].stock;
    expect(10 + 300).toBeCloseTo(ax.soldUnits + assembledFromX + last, 6);
  });
  it('shifts the delayed Acme receipt to day 6', () => {
    const ax = base.perPosition.find((p) => p.key === 'A:X')!;
    expect(ax.delayedReceipts).toEqual([{ reference: 'PO-1', quantity: 300, fromDay: 4, toDay: 6 }]);
    expect(ax.daily[5]).toMatchObject({ day: 6, receipts: 300 });
    expect(ax.stockoutDay).toBe(1);
    // days 1-5 before the delayed receipt: 20 short on day 1, then 30 a day
    expect(ax.daily.slice(0, 5).reduce((t, d) => t + d.unmet, 0)).toBe(20 + 30 * 4);
    expect(ax.unmetUnits).toBeGreaterThanOrEqual(140);
  });
  it('finds a late order at Warehouse A', () => {
    const o1 = base.orders.find((o) => o.orderNo === 'O1')!;
    expect(o1).toMatchObject({ status: 'late', daysLate: 3, unfilled: 0 });
    expect(base.metrics.lateOrders).toBeGreaterThanOrEqual(1);
    expect(base.metrics.affectedPositions).toBeGreaterThanOrEqual(1);
  });
  it('pulls finished-product demand through to the component', () => {
    const ax = base.perPosition.find((p) => p.key === 'A:X')!;
    expect(ax.daily[2].pulledDemand).toBeGreaterThan(0);
  });
  it('classifies at-risk orders when cover after the order is below one day', () => {
    const r = simulate({
      ...dominoInput(),
      positions: [pos('A', 'U', { onHand: 22, dailyDemand: 2 })],
      dependencies: [],
      orders: [{ orderId: 'z', orderNo: 'Z', customerName: 'Z', warehouseId: 'A', productId: 'U', quantity: 19, dueDay: 1, priority: 'normal' }],
    });
    expect(r.orders[0].status).toBe('at_risk');
    expect(r.orders[0].lines[0]).toMatchObject({ status: 'at_risk', coverDaysAfter: 0.5 });
  });
  it('carries unmet demand as a backlog when backorders are on', () => {
    const lost = simulate({ ...dominoInput(), backorders: false });
    const back = simulate({ ...dominoInput(), backorders: true });
    const ax = back.perPosition.find((p) => p.key === 'A:X')!;
    expect(ax.daily[5].demand).toBeGreaterThan(30);
    expect(back.metrics.shortageUnits).toBeLessThanOrEqual(lost.metrics.shortageUnits);
    expect(ax.daily[29].unmet).toBe(ax.unmetUnits);
  });
  it('lowers starting stock with a smaller safety-stock multiplier', () => {
    const r = simulate({ ...dominoInput(), safetyStockMultiplier: 0.5 });
    expect(r.perPosition.find((p) => p.key === 'B:X')!.onHand).toBe(335);
  });
});

describe('strategy comparison', () => {
  const cmp = compareStrategies(dominoInput(), sources);
  const get = (n: string) => cmp.strategies.find((s) => s.name === n)!;
  it('returns all four strategies with the baseline first', () => {
    expect(cmp.strategies.map((s) => s.name)).toEqual(['none', 'transfers', 'alternative_supplier', 'combined']);
    expect(get('none').metrics).toEqual(cmp.baseline.metrics);
    expect(get('none').actions).toEqual([]);
  });
  it('combined is no worse than the baseline and never makes stock negative', () => {
    const c = get('combined');
    expect(c.metrics.shortageUnits).toBeLessThanOrEqual(cmp.baseline.metrics.shortageUnits);
    expect(c.metrics.lateOrders).toBeLessThanOrEqual(cmp.baseline.metrics.lateOrders);
    expect(c.deltas.shortageUnits).toBeLessThan(0);
    for (const p of c.perPosition) for (const d of p.daily) expect(d.stock).toBeGreaterThanOrEqual(0);
  });
  it('transfers move stock from B to A without taking B below its minimum', () => {
    const t = get('transfers');
    expect(t.actions.length).toBeGreaterThan(0);
    expect(t.actions.every((a) => a.type === 'transfer' && a.fromKey === 'B:X' && a.toKey === 'A:X')).toBe(true);
    const moved = t.actions.reduce((s, a) => s + a.quantity, 0);
    expect(435 - moved).toBeGreaterThanOrEqual(200);
    expect(t.metrics.shortageUnits).toBeLessThan(cmp.baseline.metrics.shortageUnits);
    expect(t.metrics.actionCost).toBe(moved * 2);
  });
  it('alternative supplier buys from Initech, not the disrupted Acme', () => {
    const a = get('alternative_supplier');
    expect(a.actions.every((x) => x.type === 'purchase' && x.supplierId === 'initech')).toBe(true);
    expect(a.metrics.etaDays).toBe(3);
  });
});

describe('sensitivity sweep', () => {
  it('returns a 4 x 3 matrix with a result per strategy', () => {
    const sweep = sensitivitySweep(dominoInput(), sources);
    expect(sweep.durations).toEqual([3, 5, 7, 10]);
    expect(sweep.multipliers).toEqual([0.5, 1, 1.5]);
    expect(sweep.cells).toHaveLength(12);
    for (const c of sweep.cells) {
      expect(Object.keys(c.shortageUnits).sort()).toEqual(['alternative_supplier', 'combined', 'none', 'transfers']);
      expect(c.shortageUnits.combined).toBeLessThanOrEqual(c.shortageUnits.none);
    }
    const short = (d: number, m: number) => sweep.cells.find((c) => c.durationDays === d && c.safetyStockMultiplier === m)!;
    expect(short(10, 1).shortageUnits.none).toBeGreaterThanOrEqual(short(3, 1).shortageUnits.none);
  });
});

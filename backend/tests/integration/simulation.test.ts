import { CustomerOrder, Product, ProductDependency, PurchaseOrder, RecoveryPlan, SimulationRun, StockPolicy, SupplierOffer, TransferRoute } from '../../src/models';
import { api, auth, clearDb, day, makeWorld, putStock, seedDemand, startDb, stopDb, World } from './helpers';

let w: World;
let compX: InstanceType<typeof Product>;
let unit: InstanceType<typeof Product>;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  w = await makeWorld();
  compX = await Product.create({ sku: 'SKU-CMP-010', name: 'Critical Component X', unitCost: 80, unitPrice: 150, primarySupplier: w.acme._id, avgDailyDemand: 30 });
  unit = await Product.create({ sku: 'SKU-ASM-030', name: 'Assembled Unit', unitCost: 300, unitPrice: 500, avgDailyDemand: 2 });
  await ProductDependency.create({ componentProduct: compX._id, finishedProduct: unit._id, quantityPer: 1 });
  await putStock(compX._id, w.north._id, 10);
  await putStock(compX._id, w.south._id, 435);
  await putStock(unit._id, w.north._id, 5);
  await putStock(unit._id, w.south._id, 5);
  await seedDemand(compX._id, w.north._id, 30);
  await seedDemand(compX._id, w.south._id, 5);
  await seedDemand(unit._id, w.north._id, 2);
  await seedDemand(unit._id, w.south._id, 2);
  await StockPolicy.create([
    { product: compX._id, warehouse: w.north._id, minStock: 100 },
    { product: compX._id, warehouse: w.south._id, minStock: 200 },
  ]);
  await TransferRoute.create([
    { fromWarehouse: w.south._id, toWarehouse: w.north._id, leadTimeDays: 1, costPerUnit: 2 },
    { fromWarehouse: w.north._id, toWarehouse: w.south._id, leadTimeDays: 1, costPerUnit: 2 },
  ]);
  await SupplierOffer.create({ supplier: w.initech._id, product: compX._id, capacityUnits: 100, minOrderQty: 10, leadTimeDays: 3, unitCost: 62 });
  await PurchaseOrder.create({
    poNumber: 'PO-TEST-1',
    supplier: w.acme._id,
    warehouse: w.north._id,
    status: 'approved',
    approvedAt: new Date(),
    expectedDeliveryDate: day(4),
    items: [{ product: compX._id, quantityOrdered: 300, unitCost: 80 }],
  });
  await CustomerOrder.create([
    { orderNo: 'O1', customerName: 'Alpha Retail', warehouse: w.north._id, requiredBy: day(3), priority: 'high', items: [{ product: unit._id, quantity: 20 }] },
    { orderNo: 'O2', customerName: 'Beta Stores', warehouse: w.north._id, requiredBy: day(8), items: [{ product: unit._id, quantity: 30 }] },
    { orderNo: 'O3', customerName: 'Gamma Mart', warehouse: w.south._id, requiredBy: day(5), items: [{ product: unit._id, quantity: 15 }] },
    { orderNo: 'O4', customerName: 'Delta Shop', warehouse: w.south._id, requiredBy: day(10), priority: 'low', items: [{ product: unit._id, quantity: 25 }] },
  ]);
});
afterEach(clearDb);

const scenario = () => ({ name: 'Acme stops 5 days', type: 'supplier_stop', supplier: w.acme._id.toHexString(), durationDays: 5, horizonDays: 30 });

describe('Domino Effect Predictor', () => {
  it('builds the dependency graph from live data', async () => {
    const r = await api().get(`/api/simulation/graph?supplier=${w.acme._id}`).set(auth(w.manager.token));
    expect(r.status).toBe(200);
    const affected = new Set(r.body.affectedNodeIds);
    expect(affected.has(`product:${compX._id}`)).toBe(true);
    expect(affected.has(`product:${unit._id}`)).toBe(true);
    expect(r.body.graph.nodes.filter((n: any) => n.type === 'order' && n.affected)).toHaveLength(4);
  });

  it('component maker stops 5 days: baseline is late somewhere, combined is no worse and never negative', async () => {
    const r = await api().post('/api/simulation/run').set(auth(w.manager.token)).send({ scenario: scenario(), sweep: true });
    expect(r.status).toBe(201);
    const run = r.body;
    expect(run.baseline.metrics.affectedPositions).toBeGreaterThanOrEqual(1);
    expect(run.baseline.metrics.lateOrders).toBeGreaterThanOrEqual(1);
    const o1 = run.baseline.orders.find((o: any) => o.orderNo === 'O1');
    expect(o1.status).toBe('late');
    const ax = run.baseline.perPosition.find((p: any) => p.key === `${w.north._id}:${compX._id}`);
    expect(ax.delayedReceipts).toEqual([expect.objectContaining({ reference: 'PO-TEST-1', fromDay: 4, toDay: 6 })]);
    const combined = run.strategies.find((s: any) => s.name === 'combined');
    expect(combined.metrics.shortageUnits).toBeLessThanOrEqual(run.baseline.metrics.shortageUnits);
    for (const p of combined.perPosition) for (const d of p.daily) expect(d.stock).toBeGreaterThanOrEqual(0);
    expect(run.strategies.map((s: any) => s.name)).toEqual(['none', 'transfers', 'alternative_supplier', 'combined']);
    expect(run.sweep.cells).toHaveLength(12);
    expect(run.graph.nodes.length).toBeGreaterThan(0);
    expect(run.baseline.dailySeries.length).toBe(run.baseline.perPosition.length);
  });

  it('saves scenarios and runs and lists them', async () => {
    const s = await api().post('/api/simulation/scenarios').set(auth(w.admin.token)).send(scenario());
    expect(s.status).toBe(201);
    const run = await api().post('/api/simulation/run').set(auth(w.admin.token)).send({ scenario: s.body._id, strategies: ['combined'] });
    expect(run.body.strategies.map((x: any) => x.name)).toEqual(['none', 'combined']);
    expect(run.body.sweep).toBeNull();
    expect((await api().get('/api/simulation/scenarios').set(auth(w.admin.token))).body.total).toBe(1);
    const runs = await api().get('/api/simulation/runs').set(auth(w.admin.token));
    expect(runs.body.total).toBe(1);
    const one = await api().get(`/api/simulation/runs/${run.body._id}`).set(auth(w.admin.token));
    expect(one.body.baseline.metrics).toEqual(run.body.baseline.metrics);
    expect(await SimulationRun.countDocuments()).toBe(1);
  });

  it('turns a strategy into a proposed recovery plan', async () => {
    const run = (await api().post('/api/simulation/run').set(auth(w.manager.token)).send({ scenario: scenario() })).body;
    const r = await api()
      .post(`/api/simulation/runs/${run._id}/create-recovery-plan`)
      .set(auth(w.manager.token))
      .send({ strategy: 'combined', positionKey: `${w.north._id}:${compX._id}` });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'proposed', trigger: { kind: 'supplier_delay' } });
    expect(await RecoveryPlan.countDocuments()).toBe(1);
  });

  it('validates scenarios and denies staff', async () => {
    expect((await api().post('/api/simulation/run').set(auth(w.admin.token)).send({ scenario: { type: 'supplier_stop', durationDays: 3 } })).status).toBe(400);
    expect((await api().post('/api/simulation/run').set(auth(w.staff.token)).send({ scenario: scenario() })).status).toBe(403);
  });
});

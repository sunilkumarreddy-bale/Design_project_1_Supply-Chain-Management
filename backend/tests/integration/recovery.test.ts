import { Product, PurchaseOrder, RecoveryPlan, StockLevel, StockPolicy, Supplier, SupplierOffer, Transfer, TransferRoute } from '../../src/models';
import { api, auth, clearDb, makeWorld, putStock, seedDemand, startDb, stopDb, World } from './helpers';

let w: World;
let compX: InstanceType<typeof Product>;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  w = await makeWorld();
  compX = await Product.create({ sku: 'SKU-CMP-010', name: 'Critical Component X', unitCost: 80, unitPrice: 150, primarySupplier: w.acme._id, avgDailyDemand: 30 });
  await putStock(compX._id, w.north._id, 10);
  await putStock(compX._id, w.south._id, 435);
  await seedDemand(compX._id, w.north._id, 30);
  await seedDemand(compX._id, w.south._id, 5);
  await StockPolicy.create([
    { product: compX._id, warehouse: w.north._id, minStock: 100 },
    { product: compX._id, warehouse: w.south._id, minStock: 200 },
  ]);
  await TransferRoute.create({ fromWarehouse: w.south._id, toWarehouse: w.north._id, leadTimeDays: 1, costPerUnit: 2 });
  await SupplierOffer.create({ supplier: w.initech._id, product: compX._id, capacityUnits: 100, minOrderQty: 10, leadTimeDays: 3, unitCost: 62 });
});
afterEach(clearDb);

async function disruptAcme() {
  const r = await api().post(`/api/suppliers/${w.acme._id}/disruption`).set(auth(w.manager.token)).send({ expectedDays: 7, reason: 'Plant fire' });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('disrupted');
}

async function analyzeA() {
  const r = await api().post('/api/recovery/analyze').set(auth(w.manager.token)).send({ product: compX._id, warehouse: w.north._id });
  expect(r.status).toBe(200);
  return r.body;
}

async function proposeTop() {
  const a = await analyzeA();
  const r = await api()
    .post('/api/recovery/plans')
    .set(auth(w.manager.token))
    .send({ analysisInput: { product: compX._id, warehouse: w.north._id }, selectedOptionId: a.result.options[0].optionId });
  expect(r.status).toBe(201);
  return r.body;
}

describe('recovery engine on live data (Example A)', () => {
  it('returns the 200 + 100 plan with zero shortage when Acme is disrupted for 7 days', async () => {
    await disruptAcme();
    const a = await analyzeA();
    expect(a.excludedSupplier).toMatchObject({ name: 'Acme Components' });
    expect(a.horizonSource).toMatch(/Acme Components disruption \(7 days\)/);
    expect(a.result.context).toMatchObject({ onHand: 10, inboundWithinHorizon: 0, dailyDemand: 30, minStock: 100, horizonDays: 7, requiredUnits: 300 });
    const [top, second, third] = a.result.options;
    expect(top.steps.map((s: any) => [s.type, s.quantity])).toEqual([
      ['transfer', 200],
      ['purchase', 100],
    ]);
    expect(top).toMatchObject({ shortageLeft: 0, totalCost: 6600, etaDays: 3, rank: 1, feasible: true });
    expect(second).toMatchObject({ shortageLeft: 100 });
    expect(third).toMatchObject({ shortageLeft: 200 });
    expect(top.explanation[0]).toBe('Transfer 200 units from Warehouse B (stock 435 - minimum 200 - 5/day x 7 days = 200 available, 1 day, Rs 2/unit)');
  });

  it('runs propose -> approve -> dispatch -> receive -> completed', async () => {
    await disruptAcme();
    const plan = await proposeTop();
    expect(plan).toMatchObject({ status: 'proposed', selectedOptionId: 'transfers_then_supplier' });
    expect(plan.planNo).toMatch(/^RP-\d{4}-0001$/);
    expect((await api().post(`/api/recovery/plans/${plan._id}/approve`).set(auth(w.manager.token))).status).toBe(403);

    const approved = await api().post(`/api/recovery/plans/${plan._id}/approve`).set(auth(w.admin.token));
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('in_progress');
    const transfers = await Transfer.find({ plan: plan._id }).lean();
    expect(transfers).toEqual([expect.objectContaining({ status: 'approved', quantity: 200, mode: 'tracked', source: 'recovery_plan' })]);
    const pos = await PurchaseOrder.find({ recoveryPlan: plan._id }).lean();
    expect(pos).toEqual([expect.objectContaining({ status: 'approved', source: 'recovery_plan', supplier: w.initech._id })]);
    expect(pos[0].items[0]).toMatchObject({ quantityOrdered: 100, unitCost: 62 });

    const detail = await api().get(`/api/recovery/plans/${plan._id}`).set(auth(w.manager.token));
    expect(detail.body.transfers).toHaveLength(1);
    expect(detail.body.purchaseOrders).toHaveLength(1);
    expect(detail.body.timeline.map((t: any) => t.event)).toEqual(['proposed', 'approved', 'in_progress']);

    await api().post(`/api/transfers/${transfers[0]._id}/dispatch`).set(auth(w.southManager.token)).expect(200);
    await api().post(`/api/transfers/${transfers[0]._id}/receive`).set(auth(w.staff.token)).expect(200);
    expect((await RecoveryPlan.findById(plan._id))!.status).toBe('in_progress');

    await api()
      .post(`/api/purchase-orders/${pos[0]._id}/receive`)
      .set(auth(w.staff.token))
      .send({ receivedItems: [{ product: compX._id, quantityReceived: 100 }] })
      .expect(200);
    const done = (await RecoveryPlan.findById(plan._id))!;
    expect(done.status).toBe('completed');
    expect(done.execution!.completedAt).toBeInstanceOf(Date);
    const northQty = (await StockLevel.find({ product: compX._id, warehouse: w.north._id }).lean()).reduce((s, l) => s + l.quantity, 0);
    expect(northQty).toBe(310);
  });

  it('marks the plan failed when a step is cancelled', async () => {
    await disruptAcme();
    const plan = await proposeTop();
    await api().post(`/api/recovery/plans/${plan._id}/approve`).set(auth(w.admin.token)).expect(200);
    const t = await Transfer.findOne({ plan: plan._id });
    await api().post(`/api/transfers/${t!._id}/cancel`).set(auth(w.admin.token)).expect(200);
    const p = (await RecoveryPlan.findById(plan._id))!;
    expect(p.status).toBe('failed');
    expect(p.timeline[p.timeline.length - 1]).toMatchObject({ event: 'failed' });
  });

  it('rejects and cancels proposed plans', async () => {
    await disruptAcme();
    const a = await proposeTop();
    const rej = await api().post(`/api/recovery/plans/${a._id}/reject`).set(auth(w.admin.token)).send({ reason: 'Too costly' });
    expect(rej.body).toMatchObject({ status: 'rejected', rejectedReason: 'Too costly' });
    expect((await api().post(`/api/recovery/plans/${a._id}/approve`).set(auth(w.admin.token))).status).toBe(409);
    const b = await proposeTop();
    expect((await api().post(`/api/recovery/plans/${b._id}/cancel`).set(auth(w.southManager.token))).status).toBe(403);
    expect((await api().post(`/api/recovery/plans/${b._id}/cancel`).set(auth(w.manager.token))).body.status).toBe('cancelled');
    const list = await api().get('/api/recovery/plans').set(auth(w.admin.token));
    expect(list.body.items.map((p: any) => p.status).sort()).toEqual(['cancelled', 'rejected']);
  });

  it('reports no shortage after the disruption is cleared and stock arrives', async () => {
    await disruptAcme();
    await api().delete(`/api/suppliers/${w.acme._id}/disruption`).set(auth(w.manager.token)).expect(200);
    expect((await Supplier.findById(w.acme._id))!.status).toBe('active');
    await putStock(compX._id, w.north._id, 1000, { bin: 'A2' });
    const a = await analyzeA();
    expect(a.result).toMatchObject({ needed: false, message: 'No shortage within the horizon' });
    expect(a.horizonSource).toBe('default 7 days');
  });

  it('is closed to staff and to managers of other warehouses', async () => {
    expect((await api().post('/api/recovery/analyze').set(auth(w.staff.token)).send({ product: compX._id, warehouse: w.north._id })).status).toBe(403);
    expect((await api().post('/api/recovery/analyze').set(auth(w.southManager.token)).send({ product: compX._id, warehouse: w.north._id })).status).toBe(403);
  });
});

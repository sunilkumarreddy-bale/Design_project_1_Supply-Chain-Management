import { DnaEvent, RedistributionPlan, StockLevel, StockLot, Transfer, TransferRoute } from '../../src/models';
import { DAY_MS } from '../../src/utils/dates';
import { api, auth, clearDb, day, makeWorld, seedDemand, startDb, stopDb, World } from './helpers';

let w: World;
let batchId: string;
const expiry = () => new Date(Date.now() + 6.5 * DAY_MS);

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  w = await makeWorld();
  const line = await StockLevel.create({ product: w.milk._id, warehouse: w.north._id, bin: 'A1', batchNo: 'MLK-A-001', expiryDate: expiry(), quantity: 500 });
  batchId = line._id.toHexString();
  await StockLevel.create({ product: w.milk._id, warehouse: w.south._id, bin: 'A1', batchNo: 'MLK-B-001', expiryDate: day(9), quantity: 100 });
  await seedDemand(w.milk._id, w.north._id, 0);
  await seedDemand(w.milk._id, w.south._id, 120);
  await TransferRoute.create({ fromWarehouse: w.north._id, toWarehouse: w.south._id, leadTimeDays: 1, costPerUnit: 1.5 });
});
afterEach(clearDb);

describe('expiry-aware redistribution (Example B)', () => {
  it('scan finds the at-risk milk batch and recommends 380 to Warehouse B, residual 120', async () => {
    const r = await api().post('/api/redistribution/scan').set(auth(w.manager.token));
    expect(r.status).toBe(200);
    const c = r.body.items.find((x: any) => x.stockLevelId === batchId);
    expect(c).toBeTruthy();
    expect(c.projectedWaste).toBe(500);
    expect(c.result).toMatchObject({ shelfLifeDaysLeft: 6, sourceOwnSalesUnits: 0, surplusUnits: 500, residualUnits: 120, residualAdvice: 'markdown' });
    expect(c.result.lines).toEqual([expect.objectContaining({ toWarehouseName: 'Warehouse B', quantity: 380, sellWindowDays: 4, capacityUnits: 380 })]);
    expect(c.result.explanation.join('\n')).toMatch(/Warehouse C: no demand/);
  });

  it('analyze honours a margin override (m = 0: window 5 days, capacity 120 x 5 - 100 = 500)', async () => {
    const r = await api().post('/api/redistribution/analyze').set(auth(w.manager.token)).send({ stockLevelId: batchId, minShelfLifeDays: 0 });
    expect(r.body.result.lines[0]).toMatchObject({ quantity: 500, sellWindowDays: 5, capacityUnits: 500 });
    expect(r.body.result.residualUnits).toBe(0);
  });

  it('approval creates tracked transfers that move the batch with its expiry date intact', async () => {
    const p = await api().post('/api/redistribution/plans').set(auth(w.manager.token)).send({ stockLevelId: batchId });
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ status: 'proposed', residualUnits: 120, batchNo: 'MLK-A-001' });
    expect((await api().post(`/api/redistribution/plans/${p.body._id}/approve`).set(auth(w.manager.token))).status).toBe(403);
    const a = await api().post(`/api/redistribution/plans/${p.body._id}/approve`).set(auth(w.admin.token));
    expect(a.body.status).toBe('in_progress');
    const t = await Transfer.findOne({ plan: p.body._id });
    expect(t).toMatchObject({ status: 'approved', quantity: 380, batchNo: 'MLK-A-001', source: 'redistribution_plan' });
    await api().post(`/api/transfers/${t!._id}/dispatch`).set(auth(w.staff.token)).expect(200);
    await api().post(`/api/transfers/${t!._id}/receive`).set(auth(w.southManager.token)).expect(200);
    const moved = await StockLevel.findOne({ product: w.milk._id, warehouse: w.south._id, batchNo: 'MLK-A-001' }).lean();
    const source = await StockLevel.findById(batchId).lean();
    expect(moved!.quantity).toBe(380);
    expect(moved!.expiryDate!.getTime()).toBe(source!.expiryDate!.getTime());
    expect(source!.quantity).toBe(120);
    expect((await RedistributionPlan.findById(p.body._id))!.status).toBe('completed');
    const detail = await api().get(`/api/redistribution/plans/${p.body._id}`).set(auth(w.admin.token));
    expect(detail.body.transfers[0].status).toBe('completed');
    // Stock DNA (C.12 test 15): the executed plan left a decision_note with its numbers on the batch's lot
    const lot = await StockLot.findOne({ product: w.milk._id, batchNo: 'MLK-A-001' }).lean();
    expect(lot).toMatchObject({ qtyOnHand: 500, qtyInTransit: 0 });
    const note = await DnaEvent.findOne({ lot: lot!._id, type: 'decision_note' }).lean();
    expect(note).toMatchObject({ refType: 'redistribution_plan', refId: expect.anything() });
    expect(note!.explanation).toBe(
      `Redistribution plan ${p.body.planNo}: Warehouse B can sell 120 x 4 days = 480; holds 100; capacity 380; move 380. Residual 120 (markdown).`,
    );
    const types = (await DnaEvent.find({ lot: lot!._id }).sort({ seq: 1 }).lean()).map((g) => g.type);
    expect(types.slice(-3)).toEqual(['decision_note', 'transfer_out', 'transfer_in']);
    expect(detail.body.dnaCodes).toEqual([lot!.dnaCode]);
  });

  it('rejects and cancels proposed plans', async () => {
    const a = await api().post('/api/redistribution/plans').set(auth(w.admin.token)).send({ stockLevelId: batchId });
    expect((await api().post(`/api/redistribution/plans/${a.body._id}/reject`).set(auth(w.admin.token)).send({ reason: 'Will mark down' })).body.status).toBe('rejected');
    const b = await api().post('/api/redistribution/plans').set(auth(w.admin.token)).send({ stockLevelId: batchId });
    expect((await api().post(`/api/redistribution/plans/${b.body._id}/cancel`).set(auth(w.manager.token))).body.status).toBe('cancelled');
    const list = await api().get('/api/redistribution/plans').set(auth(w.manager.token));
    expect(list.body.total).toBe(2);
  });

  it('refuses to propose when no destination can sell the batch', async () => {
    await TransferRoute.updateOne({}, { leadTimeDays: 6 });
    const r = await api().post('/api/redistribution/plans').set(auth(w.admin.token)).send({ stockLevelId: batchId });
    expect(r.status).toBe(409);
  });
});

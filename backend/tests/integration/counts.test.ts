import { Alert, AuditLog, StockLevel } from '../../src/models';
import { api, auth, clearDb, makeWorld, putStock, settle, startDb, stopDb, World } from './helpers';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  w = await makeWorld();
  await putStock(w.bracket._id, w.north._id, 100);
  await putStock(w.cable._id, w.north._id, 50, { bin: 'A2' });
});
afterEach(clearDb);

describe('cycle counts', () => {
  it('create -> count -> submit -> reconcile applies audited adjustments and raises variance alerts', async () => {
    const c = await api().post('/api/stock-counts').set(auth(w.staff.token)).send({ warehouse: w.north._id });
    expect(c.status).toBe(201);
    expect(c.body.countNo).toMatch(/^CC-\d{4}-0001$/);
    expect(c.body.lines).toHaveLength(2);
    const lineFor = (sku: string) => c.body.lines.find((l: any) => l.product.sku === sku);
    const early = await api().post(`/api/stock-counts/${c.body._id}/submit`).set(auth(w.staff.token));
    expect(early.status).toBe(400);
    await api()
      .patch(`/api/stock-counts/${c.body._id}`)
      .set(auth(w.staff.token))
      .send({
        lines: [
          { _id: lineFor('SKU-STL-001')._id, countedQty: 97, reason: 'damaged' },
          { _id: lineFor('SKU-CBL-002')._id, countedQty: 50 },
        ],
      })
      .expect(200);
    const sub = await api().post(`/api/stock-counts/${c.body._id}/submit`).set(auth(w.staff.token));
    expect(sub.body.status).toBe('submitted');
    expect(sub.body.lines.map((l: any) => l.variance).sort()).toEqual([-3, 0]);
    expect((await api().post(`/api/stock-counts/${c.body._id}/reconcile`).set(auth(w.staff.token))).status).toBe(403);
    // stock moved after the count: the variance is applied as a delta
    await StockLevel.updateOne({ product: w.bracket._id, warehouse: w.north._id }, { $inc: { quantity: -10 } });
    const rec = await api().post(`/api/stock-counts/${c.body._id}/reconcile`).set(auth(w.manager.token));
    expect(rec.status).toBe(200);
    expect(rec.body.count.status).toBe('reconciled');
    expect(rec.body.adjustments).toEqual([expect.objectContaining({ from: 90, to: 87, variance: -3 })]);
    await settle();
    expect(await AuditLog.countDocuments({ action: 'stock.adjust' })).toBe(1);
    expect(await Alert.countDocuments({ type: 'count_variance' })).toBe(0);
  });

  it('raises a count_variance alert above 5%', async () => {
    const c = await api().post('/api/stock-counts').set(auth(w.manager.token)).send({ warehouse: w.north._id, product: w.bracket._id });
    await api().patch(`/api/stock-counts/${c.body._id}`).set(auth(w.manager.token)).send({ lines: [{ _id: c.body.lines[0]._id, countedQty: 80 }] });
    await api().post(`/api/stock-counts/${c.body._id}/submit`).set(auth(w.manager.token)).expect(200);
    await api().post(`/api/stock-counts/${c.body._id}/reconcile`).set(auth(w.manager.token)).expect(200);
    const a = await Alert.findOne({ type: 'count_variance' }).lean();
    expect(a).toMatchObject({ severity: 'warning' });
    expect(a!.message).toMatch(/variance -20, 20.0%/);
    const list = await api().get(`/api/stock-counts?warehouse=${w.north._id}`).set(auth(w.staff.token));
    expect(list.body.items[0]).toMatchObject({ lineCount: 1, varianceLines: 1, status: 'reconciled' });
  });

  it('is scoped to the user warehouse', async () => {
    expect((await api().post('/api/stock-counts').set(auth(w.staff.token)).send({ warehouse: w.south._id })).status).toBe(403);
    expect((await api().post('/api/stock-counts').set(auth(w.supplier.token)).send({ warehouse: w.north._id })).status).toBe(403);
  });
});

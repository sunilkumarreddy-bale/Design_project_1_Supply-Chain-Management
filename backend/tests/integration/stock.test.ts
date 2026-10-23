import { AuditLog, DemandHistory, StockLevel, Transfer } from '../../src/models';
import { startOfUtcDay } from '../../src/utils/dates';
import { api, auth, clearDb, day, makeWorld, settle, startDb, stopDb, World } from './helpers';
import * as inventory from '../../src/services/inventory';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  w = await makeWorld();
});
afterEach(clearDb);

const qty = async (product: unknown, warehouse: unknown) =>
  (await StockLevel.find({ product, warehouse }).lean()).reduce((s, l) => s + l.quantity, 0);

describe('receive', () => {
  it('receives into a batch line and merges repeat receipts', async () => {
    const body = { product: w.bracket._id, warehouse: w.north._id, quantity: 40, bin: 'A2', batchNo: 'B-1' };
    const r1 = await api().post('/api/stock/receive').set(auth(w.staff.token)).send(body);
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ bin: 'A2', batchNo: 'B-1', quantity: 40 });
    await api().post('/api/stock/receive').set(auth(w.staff.token)).send({ ...body, quantity: 10 }).expect(201);
    expect(await StockLevel.countDocuments({ product: w.bracket._id })).toBe(1);
    expect(await qty(w.bracket._id, w.north._id)).toBe(50);
    await settle();
    expect(await AuditLog.countDocuments({ action: 'stock.receive' })).toBe(2);
  });

  it('defaults to the first bin, rejects unknown bins and requires expiry for perishables', async () => {
    const r = await api().post('/api/stock/receive').set(auth(w.manager.token)).send({ product: w.bracket._id, warehouse: w.north._id, quantity: 5 });
    expect(r.body.bin).toBe('A1');
    const badBin = await api().post('/api/stock/receive').set(auth(w.manager.token)).send({ product: w.bracket._id, warehouse: w.north._id, quantity: 5, bin: 'Z9' });
    expect(badBin.status).toBe(400);
    const milk = await api().post('/api/stock/receive').set(auth(w.manager.token)).send({ product: w.milk._id, warehouse: w.north._id, quantity: 5 });
    expect(milk.status).toBe(400);
    expect(milk.body.error.message).toMatch(/expiry date is required/);
  });

  it('validates quantity and enforces warehouse scope', async () => {
    const zero = await api().post('/api/stock/receive').set(auth(w.staff.token)).send({ product: w.bracket._id, warehouse: w.north._id, quantity: 0 });
    expect(zero.status).toBe(400);
    const other = await api().post('/api/stock/receive').set(auth(w.staff.token)).send({ product: w.bracket._id, warehouse: w.south._id, quantity: 5 });
    expect(other.status).toBe(403);
    const sup = await api().post('/api/stock/receive').set(auth(w.supplier.token)).send({ product: w.bracket._id, warehouse: w.north._id, quantity: 5 });
    expect(sup.status).toBe(403);
    const admin = await api().post('/api/stock/receive').set(auth(w.admin.token)).send({ product: w.bracket._id, warehouse: w.south._id, quantity: 5 });
    expect(admin.status).toBe(201);
  });
});

describe('dispatch (FEFO)', () => {
  beforeEach(async () => {
    await StockLevel.create([
      { product: w.milk._id, warehouse: w.north._id, bin: 'A1', batchNo: 'LATE', expiryDate: day(10), quantity: 30 },
      { product: w.milk._id, warehouse: w.north._id, bin: 'A2', batchNo: 'EARLY', expiryDate: day(3), quantity: 20 },
    ]);
  });

  it('takes the earliest-expiring batch first and returns allocations', async () => {
    const r = await api().post('/api/stock/dispatch').set(auth(w.staff.token)).send({ product: w.milk._id, warehouse: w.north._id, quantity: 25 });
    expect(r.status).toBe(200);
    expect(r.body.allocations.map((a: { batchNo: string; quantity: number }) => [a.batchNo, a.quantity])).toEqual([
      ['EARLY', 20],
      ['LATE', 5],
    ]);
    expect(await qty(w.milk._id, w.north._id)).toBe(25);
  });

  it('honours an explicit batch', async () => {
    const r = await api().post('/api/stock/dispatch').set(auth(w.staff.token)).send({ product: w.milk._id, warehouse: w.north._id, quantity: 5, batchNo: 'LATE' });
    expect(r.body.allocations).toEqual([expect.objectContaining({ batchNo: 'LATE', quantity: 5 })]);
  });

  it('returns 400 when stock is insufficient and changes nothing', async () => {
    const r = await api().post('/api/stock/dispatch').set(auth(w.staff.token)).send({ product: w.milk._id, warehouse: w.north._id, quantity: 51 });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('Insufficient stock: have 50, requested 51');
    expect(await qty(w.milk._id, w.north._id)).toBe(50);
  });

  it("increments today's DemandHistory row", async () => {
    await api().post('/api/stock/dispatch').set(auth(w.staff.token)).send({ product: w.milk._id, warehouse: w.north._id, quantity: 4 }).expect(200);
    await api().post('/api/stock/dispatch').set(auth(w.staff.token)).send({ product: w.milk._id, warehouse: w.north._id, quantity: 6 }).expect(200);
    const rows = await DemandHistory.find({ product: w.milk._id, warehouse: w.north._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 10, source: 'dispatch' });
    expect(rows[0].date.getTime()).toBe(startOfUtcDay(new Date()).getTime());
  });
});

describe('transfers', () => {
  beforeEach(async () => {
    await StockLevel.create([
      { product: w.milk._id, warehouse: w.north._id, bin: 'A1', batchNo: 'M-1', expiryDate: day(4), quantity: 10 },
      { product: w.milk._id, warehouse: w.north._id, bin: 'A1', batchNo: 'M-2', expiryDate: day(8), quantity: 40 },
    ]);
  });

  it('instant transfer moves stock with batch numbers and expiry dates in one transaction', async () => {
    const r = await api()
      .post('/api/stock/transfer')
      .set(auth(w.manager.token))
      .send({ product: w.milk._id, fromWarehouse: w.north._id, toWarehouse: w.south._id, quantity: 15 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'completed', mode: 'instant' });
    const dest = await StockLevel.find({ product: w.milk._id, warehouse: w.south._id }).sort({ batchNo: 1 }).lean();
    expect(dest.map((d) => [d.batchNo, d.quantity, d.expiryDate!.getTime()])).toEqual([
      ['M-1', 10, day(4).getTime()],
      ['M-2', 5, day(8).getTime()],
    ]);
    expect(await qty(w.milk._id, w.north._id)).toBe(35);
  });

  it('staff cannot do instant transfers; managers only from their own warehouse', async () => {
    const body = { product: w.milk._id, fromWarehouse: w.north._id, toWarehouse: w.south._id, quantity: 1 };
    expect((await api().post('/api/stock/transfer').set(auth(w.staff.token)).send(body)).status).toBe(403);
    expect((await api().post('/api/stock/transfer').set(auth(w.southManager.token)).send(body)).status).toBe(403);
  });

  it('runs the tracked lifecycle: request, approve, dispatch, receive', async () => {
    const req = await api()
      .post('/api/stock/transfer')
      .set(auth(w.manager.token))
      .send({ product: w.milk._id, fromWarehouse: w.north._id, toWarehouse: w.south._id, quantity: 12, mode: 'tracked' });
    expect(req.body.status).toBe('pending_approval');
    const id = req.body._id;
    expect((await api().post(`/api/transfers/${id}/approve`).set(auth(w.manager.token))).status).toBe(403);
    expect((await api().post(`/api/transfers/${id}/dispatch`).set(auth(w.staff.token))).status).toBe(409);
    await api().post(`/api/transfers/${id}/approve`).set(auth(w.admin.token)).expect(200);
    const dispatched = await api().post(`/api/transfers/${id}/dispatch`).set(auth(w.staff.token));
    expect(dispatched.body.status).toBe('in_transit');
    expect(dispatched.body.allocations.map((a: { batchNo: string }) => a.batchNo)).toEqual(['M-1', 'M-2']);
    expect(await qty(w.milk._id, w.north._id)).toBe(38);
    expect(await qty(w.milk._id, w.south._id)).toBe(0);
    expect((await api().post(`/api/transfers/${id}/receive`).set(auth(w.staff.token))).status).toBe(403);
    expect((await api().post(`/api/transfers/${id}/cancel`).set(auth(w.admin.token))).status).toBe(409);
    const received = await api().post(`/api/transfers/${id}/receive`).set(auth(w.southManager.token));
    expect(received.body.status).toBe('completed');
    expect(await qty(w.milk._id, w.south._id)).toBe(12);
    const m1 = await StockLevel.findOne({ product: w.milk._id, warehouse: w.south._id, batchNo: 'M-1' }).lean();
    expect(m1!.expiryDate!.getTime()).toBe(day(4).getTime());
    const list = await api().get(`/api/stock/transfers?warehouse=${w.south._id}`).set(auth(w.staff.token));
    expect(list.body.items[0]).toMatchObject({ status: 'completed', mode: 'tracked' });
  });

  it('rejects and cancels before dispatch', async () => {
    const mk = async () =>
      (
        await api()
          .post('/api/stock/transfer')
          .set(auth(w.admin.token))
          .send({ product: w.milk._id, fromWarehouse: w.north._id, toWarehouse: w.south._id, quantity: 2, mode: 'tracked' })
      ).body._id;
    const a = await mk();
    const rej = await api().post(`/api/transfers/${a}/reject`).set(auth(w.admin.token)).send({ reason: 'not needed' });
    expect(rej.body).toMatchObject({ status: 'rejected', rejectedReason: 'not needed' });
    const b = await mk();
    expect((await api().post(`/api/transfers/${b}/cancel`).set(auth(w.manager.token))).body.status).toBe('cancelled');
  });

  it('rolls back both stock writes when the transaction fails after them', async () => {
    // Transfer.create runs after the source pick and destination put-away inside the transaction
    const spy = jest.spyOn(Transfer, 'create').mockRejectedValueOnce(new Error('disk full') as never);
    const before = await qty(w.milk._id, w.north._id);
    await expect(
      inventory.instantTransfer(
        { product: w.milk._id.toHexString(), fromWarehouse: w.north._id.toHexString(), toWarehouse: w.south._id.toHexString(), quantity: 5 },
        { ...w.admin.user.toObject(), id: w.admin.user._id.toHexString(), role: 'admin', warehouse: null, supplier: null } as any,
      ),
    ).rejects.toThrow();
    spy.mockRestore();
    expect(await qty(w.milk._id, w.north._id)).toBe(before);
    expect(await qty(w.milk._id, w.south._id)).toBe(0);
    expect(await Transfer.countDocuments()).toBe(0);
  });
});

describe('stock queries', () => {
  it('lists stock lines and per-product summary', async () => {
    await StockLevel.create([
      { product: w.bracket._id, warehouse: w.north._id, bin: 'A1', quantity: 100 },
      { product: w.bracket._id, warehouse: w.south._id, bin: 'A1', quantity: 20, batchNo: 'X', expiryDate: day(30) },
      { product: w.cable._id, warehouse: w.north._id, bin: 'A1', quantity: 0 },
    ]);
    const list = await api().get(`/api/stock?product=${w.bracket._id}`).set(auth(w.staff.token));
    expect(list.body.total).toBe(2);
    expect(list.body.items[0].product.sku).toBe('SKU-STL-001');
    const s = await api().get('/api/stock/summary').set(auth(w.staff.token));
    expect(s.body.items).toEqual([expect.objectContaining({ onHand: 120, batches: 2, value: 6000, warehouseCount: 2 })]);
    const csv = await api().get('/api/stock/export.csv').set(auth(w.staff.token));
    expect(csv.text).toMatch(/SKU-STL-001/);
  });
});

import mongoose from 'mongoose';
import * as models from '../../src/models';
import { api, clearDb, startDb, stopDb } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

describe('health', () => {
  it('GET /api/health responds', async () => {
    const r = await api().get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, service: 'smart-inventory-scm-api' });
    expect(new Date(r.body.time).getTime()).not.toBeNaN();
  });
  it('returns the JSON error shape for unknown routes', async () => {
    const r = await api().get('/api/nope');
    expect(r.status).toBe(401);
    const r2 = await api().get('/nope');
    expect(r2.status).toBe(404);
    expect(r2.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('model smoke test', () => {
  it('creates and reads one document per collection', async () => {
    const id = () => new mongoose.Types.ObjectId();
    const w = await models.Warehouse.create({ code: 'wh-x', name: 'X' });
    const s = await models.Supplier.create({ name: 'S' });
    const p = await models.Product.create({ sku: 'p-1', name: 'P', primarySupplier: s._id });
    const u = await models.User.create({ name: 'U', email: 'U@X.COM', passwordHash: 'x' });
    const docs = await Promise.all([
      models.StockLevel.create({ product: p._id, warehouse: w._id, quantity: 5 }),
      models.StockPolicy.create({ product: p._id, warehouse: w._id, minStock: 3 }),
      models.PurchaseOrder.create({ poNumber: 'PO-1', supplier: s._id, warehouse: w._id, items: [{ product: p._id, quantityOrdered: 3, unitCost: 2 }] }),
      models.Transfer.create({ product: p._id, fromWarehouse: w._id, toWarehouse: id(), quantity: 1 }),
      models.Alert.create({ type: 'low_stock', message: 'm' }),
      models.AuditLog.create({ seq: 1, prevHash: '0', hash: 'h', action: 'a', entityType: 'X', createdAt: new Date(), before: {} }),
      models.Counter.create({ _id: 'x', seq: 1 }),
      models.SupplierOffer.create({ supplier: s._id, product: p._id, capacityUnits: 1, leadTimeDays: 1, unitCost: 1 }),
      models.TransferRoute.create({ fromWarehouse: w._id, toWarehouse: id(), leadTimeDays: 1 }),
      models.DemandHistory.create({ product: p._id, warehouse: w._id, date: new Date(), quantity: 1 }),
      models.CustomerOrder.create({ orderNo: 'O1', customerName: 'C', warehouse: w._id, requiredBy: new Date(), items: [{ product: p._id, quantity: 1 }] }),
      models.ProductDependency.create({ componentProduct: p._id, finishedProduct: id(), quantityPer: 1 }),
      models.RecoveryPlan.create({ planNo: 'RP-1', product: p._id, targetWarehouse: w._id, selectedOptionId: 'x' }),
      models.RedistributionPlan.create({ planNo: 'XP-1', product: p._id, sourceWarehouse: w._id }),
      models.DisruptionScenario.create({ name: 'D', type: 'supplier_stop', supplier: s._id, durationDays: 3 }),
      models.SimulationRun.create({ parameters: { horizonDays: 30 } }),
      models.StockCount.create({ countNo: 'CC-1', warehouse: w._id }),
      models.Discrepancy.create({ type: 'other', warehouse: w._id }),
      models.Notification.create({ user: u._id, channel: 'in_app', type: 't' }),
    ]);
    expect(docs).toHaveLength(19);
    expect((await models.Warehouse.findById(w._id))!.code).toBe('WH-X');
    expect((await models.Product.findById(p._id))!.qrPayload).toBe('P-1');
    expect((await models.User.findById(u._id))!.email).toBe('u@x.com');
    expect((await models.PurchaseOrder.findOne({ poNumber: 'PO-1' }))!.get('totalCost')).toBe(6);
    expect((await models.AuditLog.findOne({ seq: 1 }).lean())!.before).toEqual({});
    await expect(models.StockLevel.create({ product: p._id, warehouse: w._id, quantity: -1, bin: 'z' })).rejects.toThrow(/negative/);
    await expect(models.User.create({ name: 'S', email: 's@x.com', passwordHash: 'x', role: 'supplier' })).rejects.toThrow(/supplier/);
    expect(await models.nextSequence('po')).toBe(1);
    expect(await models.nextSequence('po')).toBe(2);
  });
});

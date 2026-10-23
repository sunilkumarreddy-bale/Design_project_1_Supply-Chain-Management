import { Alert, AuditLog, Discrepancy, Notification, PurchaseOrder, StockLevel, Supplier } from '../../src/models';
import { api, auth, clearDb, makeWorld, putStock, seedDemand, settle, startDb, stopDb, World } from './helpers';
import { mockOutbox } from '../../src/integrations/outbox';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  w = await makeWorld();
  mockOutbox.clear();
});
afterEach(clearDb);

async function manualPO(token: string, qty = 100) {
  const r = await api()
    .post('/api/purchase-orders')
    .set(auth(token))
    .send({ supplier: w.acme._id, warehouse: w.north._id, items: [{ product: w.bracket._id, quantityOrdered: qty }], notes: 'test' });
  expect(r.status).toBe(201);
  return r.body;
}

describe('manual purchase orders', () => {
  it('creates a pending PO with a PO-YYYY-000001 number, an alert and an admin notification', async () => {
    const po = await manualPO(w.manager.token);
    expect(po.poNumber).toMatch(new RegExp(`^PO-${new Date().getUTCFullYear()}-000001$`));
    expect(po).toMatchObject({ status: 'pending_approval', source: 'manual', totalCost: 5000 });
    expect(po.items[0].unitCost).toBe(50);
    expect(await Alert.countDocuments({ type: 'po_pending_approval', isResolved: false })).toBe(1);
    expect(await Notification.countDocuments({ user: w.admin.user._id, channel: 'in_app', type: 'po.pending_approval' })).toBe(1);
  });

  it('keeps drafts out of approval until submitted', async () => {
    const r = await api()
      .post('/api/purchase-orders')
      .set(auth(w.manager.token))
      .send({ supplier: w.acme._id, warehouse: w.north._id, items: [{ product: w.bracket._id, quantityOrdered: 5 }], draft: true });
    expect(r.body.status).toBe('draft');
    expect((await api().post(`/api/purchase-orders/${r.body._id}/submit`).set(auth(w.manager.token))).body.status).toBe('pending_approval');
  });

  it('restricts creation to admins and managers of the target warehouse', async () => {
    const body = { supplier: w.acme._id, warehouse: w.north._id, items: [{ product: w.bracket._id, quantityOrdered: 5 }] };
    expect((await api().post('/api/purchase-orders').set(auth(w.staff.token)).send(body)).status).toBe(403);
    expect((await api().post('/api/purchase-orders').set(auth(w.southManager.token)).send(body)).status).toBe(403);
    expect((await api().post('/api/purchase-orders').set(auth(w.admin.token)).send({ ...body, items: [] })).status).toBe(400);
  });
});

describe('approval, supplier portal and receipt', () => {
  it('runs approve -> confirm -> dispatch -> partial -> full receipt with lead-time learning', async () => {
    const po = await manualPO(w.manager.token, 100);
    expect((await api().post(`/api/purchase-orders/${po._id}/approve`).set(auth(w.manager.token))).status).toBe(403);
    const approved = await api().post(`/api/purchase-orders/${po._id}/approve`).set(auth(w.admin.token));
    expect(approved.body.status).toBe('approved');
    expect(approved.body.expectedDeliveryDate).toBeTruthy();
    await settle();
    expect(await Alert.countDocuments({ type: 'po_pending_approval', isResolved: false })).toBe(0);
    expect(await Notification.countDocuments({ user: w.supplier.user._id, type: 'po.approved', channel: 'in_app' })).toBe(1);
    expect(mockOutbox.list('email').some((e) => e.payload.to === 'acme@test.local')).toBe(true);

    // suppliers only see and act on their own POs
    expect((await api().get('/api/purchase-orders').set(auth(w.supplier2.token))).body.total).toBe(0);
    expect((await api().get('/api/purchase-orders').set(auth(w.supplier.token))).body.total).toBe(1);
    const confirmBody = { confirmedQty: 100, confirmedDate: new Date(Date.now() + 3 * 864e5).toISOString() };
    expect((await api().post(`/api/purchase-orders/${po._id}/confirm`).set(auth(w.supplier2.token)).send(confirmBody)).status).toBe(403);
    expect((await api().post(`/api/purchase-orders/${po._id}/confirm`).set(auth(w.admin.token)).send(confirmBody)).status).toBe(403);
    const confirmed = await api().post(`/api/purchase-orders/${po._id}/confirm`).set(auth(w.supplier.token)).send(confirmBody);
    expect(confirmed.body).toMatchObject({ status: 'confirmed', supplierConfirmedQty: 100 });
    const dispatched = await api()
      .post(`/api/purchase-orders/${po._id}/dispatch`)
      .set(auth(w.supplier.token))
      .send({ carrier: 'BlueDart', trackingNo: 'BD123', eta: confirmBody.confirmedDate });
    expect(dispatched.body).toMatchObject({ status: 'dispatched', dispatchInfo: { carrier: 'BlueDart', trackingNo: 'BD123' } });

    const partial = await api()
      .post(`/api/purchase-orders/${po._id}/receive`)
      .set(auth(w.staff.token))
      .send({ receivedItems: [{ product: w.bracket._id, quantityReceived: 60, batchNo: 'R1' }], logDiscrepancy: true });
    expect(partial.status).toBe(200);
    expect(partial.body.purchaseOrder.status).toBe('partially_received');
    expect(partial.body.shortLines).toEqual([{ product: w.bracket._id.toHexString(), outstanding: 100, received: 60 }]);
    expect(partial.body.leadTimeSample).toBeNull();
    expect(await Discrepancy.countDocuments({ type: 'receipt_mismatch', expectedQty: 100, actualQty: 60 })).toBe(1);
    expect((await Supplier.findById(w.acme._id))!.leadTimeSamples).toBe(0);

    const over = await api()
      .post(`/api/purchase-orders/${po._id}/receive`)
      .set(auth(w.staff.token))
      .send({ receivedItems: [{ product: w.bracket._id, quantityReceived: 41 }] });
    expect(over.status).toBe(400);

    const full = await api()
      .post(`/api/purchase-orders/${po._id}/receive`)
      .set(auth(w.staff.token))
      .send({ receivedItems: [{ product: w.bracket._id, quantityReceived: 40 }] });
    expect(full.body.purchaseOrder.status).toBe('received');
    expect(full.body.leadTimeSample).toEqual({ days: 1, onTime: true });
    const acme = (await Supplier.findById(w.acme._id))!;
    expect(acme).toMatchObject({ leadTimeSamples: 1, leadTimeSum: 1, leadTimeSumSq: 1, totalOrders: 1, onTimeDeliveries: 1, performanceScore: 100 });
    const stock = await StockLevel.find({ product: w.bracket._id, warehouse: w.north._id }).lean();
    expect(stock.reduce((s, l) => s + l.quantity, 0)).toBe(100);
    expect(stock.map((l) => l.batchNo).sort()).toEqual([po.poNumber, 'R1'].sort());
    await settle();
    expect(await AuditLog.countDocuments({ action: 'supplier.lead_time_sample' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'po.receive' })).toBe(2);
  });

  it('counts a delivery after the expected date as late and lowers the score', async () => {
    const po = await manualPO(w.admin.token, 10);
    await api().post(`/api/purchase-orders/${po._id}/approve`).set(auth(w.admin.token)).expect(200);
    await PurchaseOrder.updateOne(
      { _id: po._id },
      { approvedAt: new Date(Date.now() - 12 * 864e5), expectedDeliveryDate: new Date(Date.now() - 7 * 864e5) },
    );
    const r = await api()
      .post(`/api/purchase-orders/${po._id}/receive`)
      .set(auth(w.admin.token))
      .send({ receivedItems: [{ product: w.bracket._id, quantityReceived: 10 }] });
    expect(r.body.leadTimeSample).toEqual({ days: 12, onTime: false });
    expect((await Supplier.findById(w.acme._id))!).toMatchObject({ lateDeliveries: 1, performanceScore: 0, leadTimeSum: 12 });
  });

  it('rejects with a reason, cancels, and refuses illegal transitions', async () => {
    const a = await manualPO(w.admin.token);
    expect((await api().post(`/api/purchase-orders/${a._id}/reject`).set(auth(w.admin.token)).send({})).status).toBe(400);
    const rej = await api().post(`/api/purchase-orders/${a._id}/reject`).set(auth(w.admin.token)).send({ reason: 'too expensive' });
    expect(rej.body).toMatchObject({ status: 'rejected', rejectedReason: 'too expensive' });
    expect((await api().post(`/api/purchase-orders/${a._id}/approve`).set(auth(w.admin.token))).status).toBe(409);
    const b = await manualPO(w.admin.token);
    expect((await api().post(`/api/purchase-orders/${b._id}/cancel`).set(auth(w.manager.token))).status).toBe(403);
    expect((await api().post(`/api/purchase-orders/${b._id}/cancel`).set(auth(w.admin.token))).body.status).toBe('cancelled');
    const pay = await api().post(`/api/purchase-orders/${b._id}/pay`).set(auth(w.admin.token));
    expect(pay.status).toBe(400);
    expect(pay.body.error.code).toBe('FEATURE_DISABLED');
  });

  it('pays through the mock driver when payments are enabled', async () => {
    process.env.ENABLE_PAYMENTS = 'true';
    try {
      const po = await manualPO(w.admin.token, 2);
      await api().post(`/api/purchase-orders/${po._id}/approve`).set(auth(w.admin.token)).expect(200);
      const r = await api().post(`/api/purchase-orders/${po._id}/pay`).set(auth(w.admin.token));
      expect(r.body.payment).toMatchObject({ status: 'pending', provider: 'mock' });
      expect(r.body.payment.reference).toMatch(/^mock_pay_/);
      expect((await api().post(`/api/purchase-orders/${po._id}/pay`).set(auth(w.admin.token))).status).toBe(409);
    } finally {
      delete process.env.ENABLE_PAYMENTS;
    }
  });
});

describe('auto-draft (F2 + F4 + F1)', () => {
  beforeEach(async () => {
    await seedDemand(w.bracket._id, w.north._id, 10);
    await putStock(w.bracket._id, w.north._id, 30);
  });

  it('drafts k x EOQ with the full explanation and never double-orders', async () => {
    const r = await api().post('/api/purchase-orders/auto-draft').set(auth(w.manager.token)).send({ warehouse: w.north._id });
    expect(r.status).toBe(200);
    expect(r.body.created).toHaveLength(1);
    const po = r.body.created[0];
    expect(po).toMatchObject({ status: 'pending_approval', autoGenerated: true, source: 'auto_reorder' });
    const line = po.items[0];
    // d = 10/day from history, sigma 0, L = 5 days (Acme promise) -> ROP 50; EOQ = ceil(sqrt(2 x 3650 x 20 / 2)) = 271
    expect(line.reorderExplanation.policy).toMatchObject({ reorderPoint: 50, economicOrderQuantity: 271 });
    expect(line.quantityOrdered).toBe(271);
    expect(line.reorderExplanation.inputs).toMatchObject({ avgDailyDemand: 10, demandSource: 'history', leadTimeSource: 'nominal', onHand: 30 });
    expect(line.reorderExplanation.steps).toEqual(
      expect.arrayContaining([expect.stringContaining('Reorder point = ceil(10 x 5 + 0) = 50'), expect.stringContaining('Order quantity = 1 x EOQ 271 = 271')]),
    );
    const again = await api().post('/api/purchase-orders/auto-draft').set(auth(w.manager.token)).send({ warehouse: w.north._id });
    expect(again.body.created).toHaveLength(0);
    expect(await PurchaseOrder.countDocuments()).toBe(1);
  });

  it('prefers a transfer when another warehouse has surplus', async () => {
    await putStock(w.bracket._id, w.south._id, 400);
    await seedDemand(w.bracket._id, w.south._id, 10);
    const r = await api().post('/api/purchase-orders/auto-draft').set(auth(w.admin.token)).send({ warehouse: w.north._id });
    expect(r.body.created).toHaveLength(0);
    expect(r.body.avoidedByTransfer).toEqual([
      expect.objectContaining({
        product: expect.objectContaining({ sku: 'SKU-STL-001' }),
        deficit: 21,
        transfers: [expect.objectContaining({ from: expect.objectContaining({ code: 'WH-SOUTH' }), quantity: 21 })],
      }),
    ]);
  });

  it('skips products whose supplier is disrupted and suggests recovery', async () => {
    await Supplier.updateOne({ _id: w.acme._id }, { status: 'disrupted', disruption: { from: new Date(), expectedDays: 7, reason: 'fire' } });
    const r = await api().post('/api/purchase-orders/auto-draft').set(auth(w.admin.token)).send({ warehouse: w.north._id });
    expect(r.body.created).toHaveLength(0);
    expect(r.body.skipped).toEqual([expect.objectContaining({ reason: expect.stringContaining('disrupted'), suggestion: expect.stringContaining('recovery') })]);
  });

  it('is limited to admins and managers of the warehouse', async () => {
    expect((await api().post('/api/purchase-orders/auto-draft').set(auth(w.staff.token)).send({ warehouse: w.north._id })).status).toBe(403);
    expect((await api().post('/api/purchase-orders/auto-draft').set(auth(w.southManager.token)).send({ warehouse: w.north._id })).status).toBe(403);
  });
});

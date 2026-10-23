import { Alert, Notification, StockLevel, User } from '../../src/models';
import { api, auth, clearDb, day, makeWorld, putStock, seedDemand, settle, startDb, stopDb, World } from './helpers';
import { mockOutbox } from '../../src/integrations/outbox';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  w = await makeWorld();
  mockOutbox.clear();
});
afterEach(clearDb);

describe('stock alerts', () => {
  it('creates low_stock once, updates it, and auto-resolves when stock recovers', async () => {
    await seedDemand(w.bracket._id, w.north._id, 10);
    await putStock(w.bracket._id, w.north._id, 60);
    const dispatch = (q: number) => api().post('/api/stock/dispatch').set(auth(w.staff.token)).send({ product: w.bracket._id, warehouse: w.north._id, quantity: q });
    await dispatch(20).expect(200);
    await dispatch(5).expect(200);
    const open = await Alert.find({ type: 'low_stock', isResolved: false }).lean();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ severity: 'warning' });
    expect(open[0].message).toMatch(/position 35 .* reorder point 50/);
    expect((await StockLevel.findOne({ product: w.bracket._id }))!.reorderPoint).toBe(50);
    await api().post('/api/stock/receive').set(auth(w.staff.token)).send({ product: w.bracket._id, warehouse: w.north._id, quantity: 100 }).expect(201);
    expect(await Alert.countDocuments({ type: 'low_stock', isResolved: false })).toBe(0);
    expect(await Alert.countDocuments({ type: 'low_stock', isResolved: true })).toBe(1);
  });

  it('marks low_stock critical at zero on-hand and emails / texts opted-in managers', async () => {
    await User.updateOne({ _id: w.manager.user._id }, { phone: '+919800000001', notify: { inApp: true, email: true, sms: true } });
    await seedDemand(w.bracket._id, w.north._id, 10);
    await putStock(w.bracket._id, w.north._id, 5);
    await api().post('/api/stock/dispatch').set(auth(w.staff.token)).send({ product: w.bracket._id, warehouse: w.north._id, quantity: 5 }).expect(200);
    await settle();
    expect(await Alert.findOne({ type: 'low_stock' }).lean()).toMatchObject({ severity: 'critical' });
    const sms = mockOutbox.list('sms').filter((m) => m.payload.to === '+919800000001');
    expect(sms).toHaveLength(1);
    expect(mockOutbox.list('email').some((m) => m.payload.to === w.manager.email)).toBe(true);
    expect(await Notification.countDocuments({ user: w.manager.user._id, channel: 'sms', status: 'sent' })).toBe(1);
    expect(await Notification.countDocuments({ user: w.southManager.user._id })).toBe(0);
  });

  it('expiry sweep raises warning and critical alerts and resolves them when the batch is gone', async () => {
    const soon = await StockLevel.create({ product: w.milk._id, warehouse: w.north._id, bin: 'A1', batchNo: 'S', expiryDate: day(2), quantity: 10 });
    await StockLevel.create({ product: w.milk._id, warehouse: w.north._id, bin: 'A1', batchNo: 'L', expiryDate: day(10), quantity: 10 });
    await StockLevel.create({ product: w.milk._id, warehouse: w.north._id, bin: 'A1', batchNo: 'F', expiryDate: day(40), quantity: 10 });
    const r = await api().post('/api/alerts/sweep-expiry').set(auth(w.admin.token)).send({});
    expect(r.body.expiry).toMatchObject({ checked: 2, created: 2 });
    const alerts = await Alert.find({ type: 'expiry' }).sort({ severity: 1 }).lean();
    expect(alerts.map((a) => a.severity).sort()).toEqual(['critical', 'warning']);
    const again = await api().post('/api/alerts/sweep-expiry').set(auth(w.admin.token)).send({});
    expect(again.body.expiry).toMatchObject({ created: 0, updated: 2 });
    await StockLevel.updateOne({ _id: soon._id }, { quantity: 0 });
    const third = await api().post('/api/alerts/sweep-expiry').set(auth(w.admin.token)).send({});
    expect(third.body.expiry.resolved).toBe(1);
    expect((await api().post('/api/alerts/sweep-expiry').set(auth(w.staff.token)).send({})).status).toBe(403);
  });

  it('lists, filters and resolves alerts', async () => {
    const a = await Alert.create({ type: 'discrepancy', severity: 'warning', warehouse: w.north._id, message: 'm' });
    await Alert.create({ type: 'overstock', severity: 'info', warehouse: w.south._id, message: 'o' });
    const list = await api().get(`/api/alerts?resolved=false&warehouse=${w.north._id}`).set(auth(w.staff.token));
    expect(list.body.total).toBe(1);
    expect((await api().post(`/api/alerts/${a._id}/resolve`).set(auth(w.staff.token))).status).toBe(403);
    expect((await api().post(`/api/alerts/${a._id}/resolve`).set(auth(w.southManager.token))).status).toBe(403);
    const r = await api().post(`/api/alerts/${a._id}/resolve`).set(auth(w.manager.token));
    expect(r.body).toMatchObject({ isResolved: true });
    expect((await api().post(`/api/alerts/${a._id}/resolve`).set(auth(w.manager.token))).status).toBe(409);
    expect((await api().get('/api/alerts').set(auth(w.supplier.token))).status).toBe(403);
  });
});

describe('notifications', () => {
  it('creates in-app notifications and sends email / SMS per preference', async () => {
    await User.updateOne({ _id: w.admin.user._id }, { phone: '+919800000002', notify: { inApp: true, email: false, sms: true } });
    await api().post(`/api/suppliers/${w.globex._id}/disruption`).set(auth(w.manager.token)).send({ expectedDays: 4, reason: 'strike' }).expect(200);
    await settle();
    const adminNotes = await Notification.find({ user: w.admin.user._id }).lean();
    expect(adminNotes.map((n) => n.channel).sort()).toEqual(expect.arrayContaining(['in_app', 'sms']));
    expect(adminNotes.some((n) => n.channel === 'email')).toBe(false);
    expect(mockOutbox.list('sms').some((m) => m.payload.to === '+919800000002')).toBe(true);
    const mine = await api().get('/api/notifications').set(auth(w.admin.token));
    expect(mine.body.unread).toBeGreaterThan(0);
    const one = await api().post(`/api/notifications/${mine.body.items[0]._id}/read`).set(auth(w.admin.token));
    expect(one.body.status).toBe('read');
    const all = await api().post('/api/notifications/read-all').set(auth(w.admin.token));
    expect(all.body.updated).toBe(mine.body.unread - 1);
    expect((await api().get('/api/notifications').set(auth(w.admin.token))).body.unread).toBe(0);
    expect((await api().post(`/api/notifications/${mine.body.items[0]._id}/read`).set(auth(w.staff.token))).status).toBe(404);
  });

  it('records failed deliveries with the provider error', async () => {
    process.env.EMAIL_PROVIDER = 'sendgrid';
    process.env.SENDGRID_API_KEY = 'SG.invalid';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{"errors":[{"message":"bad key"}]}', { status: 401 }));
    try {
      const { notify, flushNotifications } = await import('../../src/services/notifications');
      await notify({ userIds: [w.staff.user._id] }, { type: 'test', subject: 'Hi', body: 'Body' });
      await flushNotifications();
      const n = await Notification.findOne({ user: w.staff.user._id, channel: 'email' }).lean();
      expect(n).toMatchObject({ status: 'failed' });
      expect(n!.error).toMatch(/SendGrid error 401/);
    } finally {
      fetchSpy.mockRestore();
      process.env.EMAIL_PROVIDER = 'console';
      delete process.env.SENDGRID_API_KEY;
    }
  });
});

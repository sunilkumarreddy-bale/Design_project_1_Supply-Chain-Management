import { AuditLog } from '../../src/models';
import { recordAudit } from '../../src/middleware/audit';
import { api, auth, clearDb, makeUser, settle, startDb, stopDb } from './helpers';

beforeAll(startDb);
afterAll(stopDb);
afterEach(clearDb);

describe('audit chain (F6)', () => {
  it('writes chained entries for mutations and verifies them', async () => {
    const admin = await makeUser('admin');
    await api().post('/api/warehouses').set(auth(admin.token)).send({ code: 'WH-1', name: 'One', city: 'Pune' }).expect(201);
    await api().post('/api/suppliers').set(auth(admin.token)).send({ name: 'Sup' }).expect(201);
    await Promise.all([1, 2, 3].map((i) => recordAudit({ action: 'test.concurrent', entityType: 'Test', entityId: `t${i}`, after: { i } })));
    await settle();
    const entries = await AuditLog.find().sort({ seq: 1 }).lean();
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(entries[0].prevHash).toBe('0'.repeat(64));
    for (let i = 1; i < entries.length; i++) expect(entries[i].prevHash).toBe(entries[i - 1].hash);
    const v = await api().get('/api/audit/verify').set(auth(admin.token));
    expect(v.body).toMatchObject({ valid: true, checked: 5, headSeq: 5, headHash: entries[4].hash });
  });

  it('reports the first broken entry after a record is edited directly in the database', async () => {
    const admin = await makeUser('admin');
    for (let i = 1; i <= 4; i++) await recordAudit({ action: 'stock.receive', entityType: 'StockLevel', entityId: `s${i}`, after: { quantity: i } });
    await settle();
    await AuditLog.collection.updateOne({ seq: 2 }, { $set: { 'after.quantity': 999 } });
    const v = await api().get('/api/audit/verify').set(auth(admin.token));
    expect(v.body).toMatchObject({ valid: false, checked: 1, brokenAtSeq: 2 });
    expect(v.body.reason).toMatch(/modified/);
  });

  it('detects a deleted entry', async () => {
    const admin = await makeUser('admin');
    for (let i = 1; i <= 3; i++) await recordAudit({ action: 'x', entityType: 'X', after: { i } });
    await settle();
    await AuditLog.collection.deleteOne({ seq: 2 });
    const v = await api().get('/api/audit/verify').set(auth(admin.token));
    expect(v.body).toMatchObject({ valid: false, brokenAtSeq: 3 });
    expect(v.body.reason).toMatch(/Sequence gap/);
  });

  it('lists newest first with filters, exports CSV, and is closed to staff', async () => {
    const admin = await makeUser('admin');
    const manager = await makeUser('warehouse_manager');
    const staff = await makeUser('staff');
    await recordAudit({ action: 'po.approve', entityType: 'PurchaseOrder', actor: admin.user._id.toHexString(), after: { a: 1 } });
    await recordAudit({ action: 'stock.receive', entityType: 'StockLevel', after: { a: 2 } });
    await settle();
    const list = await api().get('/api/audit?entityType=PurchaseOrder').set(auth(manager.token));
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].actorInfo.name).toBe('admin user');
    const all = await api().get('/api/audit?limit=1&page=1').set(auth(manager.token));
    expect(all.body.items[0].action).toBe('stock.receive');
    const csv = await api().get('/api/audit/export.csv').set(auth(admin.token));
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toMatch(/^seq,createdAt,actor/);
    expect(csv.text).toMatch(/po\.approve/);
    expect((await api().get('/api/audit').set(auth(staff.token))).status).toBe(403);
    expect((await api().get('/api/audit/verify').set(auth(staff.token))).status).toBe(403);
  });
});

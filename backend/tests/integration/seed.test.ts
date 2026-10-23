import { AuditLog, PurchaseOrder, Supplier, User } from '../../src/models';
import { seedDatabase } from '../../src/seed/seedDatabase';
import { runScenarios } from '../../src/seed/runScenarios';
import { SEED_PASSWORD } from '../../src/seed/data';
import { api, auth, settle, startDb, stopDb } from './helpers';

beforeAll(startDb);
afterAll(stopDb);

describe('seed and scripted scenarios', () => {
  it('seeds the demo data, all five accounts log in and the audit chain verifies', async () => {
    const r = await seedDatabase();
    expect(r.skipped).toBe(false);
    expect(r.counts).toMatchObject({ users: 5, warehouses: 3, suppliers: 3, products: 8, customerorders: 4 });
    expect(await seedDatabase({ ifEmpty: true })).toEqual({ skipped: true, counts: {} });
    const tokens: Record<string, string> = {};
    for (const email of ['admin@example.com', 'manager@example.com', 'staff@example.com', 'supplier@example.com', 'supplier2@example.com']) {
      const login = await api().post('/api/auth/login').send({ email, password: SEED_PASSWORD });
      expect(login.status).toBe(200);
      tokens[email] = login.body.token;
    }
    expect((await User.findOne({ email: 'manager@example.com' }).populate('warehouse'))!.get('warehouse.code')).toBe('WH-NORTH');
    expect(await PurchaseOrder.countDocuments({ status: { $in: ['pending_approval', 'approved', 'partially_received'] } })).toBe(3);
    const globex = (await Supplier.findOne({ name: 'Globex Traders' }))!;
    expect(globex).toMatchObject({ leadTimeSamples: 6, leadTimeSum: 77, leadTimeSumSq: 999 });
    await settle();
    expect(await AuditLog.countDocuments()).toBeGreaterThan(20);
    const v = await api().get('/api/audit/verify').set(auth(tokens['admin@example.com']));
    expect(v.body.valid).toBe(true);
    const alerts = await api().get('/api/alerts?resolved=false').set(auth(tokens['admin@example.com']));
    expect(alerts.body.total).toBeGreaterThan(0);
    // Globex products show a longer lead time and a higher reorder point than the promise implies
    const ins = await api().get('/api/analytics/insights').set(auth(tokens['admin@example.com']));
    const cable = ins.body.items.find((i: any) => i.product.sku === 'SKU-CBL-002');
    expect(cable.leadTimeDays).toBeCloseTo(11.89, 2);
    expect(cable.promisedLeadTimeDays).toBe(10);
    const paste = ins.body.items.find((i: any) => i.product.sku === 'SKU-THP-005');
    expect(paste.class).toBe('CZ');
  });

  it('runs the scripted scenarios and every Example A / B check passes', async () => {
    const r = await runScenarios();
    const failed = r.checks.filter((c) => !c.passed);
    expect(failed).toEqual([]);
    expect(r.checks.length).toBeGreaterThanOrEqual(10);
    expect(r.lines.join('\n')).toMatch(/Transfer 200 units from Warehouse B/);
  });
});

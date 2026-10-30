import { AuditLog, DnaEvent, DnaLink, PurchaseOrder, StockLot, Supplier, User } from '../../src/models';
import { seedDnaScenarios } from '../../src/seed/dnaScenarios';
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
    expect(r.counts).toMatchObject({ users: 5, warehouses: 3, suppliers: 3, products: 8, customerorders: 10 });
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

  it('seeds the six Stock DNA scenarios; the milk lot tells its whole born-to-dead story (AC-DNA-11)', async () => {
    const admin = (await api().post('/api/auth/login').send({ email: 'admin@example.com', password: SEED_PASSWORD })).body.token;
    const by = async (batchNo: string) => (await StockLot.findOne({ batchNo }).lean())!;
    const milk = await by('MLK-DNA-001');
    expect(milk).toMatchObject({ status: 'expired_disposed', qtyBorn: 500, qtyOnHand: 0, death: expect.objectContaining({ cause: 'expired', valueLost: 3000 }) });
    expect(milk.qtyOutByCause).toMatchObject({ sold: 380, expired: 120 });
    expect(milk.death!.lifespanDays).toBeCloseTo(6.1, 1);
    const story = (await DnaEvent.find({ lot: milk._id }).sort({ seq: 1 }).lean()).map((g) => g.type);
    expect(story[0]).toBe('born');
    expect(story).toEqual(expect.arrayContaining(['decision_note', 'transfer_out', 'transfer_in', 'dispatch_sale', 'expire', 'write_off']));
    expect(story[story.length - 1]).toBe('death');
    const note = await DnaEvent.findOne({ lot: milk._id, type: 'decision_note' }).lean();
    expect(note!.explanation).toMatch(/can sell 120 x 4 days = 480; holds 100; capacity 380; move 380/);
    expect(await by('CBL-LONG-01')).toMatchObject({ status: 'active', qtyBorn: 300, qtyOnHand: 97, qtyOutByCause: expect.objectContaining({ sold: 200, shrinkage: 3 }) });
    expect(await by('BOX-RC-01')).toMatchObject({ status: 'active', qtyOnHand: 160, flags: expect.objectContaining({ recalled: true }) });
    expect(await by('THP-QC-01')).toMatchObject({ status: 'quarantine' });
    const sold = await by('BAT-SO-01');
    expect(sold).toMatchObject({ status: 'depleted', death: expect.objectContaining({ cause: 'sold_out' }) });
    const child = await by('BAT-SO-01-R1');
    expect(child).toMatchObject({ status: 'quarantine', qtyBorn: 3 });
    expect(await DnaLink.countDocuments({ parentLot: sold._id, childLot: child._id })).toBe(1);
    expect(await by('CBL-LEGACY-01')).toMatchObject({ flags: expect.objectContaining({ backfilled: true }) });
    expect(await seedDnaScenarios()).toEqual({ skipped: true, lots: 0 });

    // every seeded lot verifies against its audit anchors, and genes, headers and slices agree
    for (const l of await StockLot.find().select('_id').lean()) {
      const v = await api().post(`/api/dna/lots/${l._id}/verify`).set(auth(admin));
      expect(v.body).toMatchObject({ ok: true, anchoredOk: true });
    }
    const rec = await api().post('/api/dna/reconcile').set(auth(admin));
    expect(rec.body).toMatchObject({ drift: [], orphanSlices: 0 });
    const trace = await api().get('/api/dna/recall-trace?batchNo=BOX-RC-01').set(auth(admin));
    expect(trace.body.summary).toMatchObject({ qtyDispatchedToOrders: 40, qtyStillAlive: 160 });
    expect(trace.body.summary.orders).toEqual([expect.objectContaining({ orderNo: 'CO-DNA-R1', qty: 40 })]);
  });

  it('runs the scripted scenarios and every Example A / B check passes', async () => {
    const r = await runScenarios();
    const failed = r.checks.filter((c) => !c.passed);
    expect(failed).toEqual([]);
    expect(r.checks.length).toBeGreaterThanOrEqual(10);
    expect(r.lines.join('\n')).toMatch(/Transfer 200 units from Warehouse B/);
  });
});

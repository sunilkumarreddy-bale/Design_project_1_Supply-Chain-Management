import { Product, StockLevel, Supplier, TransferRoute, Warehouse } from '../../src/models';
import { api, auth, clearDb, day, makeWorld, putStock, seedDemand, startDb, stopDb, World } from './helpers';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  w = await makeWorld();
});
afterEach(clearDb);

describe('products', () => {
  it('creates, searches, updates, shows QR, scans and explains', async () => {
    const c = await api()
      .post('/api/products')
      .set(auth(w.manager.token))
      .send({ sku: 'sku-new-1', name: 'Widget', unitCost: 10, unitPrice: 15, primarySupplier: w.acme._id, avgDailyDemand: 4 });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ sku: 'SKU-NEW-1', qrPayload: 'SKU-NEW-1', leadTime: { days: 5, source: 'nominal' } });
    expect((await api().post('/api/products').set(auth(w.manager.token)).send({ sku: 'SKU-NEW-1', name: 'Dup', unitCost: 1, unitPrice: 1 })).status).toBe(409);
    expect((await api().post('/api/products').set(auth(w.staff.token)).send({ sku: 'X', name: 'X', unitCost: 1, unitPrice: 1 })).status).toBe(403);
    const perishable = await api().post('/api/products').set(auth(w.admin.token)).send({ sku: 'P2', name: 'Yogurt', unitCost: 1, unitPrice: 2, isPerishable: true });
    expect(perishable.status).toBe(400);

    const search = await api().get('/api/products?q=widg').set(auth(w.staff.token));
    expect(search.body.items.map((p: any) => p.sku)).toEqual(['SKU-NEW-1']);
    const upd = await api().patch(`/api/products/${c.body._id}`).set(auth(w.manager.token)).send({ serviceLevelZ: 2.05, leadTimeDaysOverride: 2 });
    expect(upd.body).toMatchObject({ serviceLevelZ: 2.05, leadTime: { days: 2, source: 'override' } });
    const cleared = await api().patch(`/api/products/${c.body._id}`).set(auth(w.manager.token)).send({ leadTimeDaysOverride: null });
    expect(cleared.body).toMatchObject({ leadTimeDaysOverride: null, leadTime: { days: 5, source: 'nominal' } });
    const upd2 = await api().patch(`/api/products/${c.body._id}`).set(auth(w.manager.token)).send({ leadTimeDaysOverride: 2 });
    expect(upd2.body.leadTime.days).toBe(2);
    const qr = await api().get(`/api/products/${c.body._id}/qr`).set(auth(w.supplier.token));
    expect(qr.body.dataUrl).toMatch(/^data:image\/png;base64,/);
    const scan = await api().post('/api/products/scan').set(auth(w.staff.token)).send({ payload: 'sku-new-1' });
    expect(scan.body.product.name).toBe('Widget');
    expect((await api().post('/api/products/scan').set(auth(w.staff.token)).send({ payload: 'nope' })).status).toBe(404);
    await putStock(c.body._id, w.north._id, 3);
    const ex = await api().get(`/api/products/${c.body._id}/explain?warehouse=${w.north._id}`).set(auth(w.staff.token));
    expect(ex.body.explanation.shouldReorder).toBe(true);
    expect(ex.body.explanation.steps.length).toBeGreaterThan(4);
    expect((await api().get(`/api/products/${c.body._id}/explain`).set(auth(w.supplier.token))).status).toBe(403);
    const one = await api().get(`/api/products/${c.body._id}`).set(auth(w.staff.token));
    expect(one.body.stock).toEqual([expect.objectContaining({ quantity: 3, batches: 1 })]);
  });

  it('uploads a product image through the storage adapter', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
    const r = await api().post(`/api/products/${w.bracket._id}/image`).set(auth(w.manager.token)).attach('image', png, 'b.png');
    expect(r.status).toBe(200);
    expect(r.body.driver).toBe('local');
    expect(r.body.imageUrl).toMatch(/\/uploads\/products\/.+b\.png$/);
    const served = await api().get(new URL(r.body.imageUrl).pathname);
    expect(served.status).toBe(200);
    const bad = await api().post(`/api/products/${w.bracket._id}/image`).set(auth(w.manager.token)).attach('image', Buffer.from('hi'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(bad.status).toBe(400);
  });
});

describe('warehouses, suppliers and offers', () => {
  it('creates warehouses with geocoding and lets managers edit only their own', async () => {
    const r = await api()
      .post('/api/warehouses')
      .set(auth(w.admin.token))
      .send({ code: 'wh-west', name: 'Warehouse D', address: 'MIDC', city: 'Mumbai', zones: [{ code: 'A', bins: ['A1'] }] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ code: 'WH-WEST', location: { lat: 19.076, lng: 72.8777 } });
    expect((await api().post('/api/warehouses').set(auth(w.admin.token)).send({ code: 'X1', name: 'X', zones: [{ code: 'A', bins: ['B1'] }, { code: 'B', bins: ['B1'] }] })).status).toBe(400);
    expect((await api().patch(`/api/warehouses/${w.north._id}`).set(auth(w.manager.token)).send({ name: 'North Hub' })).body.name).toBe('North Hub');
    expect((await api().patch(`/api/warehouses/${w.south._id}`).set(auth(w.manager.token)).send({ name: 'Nope' })).status).toBe(403);
    expect((await api().patch(`/api/warehouses/${w.north._id}`).set(auth(w.manager.token)).send({ isActive: false })).status).toBe(403);
    expect((await api().patch(`/api/warehouses/${w.north._id}`).set(auth(w.admin.token)).send({ isActive: false })).body.isActive).toBe(false);
    expect((await api().post('/api/warehouses').set(auth(w.manager.token)).send({ code: 'Y1', name: 'Y' })).status).toBe(403);
  });

  it('shows learned lead time, limits suppliers to their own record, and manages offers', async () => {
    await Supplier.updateOne({ _id: w.globex._id }, { leadTimeSamples: 6, leadTimeSum: 77, leadTimeSumSq: 999 });
    const list = await api().get('/api/suppliers').set(auth(w.manager.token));
    const globex = list.body.items.find((s: any) => s.name === 'Globex Traders');
    expect(globex.leadTime.mean).toBeCloseTo(11.89, 2);
    expect(globex.leadTime.source).toBe('blended');
    const own = await api().get('/api/suppliers').set(auth(w.supplier.token));
    expect(own.body.items.map((s: any) => s.name)).toEqual(['Acme Components']);
    expect((await api().get(`/api/suppliers/${w.globex._id}`).set(auth(w.supplier.token))).status).toBe(403);
    expect((await api().patch(`/api/suppliers/${w.acme._id}`).set(auth(w.manager.token)).send({ name: 'x' })).status).toBe(403);
    expect((await api().patch(`/api/suppliers/${w.acme._id}`).set(auth(w.admin.token)).send({ leadTimeDays: 6 })).body.leadTimeDays).toBe(6);

    const offer = await api()
      .post('/api/supplier-offers')
      .set(auth(w.supplier.token))
      .send({ supplier: w.globex._id, product: w.bracket._id, capacityUnits: 500, minOrderQty: 50, leadTimeDays: 2, unitCost: 45 });
    expect(offer.status).toBe(201);
    expect(offer.body.supplier.name).toBe('Acme Components');
    expect((await api().patch(`/api/supplier-offers/${offer.body._id}`).set(auth(w.supplier2.token)).send({ unitCost: 1 })).status).toBe(403);
    expect((await api().patch(`/api/supplier-offers/${offer.body._id}`).set(auth(w.supplier.token)).send({ unitCost: 44 })).body.unitCost).toBe(44);
    expect((await api().get('/api/supplier-offers').set(auth(w.supplier2.token))).body.total).toBe(0);
    expect((await api().post('/api/supplier-offers').set(auth(w.staff.token)).send({ supplier: w.acme._id, product: w.bracket._id, capacityUnits: 1, leadTimeDays: 1, unitCost: 1 })).status).toBe(403);
    expect((await api().delete(`/api/supplier-offers/${offer.body._id}`).set(auth(w.manager.token))).status).toBe(200);
  });

  it('lets a new supplier user register its own supplier record', async () => {
    const { makeUser } = await import('./helpers');
    const s = await makeUser('supplier', { supplier: w.acme._id });
    expect((await api().post('/api/suppliers').set(auth(s.token)).send({ name: 'Other' })).status).toBe(409);
    const admin = await api().post('/api/suppliers').set(auth(w.admin.token)).send({ name: 'Umbrella', leadTimeDays: 4 });
    expect(admin.body).toMatchObject({ name: 'Umbrella', status: 'active', leadTime: { mean: 4, source: 'nominal' } });
  });
});

describe('policies, routes, discrepancies, orders, dependencies, maps, config', () => {
  it('upserts stock policies and transfer routes, estimates routes from distance', async () => {
    const p = await api().put('/api/stock-policies').set(auth(w.manager.token)).send({ product: w.bracket._id, warehouse: w.north._id, minStock: 40, maxStock: 500 });
    expect(p.body).toMatchObject({ minStock: 40, maxStock: 500 });
    expect((await api().put('/api/stock-policies').set(auth(w.manager.token)).send({ product: w.bracket._id, warehouse: w.south._id, minStock: 1 })).status).toBe(403);
    expect((await api().put('/api/stock-policies').set(auth(w.admin.token)).send({ product: w.bracket._id, warehouse: w.south._id, minStock: 10, maxStock: 5 })).status).toBe(400);
    const r = await api().put('/api/transfer-routes').set(auth(w.admin.token)).send({ fromWarehouse: w.north._id, toWarehouse: w.south._id, leadTimeDays: 1, costPerUnit: 2 });
    expect(r.body).toMatchObject({ leadTimeDays: 1, costPerUnit: 2, estimated: false });
    const est = await api().post('/api/transfer-routes/estimate').set(auth(w.admin.token)).send({ fromWarehouse: w.north._id, toWarehouse: w.east._id });
    // Bengaluru -> Kolkata is ~1550 km straight line, x1.25 road factor -> 5 days at 400 km/day
    expect(est.body).toMatchObject({ saved: true, leadTimeDays: 5 });
    expect(est.body.distanceKm).toBeGreaterThan(1800);
    expect((await TransferRoute.findOne({ toWarehouse: w.east._id }))!.estimated).toBe(true);
    expect((await api().get('/api/transfer-routes').set(auth(w.manager.token))).body.total).toBe(2);
    expect((await api().get('/api/transfer-routes').set(auth(w.staff.token))).status).toBe(403);
  });

  it('records and resolves discrepancies with evidence', async () => {
    const d = await api()
      .post('/api/discrepancies')
      .set(auth(w.staff.token))
      .send({ type: 'damage', warehouse: w.north._id, product: w.bracket._id, expectedQty: 10, actualQty: 8, notes: 'crushed box' });
    expect(d.status).toBe(201);
    const ev = await api().post(`/api/discrepancies/${d.body._id}/evidence`).set(auth(w.staff.token)).attach('file', Buffer.from('%PDF-1.4'), { filename: 'proof.pdf', contentType: 'application/pdf' });
    expect(ev.body.evidence).toHaveLength(1);
    expect((await api().patch(`/api/discrepancies/${d.body._id}`).set(auth(w.staff.token)).send({ status: 'resolved' })).status).toBe(403);
    expect((await api().patch(`/api/discrepancies/${d.body._id}`).set(auth(w.manager.token)).send({ status: 'resolved' })).status).toBe(400);
    const res = await api().patch(`/api/discrepancies/${d.body._id}`).set(auth(w.manager.token)).send({ status: 'resolved', resolution: 'Written off' });
    expect(res.body).toMatchObject({ status: 'resolved', resolution: 'Written off' });
    expect((await api().get('/api/discrepancies?status=resolved').set(auth(w.staff.token))).body.total).toBe(1);
  });

  it('manages customer orders and product dependencies', async () => {
    const o = await api()
      .post('/api/customer-orders')
      .set(auth(w.manager.token))
      .send({ customerName: 'Alpha', warehouse: w.north._id, requiredBy: day(5).toISOString(), items: [{ product: w.bracket._id, quantity: 5 }] });
    expect(o.status).toBe(201);
    expect(o.body.orderNo).toMatch(/^CO-\d{4}-0001$/);
    expect((await api().patch(`/api/customer-orders/${o.body._id}`).set(auth(w.manager.token)).send({ status: 'cancelled' })).body.status).toBe('cancelled');
    expect((await api().post('/api/customer-orders').set(auth(w.staff.token)).send({})).status).toBe(403);
    expect((await api().delete(`/api/customer-orders/${o.body._id}`).set(auth(w.admin.token))).status).toBe(200);
    const d = await api().post('/api/product-dependencies').set(auth(w.manager.token)).send({ componentProduct: w.bracket._id, finishedProduct: w.cable._id, quantityPer: 2 });
    expect(d.status).toBe(201);
    expect((await api().post('/api/product-dependencies').set(auth(w.manager.token)).send({ componentProduct: w.cable._id, finishedProduct: w.bracket._id, quantityPer: 1 })).status).toBe(400);
    expect((await api().get('/api/product-dependencies').set(auth(w.manager.token))).body.items[0].componentProduct.sku).toBe('SKU-STL-001');
    expect((await api().delete(`/api/product-dependencies/${d.body._id}`).set(auth(w.manager.token))).status).toBe(200);
  });

  it('serves maps (mock) and config', async () => {
    const g = await api().post('/api/maps/geocode').set(auth(w.manager.token)).send({ address: 'Whitefield, Bengaluru' });
    expect(g.body).toMatchObject({ lat: 12.9716, lng: 77.5946, driver: 'mock' });
    const d = await api().post('/api/maps/distance').set(auth(w.manager.token)).send({ origin: { lat: 12.97, lng: 77.59 }, destination: { lat: 13.08, lng: 80.27 } });
    expect(d.body.transferLeadDays).toBe(1);
    const c = await api().get('/api/config').set(auth(w.staff.token));
    expect(c.body).toMatchObject({ paymentsEnabled: false, drivers: { email: 'console', sms: 'console', maps: 'mock', images: 'local' } });
  });
});

describe('insights, dashboard and reports', () => {
  beforeEach(async () => {
    await Supplier.updateOne({ _id: w.globex._id }, { leadTimeSamples: 6, leadTimeSum: 77, leadTimeSumSq: 999 });
    await seedDemand(w.bracket._id, w.north._id, 10);
    await seedDemand(w.cable._id, w.north._id, 20);
    await putStock(w.bracket._id, w.north._id, 400);
    await putStock(w.bracket._id, w.south._id, 40);
    await seedDemand(w.bracket._id, w.south._id, 10);
    await putStock(w.cable._id, w.north._id, 100);
    await StockLevel.create({ product: w.milk._id, warehouse: w.north._id, bin: 'A1', batchNo: 'M', expiryDate: day(3), quantity: 50 });
  });

  it('returns ABC-XYZ insights with learned lead times and expiry risk', async () => {
    const r = await api().get(`/api/analytics/insights?warehouse=${w.north._id}`).set(auth(w.manager.token));
    expect(r.status).toBe(200);
    const cable = r.body.items.find((i: any) => i.product.sku === 'SKU-CBL-002');
    expect(cable).toMatchObject({ abc: 'A', xyz: 'X', class: 'AX', leadTimeSource: 'blended', promisedLeadTimeDays: 10, recommendedZ: 2.05, status: 'reorder' });
    expect(cable.leadTimeDays).toBeGreaterThan(10);
    // the learned 11.9 days push the reorder point above what the 10-day promise implies (20/day x 10 = 200)
    expect(cable.reorderPoint).toBeGreaterThan(200);
    expect(cable.policyHint).toMatch(/High value/);
    expect(cable.daysOfCover).toBe(5);
    expect(r.body.expiryRisk).toEqual([expect.objectContaining({ batchNo: 'M', units: 50, projectedWaste: 50, valueAtRisk: 1250 })]);
    expect((await api().get('/api/analytics/insights').set(auth(w.staff.token))).status).toBe(403);
  });

  it('suggests rebalances and executes them as instant or requested transfers', async () => {
    const s = await api().get('/api/analytics/rebalance').set(auth(w.admin.token));
    const sug = s.body.items.find((x: any) => x.product.sku === 'SKU-STL-001');
    expect(sug).toMatchObject({ from: { code: 'WH-NORTH' }, to: { code: 'WH-SOUTH' }, quantity: 11 });
    expect(sug.explanation).toMatch(/deficit 11/);
    const asSouth = await api()
      .post('/api/analytics/rebalance/execute')
      .set(auth(w.southManager.token))
      .send({ product: sug.product._id, from: sug.from._id, to: sug.to._id, quantity: sug.quantity });
    expect(asSouth.body).toMatchObject({ mode: 'tracked', transfer: { status: 'pending_approval', source: 'rebalance' } });
    const asNorth = await api()
      .post('/api/analytics/rebalance/execute')
      .set(auth(w.manager.token))
      .send({ product: sug.product._id, from: sug.from._id, to: sug.to._id, quantity: sug.quantity });
    expect(asNorth.body).toMatchObject({ mode: 'instant', transfer: { status: 'completed' } });
  });

  it('serves dashboard KPIs and charts', async () => {
    const o = await api().get('/api/dashboard/overview').set(auth(w.staff.token));
    expect(o.body).toMatchObject({ products: 3, warehouses: 3, suppliers: 3, totalUnits: 590, stockValue: 400 * 50 + 40 * 50 + 100 * 120 + 50 * 25 });
    const scoped = await api().get(`/api/dashboard/overview?warehouse=${w.south._id}`).set(auth(w.staff.token));
    expect(scoped.body.totalUnits).toBe(40);
    const v = await api().get('/api/dashboard/stock-by-value').set(auth(w.staff.token));
    expect(v.body.items[0]).toMatchObject({ sku: 'SKU-STL-001', value: 22000 });
    const f = await api().get('/api/dashboard/po-funnel').set(auth(w.staff.token));
    expect(f.body.items).toHaveLength(9);
    expect((await api().get('/api/dashboard/pending').set(auth(w.admin.token))).body).toHaveProperty('recoveryPlans');
    expect((await api().get('/api/dashboard/overview').set(auth(w.supplier.token))).status).toBe(403);
  });

  it('exports CSV and PDF reports; suppliers get only their own scorecard', async () => {
    for (const path of ['stock.csv', 'purchase-orders.csv', 'suppliers.csv', 'expiry.csv']) {
      const r = await api().get(`/api/reports/${path}`).set(auth(w.manager.token));
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/text\/csv/);
      expect(r.headers['content-disposition']).toMatch(/attachment/);
    }
    const sup = await api().get('/api/reports/suppliers.csv').set(auth(w.admin.token));
    expect(sup.text).toMatch(/Globex Traders,.*,10,11\.89,/);
    for (const path of ['stock.pdf', 'purchase-orders.pdf', `supplier-scorecard.pdf?supplier=${w.globex._id}`]) {
      const r = await api().get(`/api/reports/${path}`).set(auth(w.manager.token)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(r.status).toBe(200);
      expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
    expect((await api().get('/api/reports/stock.csv').set(auth(w.supplier.token))).status).toBe(403);
    expect((await api().get(`/api/reports/supplier-scorecard.pdf?supplier=${w.globex._id}`).set(auth(w.supplier.token))).status).toBe(403);
    expect((await api().get('/api/reports/supplier-scorecard.pdf').set(auth(w.supplier.token))).status).toBe(200);
  });
});

describe('inactive records', () => {
  it('refuses stock movements on inactive products and warehouses', async () => {
    await Product.updateOne({ _id: w.bracket._id }, { isActive: false });
    const r = await api().post('/api/stock/receive').set(auth(w.admin.token)).send({ product: w.bracket._id, warehouse: w.north._id, quantity: 1 });
    expect(r.status).toBe(400);
    await Warehouse.updateOne({ _id: w.south._id }, { isActive: false });
    const r2 = await api().post('/api/stock/receive').set(auth(w.admin.token)).send({ product: w.cable._id, warehouse: w.south._id, quantity: 1 });
    expect(r2.status).toBe(400);
  });
});

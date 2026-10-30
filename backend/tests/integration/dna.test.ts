/** Stock DNA integration tests (docs/Stock_DNA_Spec.md C.12, tests 8-19). */
import {
  AuditLog,
  CustomerOrder,
  DnaEvent,
  DnaLink,
  PurchaseOrder,
  StockLevel,
  StockLot,
  Transfer,
} from '../../src/models';
import { runExpiryJob } from '../../src/services/stockService';
import { geneHash, hashFieldsOf } from '../../src/engines/dnaEngine';
import { GENESIS_HASH } from '../../src/engines/hashChain';
import { DAY_MS } from '../../src/utils/dates';
import { api, auth, clearDb, makeWorld, settle, startDb, stopDb, World } from './helpers';

let w: World;
beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  w = await makeWorld();
});
afterEach(clearDb);

async function receive(token: string, body: Record<string, unknown>) {
  const r = await api().post('/api/stock/receive').set(auth(token)).send(body);
  expect(r.status).toBe(201);
  return (await StockLot.findOne({ dnaCode: r.body.dnaCode }).lean())!;
}

async function dispatch(token: string, body: Record<string, unknown>) {
  return api().post('/api/stock/dispatch').set(auth(token)).send(body);
}

async function genes(lotId: unknown) {
  return DnaEvent.find({ lot: lotId }).sort({ seq: 1 }).lean();
}

async function lot(id: unknown) {
  return (await StockLot.findById(id).lean())!;
}

async function expectReconciled() {
  await settle();
  const r = await api().post('/api/dna/reconcile').set(auth(w.admin.token));
  expect(r.status).toBe(200);
  expect(r.body.drift).toEqual([]);
  expect(r.body.orphanSlices).toBe(0);
}

async function order(
  warehouse: unknown,
  product: unknown,
  quantity: number,
  orderNo = `CO-${Math.random().toString(36).slice(2, 8)}`,
) {
  return CustomerOrder.create({
    orderNo,
    customerName: 'Test Customer',
    warehouse,
    items: [{ product, quantity }],
    requiredBy: new Date(Date.now() + 5 * DAY_MS),
  });
}

describe('birth (test 8)', () => {
  it('a PO receipt creates a lot with a DNA code, a born gene and its audit anchor', async () => {
    const po = await PurchaseOrder.create({
      poNumber: 'PO-2026-000777',
      supplier: w.acme._id,
      warehouse: w.north._id,
      items: [{ product: w.bracket._id, quantityOrdered: 100, unitCost: 48 }],
      status: 'approved',
      approvedAt: new Date(),
    });
    const r = await api()
      .post(`/api/purchase-orders/${po._id}/receive`)
      .set(auth(w.staff.token))
      .send({ receivedItems: [{ product: w.bracket._id, quantityReceived: 100, bin: 'A2' }] });
    expect(r.status).toBe(200);
    expect(r.body.dnaLots).toEqual([expect.objectContaining({ quantity: 100, created: true })]);
    const l = await lot(r.body.dnaLots[0].lot);
    const yymmdd = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    expect(l.dnaCode).toMatch(new RegExp(`^DNA-SKU-STL-001-${yymmdd}-\\d{4}$`));
    expect(l).toMatchObject({
      batchNo: 'PO-2026-000777',
      status: 'active',
      qtyBorn: 100,
      qtyOnHand: 100,
      eventCount: 2,
    });
    expect(l.birth).toMatchObject({
      type: 'purchase_receipt',
      qty: 100,
      unitCost: 48,
      refType: 'purchase_order',
      bin: 'A2',
      backfilled: false,
    });
    expect(l.birth!.grnNo).toMatch(/^GRN-\d{4}-\d{6}$/);
    expect(String(l.supplier)).toBe(String(w.acme._id));
    const g = await genes(l._id);
    expect(g.map((x) => x.type)).toEqual(['born', 'put_away']);
    expect(g[0]).toMatchObject({ seq: 1, prevHash: GENESIS_HASH, qtyDelta: 100, refType: 'purchase_order' });
    await settle();
    const anchor = await AuditLog.findOne({ action: 'dna.born', entityId: l._id.toHexString() }).lean();
    expect(anchor!.metadata).toMatchObject({ seq: 1, dnaHash: g[0].hash, dnaCode: l.dnaCode });
    const slice = await StockLevel.findOne({ lot: l._id }).lean();
    expect(slice).toMatchObject({ quantity: 100, bin: 'A2', batchNo: 'PO-2026-000777' });
    await expectReconciled();
  });
});

describe('life to death (test 9) and partial transfers (test 10)', () => {
  it('receive, put away, transfer out and in, dispatch to depletion: the lot dies sold_out and is sealed', async () => {
    const l = await receive(w.manager.token, {
      product: w.bracket._id,
      warehouse: w.north._id,
      quantity: 100,
      batchNo: 'B9',
      bin: 'A1',
    });
    const t = await api()
      .post('/api/stock/transfer')
      .set(auth(w.manager.token))
      .send({
        product: w.bracket._id,
        fromWarehouse: w.north._id,
        toWarehouse: w.south._id,
        quantity: 40,
        batchNo: 'B9',
        mode: 'tracked',
      });
    expect(t.status).toBe(201);
    await api().post(`/api/transfers/${t.body._id}/approve`).set(auth(w.admin.token)).expect(200);
    await api().post(`/api/transfers/${t.body._id}/dispatch`).set(auth(w.staff.token)).expect(200);
    expect(await lot(l._id)).toMatchObject({ qtyOnHand: 60, qtyInTransit: 40, status: 'active' });
    await api().post(`/api/transfers/${t.body._id}/receive`).set(auth(w.southManager.token)).expect(200);
    expect((await Transfer.findById(t.body._id).lean())!.allocations[0]).toMatchObject({
      quantity: 40,
      batchNo: 'B9',
    });
    expect(
      (await dispatch(w.manager.token, { product: w.bracket._id, warehouse: w.north._id, quantity: 60 }))
        .status,
    ).toBe(200);
    const last = await dispatch(w.southManager.token, {
      product: w.bracket._id,
      warehouse: w.south._id,
      quantity: 40,
    });
    expect(last.status).toBe(200);
    expect(last.body.allocations[0]).toMatchObject({
      lot: l._id.toHexString(),
      dnaCode: l.dnaCode,
      quantity: 40,
    });

    const dead = await lot(l._id);
    expect(dead.status).toBe('depleted');
    expect(dead.qtyOutByCause).toMatchObject({ sold: 100 });
    expect(dead.death).toMatchObject({ cause: 'sold_out', valueLost: 0 });
    expect(dead.death!.lifespanDays).toBeGreaterThanOrEqual(0);
    expect(String(dead.death!.approvedBy)).toBe(String(w.southManager.user._id));
    const g = await genes(l._id);
    expect(g.map((x) => x.type)).toEqual([
      'born',
      'put_away',
      'transfer_out',
      'transfer_in',
      'pick_fefo',
      'dispatch_sale',
      'pick_fefo',
      'dispatch_sale',
      'death',
    ]);
    expect(g.map((x) => x.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(g[2]).toMatchObject({
      qtyMoved: 40,
      qtyAfter: { onHand: 60, inTransit: 40 },
      refType: 'transfer',
    });

    // sealed: nothing more can be added; the same batch received again is a new lot
    const held = await api()
      .post(`/api/dna/lots/${l._id}/hold`)
      .set(auth(w.admin.token))
      .send({ reason: 'test after death' });
    expect(held.status).toBe(409);
    expect(held.body.error.message).toMatch(/sealed/);
    const again = await receive(w.manager.token, {
      product: w.bracket._id,
      warehouse: w.north._id,
      quantity: 5,
      batchNo: 'B9',
      bin: 'A1',
    });
    expect(again.dnaCode).not.toBe(l.dnaCode);
    expect((await lot(l._id)).eventCount).toBe(9);
    const v = await api().post(`/api/dna/lots/${l._id}/verify`).set(auth(w.manager.token));
    expect(v.body).toMatchObject({ ok: true, eventsChecked: 9, firstBrokenSeq: null, anchoredOk: true });
    await expectReconciled();
  });

  it('a partial transfer keeps one lot over two slices and the counters match StockLevel', async () => {
    const l = await receive(w.manager.token, {
      product: w.bracket._id,
      warehouse: w.north._id,
      quantity: 100,
      batchNo: 'B10',
    });
    const t = await api()
      .post('/api/stock/transfer')
      .set(auth(w.manager.token))
      .send({
        product: w.bracket._id,
        fromWarehouse: w.north._id,
        toWarehouse: w.south._id,
        quantity: 30,
        mode: 'instant',
      });
    expect(t.status).toBe(201);
    expect(await StockLot.countDocuments({ product: w.bracket._id })).toBe(1);
    const slices = await StockLevel.find({ lot: l._id }).sort({ quantity: -1 }).lean();
    expect(slices.map((s) => [String(s.warehouse), s.quantity])).toEqual([
      [String(w.north._id), 70],
      [String(w.south._id), 30],
    ]);
    expect(await lot(l._id)).toMatchObject({ qtyOnHand: 100, qtyInTransit: 0 });
    const tracked = await api()
      .post('/api/stock/transfer')
      .set(auth(w.manager.token))
      .send({
        product: w.bracket._id,
        fromWarehouse: w.north._id,
        toWarehouse: w.east._id,
        quantity: 20,
        mode: 'tracked',
      });
    await api().post(`/api/transfers/${tracked.body._id}/approve`).set(auth(w.admin.token)).expect(200);
    await api().post(`/api/transfers/${tracked.body._id}/dispatch`).set(auth(w.manager.token)).expect(200);
    const mid = await lot(l._id);
    expect(mid).toMatchObject({ qtyOnHand: 80, qtyInTransit: 20 });
    const sum = (await StockLevel.find({ lot: l._id }).lean()).reduce((s, x) => s + x.quantity, 0);
    expect(sum).toBe(80);
    const d = await api().get(`/api/dna/lots/${l._id}`).set(auth(w.manager.token));
    expect(d.body.invariantOk).toBe(true);
    expect(d.body.metrics.hops).toBe(1);
    expect(d.body.metrics.journey.map((j: any) => j.warehouse.code)).toEqual(['WH-NORTH', 'WH-SOUTH']);
    await expectReconciled();
  });
});

describe('expiry (test 11)', () => {
  it('expiry job: warning once, then expired and not sellable; disposal kills it with value lost; no duplicates', async () => {
    const l = await receive(w.manager.token, {
      product: w.milk._id,
      warehouse: w.north._id,
      quantity: 120,
      batchNo: 'MLK-11',
      expiryDate: new Date(Date.now() + 1.5 * DAY_MS).toISOString(),
    });
    expect(l.manufactureDate).toBeTruthy();
    expect(l.shelfLifeDays).toBe(6);
    expect(await runExpiryJob()).toMatchObject({ warned: 1, expired: 0 });
    expect(await runExpiryJob()).toMatchObject({ warned: 0, expired: 0 });
    const later = new Date(Date.now() + 2 * DAY_MS);
    expect(await runExpiryJob(later)).toMatchObject({ expired: 1 });
    expect(await runExpiryJob(later)).toMatchObject({ expired: 0 });
    const g = await genes(l._id);
    expect(g.filter((x) => x.type === 'expire')).toHaveLength(1);
    expect(g.filter((x) => x.type === 'expiry_warning')).toHaveLength(1);
    expect((await lot(l._id)).status).toBe('expired');

    const d = await dispatch(w.manager.token, {
      product: w.milk._id,
      warehouse: w.north._id,
      quantity: 1,
      batchNo: 'MLK-11',
    });
    expect(d.status).toBe(409);
    expect(d.body.error.message).toMatch(/expired/);
    expect(
      (await dispatch(w.manager.token, { product: w.milk._id, warehouse: w.north._id, quantity: 1 })).status,
    ).toBe(400);

    const bad = await api()
      .post(`/api/dna/lots/${l._id}/dispose`)
      .set(auth(w.admin.token))
      .send({ warehouse: w.north._id, quantity: 120, cause: 'recalled', reason: 'wrong cause' });
    expect(bad.status).toBe(409);
    const ok = await api()
      .post(`/api/dna/lots/${l._id}/dispose`)
      .set(auth(w.admin.token))
      .send({ warehouse: w.north._id, quantity: 120, cause: 'expired', reason: 'Expired milk to waste' });
    expect(ok.status).toBe(200);
    const dead = await lot(l._id);
    expect(dead.status).toBe('expired_disposed');
    expect(dead.death).toMatchObject({ cause: 'expired', valueLost: 3000 });
    expect(dead.qtyOutByCause.expired).toBe(120);
    const stats = await api().get('/api/dna/stats').set(auth(w.admin.token));
    expect(stats.body.valueLostByCause.expired).toBe(3000);
    expect(stats.body.diedThisMonthByCause).toEqual([{ cause: 'expired', count: 1, valueLost: 3000 }]);
    await expectReconciled();
  });
});

describe('recall (test 12)', () => {
  it('a recall blocks dispatch, the trace shows warehouses and orders reached, clearing allows dispatch again', async () => {
    const l = await receive(w.manager.token, {
      product: w.bracket._id,
      warehouse: w.north._id,
      quantity: 100,
      batchNo: 'R12',
    });
    const o = await order(w.north._id, w.bracket._id, 10, 'CO-R12');
    const s = await api().post(`/api/customer-orders/${o._id}/ship`).set(auth(w.manager.token)).send({});
    expect(s.status).toBe(200);
    expect(s.body.order.status).toBe('fulfilled');
    await api()
      .post('/api/stock/transfer')
      .set(auth(w.manager.token))
      .send({
        product: w.bracket._id,
        fromWarehouse: w.north._id,
        toWarehouse: w.south._id,
        quantity: 30,
        mode: 'instant',
      })
      .expect(201);

    expect(
      (
        await api()
          .post(`/api/dna/lots/${l._id}/recall`)
          .set(auth(w.manager.token))
          .send({ reason: 'Supplier notice' })
      ).status,
    ).toBe(403);
    const r = await api()
      .post(`/api/dna/lots/${l._id}/recall`)
      .set(auth(w.admin.token))
      .send({ reason: 'Supplier notice: cracked welds' });
    expect(r.status).toBe(200);
    expect(r.body.gene).toMatchObject({ type: 'recall_flag' });
    const blocked = await dispatch(w.manager.token, {
      product: w.bracket._id,
      warehouse: w.north._id,
      quantity: 1,
      batchNo: 'R12',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/recalled/);
    expect(
      (await dispatch(w.southManager.token, { product: w.bracket._id, warehouse: w.south._id, quantity: 1 }))
        .status,
    ).toBe(400);

    const trace = await api()
      .get('/api/dna/recall-trace')
      .query({ batchNo: 'R12', product: String(w.bracket._id) })
      .set(auth(w.manager.token));
    expect(trace.status).toBe(200);
    expect(trace.body.matched).toBe(1);
    expect(trace.body.summary.warehousesReached.map((x: any) => [x.warehouse.code, x.qtyReceived])).toEqual([
      ['WH-NORTH', 100],
      ['WH-SOUTH', 30],
    ]);
    expect(trace.body.summary.orders).toEqual([{ refId: String(o._id), qty: 10, orderNo: 'CO-R12' }]);
    expect(trace.body.summary.qtyStillAlive).toBe(90);
    expect(trace.body.lots[0].backward).toMatchObject({ birthType: 'purchase_receipt' });

    await api()
      .post(`/api/dna/lots/${l._id}/recall/clear`)
      .set(auth(w.admin.token))
      .send({ reason: 'False alarm' })
      .expect(200);
    expect(
      (
        await dispatch(w.manager.token, {
          product: w.bracket._id,
          warehouse: w.north._id,
          quantity: 1,
          batchNo: 'R12',
        })
      ).status,
    ).toBe(200);
    await expectReconciled();
  });
});

describe('returns and counts (tests 13, 14)', () => {
  it('a customer return of a dead lot creates a linked child lot; the parent stays sealed', async () => {
    const l = await receive(w.manager.token, {
      product: w.bracket._id,
      warehouse: w.north._id,
      quantity: 20,
      batchNo: 'D13',
    });
    const o = await order(w.north._id, w.bracket._id, 20);
    await api().post(`/api/customer-orders/${o._id}/reserve`).set(auth(w.manager.token)).expect(200);
    expect((await lot(l._id)).qtyReserved).toBe(20);
    await api().post(`/api/customer-orders/${o._id}/ship`).set(auth(w.manager.token)).send({}).expect(200);
    const parent = await lot(l._id);
    expect(parent).toMatchObject({ status: 'depleted', qtyReserved: 0 });
    const types = (await genes(l._id)).map((g) => g.type);
    expect(types).toEqual([
      'born',
      'put_away',
      'reserve',
      'release_reserve',
      'pick_fefo',
      'dispatch_sale',
      'death',
    ]);

    const tooMany = await api()
      .post(`/api/dna/lots/${l._id}/accept-return`)
      .set(auth(w.manager.token))
      .send({ warehouse: w.north._id, quantity: 25, reason: 'Customer returned' });
    expect(tooMany.status).toBe(400);
    const r = await api()
      .post(`/api/dna/lots/${l._id}/accept-return`)
      .set(auth(w.manager.token))
      .send({
        warehouse: w.north._id,
        quantity: 5,
        reason: 'Wrong size ordered',
        customerOrder: String(o._id),
      });
    expect(r.status).toBe(201);
    expect(r.body.lot).toMatchObject({ batchNo: 'D13-R1', status: 'quarantine', qtyBorn: 5 });
    expect(r.body.lot.birth).toMatchObject({ type: 'return_in', refType: 'customer_order' });
    expect(r.body.lot.parentLots).toEqual([String(l._id)]);
    expect(
      await DnaLink.findOne({ parentLot: l._id, childLot: r.body.lot._id, relation: 'return', qty: 5 }),
    ).toBeTruthy();
    expect((await lot(l._id)).eventCount).toBe(parent.eventCount);
    const gen = await api().get(`/api/dna/lots/${r.body.lot._id}/genealogy`).set(auth(w.manager.token));
    expect(gen.body.nodes.map((n: any) => n.role).sort()).toEqual(['ancestor', 'self']);
    expect(gen.body.edges).toEqual([
      expect.objectContaining({ parentLot: String(l._id), childLot: r.body.lot._id, relation: 'return' }),
    ]);
    // quarantined child cannot be sold until released
    expect(
      (
        await dispatch(w.manager.token, {
          product: w.bracket._id,
          warehouse: w.north._id,
          quantity: 1,
          batchNo: 'D13-R1',
        })
      ).status,
    ).toBe(409);
    await api()
      .post(`/api/dna/lots/${r.body.lot._id}/release`)
      .set(auth(w.manager.token))
      .send({ reason: 'Inspected, resaleable' })
      .expect(200);
    expect(
      (
        await dispatch(w.manager.token, {
          product: w.bracket._id,
          warehouse: w.north._id,
          quantity: 1,
          batchNo: 'D13-R1',
        })
      ).status,
    ).toBe(200);
    await expectReconciled();
  });

  it('a cycle count posts count_adjust: shrinkage for a shortfall, qtyAdded for a surplus', async () => {
    const a = await receive(w.manager.token, {
      product: w.bracket._id,
      warehouse: w.north._id,
      quantity: 100,
      batchNo: 'C14',
      bin: 'A1',
    });
    const b = await receive(w.manager.token, {
      product: w.cable._id,
      warehouse: w.north._id,
      quantity: 50,
      batchNo: 'C14B',
      bin: 'A2',
    });
    const c = await api().post('/api/stock-counts').set(auth(w.staff.token)).send({ warehouse: w.north._id });
    const line = (sku: string) => c.body.lines.find((l: any) => l.product.sku === sku);
    await api()
      .patch(`/api/stock-counts/${c.body._id}`)
      .set(auth(w.staff.token))
      .send({
        lines: [
          { _id: line('SKU-STL-001')._id, countedQty: 96, reason: 'missing' },
          { _id: line('SKU-CBL-002')._id, countedQty: 53, reason: 'found' },
        ],
      })
      .expect(200);
    await api().post(`/api/stock-counts/${c.body._id}/submit`).set(auth(w.staff.token)).expect(200);
    await api().post(`/api/stock-counts/${c.body._id}/reconcile`).set(auth(w.manager.token)).expect(200);
    expect(await lot(a._id)).toMatchObject({
      qtyOnHand: 96,
      qtyOutByCause: expect.objectContaining({ shrinkage: 4 }),
    });
    expect(await lot(b._id)).toMatchObject({ qtyOnHand: 53, qtyAdded: 3 });
    const g = (await genes(a._id)).find((x) => x.type === 'count_adjust')!;
    expect(g).toMatchObject({
      qtyDelta: -4,
      refType: 'stock_count',
      refId: c.body._id ? expect.anything() : null,
    });
    expect(g.explanation).toMatch(/system 100, counted 96; shrinkage 4/);
    await expectReconciled();
  });
});

describe('integrity (test 16) and concurrency (test 17)', () => {
  it('a gene edited in the database is found at its seq; a consistently rewritten chain fails the anchor check', async () => {
    const l = await receive(w.manager.token, {
      product: w.bracket._id,
      warehouse: w.north._id,
      quantity: 50,
      batchNo: 'T16',
    });
    await dispatch(w.manager.token, { product: w.bracket._id, warehouse: w.north._id, quantity: 5 });
    await dispatch(w.manager.token, { product: w.bracket._id, warehouse: w.north._id, quantity: 5 });
    await settle();
    const ok = await api().post(`/api/dna/lots/${l._id}/verify`).set(auth(w.admin.token));
    expect(ok.body).toMatchObject({ ok: true, eventsChecked: 6, anchoredOk: true });

    await DnaEvent.collection.updateOne({ lot: l._id, seq: 4 }, { $set: { qtyMoved: 500 } });
    const broken = await api().post(`/api/dna/lots/${l._id}/verify`).set(auth(w.admin.token));
    expect(broken.body).toMatchObject({ ok: false, firstBrokenSeq: 4 });
    expect(broken.body.reason).toMatch(/modified/);
    expect((await lot(l._id)).lastVerify).toMatchObject({ ok: false, firstBrokenSeq: 4 });

    // rewrite every hash so the lot chain is self-consistent: only the audit anchors can tell
    const all = await genes(l._id);
    let prev = GENESIS_HASH;
    for (const g of all) {
      const hash = geneHash(prev, hashFieldsOf(g as unknown as Record<string, unknown>));
      await DnaEvent.collection.updateOne({ _id: g._id }, { $set: { prevHash: prev, hash } });
      prev = hash;
    }
    await StockLot.collection.updateOne({ _id: l._id }, { $set: { headHash: prev } });
    const forged = await api().post(`/api/dna/lots/${l._id}/verify`).set(auth(w.admin.token));
    expect(forged.body).toMatchObject({ ok: false, firstBrokenSeq: null, anchoredOk: false });
    expect(forged.body.anchorProblems.map((p: any) => p.seq)).toEqual([4, 5, 6]);
  });

  it('simultaneous dispatches on one lot never duplicate or skip a seq', async () => {
    const l = await receive(w.manager.token, {
      product: w.bracket._id,
      warehouse: w.north._id,
      quantity: 10,
      batchNo: 'C17',
    });
    const both = await Promise.all([
      dispatch(w.manager.token, { product: w.bracket._id, warehouse: w.north._id, quantity: 4 }),
      dispatch(w.manager.token, { product: w.bracket._id, warehouse: w.north._id, quantity: 4 }),
    ]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    const race = await Promise.all([
      dispatch(w.manager.token, { product: w.bracket._id, warehouse: w.north._id, quantity: 2 }),
      dispatch(w.manager.token, { product: w.bracket._id, warehouse: w.north._id, quantity: 2 }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 400]);
    const g = await genes(l._id);
    expect(g.map((x) => x.seq)).toEqual(g.map((_, i) => i + 1));
    const final = await lot(l._id);
    expect(final).toMatchObject({ status: 'depleted', qtyOnHand: 0, eventCount: g.length });
    expect(final.qtyOutByCause.sold).toBe(10);
    const v = await api().post(`/api/dna/lots/${l._id}/verify`).set(auth(w.admin.token));
    expect(v.body.ok).toBe(true);
    await expectReconciled();
  });
});

describe('roles and scoping (test 18)', () => {
  it('suppliers see only their own lots and no customer references; staff cannot recall or dispose; managers request, admins approve', async () => {
    const acmeLot = await receive(w.manager.token, {
      product: w.bracket._id,
      warehouse: w.north._id,
      quantity: 30,
      batchNo: 'S18',
    });
    await StockLot.updateOne({ _id: acmeLot._id }, { supplier: w.acme._id });
    const otherLot = await receive(w.manager.token, {
      product: w.milk._id,
      warehouse: w.north._id,
      quantity: 30,
      batchNo: 'S18M',
      expiryDate: new Date(Date.now() + 5 * DAY_MS).toISOString(),
    });
    await StockLot.updateOne({ _id: otherLot._id }, { supplier: w.initech._id });
    const o = await order(w.north._id, w.bracket._id, 5);
    await api().post(`/api/customer-orders/${o._id}/ship`).set(auth(w.manager.token)).send({}).expect(200);

    const list = await api().get('/api/dna/lots').set(auth(w.supplier.token));
    expect(list.status).toBe(200);
    expect(list.body.items.map((x: any) => x.dnaCode)).toEqual([acmeLot.dnaCode]);
    expect((await api().get(`/api/dna/lots/${otherLot._id}`).set(auth(w.supplier.token))).status).toBe(404);
    const tl = await api().get(`/api/dna/lots/${acmeLot._id}/timeline`).set(auth(w.supplier.token));
    const sale = tl.body.items.find((g: any) => g.type === 'dispatch_sale');
    expect(sale).toMatchObject({
      refType: 'customer_order',
      refId: null,
      explanation: 'Dispatched 5 to a customer',
    });
    expect(JSON.stringify(tl.body)).not.toContain(String(o._id));
    const internal = await api().get(`/api/dna/lots/${acmeLot._id}/timeline`).set(auth(w.manager.token));
    expect(internal.body.items.find((g: any) => g.type === 'dispatch_sale').refId).toBe(String(o._id));
    expect((await api().get('/api/dna/recall-trace?batchNo=S18').set(auth(w.supplier.token))).status).toBe(
      403,
    );

    expect(
      (
        await api()
          .post(`/api/dna/lots/${acmeLot._id}/recall`)
          .set(auth(w.staff.token))
          .send({ reason: 'not allowed' })
      ).status,
    ).toBe(403);
    const staffDispose = await api()
      .post(`/api/dna/lots/${acmeLot._id}/dispose`)
      .set(auth(w.staff.token))
      .send({ warehouse: w.north._id, quantity: 1, cause: 'damaged', reason: 'not allowed' });
    expect(staffDispose.status).toBe(403);

    const req = await api()
      .post(`/api/dna/lots/${acmeLot._id}/dispose`)
      .set(auth(w.manager.token))
      .send({ warehouse: w.north._id, quantity: 5, cause: 'damaged', reason: 'Crushed pallet' });
    expect(req.status).toBe(202);
    expect(req.body).toMatchObject({
      pending: true,
      request: expect.objectContaining({ status: 'pending', qty: 5 }),
    });
    expect((await lot(acmeLot._id)).qtyOnHand).toBe(25);
    const rid = req.body.request._id;
    expect(
      (
        await api()
          .post(`/api/dna/lots/${acmeLot._id}/requests/${rid}/approve`)
          .set(auth(w.manager.token))
          .send({})
      ).status,
    ).toBe(403);
    const ap = await api()
      .post(`/api/dna/lots/${acmeLot._id}/requests/${rid}/approve`)
      .set(auth(w.admin.token))
      .send({ note: 'ok' });
    expect(ap.status).toBe(200);
    expect(ap.body.gene).toMatchObject({ type: 'write_off' });
    const after = await StockLot.findById(acmeLot._id).lean();
    expect(after).toMatchObject({ qtyOnHand: 20, qtyOutByCause: expect.objectContaining({ damaged: 5 }) });
    expect(after!.requests[0]).toMatchObject({ status: 'approved' });
    expect(
      (
        await api()
          .post(`/api/dna/lots/${acmeLot._id}/requests/${rid}/approve`)
          .set(auth(w.admin.token))
          .send({})
      ).status,
    ).toBe(409);
    // the south manager cannot hold a lot that never was in their warehouse
    expect(
      (
        await api()
          .post(`/api/dna/lots/${acmeLot._id}/hold`)
          .set(auth(w.southManager.token))
          .send({ reason: 'not mine' })
      ).status,
    ).toBe(403);
    await expectReconciled();
  });
});

describe('lookup, stats, certificate and backfill', () => {
  it('resolves a scanned code, lists with filters, serves the certificate and backfills orphan stock idempotently', async () => {
    const l = await receive(w.manager.token, {
      product: w.bracket._id,
      warehouse: w.north._id,
      quantity: 12,
      batchNo: 'L1',
    });
    expect(
      (await api().get('/api/dna/lookup').query({ code: l.dnaCode.toLowerCase() }).set(auth(w.staff.token)))
        .body._id,
    ).toBe(String(l._id));
    expect(
      (
        await api()
          .get('/api/dna/lookup')
          .query({ sku: 'SKU-STL-001', batchNo: 'L1' })
          .set(auth(w.staff.token))
      ).body.dnaCode,
    ).toBe(l.dnaCode);
    expect(
      (await api().get('/api/dna/lookup').query({ code: 'DNA-NOPE' }).set(auth(w.staff.token))).status,
    ).toBe(404);
    const alive = await api().get('/api/dna/lots').query({ alive: 'true', q: 'L1' }).set(auth(w.admin.token));
    expect(alive.body.items).toEqual([
      expect.objectContaining({ dnaCode: l.dnaCode, locations: [expect.objectContaining({ qty: 12 })] }),
    ]);
    const pdf = await api().get(`/api/dna/lots/${l._id}/certificate.pdf`).set(auth(w.manager.token));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect((await api().get(`/api/dna/lots/${l._id}/certificate.pdf`).set(auth(w.staff.token))).status).toBe(
      403,
    );

    // stock written outside the service (as older data would be) is adopted by the backfill
    await StockLevel.collection.insertOne({
      product: w.cable._id,
      warehouse: w.south._id,
      bin: 'A1',
      batchNo: '',
      expiryDate: null,
      quantity: 7,
      reorderPoint: 0,
      lot: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { backfillLots } = await import('../../src/services/stockService');
    const { purchaseHint } = await import('../../src/seed/dnaBackfill');
    const first = await backfillLots(purchaseHint);
    expect(first).toEqual({ slicesAdopted: 1, lotsCreated: 1, backfilled: 1, fromHistory: 0 });
    expect(await backfillLots(purchaseHint)).toEqual({
      slicesAdopted: 0,
      lotsCreated: 0,
      backfilled: 0,
      fromHistory: 0,
    });
    const bf = await StockLot.findOne({ product: w.cable._id }).lean();
    expect(bf).toMatchObject({
      flags: expect.objectContaining({ backfilled: true }),
      birth: expect.objectContaining({ type: 'opening_balance', backfilled: true }),
    });
    expect((await genes(bf!._id))[0].explanation).toMatch(
      /Backfilled from existing stock; true birth not recorded/,
    );
    const s = await api().get('/api/dna/stats').set(auth(w.admin.token));
    expect(s.body).toMatchObject({ alive: 2, dead: 0 });
    // staff see lots that have been in their own warehouse only
    expect((await api().get('/api/dna/stats').set(auth(w.staff.token))).body).toMatchObject({ alive: 1 });
    await expectReconciled();
  });
});

/** Builds the demo database (PART 4). Every created record also gets a hash-chained audit entry. */
import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import {
  CustomerOrder,
  DemandHistory,
  Product,
  ProductDependency,
  PurchaseOrder,
  StockPolicy,
  Supplier,
  SupplierOffer,
  TransferRoute,
  User,
  Warehouse,
} from '../models';
import { applyLeadTimeSample, supplierPerformanceScore } from '../engines/reorder';
import { recordAudit, auditIdle } from '../middleware/audit';
import { addDays, DAY_MS, startOfUtcDay } from '../utils/dates';
import { nextPoNumber } from '../services/counters';
import { checkOverduePOs, evaluateStockAlerts, sweepExpiry } from '../services/alerts';
import { announcePending } from '../services/purchaseOrders';
import { flushNotifications } from '../services/notifications';
import { receiveLot, runStock } from '../services/stockService';
import {
  CUSTOMER_ORDERS,
  DEMAND,
  GLOBEX_HISTORY_DAYS,
  OFFERS,
  POLICIES,
  PRODUCTS,
  ROUTES,
  SEED_PASSWORD,
  STOCK,
  SUPPLIERS,
  WAREHOUSES,
} from './data';

export interface SeedResult {
  skipped: boolean;
  counts: Record<string, number>;
}

/** Deterministic pseudo-random sequence (no Math.random) so every seed produces the same history. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function series(mean: number, pattern: 'constant' | 'varied' | 'erratic', seed: number, days = 30): number[] {
  if (pattern === 'constant') return Array(days).fill(mean);
  const rnd = lcg(seed);
  if (pattern === 'varied') return Array.from({ length: days }, () => Math.max(0, Math.round(mean * (0.85 + rnd() * 0.3))));
  // erratic: mostly zero with occasional spikes, averaging roughly `mean`
  return Array.from({ length: days }, () => (rnd() < 0.15 ? Math.round((mean / 0.15) * (0.5 + rnd())) : 0));
}

export async function seedDatabase(opts: { ifEmpty?: boolean; log?: (m: string) => void } = {}): Promise<SeedResult> {
  const log = opts.log ?? (() => undefined);
  if (opts.ifEmpty && (await User.estimatedDocumentCount()) > 0) {
    log('Database already has users; --if-empty given, nothing to do.');
    return { skipped: true, counts: {} };
  }
  log('Clearing collections...');
  const db = mongoose.connection.db!;
  for (const c of await db.collections()) await c.deleteMany({});

  const now = new Date();
  const today = startOfUtcDay(now);
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const audit = (action: string, entityType: string, doc: { _id: Types.ObjectId }, warehouse?: unknown) =>
    recordAudit({ action, entityType, entityId: doc._id, actor: null, warehouse, after: doc, metadata: { seed: true } });

  // warehouses and users
  const wh: Record<string, InstanceType<typeof Warehouse>> = {};
  for (const w of WAREHOUSES) {
    wh[w.code] = await Warehouse.create(w);
    await audit('seed.warehouse', 'Warehouse', wh[w.code], wh[w.code]._id);
  }
  const sup: Record<string, InstanceType<typeof Supplier>> = {};
  for (const s of SUPPLIERS) {
    const { key, ...data } = s;
    sup[key] = await Supplier.create(data);
  }

  const users = [
    { name: 'Asha Admin', email: 'admin@example.com', role: 'admin', phone: '+919800000001' },
    { name: 'Manoj Manager', email: 'manager@example.com', role: 'warehouse_manager', warehouse: wh['WH-NORTH']._id, phone: '+919800000002' },
    { name: 'Sita Staff', email: 'staff@example.com', role: 'staff', warehouse: wh['WH-NORTH']._id },
    { name: 'Acme Portal', email: 'supplier@example.com', role: 'supplier', supplier: sup.acme._id },
    { name: 'Initech Portal', email: 'supplier2@example.com', role: 'supplier', supplier: sup.initech._id },
  ];
  const u: Record<string, InstanceType<typeof User>> = {};
  for (const x of users) {
    u[x.email] = await User.create({ ...x, passwordHash });
    await audit('seed.user', 'User', u[x.email], x.warehouse);
  }
  wh['WH-NORTH'].manager = u['manager@example.com']._id;
  await wh['WH-NORTH'].save();

  // products
  const p: Record<string, InstanceType<typeof Product>> = {};
  for (const x of PRODUCTS) {
    const { supplier, ...data } = x;
    p[x.sku] = await Product.create({ ...data, primarySupplier: supplier ? sup[supplier]._id : null, qrPayload: x.sku });
    await audit('seed.product', 'Product', p[x.sku]);
  }
  await ProductDependency.create({ componentProduct: p['SKU-CMP-010']._id, finishedProduct: p['SKU-ASM-030']._id, quantityPer: 1 });

  // demand history (30 full days before today)
  const rows = [];
  let seed = 7;
  for (const d of DEMAND) {
    const values = series(d.mean, d.pattern, seed++);
    for (let i = 0; i < values.length; i++) {
      rows.push({ product: p[d.sku]._id, warehouse: wh[d.wh]._id, date: addDays(today, -(values.length - i)), quantity: values[i], source: 'seed' });
    }
  }
  await DemandHistory.insertMany(rows);

  // stock, policies, routes, offers
  // opening balances go through the stock service, so every seeded lot is born with its DNA
  for (const s of STOCK) {
    await runStock(null, (ctx) =>
      receiveLot(ctx, {
        product: p[s.sku]._id,
        warehouse: wh[s.wh]._id,
        bin: s.bin,
        batchNo: s.batchNo ?? '',
        expiryDate: s.expiresInDays !== undefined ? new Date(now.getTime() + s.expiresInDays * DAY_MS) : null,
        quantity: s.qty,
        supplier: p[s.sku].primarySupplier,
        birthType: 'opening_balance',
        explanation: `Opening balance (seed, illustrative): ${s.qty} at ${s.wh}`,
      }),
    );
  }
  for (const x of POLICIES) await StockPolicy.create({ product: p[x.sku]._id, warehouse: wh[x.wh]._id, minStock: x.minStock, maxStock: x.maxStock ?? null });
  for (const r of ROUTES) {
    await TransferRoute.create({ fromWarehouse: wh[r.from]._id, toWarehouse: wh[r.to]._id, leadTimeDays: r.leadTimeDays, costPerUnit: r.costPerUnit, distanceKm: r.distanceKm });
  }
  for (const o of OFFERS) {
    await SupplierOffer.create({ supplier: sup[o.supplier]._id, product: p[o.sku]._id, capacityUnits: o.capacityUnits, minOrderQty: o.minOrderQty, leadTimeDays: o.leadTimeDays, unitCost: o.unitCost });
  }

  // Globex delivery history: six received POs whose real lead times feed the F3 accumulators
  let acc = { leadTimeSamples: 0, leadTimeSum: 0, leadTimeSumSq: 0 };
  for (let i = 0; i < GLOBEX_HISTORY_DAYS.length; i++) {
    const days = GLOBEX_HISTORY_DAYS[i];
    const approvedAt = addDays(today, -(150 - i * 20));
    const delivered = addDays(approvedAt, days);
    const po = await PurchaseOrder.create({
      poNumber: await nextPoNumber(),
      supplier: sup.globex._id,
      warehouse: wh['WH-NORTH']._id,
      items: [{ product: p['SKU-CBL-002']._id, quantityOrdered: 400, quantityReceived: 400, unitCost: 120 }],
      status: 'received',
      source: 'manual',
      createdBy: u['manager@example.com']._id,
      approvedBy: u['admin@example.com']._id,
      approvedAt,
      expectedDeliveryDate: addDays(approvedAt, 10),
      actualDeliveryDate: delivered,
      receivedBy: u['staff@example.com']._id,
    });
    acc = applyLeadTimeSample(acc, days);
    await audit('seed.purchase_order', 'PurchaseOrder', po, wh['WH-NORTH']._id);
  }
  Object.assign(sup.globex, acc, {
    totalOrders: GLOBEX_HISTORY_DAYS.length,
    onTimeDeliveries: 0,
    lateDeliveries: GLOBEX_HISTORY_DAYS.length,
    performanceScore: supplierPerformanceScore(0, GLOBEX_HISTORY_DAYS.length),
  });
  await sup.globex.save();
  Object.assign(sup.acme, { totalOrders: 4, onTimeDeliveries: 4, performanceScore: 100 });
  await sup.acme.save();
  for (const s of Object.values(sup)) await audit('seed.supplier', 'Supplier', s);

  // open POs: one pending approval, one approved (the Acme order that a disruption delays), one partially received
  const pending = await PurchaseOrder.create({
    poNumber: await nextPoNumber(),
    supplier: sup.initech._id,
    warehouse: wh['WH-SOUTH']._id,
    items: [{ product: p['SKU-BOX-003']._id, quantityOrdered: 600, unitCost: 15 }],
    status: 'pending_approval',
    source: 'manual',
    createdBy: u['manager@example.com']._id,
    notes: 'Festival season packaging',
  });
  const approved = await PurchaseOrder.create({
    poNumber: await nextPoNumber(),
    supplier: sup.acme._id,
    warehouse: wh['WH-NORTH']._id,
    items: [{ product: p['SKU-CMP-010']._id, quantityOrdered: 300, unitCost: 80 }],
    status: 'approved',
    source: 'manual',
    createdBy: u['manager@example.com']._id,
    approvedBy: u['admin@example.com']._id,
    approvedAt: addDays(now, -1),
    expectedDeliveryDate: addDays(today, 4),
  });
  const partial = await PurchaseOrder.create({
    poNumber: await nextPoNumber(),
    supplier: sup.globex._id,
    warehouse: wh['WH-NORTH']._id,
    items: [{ product: p['SKU-CBL-002']._id, quantityOrdered: 400, quantityReceived: 150, unitCost: 120 }],
    status: 'partially_received',
    source: 'manual',
    createdBy: u['manager@example.com']._id,
    approvedBy: u['admin@example.com']._id,
    approvedAt: addDays(now, -14),
    expectedDeliveryDate: addDays(today, -2),
    receivedBy: u['staff@example.com']._id,
  });
  for (const po of [pending, approved, partial]) await audit('seed.purchase_order', 'PurchaseOrder', po, po.warehouse);

  // downstream customer orders for the Domino demo
  for (const o of CUSTOMER_ORDERS) {
    const co = await CustomerOrder.create({
      orderNo: o.orderNo,
      customerName: o.customerName,
      warehouse: wh[o.wh]._id,
      requiredBy: addDays(today, o.dueInDays),
      priority: o.priority,
      items: [{ product: p['SKU-ASM-030']._id, quantity: o.qty }],
      createdBy: u['manager@example.com']._id,
    });
    await audit('seed.customer_order', 'CustomerOrder', co, co.warehouse);
  }

  // alerts derived from the data
  await announcePending(pending);
  for (const s of STOCK) await evaluateStockAlerts(p[s.sku]._id, wh[s.wh]._id);
  await sweepExpiry(now);
  await checkOverduePOs(now);
  await auditIdle();
  await flushNotifications();

  const counts: Record<string, number> = {};
  for (const name of ['users', 'warehouses', 'suppliers', 'products', 'stocklevels', 'purchaseorders', 'demandhistory', 'alerts', 'auditlogs', 'customerorders']) {
    counts[name] = await db.collection(name).countDocuments();
  }
  return { skipped: false, counts };
}

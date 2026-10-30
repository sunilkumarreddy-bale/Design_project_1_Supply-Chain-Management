/**
 * Stock DNA read side (docs/Stock_DNA_Spec.md C.8, C.9, C.11): lot lists, lot detail with computed values,
 * timeline, genealogy, journey, integrity verification against the audit anchors, recall trace, stats,
 * reconcile and the PDF life certificate. All writes go through services/stockService.
 */
import { Types } from 'mongoose';
import {
  AuditLog,
  CustomerOrder,
  DnaEvent,
  DnaLink,
  Product,
  StockLevel,
  StockLot,
  Warehouse,
} from '../models';
import { ApiError } from '../utils/apiError';
import { idStr } from '../utils/ids';
import type { AuthUser } from '../middleware/auth';
import {
  ALIVE_STATUSES,
  DEAD_STATUSES,
  geneTotals,
  invariantHolds,
  lifeUsedPct,
  LotStatus,
  lotMetrics,
  reconcileLots,
  remainingShelfDays,
  StoredGene,
  traceBackward,
  traceForward,
  TraceLot,
  verifyLotChain,
} from '../engines/dnaEngine';
import { header as pdfHeader, money, pdfBuffer, table } from './reports';
import { notifySafe } from './notifications';

const DAY_MS = 86_400_000;
const d10 = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '-');
const dt = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '-';

/** Suppliers only ever see their own lots; managers and staff see lots that have been in their warehouse. */
export function lotScope(user: AuthUser): Record<string, unknown> {
  if (user.role === 'supplier') return { supplier: user.supplier ? new Types.ObjectId(user.supplier) : null };
  if ((user.role === 'warehouse_manager' || user.role === 'staff') && user.warehouse)
    return { warehouses: new Types.ObjectId(user.warehouse) };
  return {};
}

/** Loads a lot the user may read (suppliers: own lots only; everyone else may open any lot, e.g. from a trace). */
export async function readableLot(id: string, user: AuthUser) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid lot id');
  const lot = await StockLot.findById(id)
    .populate('product', 'sku name unit unitCost unitPrice holdingCostPerUnitYear isPerishable')
    .populate('supplier', 'name')
    .populate('birth.warehouse', 'code name city')
    .populate('death.approvedBy', 'name')
    .populate('requests.requestedBy', 'name')
    .populate('requests.decidedBy', 'name')
    .lean();
  if (!lot) throw ApiError.notFound('Lot not found');
  if (user.role === 'supplier' && idStr(lot.supplier) !== user.supplier)
    throw ApiError.notFound('Lot not found');
  return lot;
}

export interface ListLotsQuery {
  page: number;
  limit: number;
  product?: string;
  warehouse?: string;
  supplier?: string;
  status?: LotStatus;
  alive?: 'true' | 'false';
  expiringInDays?: number;
  recalled?: 'true' | 'false';
  q?: string;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function lotFilter(q: Omit<ListLotsQuery, 'page' | 'limit'>, user: AuthUser, now = new Date()) {
  const f: Record<string, unknown> = { ...lotScope(user) };
  if (q.product) f.product = new Types.ObjectId(q.product);
  if (q.warehouse) f.warehouses = new Types.ObjectId(q.warehouse);
  if (q.supplier && user.role !== 'supplier') f.supplier = new Types.ObjectId(q.supplier);
  if (q.status) f.status = q.status;
  else if (q.alive === 'true') f.status = { $in: ALIVE_STATUSES };
  else if (q.alive === 'false') f.status = { $in: DEAD_STATUSES };
  if (q.expiringInDays !== undefined) {
    f.expiryDate = { $ne: null, $lte: new Date(now.getTime() + q.expiringInDays * DAY_MS) };
    if (!q.status) f.status = { $in: ALIVE_STATUSES };
  }
  if (q.recalled === 'true') f['flags.recalled'] = true;
  if (q.recalled === 'false') f['flags.recalled'] = false;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q.trim()), 'i');
    f.$or = [{ dnaCode: rx }, { batchNo: rx }];
  }
  return f;
}

/** Where each lot is right now (warehouses holding stock of it). */
async function currentLocations(lotIds: Types.ObjectId[]) {
  const rows = await StockLevel.aggregate([
    { $match: { lot: { $in: lotIds }, quantity: { $gt: 0 } } },
    { $group: { _id: { lot: '$lot', warehouse: '$warehouse' }, qty: { $sum: '$quantity' } } },
    { $lookup: { from: 'warehouses', localField: '_id.warehouse', foreignField: '_id', as: 'w' } },
    { $unwind: '$w' },
    {
      $project: {
        _id: 0,
        lot: '$_id.lot',
        warehouse: { _id: '$w._id', code: '$w.code', name: '$w.name' },
        qty: 1,
      },
    },
  ]);
  const m = new Map<string, { warehouse: { _id: unknown; code: string; name: string }; qty: number }[]>();
  for (const r of rows)
    m.set(idStr(r.lot)!, [...(m.get(idStr(r.lot)!) ?? []), { warehouse: r.warehouse, qty: r.qty }]);
  return m;
}

export async function listLots(q: ListLotsQuery, user: AuthUser) {
  const filter = lotFilter(q, user);
  const skip = (q.page - 1) * q.limit;
  const [items, total] = await Promise.all([
    StockLot.find(filter)
      .select('-requests -headHash')
      .populate('product', 'sku name unit')
      .populate('supplier', 'name')
      .sort({ status: 1, expiryDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(q.limit)
      .lean(),
    StockLot.countDocuments(filter),
  ]);
  const where = await currentLocations(items.map((l) => l._id));
  const now = new Date();
  return {
    items: items.map((l) => ({
      ...l,
      locations: where.get(l._id.toHexString()) ?? [],
      lifeUsedPct: l.death?.lifeUsedPct ?? lifeUsedPct(l.manufactureDate ?? null, l.expiryDate ?? null, now),
      remainingShelfDays: remainingShelfDays(l.expiryDate ?? null, now),
    })),
    total,
    page: q.page,
    limit: q.limit,
  };
}

/** Customer references are ids only; suppliers do not see them at all. */
function sanitizeGene<T extends Record<string, any>>(g: T, user: AuthUser): T {
  if (user.role !== 'supplier' || g.refType !== 'customer_order') return g;
  return {
    ...g,
    refId: null,
    explanation:
      g.type === 'dispatch_sale'
        ? `Dispatched ${g.qtyMoved} to a customer`
        : `${String(g.type).replace(/_/g, ' ')} for a customer order`,
  };
}

export async function lotGenes(lotId: unknown) {
  return DnaEvent.find({ lot: idStr(lotId) })
    .sort({ seq: 1 })
    .lean();
}

export async function getLot(id: string, user: AuthUser) {
  const lot = await readableLot(id, user);
  const genes = await lotGenes(lot._id);
  const slices = await StockLevel.find({ lot: lot._id, quantity: { $gt: 0 } })
    .populate('warehouse', 'code name')
    .sort({ warehouse: 1, bin: 1 })
    .lean();
  const product = lot.product as unknown as { holdingCostPerUnitYear?: number } | null;
  const metrics = lotMetrics(
    {
      state: {
        qtyOnHand: lot.qtyOnHand,
        qtyBorn: lot.qtyBorn,
        qtyAdded: lot.qtyAdded,
        status: lot.status as LotStatus,
      },
      bornAt: lot.birth!.at,
      diedAt: lot.death?.at ?? null,
      manufactureDate: lot.manufactureDate ?? null,
      expiryDate: lot.expiryDate ?? null,
      holdingCostPerUnitYear: product?.holdingCostPerUnitYear ?? 0,
      genes: genes.map((g) => ({
        ...g,
        warehouse: idStr(g.warehouse),
        fromWarehouse: idStr(g.fromWarehouse),
        toWarehouse: idStr(g.toWarehouse),
        refId: idStr(g.refId),
      })),
    },
    new Date(),
  );
  const whIds = [...new Set(metrics.journey.map((j) => j.warehouse))];
  const whs = await Warehouse.find({ _id: { $in: whIds } })
    .select('code name city location')
    .lean();
  const whById = new Map(whs.map((w) => [w._id.toHexString(), w]));
  const sliceSum = slices.reduce((s, x) => s + x.quantity, 0);
  return {
    ...lot,
    requests: user.role === 'supplier' ? [] : lot.requests,
    metrics: {
      ...metrics,
      journey: metrics.journey.map((j) => ({
        ...j,
        warehouse: whById.get(j.warehouse) ?? { _id: j.warehouse, code: '?', name: 'Unknown' },
      })),
      dwellByLocation: Object.fromEntries(
        Object.entries(metrics.dwellByLocation).map(([k, v]) => [whById.get(k)?.code ?? k, v]),
      ),
    },
    slices,
    invariantOk: invariantHolds(lot as never) && sliceSum === lot.qtyOnHand,
  };
}

export async function timeline(id: string, user: AuthUser) {
  const lot = await readableLot(id, user);
  const genes = await DnaEvent.find({ lot: lot._id })
    .sort({ seq: 1 })
    .populate('actor', 'name role')
    .populate('warehouse', 'code name')
    .populate('fromWarehouse', 'code name')
    .populate('toWarehouse', 'code name')
    .lean();
  let prev: Date | null = null;
  const items = genes.map((g) => {
    const since = prev ? Math.round(((g.at.getTime() - prev.getTime()) / DAY_MS) * 100) / 100 : null;
    prev = g.at;
    return sanitizeGene({ ...g, daysSincePrevious: since }, user);
  });
  return { lot: { _id: lot._id, dnaCode: lot.dnaCode, status: lot.status }, items, total: items.length };
}

/** Lots reachable over dnalinks: ancestors (up) and descendants (down). */
export async function genealogy(id: string, user: AuthUser) {
  const lot = await readableLot(id, user);
  const edges: { parentLot: string; childLot: string; relation: string; qty: number; at: Date }[] = [];
  const seenEdge = new Set<string>();
  const visit = async (start: string, dir: 'up' | 'down') => {
    const queue = [start];
    const seen = new Set<string>([start]);
    while (queue.length) {
      const cur = queue.shift()!;
      const links = await DnaLink.find(dir === 'up' ? { childLot: cur } : { parentLot: cur }).lean();
      for (const l of links) {
        const key = l._id.toHexString();
        if (!seenEdge.has(key)) {
          seenEdge.add(key);
          edges.push({
            parentLot: idStr(l.parentLot)!,
            childLot: idStr(l.childLot)!,
            relation: l.relation,
            qty: l.qty,
            at: l.at,
          });
        }
        const next = idStr(dir === 'up' ? l.parentLot : l.childLot)!;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  };
  const self = lot._id.toHexString();
  await visit(self, 'up');
  await visit(self, 'down');
  const ids = [...new Set([self, ...edges.flatMap((e) => [e.parentLot, e.childLot])])];
  const nodes = await StockLot.find({ _id: { $in: ids } })
    .select('dnaCode batchNo status qtyBorn qtyOnHand birth.type supplier')
    .lean();
  const visible = user.role === 'supplier' ? nodes.filter((n) => idStr(n.supplier) === user.supplier) : nodes;
  const up = traceBackward(self, edges);
  return {
    lot: self,
    nodes: visible.map((n) => ({
      ...n,
      role:
        n._id.toHexString() === self
          ? 'self'
          : up.some((u) => u.parent === n._id.toHexString())
            ? 'ancestor'
            : 'descendant',
    })),
    edges: edges.filter(
      (e) =>
        visible.some((n) => n._id.toHexString() === e.parentLot) &&
        visible.some((n) => n._id.toHexString() === e.childLot),
    ),
  };
}

export async function journey(id: string, user: AuthUser) {
  const l = await getLot(id, user);
  return {
    lot: l._id,
    dnaCode: l.dnaCode,
    journey: l.metrics.journey,
    dwellByLocation: l.metrics.dwellByLocation,
    hops: l.metrics.hops,
  };
}

/** Resolves a scanned DNA code, or a product SKU plus batch number, to a lot. */
export async function lookup(input: { code?: string; sku?: string; batchNo?: string }, user: AuthUser) {
  let lot = null;
  if (input.code) {
    lot = await StockLot.findOne({ dnaCode: input.code.trim().toUpperCase(), ...lotScope(user) })
      .select('_id dnaCode status')
      .lean();
  } else if (input.sku) {
    const p = await Product.findOne({ $or: [{ sku: input.sku.trim() }, { qrPayload: input.sku.trim() }] })
      .select('_id')
      .lean();
    if (p) {
      lot = await StockLot.findOne({
        product: p._id,
        batchNo: (input.batchNo ?? '').trim(),
        ...lotScope(user),
      })
        .sort({ createdAt: -1 })
        .select('_id dnaCode status')
        .lean();
    }
  }
  if (!lot) throw ApiError.notFound('No lot matches that code');
  return lot;
}

/** Verifies the lot's chain and its anchors in the audit chain; records the result on the lot. */
export async function verifyLot(id: string, user: AuthUser) {
  const lot = await readableLot(id, user);
  const genes = (await lotGenes(lot._id)) as unknown as StoredGene[];
  const anchors = await AuditLog.find({
    entityType: 'StockLot',
    entityId: lot._id.toHexString(),
    action: /^dna\./,
  })
    .select('metadata')
    .lean();
  const map = new Map<number, string>();
  for (const a of anchors) {
    const m = a.metadata as { seq?: number; dnaHash?: string } | null;
    if (m?.seq) map.set(m.seq, m.dnaHash ?? '');
  }
  const header = await StockLot.findById(lot._id).select('eventCount headHash').lean();
  const r = verifyLotChain(
    genes,
    { eventCount: header!.eventCount, headHash: header!.headHash ?? null },
    map,
  );
  const at = new Date();
  await StockLot.updateOne(
    { _id: lot._id },
    { $set: { lastVerify: { at, ok: r.ok, firstBrokenSeq: r.firstBrokenSeq } } },
  );
  if (!r.ok) {
    await notifySafe(
      { roles: ['admin'] },
      {
        type: 'dna.verify_failed',
        subject: `DNA verification failed for ${lot.dnaCode}`,
        body: r.reason ?? 'The chain does not verify',
        link: `/dna/${lot._id.toHexString()}`,
      },
    );
  }
  return { ...r, checkedAt: at, dnaCode: lot.dnaCode };
}

/** Recall trace: every lot matching supplier/product/batch, traced forward (and back to its birth). */
export async function recallTrace(input: { supplier?: string; product?: string; batchNo?: string }) {
  if (!input.supplier && !input.product && !input.batchNo)
    throw ApiError.badRequest('Give a supplier, a product or a batch number');
  const f: Record<string, unknown> = {};
  if (input.supplier) f.supplier = new Types.ObjectId(input.supplier);
  if (input.product) f.product = new Types.ObjectId(input.product);
  if (input.batchNo) f.batchNo = input.batchNo.trim();
  const roots = await StockLot.find(f)
    .populate('product', 'sku name')
    .populate('supplier', 'name')
    .populate('birth.warehouse', 'code name')
    .lean();
  // the whole family: descendants of the matching lots
  const family = new Set(roots.map((r) => r._id.toHexString()));
  const links: { parentLot: string; childLot: string; relation: string; qty: number }[] = [];
  let frontier = [...family];
  while (frontier.length) {
    const ls = await DnaLink.find({ parentLot: { $in: frontier } }).lean();
    frontier = [];
    for (const l of ls) {
      links.push({
        parentLot: idStr(l.parentLot)!,
        childLot: idStr(l.childLot)!,
        relation: l.relation,
        qty: l.qty,
      });
      const c = idStr(l.childLot)!;
      if (!family.has(c)) {
        family.add(c);
        frontier.push(c);
      }
    }
  }
  const all = await StockLot.find({ _id: { $in: [...family] } }).lean();
  const lots = new Map<string, TraceLot>(
    all.map((l) => [
      l._id.toHexString(),
      {
        id: l._id.toHexString(),
        dnaCode: l.dnaCode,
        status: l.status as LotStatus,
        qtyBorn: l.qtyBorn,
        qtyAdded: l.qtyAdded,
        qtyOnHand: l.qtyOnHand,
        qtyInTransit: l.qtyInTransit,
        birthWarehouse: idStr(l.birth?.warehouse),
      },
    ]),
  );
  const genes = await DnaEvent.find({
    lot: { $in: [...family] },
    type: { $in: ['born', 'receive_more', 'transfer_in', 'dispatch_sale'] },
  })
    .select('lot type warehouse toWarehouse qtyMoved qtyDelta refType refId')
    .lean();
  const plain = genes.map((g) => ({
    ...g,
    lot: idStr(g.lot)!,
    warehouse: idStr(g.warehouse),
    toWarehouse: idStr(g.toWarehouse),
    refId: idStr(g.refId),
  }));
  const whs = await Warehouse.find().select('code name').lean();
  const whName = new Map(whs.map((w) => [w._id.toHexString(), { _id: w._id, code: w.code, name: w.name }]));
  const orderIds = plain.filter((g) => g.refType === 'customer_order' && g.refId).map((g) => g.refId!);
  const orders = await CustomerOrder.find({ _id: { $in: orderIds } })
    .select('orderNo warehouse status')
    .lean();
  const orderNo = new Map(orders.map((o) => [o._id.toHexString(), o.orderNo]));
  const resolveWh = (w: { warehouse: string; qtyReceived: number }) => ({
    ...w,
    warehouse: whName.get(w.warehouse) ?? { _id: w.warehouse, code: '?', name: 'Unknown' },
  });
  const resolveOrder = (o: { refId: string; qty: number }) => ({
    ...o,
    orderNo: orderNo.get(o.refId) ?? null,
  });

  const perLot = roots.map((r) => {
    const t = traceForward([r._id.toHexString()], lots, plain, links);
    return {
      lot: {
        _id: r._id,
        dnaCode: r.dnaCode,
        batchNo: r.batchNo,
        status: r.status,
        product: r.product,
        supplier: r.supplier,
        flags: r.flags,
        qtyBorn: r.qtyBorn,
        qtyOnHand: r.qtyOnHand,
      },
      backward: {
        supplier: r.supplier,
        birthType: r.birth?.type,
        purchaseOrder: r.birth?.refType === 'purchase_order' ? r.birth.refId : null,
        grnNo: r.birth?.grnNo ?? null,
        receivedAt: r.birth?.at,
        receivingWarehouse: r.birth?.warehouse,
        parents: traceBackward(r._id.toHexString(), links),
      },
      forward: {
        warehousesReached: t.warehousesReached.map(resolveWh),
        orders: t.orders.map(resolveOrder),
        qtyDispatchedToOrders: t.qtyDispatchedToOrders,
        qtyStillAlive: t.qtyStillAlive,
        lots: t.lots.map((l) => ({
          ...l,
          warehouses: l.warehouses.map(resolveWh),
          orders: l.orders.map(resolveOrder),
        })),
      },
    };
  });
  const total = traceForward(
    roots.map((r) => r._id.toHexString()),
    lots,
    plain,
    links,
  );
  return {
    query: input,
    matched: roots.length,
    lots: perLot,
    summary: {
      warehousesReached: total.warehousesReached.map(resolveWh),
      orders: total.orders.map(resolveOrder),
      qtyDispatchedToOrders: total.qtyDispatchedToOrders,
      qtyStillAlive: total.qtyStillAlive,
    },
  };
}

export async function stats(user: AuthUser, now = new Date()) {
  const scope = lotScope(user);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [alive, dead, deaths, recentDeaths, expiringSoon, recalled, value] = await Promise.all([
    StockLot.countDocuments({ ...scope, status: { $in: ALIVE_STATUSES } }),
    StockLot.countDocuments({ ...scope, status: { $in: DEAD_STATUSES } }),
    StockLot.aggregate([
      { $match: { ...scope, death: { $ne: null } } },
      {
        $group: {
          _id: '$death.cause',
          count: { $sum: 1 },
          avgLifespanDays: { $avg: '$death.lifespanDays' },
          avgLifeUsedPct: { $avg: '$death.lifeUsedPct' },
          valueLost: { $sum: '$death.valueLost' },
        },
      },
      { $sort: { count: -1 } },
    ]),
    StockLot.aggregate([
      { $match: { ...scope, 'death.at': { $gte: monthStart } } },
      { $group: { _id: '$death.cause', count: { $sum: 1 }, valueLost: { $sum: '$death.valueLost' } } },
      { $sort: { count: -1 } },
    ]),
    StockLot.countDocuments({
      ...scope,
      status: { $in: ['active', 'quarantine'] },
      expiryDate: { $ne: null, $gte: now, $lte: new Date(now.getTime() + 7 * DAY_MS) },
    }),
    StockLot.countDocuments({ ...scope, 'flags.recalled': true, status: { $in: ALIVE_STATUSES } }),
    // value lost by cause, including waste on lots that are still alive (unit cost at birth)
    StockLot.aggregate([
      { $match: scope },
      {
        $project: {
          cost: '$birth.unitCost',
          expired: '$qtyOutByCause.expired',
          damaged: '$qtyOutByCause.damaged',
          shrinkage: '$qtyOutByCause.shrinkage',
          recalled: '$qtyOutByCause.recalled',
          writtenOff: '$qtyOutByCause.writtenOff',
        },
      },
      {
        $group: {
          _id: null,
          expired: { $sum: { $multiply: ['$expired', '$cost'] } },
          damaged: { $sum: { $multiply: ['$damaged', '$cost'] } },
          shrinkage: { $sum: { $multiply: ['$shrinkage', '$cost'] } },
          recalled: { $sum: { $multiply: ['$recalled', '$cost'] } },
          writtenOff: { $sum: { $multiply: ['$writtenOff', '$cost'] } },
        },
      },
    ]),
  ]);
  // value lost this month to expiry and damage: write-off and damage genes dated this month
  const monthLoss = await DnaEvent.aggregate([
    {
      $match: {
        at: { $gte: monthStart },
        $or: [{ type: 'damage' }, { type: 'write_off', cause: { $in: ['expired', 'damaged'] } }],
      },
    },
    { $lookup: { from: 'stocklots', localField: 'lot', foreignField: '_id', as: 'l' } },
    { $unwind: '$l' },
    ...(Object.keys(scope).length
      ? [{ $match: Object.fromEntries(Object.entries(scope).map(([k, v]) => [`l.${k}`, v])) }]
      : []),
    {
      $group: {
        _id: { $cond: [{ $eq: ['$cause', 'expired'] }, 'expired', 'damaged'] },
        value: { $sum: { $multiply: ['$qtyMoved', '$l.birth.unitCost'] } },
        units: { $sum: '$qtyMoved' },
      },
    },
  ]);
  const n = (x: unknown) => Math.round(Number(x ?? 0) * 100) / 100;
  const deathCount = deaths.reduce((s, d) => s + d.count, 0);
  const v = value[0] ?? {};
  return {
    alive,
    dead,
    recalledAlive: recalled,
    expiringSoon,
    deathsByCause: deaths.map((d) => ({
      cause: d._id,
      count: d.count,
      avgLifespanDays: n(d.avgLifespanDays),
      avgLifeUsedPct: d.avgLifeUsedPct === null ? null : n(d.avgLifeUsedPct),
      valueLost: n(d.valueLost),
    })),
    averageLifespanDays: deathCount
      ? n(deaths.reduce((s, d) => s + d.avgLifespanDays * d.count, 0) / deathCount)
      : null,
    averageLifeUsedAtDeath: (() => {
      const withLife = deaths.filter((d) => d.avgLifeUsedPct !== null);
      const c = withLife.reduce((s, d) => s + d.count, 0);
      return c ? n(withLife.reduce((s, d) => s + d.avgLifeUsedPct * d.count, 0) / c) : null;
    })(),
    valueLostByCause: {
      expired: n(v.expired),
      damaged: n(v.damaged),
      shrinkage: n(v.shrinkage),
      recalled: n(v.recalled),
      writtenOff: n(v.writtenOff),
    },
    diedThisMonthByCause: recentDeaths.map((d) => ({
      cause: d._id,
      count: d.count,
      valueLost: n(d.valueLost),
    })),
    valueLostThisMonth: {
      expired: n(monthLoss.find((m) => m._id === 'expired')?.value),
      damaged: n(monthLoss.find((m) => m._id === 'damaged')?.value),
      total: n(monthLoss.reduce((s, m) => s + m.value, 0)),
    },
    monthStart,
  };
}

/** Compares, per lot, the genes' running totals, the header counters and the sum of stock slices. */
export async function reconcileAll() {
  const lots = await StockLot.find()
    .select('dnaCode qtyBorn qtyAdded qtyOnHand qtyInTransit qtyOutByCause')
    .lean();
  const lastGenes = await DnaEvent.aggregate([
    { $sort: { lot: 1, seq: -1 } },
    { $group: { _id: '$lot', seq: { $first: '$seq' }, qtyAfter: { $first: '$qtyAfter' } } },
  ]);
  const slices = await StockLevel.aggregate([
    { $match: { lot: { $ne: null } } },
    { $group: { _id: '$lot', qty: { $sum: '$quantity' } } },
  ]);
  const gm = new Map(lastGenes.map((g) => [idStr(g._id)!, geneTotals([g])]));
  const sm = new Map(slices.map((s) => [idStr(s._id)!, s.qty as number]));
  const drift = reconcileLots(
    lots.map((l) => ({
      lot: l._id.toHexString(),
      dnaCode: l.dnaCode,
      header: {
        qtyBorn: l.qtyBorn,
        qtyAdded: l.qtyAdded,
        qtyOnHand: l.qtyOnHand,
        qtyInTransit: l.qtyInTransit,
        qtyOutByCause: l.qtyOutByCause as never,
      },
      geneOnHand: gm.get(l._id.toHexString())?.onHand ?? 0,
      geneInTransit: gm.get(l._id.toHexString())?.inTransit ?? 0,
      sliceOnHand: sm.get(l._id.toHexString()) ?? 0,
    })),
  );
  const orphanSlices = await StockLevel.countDocuments({ lot: null, quantity: { $gt: 0 } });
  return { lotsChecked: lots.length, drift, orphanSlices, checkedAt: new Date() };
}

/** Life certificate PDF: birth certificate, the full gene list and, for a dead lot, the death certificate. */
export async function certificatePdf(id: string, user: AuthUser) {
  const lot = await readableLot(id, user);
  const genes = await DnaEvent.find({ lot: lot._id })
    .sort({ seq: 1 })
    .populate('actor', 'name')
    .populate('warehouse', 'code')
    .populate('toWarehouse', 'code')
    .lean();
  const product = lot.product as unknown as { sku: string; name: string; unit?: string };
  const supplier = lot.supplier as unknown as { name: string } | null;
  const birthWh = lot.birth?.warehouse as unknown as { code: string; name: string } | null;
  const lastVerify = (lot as { lastVerify?: { at?: Date | null; ok?: boolean | null } }).lastVerify;
  return pdfBuffer((doc) => {
    pdfHeader(doc, `Stock DNA life certificate - ${lot.dnaCode}`, `Generated ${dt(new Date())} UTC`);
    doc.fillColor('#26365b').font('Helvetica-Bold').fontSize(12).text('Birth certificate');
    doc.font('Helvetica').fontSize(9).fillColor('#222');
    const birth = [
      ['DNA code', lot.dnaCode],
      ['Product', `${product?.sku ?? ''} ${product?.name ?? ''}`],
      ['Batch', lot.batchNo || '-'],
      ['Supplier', supplier?.name ?? '-'],
      [
        'Born',
        `${dt(lot.birth?.at)} UTC as ${String(lot.birth?.type).replace(/_/g, ' ')}${lot.birth?.backfilled ? ' (backfilled: true birth not recorded)' : ''}`,
      ],
      ['Warehouse', birthWh ? `${birthWh.code} ${birthWh.name}` : '-'],
      ['Quantity at birth', `${lot.qtyBorn} ${product?.unit ?? ''}`],
      ['Unit cost', money(lot.birth?.unitCost ?? 0)],
      ['Expiry', d10(lot.expiryDate)],
      ['Status now', String(lot.status).replace(/_/g, ' ')],
    ];
    for (const [k, v] of birth) doc.text(`${k}: ${v}`);
    doc.moveDown(0.6);
    doc.fillColor('#26365b').font('Helvetica-Bold').fontSize(12).text(`Life record (${genes.length} events)`);
    doc.moveDown(0.3);
    table(
      doc,
      [
        { header: '#', width: 26, align: 'right' },
        { header: 'Time (UTC)', width: 92 },
        { header: 'Event', width: 92 },
        { header: 'Where', width: 70 },
        { header: 'Qty change', width: 60, align: 'right' },
        { header: 'On hand after', width: 64, align: 'right' },
        { header: 'By', width: 80 },
        { header: 'Explanation', width: 285 },
      ],
      genes.map((g) => {
        const wh = (g.warehouse as unknown as { code?: string } | null)?.code ?? '';
        const to = (g.toWarehouse as unknown as { code?: string } | null)?.code;
        const ex =
          user.role === 'supplier' && g.refType === 'customer_order'
            ? 'Dispatched to a customer'
            : g.explanation;
        return [
          g.seq,
          dt(g.at),
          g.type.replace(/_/g, ' '),
          to && g.type.startsWith('transfer') ? `${wh} > ${to}` : wh,
          g.qtyDelta || (g.qtyMoved ? `(${g.qtyMoved} moved)` : 0),
          g.qtyAfter?.onHand ?? 0,
          (g.actor as unknown as { name?: string } | null)?.name ?? 'system',
          ex,
        ];
      }),
    );
    if (lot.death) {
      doc.moveDown(0.8);
      doc
        .fillColor('#8c1d2f')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text('Death certificate', doc.page.margins.left);
      doc.font('Helvetica').fontSize(9).fillColor('#222');
      doc.text(`Cause: ${String(lot.death.cause).replace(/_/g, ' ')}`);
      doc.text(`Date: ${dt(lot.death.at)} UTC`);
      doc.text(`Lifespan: ${lot.death.lifespanDays} days`);
      doc.text(
        `Shelf life used: ${lot.death.lifeUsedPct === null || lot.death.lifeUsedPct === undefined ? 'unknown' : `${Math.round(lot.death.lifeUsedPct * 100)}%`}`,
      );
      doc.text(`Value lost: ${money(lot.death.valueLost ?? 0)}`);
    }
    doc.moveDown(0.8);
    doc
      .fillColor('#555')
      .fontSize(8)
      .text(`Head hash: ${lot.headHash ?? '-'}`, doc.page.margins.left);
    doc.text(
      lastVerify?.at
        ? `${lastVerify.ok ? 'Verified' : 'Verification FAILED'} on ${dt(lastVerify.at)} UTC`
        : 'Not verified',
    );
  });
}

/** Lots in the warehouses a manager or staff member may change. */
export function canWriteLot(user: AuthUser, lot: { warehouses?: unknown[] }): boolean {
  if (user.role === 'admin') return true;
  if (user.role !== 'warehouse_manager' && user.role !== 'staff') return false;
  return !!user.warehouse && (lot.warehouses ?? []).some((w) => idStr(w) === user.warehouse);
}

export interface SliceLotInfo {
  lot: string;
  dnaCode: string;
  status: LotStatus;
  recalled: boolean;
  remainingShelfDays: number | null;
  sellable: boolean;
}

/** The DNA lot behind each stock slice (by slice id), for screens and engines that work on slices. */
export async function lotInfoForSlices(
  slices: { _id: unknown; lot?: unknown }[],
  now = new Date(),
): Promise<Map<string, SliceLotInfo>> {
  const ids = [...new Set(slices.map((s) => idStr(s.lot)).filter((x): x is string => !!x))];
  const lots = await StockLot.find({ _id: { $in: ids } })
    .select('dnaCode status flags expiryDate')
    .lean();
  const byId = new Map(lots.map((l) => [l._id.toHexString(), l]));
  const out = new Map<string, SliceLotInfo>();
  for (const s of slices) {
    const l = byId.get(idStr(s.lot) ?? '');
    if (!l) continue;
    out.set(idStr(s._id)!, {
      lot: l._id.toHexString(),
      dnaCode: l.dnaCode,
      status: l.status as LotStatus,
      recalled: !!l.flags?.recalled,
      remainingShelfDays: remainingShelfDays(l.expiryDate ?? null, now),
      sellable: l.status === 'active' && !l.flags?.recalled,
    });
  }
  return out;
}

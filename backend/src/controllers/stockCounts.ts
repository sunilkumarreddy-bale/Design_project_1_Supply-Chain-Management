import { Request, Response } from 'express';
import { z } from 'zod';
import { StockCount, StockLevel } from '../models';
import { withTransaction } from '../config/db';
import { ApiError } from '../utils/apiError';
import { snapshot } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { assertWarehouseScope } from '../middleware/rbac';
import { objectId, pageOf, paging } from '../middleware/validate';
import { addToLine, afterStockChange, requireActiveWarehouse } from '../services/inventory';
import { nextCountNo } from '../services/counters';
import { raiseAlert } from '../services/alerts';
import { emitAll } from '../sockets';
import { sendPage } from './helpers';

/** Variances above this share of the system quantity raise a count_variance alert. */
export const VARIANCE_ALERT_THRESHOLD = 0.05;

export const createCountSchema = z.object({ warehouse: objectId, product: objectId.optional(), bin: z.string().trim().optional() });
export const listCountsQuery = z.object({
  ...paging,
  warehouse: objectId.optional(),
  status: z.enum(['open', 'submitted', 'reconciled', 'cancelled']).optional(),
});
export const updateCountSchema = z.object({
  lines: z.array(
    z.object({
      _id: objectId,
      countedQty: z.union([z.coerce.number().min(0, 'must be 0 or more'), z.null()]),
      reason: z.string().max(300).optional(),
    }),
  ),
});

const populate = (q: any) =>
  q
    .populate('warehouse', 'code name')
    .populate('lines.product', 'sku name unit')
    .populate('createdBy', 'name')
    .populate('reconciledBy', 'name');

async function loadCount(id: string) {
  const c = await StockCount.findById(id);
  if (!c) throw ApiError.notFound('Cycle count not found');
  return c;
}

export async function createCount(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof createCountSchema>;
  assertWarehouseScope(user, b.warehouse);
  await requireActiveWarehouse(b.warehouse);
  const filter: Record<string, unknown> = { warehouse: b.warehouse, quantity: { $gt: 0 } };
  if (b.product) filter.product = b.product;
  if (b.bin) filter.bin = b.bin;
  const lines = await StockLevel.find(filter).sort({ bin: 1, product: 1 }).lean();
  if (!lines.length) throw ApiError.badRequest('There is no stock to count for this selection');
  const count = await StockCount.create({
    countNo: await nextCountNo(),
    warehouse: b.warehouse,
    status: 'open',
    lines: lines.map((l) => ({
      product: l.product,
      bin: l.bin,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      systemQty: l.quantity,
      countedQty: null,
      variance: null,
    })),
    createdBy: user._id,
  });
  await recordAudit({ action: 'count.create', entityType: 'StockCount', entityId: count._id, actor: user, warehouse: b.warehouse, after: count });
  res.status(201).json((await populate(StockCount.findById(count._id))).toJSON());
}

export async function listCounts(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listCountsQuery>;
  const { page, limit, skip } = pageOf(q, 50);
  const filter: Record<string, unknown> = {};
  if (q.warehouse) filter.warehouse = q.warehouse;
  if (q.status) filter.status = q.status;
  const [items, total] = await Promise.all([
    StockCount.find(filter).populate('warehouse', 'code name').populate('createdBy', 'name').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    StockCount.countDocuments(filter),
  ]);
  sendPage(
    res,
    items.map((c) => ({
      ...c,
      lineCount: c.lines.length,
      countedLines: c.lines.filter((l) => l.countedQty !== null && l.countedQty !== undefined).length,
      varianceLines: c.lines.filter((l) => (l.variance ?? 0) !== 0).length,
      lines: undefined,
    })),
    total,
    page,
    limit,
  );
}

export async function getCount(req: Request, res: Response) {
  const c = await populate(StockCount.findById(req.params.id));
  if (!c) throw ApiError.notFound('Cycle count not found');
  res.json(c.toJSON());
}

export async function updateCount(req: Request, res: Response) {
  const user = currentUser(req);
  const c = await loadCount(req.params.id);
  assertWarehouseScope(user, c.warehouse);
  if (c.status !== 'open') throw ApiError.conflict(`Count ${c.countNo} is ${c.status} and can no longer be edited`);
  const b = req.body as z.infer<typeof updateCountSchema>;
  for (const u of b.lines) {
    const line = c.lines.id(u._id);
    if (!line) throw ApiError.badRequest(`Line ${u._id} is not part of this count`);
    line.countedQty = u.countedQty;
    if (u.reason !== undefined) line.reason = u.reason;
  }
  await c.save();
  res.json((await populate(StockCount.findById(c._id))).toJSON());
}

export async function submitCount(req: Request, res: Response) {
  const user = currentUser(req);
  const c = await loadCount(req.params.id);
  assertWarehouseScope(user, c.warehouse);
  if (c.status !== 'open') throw ApiError.conflict(`Count ${c.countNo} is already ${c.status}`);
  const missing = c.lines.filter((l) => l.countedQty === null || l.countedQty === undefined).length;
  if (missing) throw ApiError.badRequest(`Enter a counted quantity for every line (${missing} missing)`);
  const before = snapshot(c);
  for (const l of c.lines) l.variance = (l.countedQty ?? 0) - l.systemQty;
  c.status = 'submitted';
  c.submittedAt = new Date();
  await c.save();
  await recordAudit({ action: 'count.submit', entityType: 'StockCount', entityId: c._id, actor: user, warehouse: c.warehouse, before, after: c });
  res.json((await populate(StockCount.findById(c._id))).toJSON());
}

/** Applies every variance as an adjustment of the live stock line in one transaction. */
export async function reconcileCount(req: Request, res: Response) {
  const user = currentUser(req);
  const pre = await loadCount(req.params.id);
  assertWarehouseScope(user, pre.warehouse);
  if (pre.status !== 'submitted') throw ApiError.conflict(`Count ${pre.countNo} must be submitted before reconciling (it is ${pre.status})`);
  const before = snapshot(pre);
  const adjustments = await withTransaction(async (session) => {
    const c = await StockCount.findById(pre._id).session(session);
    if (!c || c.status !== 'submitted') throw ApiError.conflict('Count is no longer submitted');
    const out = [];
    for (const l of c.lines) {
      const variance = l.variance ?? 0;
      if (variance === 0) continue;
      const filter = { product: l.product, warehouse: c.warehouse, batchNo: l.batchNo, bin: l.bin };
      const live = await StockLevel.findOne(filter).session(session);
      if (live) {
        const from = live.quantity;
        live.quantity = Math.max(0, from + variance);
        await live.save({ session });
        out.push({ line: l, lineId: live._id, from, to: live.quantity, variance });
      } else if (variance > 0) {
        const { line } = await addToLine(
          { product: l.product, warehouse: c.warehouse, bin: l.bin, batchNo: l.batchNo, expiryDate: l.expiryDate ?? null, quantity: variance },
          session,
        );
        out.push({ line: l, lineId: line._id, from: 0, to: line.quantity, variance });
      }
    }
    c.status = 'reconciled';
    c.reconciledBy = user._id;
    c.reconciledAt = new Date();
    await c.save({ session });
    return { count: c, out };
  });
  const c = adjustments.count;
  for (const a of adjustments.out) {
    await recordAudit({
      action: 'stock.adjust',
      entityType: 'StockLevel',
      entityId: a.lineId,
      actor: user,
      warehouse: c.warehouse,
      before: { quantity: a.from },
      after: { quantity: a.to },
      metadata: { countNo: c.countNo, variance: a.variance, reason: a.line.reason },
    });
    const share = a.line.systemQty > 0 ? Math.abs(a.variance) / a.line.systemQty : Infinity;
    if (share > VARIANCE_ALERT_THRESHOLD) {
      await raiseAlert({
        type: 'count_variance',
        severity: share > 0.2 ? 'critical' : 'warning',
        product: a.line.product,
        warehouse: c.warehouse,
        key: `${c._id.toHexString()}:${a.line._id.toHexString()}`,
        message: `${c.countNo}: counted ${a.line.countedQty} vs system ${a.line.systemQty} (variance ${a.variance > 0 ? '+' : ''}${a.variance}${
          Number.isFinite(share) ? `, ${(share * 100).toFixed(1)}%` : ''
        }) in bin ${a.line.bin || '-'} batch ${a.line.batchNo || '-'}${a.line.reason ? `; reason: ${a.line.reason}` : ''}`,
      });
    }
  }
  await recordAudit({ action: 'count.reconcile', entityType: 'StockCount', entityId: c._id, actor: user, warehouse: c.warehouse, before, after: c });
  const products = [...new Set(adjustments.out.map((a) => a.line.product.toHexString()))];
  for (const p of products) await afterStockChange(p, [c.warehouse], { action: 'count_adjust' });
  emitAll('count:update', { _id: c._id, status: c.status });
  res.json({
    count: (await populate(StockCount.findById(c._id))).toJSON(),
    adjustments: adjustments.out.map((a) => ({ lineId: a.lineId, from: a.from, to: a.to, variance: a.variance })),
  });
}

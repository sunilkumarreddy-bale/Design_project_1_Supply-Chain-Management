import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { StockLevel, Transfer, TRANSFER_STATUSES } from '../models';
import { currentUser } from '../middleware/auth';
import { assertWarehouseScope } from '../middleware/rbac';
import { dateLike, objectId, pageOf, paging, positiveQty } from '../middleware/validate';
import { dispatchStock, instantTransfer, receiveStock } from '../services/inventory';
import { requestTrackedTransfer } from '../services/transfers';
import { stockCsv } from '../services/reports';
import { sendFile, sendPage, today } from './helpers';

export const listStockQuery = z.object({
  ...paging,
  warehouse: objectId.optional(),
  product: objectId.optional(),
  includeEmpty: z.enum(['true', 'false']).optional(),
});
export const summaryQuery = z.object({ warehouse: objectId.optional() });

const optText = z.string().trim().max(60).optional().nullable();

export const receiveSchema = z.object({
  product: objectId,
  warehouse: objectId,
  quantity: positiveQty,
  bin: optText,
  batchNo: optText,
  expiryDate: dateLike,
});

export const dispatchSchema = z.object({
  product: objectId,
  warehouse: objectId,
  quantity: positiveQty,
  bin: optText,
  batchNo: optText,
});

export const transferSchema = z.object({
  product: objectId,
  fromWarehouse: objectId,
  toWarehouse: objectId,
  quantity: positiveQty,
  batchNo: optText,
  notes: z.string().max(500).optional().default(''),
  mode: z.enum(['instant', 'tracked']).default('instant'),
});

export const listTransfersQuery = z.object({
  ...paging,
  status: z.enum(TRANSFER_STATUSES).optional(),
  warehouse: objectId.optional(),
  plan: objectId.optional(),
});

export async function listStock(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listStockQuery>;
  const { page, limit, skip } = pageOf(q, 200);
  const filter: Record<string, unknown> = {};
  if (q.warehouse) filter.warehouse = q.warehouse;
  if (q.product) filter.product = q.product;
  if (q.includeEmpty !== 'true') filter.quantity = { $gt: 0 };
  const [items, total] = await Promise.all([
    StockLevel.find(filter)
      .populate('product', 'sku name unit unitCost isPerishable')
      .populate('warehouse', 'code name')
      .sort({ product: 1, expiryDate: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    StockLevel.countDocuments(filter),
  ]);
  sendPage(res, items, total, page, limit);
}

export async function stockSummary(req: Request, res: Response) {
  const q = req.query as z.infer<typeof summaryQuery>;
  const match: Record<string, unknown> = { quantity: { $gt: 0 } };
  if (q.warehouse) match.warehouse = new Types.ObjectId(q.warehouse);
  const rows = await StockLevel.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$product',
        onHand: { $sum: '$quantity' },
        batches: { $sum: 1 },
        nearestExpiry: { $min: '$expiryDate' },
        warehouses: { $addToSet: '$warehouse' },
      },
    },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    {
      $project: {
        _id: 0,
        product: { _id: '$product._id', sku: '$product.sku', name: '$product.name', unit: '$product.unit', unitCost: '$product.unitCost' },
        onHand: 1,
        batches: 1,
        nearestExpiry: 1,
        warehouseCount: { $size: '$warehouses' },
        value: { $multiply: ['$onHand', '$product.unitCost'] },
      },
    },
    { $sort: { value: -1 } },
  ]);
  res.json({ items: rows, total: rows.length, page: 1, limit: rows.length });
}

export async function receive(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof receiveSchema>;
  assertWarehouseScope(user, b.warehouse);
  const line = await receiveStock(b, user);
  res.status(201).json(line);
}

export async function dispatch(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof dispatchSchema>;
  assertWarehouseScope(user, b.warehouse);
  const allocations = await dispatchStock(b, user);
  res.json({ allocations, quantity: b.quantity });
}

export async function transfer(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof transferSchema>;
  assertWarehouseScope(user, b.fromWarehouse, 'the source warehouse');
  const t = b.mode === 'tracked' ? await requestTrackedTransfer(b, user) : await instantTransfer(b, user);
  res.status(201).json(t);
}

export async function listTransfers(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listTransfersQuery>;
  const { page, limit, skip } = pageOf(q, 100);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.plan) filter.plan = q.plan;
  if (q.warehouse) filter.$or = [{ fromWarehouse: q.warehouse }, { toWarehouse: q.warehouse }];
  const [items, total] = await Promise.all([
    Transfer.find(filter)
      .populate('product', 'sku name unit')
      .populate('fromWarehouse', 'code name')
      .populate('toWarehouse', 'code name')
      .populate('initiatedBy', 'name')
      .populate('approvedBy', 'name')
      .populate('receivedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transfer.countDocuments(filter),
  ]);
  sendPage(res, items, total, page, limit);
}

export async function exportStockCsv(req: Request, res: Response) {
  const q = req.query as z.infer<typeof summaryQuery>;
  sendFile(res, await stockCsv(q.warehouse ?? null), `stock-${today()}.csv`, 'text/csv; charset=utf-8');
}

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  Alert,
  Product,
  PO_STATUSES,
  PurchaseOrder,
  RecoveryPlan,
  RedistributionPlan,
  StockLevel,
  Supplier,
  Transfer,
  Warehouse,
} from '../models';
import { objectId } from '../middleware/validate';

export const dashboardQuery = z.object({ warehouse: objectId.optional() });

export async function overview(req: Request, res: Response) {
  const wh = (req.query as z.infer<typeof dashboardQuery>).warehouse ?? null;
  const stockMatch: Record<string, unknown> = {};
  if (wh) stockMatch.warehouse = new Types.ObjectId(wh);
  const whFilter = wh ? { warehouse: wh } : {};
  const [products, warehouses, suppliers, openAlerts, pendingPOs, lowStock, totals] = await Promise.all([
    Product.countDocuments({ isActive: true }),
    Warehouse.countDocuments({ isActive: true }),
    Supplier.countDocuments({ isActive: true }),
    Alert.countDocuments({ isResolved: false, ...(wh ? { $or: [{ warehouse: wh }, { warehouse: null }] } : {}) }),
    PurchaseOrder.countDocuments({ status: 'pending_approval', ...whFilter }),
    Alert.countDocuments({ isResolved: false, type: 'low_stock', ...whFilter }),
    StockLevel.aggregate([
      { $match: stockMatch },
      { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: 'p' } },
      { $unwind: '$p' },
      { $group: { _id: null, units: { $sum: '$quantity' }, value: { $sum: { $multiply: ['$quantity', '$p.unitCost'] } } } },
    ]),
  ]);
  res.json({
    products,
    warehouses,
    suppliers,
    openAlerts,
    pendingPOs,
    lowStockLines: lowStock,
    totalUnits: totals[0]?.units ?? 0,
    stockValue: totals[0]?.value ?? 0,
    warehouse: wh,
    generatedAt: new Date(),
  });
}

export async function stockByValue(req: Request, res: Response) {
  const wh = (req.query as z.infer<typeof dashboardQuery>).warehouse;
  const match: Record<string, unknown> = { quantity: { $gt: 0 } };
  if (wh) match.warehouse = new Types.ObjectId(wh);
  const rows = await StockLevel.aggregate([
    { $match: match },
    { $group: { _id: '$product', units: { $sum: '$quantity' } } },
    { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'p' } },
    { $unwind: '$p' },
    { $project: { _id: 0, productId: '$_id', sku: '$p.sku', name: '$p.name', units: 1, value: { $multiply: ['$units', '$p.unitCost'] } } },
    { $sort: { value: -1 } },
    { $limit: 20 },
  ]);
  res.json({ items: rows });
}

export async function poFunnel(req: Request, res: Response) {
  const wh = (req.query as z.infer<typeof dashboardQuery>).warehouse;
  const match: Record<string, unknown> = {};
  if (wh) match.warehouse = new Types.ObjectId(wh);
  const rows = await PurchaseOrder.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const counts = new Map(rows.map((r) => [r._id, r.count]));
  res.json({ items: PO_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 })) });
}

/** Everything waiting for an approver: POs, recovery and redistribution plans, tracked transfers. */
export async function pendingApprovals(_req: Request, res: Response) {
  const [pos, recovery, redistribution, transfers] = await Promise.all([
    PurchaseOrder.find({ status: 'pending_approval' }).populate('supplier', 'name').populate('warehouse', 'code name').sort({ createdAt: -1 }).limit(20).lean({ virtuals: true }),
    RecoveryPlan.find({ status: 'proposed' }).populate('product', 'sku name').populate('targetWarehouse', 'code name').sort({ createdAt: -1 }).limit(20).lean(),
    RedistributionPlan.find({ status: 'proposed' }).populate('product', 'sku name').populate('sourceWarehouse', 'code name').sort({ createdAt: -1 }).limit(20).lean(),
    Transfer.find({ status: 'pending_approval' })
      .populate('product', 'sku name')
      .populate('fromWarehouse', 'code name')
      .populate('toWarehouse', 'code name')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
  ]);
  res.json({
    purchaseOrders: pos.map((p) => ({ ...p, totalCost: p.items.reduce((s, i) => s + i.quantityOrdered * (i.unitCost ?? 0), 0) })),
    recoveryPlans: recovery.map((p) => ({
      _id: p._id,
      planNo: p.planNo,
      product: p.product,
      targetWarehouse: p.targetWarehouse,
      createdAt: (p as { createdAt?: Date }).createdAt,
      option: p.options.find((o) => o.optionId === p.selectedOptionId) ?? null,
    })),
    redistributionPlans: redistribution.map((p) => ({
      _id: p._id,
      planNo: p.planNo,
      product: p.product,
      sourceWarehouse: p.sourceWarehouse,
      batchNo: p.batchNo,
      units: p.lines.reduce((s, l) => s + l.quantity, 0),
      createdAt: (p as { createdAt?: Date }).createdAt,
    })),
    transfers,
  });
}

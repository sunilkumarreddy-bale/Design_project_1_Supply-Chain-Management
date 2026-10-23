import { Request, Response } from 'express';
import { z } from 'zod';
import { StockPolicy, TransferRoute, Warehouse } from '../models';
import { ApiError } from '../utils/apiError';
import { snapshot } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { assertWarehouseScope } from '../middleware/rbac';
import { objectId } from '../middleware/validate';
import { estimateBetween } from '../services/routes';
import { requireActiveProduct } from '../services/inventory';

const nullableQty = z.union([z.coerce.number().min(0, 'must be 0 or more'), z.null(), z.literal('')]).transform((v) => (v === '' ? null : v));

export const listPoliciesQuery = z.object({ product: objectId.optional(), warehouse: objectId.optional() });
export const putPolicySchema = z
  .object({ product: objectId, warehouse: objectId, minStock: nullableQty.default(null), maxStock: nullableQty.default(null) })
  .refine((v) => v.minStock === null || v.maxStock === null || v.maxStock >= v.minStock, {
    message: 'maxStock must be at least minStock',
    path: ['maxStock'],
  });

export async function listPolicies(req: Request, res: Response) {
  const q = req.query as z.infer<typeof listPoliciesQuery>;
  const filter: Record<string, unknown> = {};
  if (q.product) filter.product = q.product;
  if (q.warehouse) filter.warehouse = q.warehouse;
  const items = await StockPolicy.find(filter).populate('product', 'sku name').populate('warehouse', 'code name').lean();
  res.json({ items, total: items.length, page: 1, limit: items.length });
}

export async function putPolicy(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof putPolicySchema>;
  assertWarehouseScope(user, b.warehouse);
  await requireActiveProduct(b.product);
  if (!(await Warehouse.exists({ _id: b.warehouse }))) throw ApiError.notFound('Warehouse not found');
  const before = await StockPolicy.findOne({ product: b.product, warehouse: b.warehouse }).lean();
  const p = await StockPolicy.findOneAndUpdate(
    { product: b.product, warehouse: b.warehouse },
    { minStock: b.minStock, maxStock: b.maxStock },
    { upsert: true, new: true, runValidators: true },
  );
  await recordAudit({ action: 'stock_policy.put', entityType: 'StockPolicy', entityId: p!._id, actor: user, warehouse: b.warehouse, before, after: p });
  res.json(await StockPolicy.findById(p!._id).populate('product', 'sku name').populate('warehouse', 'code name').lean());
}

export const putRouteSchema = z
  .object({
    fromWarehouse: objectId,
    toWarehouse: objectId,
    leadTimeDays: z.coerce.number().min(0, 'must be 0 or more'),
    costPerUnit: z.coerce.number().min(0, 'must be 0 or more'),
    distanceKm: z.union([z.coerce.number().min(0), z.null()]).optional(),
  })
  .refine((v) => v.fromWarehouse !== v.toWarehouse, { message: 'must differ from fromWarehouse', path: ['toWarehouse'] });

export const estimateRouteSchema = z
  .object({ fromWarehouse: objectId, toWarehouse: objectId, save: z.boolean().default(true) })
  .refine((v) => v.fromWarehouse !== v.toWarehouse, { message: 'must differ from fromWarehouse', path: ['toWarehouse'] });

export async function listRoutes(_req: Request, res: Response) {
  const items = await TransferRoute.find().populate('fromWarehouse', 'code name').populate('toWarehouse', 'code name').lean();
  res.json({ items, total: items.length, page: 1, limit: items.length });
}

function routeScope(user: ReturnType<typeof currentUser>, from: string, to: string) {
  if (user.role === 'warehouse_manager' && user.warehouse !== from && user.warehouse !== to) {
    throw ApiError.forbidden('Managers can only edit routes that start or end at their own warehouse');
  }
}

export async function putRoute(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof putRouteSchema>;
  routeScope(user, b.fromWarehouse, b.toWarehouse);
  const n = await Warehouse.countDocuments({ _id: { $in: [b.fromWarehouse, b.toWarehouse] } });
  if (n !== 2) throw ApiError.notFound('Warehouse not found');
  const before = await TransferRoute.findOne({ fromWarehouse: b.fromWarehouse, toWarehouse: b.toWarehouse }).lean();
  const r = await TransferRoute.findOneAndUpdate(
    { fromWarehouse: b.fromWarehouse, toWarehouse: b.toWarehouse },
    { leadTimeDays: b.leadTimeDays, costPerUnit: b.costPerUnit, distanceKm: b.distanceKm ?? before?.distanceKm ?? null, estimated: false },
    { upsert: true, new: true, runValidators: true },
  );
  await recordAudit({ action: 'transfer_route.put', entityType: 'TransferRoute', entityId: r!._id, actor: user, before, after: r });
  res.json(await TransferRoute.findById(r!._id).populate('fromWarehouse', 'code name').populate('toWarehouse', 'code name').lean());
}

/** Estimates lead time (distance / 400 km per day) and cost from the Maps adapter; saves it as an estimated route. */
export async function estimateRoute(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof estimateRouteSchema>;
  routeScope(user, b.fromWarehouse, b.toWarehouse);
  const e = await estimateBetween(b.fromWarehouse, b.toWarehouse);
  if (!b.save) return res.json({ ...e, saved: false });
  const before = await TransferRoute.findOne({ fromWarehouse: b.fromWarehouse, toWarehouse: b.toWarehouse });
  if (before && !before.estimated) {
    before.distanceKm = e.distanceKm;
    await before.save();
    return res.json({ ...e, saved: false, note: 'A manually entered route exists; only its distance was updated' });
  }
  const r = await TransferRoute.findOneAndUpdate(
    { fromWarehouse: b.fromWarehouse, toWarehouse: b.toWarehouse },
    { leadTimeDays: e.leadTimeDays, costPerUnit: e.costPerUnit, distanceKm: e.distanceKm, estimated: true },
    { upsert: true, new: true },
  );
  await recordAudit({ action: 'transfer_route.estimate', entityType: 'TransferRoute', entityId: r!._id, actor: user, before: snapshot(before), after: r });
  res.json({ ...e, saved: true, route: r });
}

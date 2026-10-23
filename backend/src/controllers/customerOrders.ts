import { Request, Response } from 'express';
import { z } from 'zod';
import { CustomerOrder, Product, ProductDependency } from '../models';
import { ApiError } from '../utils/apiError';
import { snapshot } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { assertWarehouseScope } from '../middleware/rbac';
import { dateLike, objectId, pageOf, paging, positiveQty, nullableNumber } from '../middleware/validate';
import { requireActiveWarehouse } from '../services/inventory';
import { nextCustomerOrderNo } from '../services/counters';
import { sendPage } from './helpers';

const line = z.object({
  product: objectId,
  quantity: positiveQty,
  quantityFulfilled: z.coerce.number().min(0).optional(),
  unitPrice: nullableNumber(z.coerce.number().min(0)).optional().transform((v) => v ?? null),
});

export const createOrderSchema = z.object({
  orderNo: z.string().trim().max(40).optional().default(''),
  customerName: z.string().trim().min(1, 'is required').max(120),
  warehouse: objectId,
  items: z.array(line).min(1, 'add at least one line'),
  requiredBy: dateLike.refine((d) => d !== null, 'is required'),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
});
export const updateOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(120).optional(),
  items: z.array(line).min(1).optional(),
  requiredBy: dateLike,
  priority: z.enum(['low', 'normal', 'high']).optional(),
  status: z.enum(['open', 'fulfilled', 'late', 'cancelled']).optional(),
});
export const listOrdersQuery = z.object({
  ...paging,
  status: z.enum(['open', 'fulfilled', 'late', 'cancelled']).optional(),
  warehouse: objectId.optional(),
});

const populate = (q: any) => q.populate('warehouse', 'code name').populate('items.product', 'sku name unit unitPrice');

async function checkProducts(items: { product: string }[]) {
  const ids = [...new Set(items.map((i) => i.product))];
  if (ids.length !== items.length) throw ApiError.badRequest('Each product can appear only once per order');
  const n = await Product.countDocuments({ _id: { $in: ids } });
  if (n !== ids.length) throw ApiError.badRequest('One or more products were not found');
}

export async function listOrders(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listOrdersQuery>;
  const { page, limit, skip } = pageOf(q, 50);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.warehouse) filter.warehouse = q.warehouse;
  const [items, total] = await Promise.all([
    populate(CustomerOrder.find(filter).sort({ requiredBy: 1 }).skip(skip).limit(limit)).lean(),
    CustomerOrder.countDocuments(filter),
  ]);
  sendPage(res, items, total, page, limit);
}

export async function createOrder(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof createOrderSchema>;
  assertWarehouseScope(user, b.warehouse);
  await requireActiveWarehouse(b.warehouse);
  await checkProducts(b.items);
  const orderNo = b.orderNo || (await nextCustomerOrderNo());
  if (await CustomerOrder.exists({ orderNo })) throw ApiError.conflict(`Order ${orderNo} already exists`);
  const o = await CustomerOrder.create({ ...b, orderNo, requiredBy: b.requiredBy!, createdBy: user._id });
  await recordAudit({ action: 'customer_order.create', entityType: 'CustomerOrder', entityId: o._id, actor: user, warehouse: o.warehouse, after: o });
  res.status(201).json(await populate(CustomerOrder.findById(o._id)).lean());
}

export async function updateOrder(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof updateOrderSchema>;
  const o = await CustomerOrder.findById(req.params.id);
  if (!o) throw ApiError.notFound('Order not found');
  assertWarehouseScope(user, o.warehouse);
  if (b.items) await checkProducts(b.items);
  const before = snapshot(o);
  if (b.customerName !== undefined) o.customerName = b.customerName;
  if (b.items) o.items = b.items as any;
  if (b.requiredBy) o.requiredBy = b.requiredBy;
  if (b.priority) o.priority = b.priority;
  if (b.status) o.status = b.status;
  await o.save();
  await recordAudit({ action: 'customer_order.update', entityType: 'CustomerOrder', entityId: o._id, actor: user, warehouse: o.warehouse, before, after: o });
  res.json(await populate(CustomerOrder.findById(o._id)).lean());
}

export async function deleteOrder(req: Request, res: Response) {
  const user = currentUser(req);
  const o = await CustomerOrder.findById(req.params.id);
  if (!o) throw ApiError.notFound('Order not found');
  assertWarehouseScope(user, o.warehouse);
  await o.deleteOne();
  await recordAudit({ action: 'customer_order.delete', entityType: 'CustomerOrder', entityId: o._id, actor: user, warehouse: o.warehouse, before: o });
  res.json({ ok: true });
}

export const createDependencySchema = z
  .object({ componentProduct: objectId, finishedProduct: objectId, quantityPer: z.coerce.number().positive('must be greater than 0') })
  .refine((v) => v.componentProduct !== v.finishedProduct, { message: 'a product cannot depend on itself', path: ['finishedProduct'] });

export async function listDependencies(_req: Request, res: Response) {
  const items = await ProductDependency.find().populate('componentProduct', 'sku name').populate('finishedProduct', 'sku name').lean();
  res.json({ items, total: items.length, page: 1, limit: items.length });
}

export async function createDependency(req: Request, res: Response) {
  const b = req.body as z.infer<typeof createDependencySchema>;
  const n = await Product.countDocuments({ _id: { $in: [b.componentProduct, b.finishedProduct] } });
  if (n !== 2) throw ApiError.badRequest('Product not found');
  if (await ProductDependency.exists({ componentProduct: b.finishedProduct, finishedProduct: b.componentProduct })) {
    throw ApiError.badRequest('The reverse link already exists; dependencies cannot be circular');
  }
  const d = await ProductDependency.create(b);
  await recordAudit({ action: 'product_dependency.create', entityType: 'ProductDependency', entityId: d._id, actor: currentUser(req), after: d });
  res.status(201).json(await ProductDependency.findById(d._id).populate('componentProduct', 'sku name').populate('finishedProduct', 'sku name').lean());
}

export async function deleteDependency(req: Request, res: Response) {
  const d = await ProductDependency.findById(req.params.id);
  if (!d) throw ApiError.notFound('Dependency not found');
  await d.deleteOne();
  await recordAudit({ action: 'product_dependency.delete', entityType: 'ProductDependency', entityId: d._id, actor: currentUser(req), before: d });
  res.json({ ok: true });
}

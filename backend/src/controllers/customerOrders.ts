import { Request, Response } from 'express';
import { z } from 'zod';
import { CustomerOrder, Product, ProductDependency } from '../models';
import { ApiError } from '../utils/apiError';
import { snapshot } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { assertWarehouseScope } from '../middleware/rbac';
import { dateLike, objectId, pageOf, paging, positiveQty, nullableNumber } from '../middleware/validate';
import { afterStockChange, recordDemand, requireActiveWarehouse } from '../services/inventory';
import { dispatchFefo, releaseReserve, reserve, runStock } from '../services/stockService';
import { emitAll } from '../sockets';
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

export const shipSchema = z.object({
  lines: z.array(z.object({ product: objectId, quantity: positiveQty })).optional(),
});

async function openOrder(id: string) {
  const o = await CustomerOrder.findById(id);
  if (!o) throw ApiError.notFound('Order not found');
  if (o.status === 'cancelled' || o.status === 'fulfilled') throw ApiError.conflict(`Order ${o.orderNo} is ${o.status}`);
  return o;
}

/** Reserves the outstanding quantity of every line by FEFO (reserve genes on the lots). */
export async function reserveOrder(req: Request, res: Response) {
  const user = currentUser(req);
  const pre = await openOrder(req.params.id);
  assertWarehouseScope(user, pre.warehouse);
  const { result, genes } = await runStock(user, async (ctx) => {
    await releaseReserve(ctx, { refType: 'customer_order', refId: pre._id, explanation: `Re-reserving ${pre.orderNo}` });
    const out = [];
    for (const l of pre.items) {
      const q = l.quantity - (l.quantityFulfilled ?? 0);
      if (q <= 0) continue;
      out.push({ product: l.product, lots: await reserve(ctx, { product: l.product, warehouse: pre.warehouse, quantity: q, refType: 'customer_order', refId: pre._id }) });
    }
    await recordAudit({ action: 'customer_order.reserve', entityType: 'CustomerOrder', entityId: pre._id, actor: user, warehouse: pre.warehouse, after: { reservations: out } }, ctx.session);
    return out;
  });
  res.json({ order: await populate(CustomerOrder.findById(pre._id)).lean(), reservations: result, genes: genes.length });
}

/**
 * Ships an order by FEFO from its warehouse (all outstanding quantities, or the given lines): releases its
 * reservations, writes pick_fefo and dispatch_sale genes against the order, and marks it fulfilled when done.
 */
export async function shipOrder(req: Request, res: Response) {
  const user = currentUser(req);
  const pre = await openOrder(req.params.id);
  assertWarehouseScope(user, pre.warehouse);
  const b = req.body as z.infer<typeof shipSchema>;
  const { result } = await runStock(user, async (ctx) => {
    const o = await CustomerOrder.findById(pre._id).session(ctx.session);
    if (!o) throw ApiError.notFound('Order not found');
    await releaseReserve(ctx, { refType: 'customer_order', refId: o._id, explanation: `Released for shipping ${o.orderNo}` });
    const shipped = [];
    for (const l of o.items) {
      const outstanding = l.quantity - (l.quantityFulfilled ?? 0);
      const asked = b.lines ? b.lines.find((x) => x.product === String(l.product))?.quantity ?? 0 : outstanding;
      if (asked > outstanding) throw ApiError.badRequest(`Only ${outstanding} outstanding for a line of ${o.orderNo}`);
      if (asked <= 0) continue;
      const allocations = await dispatchFefo(ctx, {
        product: l.product,
        warehouse: o.warehouse,
        quantity: asked,
        refType: 'customer_order',
        refId: o._id,
        explanation: `Shipped ${asked} on customer order ${o.orderNo}`,
      });
      await recordDemand(l.product, o.warehouse, asked, ctx.session);
      l.quantityFulfilled = (l.quantityFulfilled ?? 0) + asked;
      shipped.push({ product: l.product, quantity: asked, allocations });
    }
    if (!shipped.length) throw ApiError.badRequest('Nothing to ship');
    if (o.items.every((l) => (l.quantityFulfilled ?? 0) >= l.quantity)) o.status = 'fulfilled';
    await o.save({ session: ctx.session });
    await recordAudit({ action: 'customer_order.ship', entityType: 'CustomerOrder', entityId: o._id, actor: user, warehouse: o.warehouse, after: { shipped } }, ctx.session);
    return shipped;
  });
  for (const s of result) await afterStockChange(s.product, [pre.warehouse], { action: 'dispatch', quantity: s.quantity });
  emitAll('order:update', { _id: pre._id });
  res.json({ order: await populate(CustomerOrder.findById(pre._id)).lean(), shipped: result });
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

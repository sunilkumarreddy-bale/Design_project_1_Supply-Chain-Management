import { Types } from 'mongoose';
import { Alert, AlertType, Product, PurchaseOrder, Severity, StockLevel, Warehouse } from '../models';
import { emitAll } from '../sockets';
import { idStr } from '../utils/ids';
import { DAY_MS } from '../utils/dates';
import { fmt } from '../utils/format';
import { explainProductAt } from './planning';
import { notifySafe } from './notifications';

export interface RaiseAlertInput {
  type: AlertType;
  severity: Severity;
  message: string;
  product?: unknown;
  warehouse?: unknown;
  supplier?: unknown;
  purchaseOrder?: unknown;
  plan?: unknown;
  key?: string;
}

const LINKS: Partial<Record<AlertType, (a: RaiseAlertInput) => string>> = {
  po_pending_approval: (a) => `/purchase-orders?focus=${idStr(a.purchaseOrder)}`,
  po_overdue: (a) => `/purchase-orders?focus=${idStr(a.purchaseOrder)}`,
  recovery_proposed: (a) => `/recovery/${idStr(a.plan)}`,
  redistribution_proposed: (a) => `/redistribution?plan=${idStr(a.plan)}`,
  supplier_disruption: () => '/suppliers',
  count_variance: () => '/counts',
  discrepancy: () => '/alerts',
};

export function alertLink(a: RaiseAlertInput): string {
  const f = LINKS[a.type];
  if (f) return f(a);
  return a.product ? `/stock?product=${idStr(a.product)}` : '/alerts';
}

/**
 * Raises an alert, de-duplicated by {type, product, warehouse, key} among open alerts: an existing open alert
 * gets its message and severity updated instead of a new one being created. New alerts are pushed over
 * Socket.io; critical ones are also sent by email/SMS to admins and the warehouse's managers.
 */
export async function raiseAlert(input: RaiseAlertInput) {
  const filter = {
    type: input.type,
    product: input.product ? idStr(input.product) : null,
    warehouse: input.warehouse ? idStr(input.warehouse) : null,
    key: input.key ?? '',
    isResolved: false,
  };
  const existing = await Alert.findOne(filter);
  if (existing) {
    const escalated = existing.severity !== 'critical' && input.severity === 'critical';
    existing.message = input.message;
    existing.severity = input.severity;
    if (input.purchaseOrder) existing.purchaseOrder = new Types.ObjectId(idStr(input.purchaseOrder)!);
    if (input.plan) existing.plan = new Types.ObjectId(idStr(input.plan)!);
    await existing.save();
    emitAll('alert:update', existing.toJSON());
    if (escalated) await notifyCritical(existing.toJSON(), input);
    return { alert: existing, created: false };
  }
  const alert = await Alert.create({
    ...filter,
    severity: input.severity,
    message: input.message,
    supplier: input.supplier ? idStr(input.supplier) : null,
    purchaseOrder: input.purchaseOrder ? idStr(input.purchaseOrder) : null,
    plan: input.plan ? idStr(input.plan) : null,
  });
  emitAll('alert:new', alert.toJSON());
  if (alert.severity === 'critical') await notifyCritical(alert.toJSON(), input);
  return { alert, created: true };
}

async function notifyCritical(alert: { type: string; message: string }, input: RaiseAlertInput) {
  await notifySafe(
    { roles: ['admin', 'warehouse_manager'], warehouse: input.warehouse ?? undefined },
    {
      type: `alert.${alert.type}`,
      subject: `Critical alert: ${alert.type.replace(/_/g, ' ')}`,
      body: alert.message,
      link: alertLink(input),
    },
  );
}

export async function resolveAlerts(filter: Record<string, unknown>, by?: unknown) {
  const open = await Alert.find({ ...filter, isResolved: false });
  for (const a of open) {
    a.isResolved = true;
    a.resolvedAt = new Date();
    a.resolvedBy = by ? new Types.ObjectId(idStr(by)!) : null;
    await a.save();
    emitAll('alert:resolved', a.toJSON());
  }
  return open.length;
}

/**
 * low_stock: inventory position <= reorder point (critical when on-hand is 0);
 * overstock: on-hand > 5 x reorder point. Both auto-resolve when the condition clears.
 * Also refreshes the reorder-point snapshot on the product's stock lines at this warehouse.
 */
export async function evaluateStockAlerts(productId: unknown, warehouseId: unknown) {
  const pid = idStr(productId)!;
  const wid = idStr(warehouseId)!;
  const product = await Product.findById(pid).select('isActive').lean();
  if (!product) return;
  const { product: p, onHand, explanation: e } = await explainProductAt(pid, wid);
  const rop = e.policy.reorderPoint;
  await StockLevel.updateMany({ product: pid, warehouse: wid }, { reorderPoint: rop });
  const wh = await Warehouse.findById(wid).select('name').lean();
  const where = wh?.name ?? 'warehouse';
  const scope = { product: pid, warehouse: wid };
  if (product.isActive && e.inputs.avgDailyDemand > 0 && e.position <= rop) {
    await raiseAlert({
      type: 'low_stock',
      severity: onHand <= 0 ? 'critical' : 'warning',
      ...scope,
      message: `${p.sku} ${p.name} at ${where}: position ${fmt(e.position)} (on-hand ${fmt(onHand)} + on-order ${fmt(
        e.inputs.onOrder,
      )}) is at or below the reorder point ${rop}`,
    });
  } else {
    await resolveAlerts({ type: 'low_stock', ...scope });
  }
  if (product.isActive && rop > 0 && onHand > 5 * rop) {
    await raiseAlert({
      type: 'overstock',
      severity: 'info',
      ...scope,
      message: `${p.sku} ${p.name} at ${where}: on-hand ${fmt(onHand)} is above 5 x reorder point (${5 * rop})`,
    });
  } else {
    await resolveAlerts({ type: 'overstock', ...scope });
  }
}

export const EXPIRY_WINDOW_DAYS = 14;
export const EXPIRY_CRITICAL_DAYS = 3;

/** Creates expiry alerts for batches expiring within 14 days (critical at 3 days or fewer). */
export async function sweepExpiry(now = new Date(), warehouseId?: unknown) {
  const limit = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * DAY_MS);
  const match: Record<string, unknown> = { expiryDate: { $ne: null, $lte: limit }, quantity: { $gt: 0 } };
  if (warehouseId) match.warehouse = idStr(warehouseId);
  const lines = await StockLevel.find(match).populate('product', 'sku name').populate('warehouse', 'name').lean();
  let created = 0;
  let updated = 0;
  const activeKeys = new Set<string>();
  for (const l of lines) {
    const p = l.product as unknown as { _id: Types.ObjectId; sku: string; name: string };
    const w = l.warehouse as unknown as { _id: Types.ObjectId; name: string };
    if (!p || !w) continue;
    const daysLeft = Math.floor((new Date(l.expiryDate!).getTime() - now.getTime()) / DAY_MS);
    const key = l._id.toHexString();
    activeKeys.add(key);
    const r = await raiseAlert({
      type: 'expiry',
      severity: daysLeft <= EXPIRY_CRITICAL_DAYS ? 'critical' : 'warning',
      product: p._id,
      warehouse: w._id,
      key,
      message:
        daysLeft < 0
          ? `${p.sku} batch ${l.batchNo || '(none)'} at ${w.name}: ${l.quantity} units expired ${-daysLeft} day(s) ago`
          : `${p.sku} batch ${l.batchNo || '(none)'} at ${w.name}: ${l.quantity} units expire in ${daysLeft} day(s)`,
    });
    if (r.created) created++;
    else updated++;
  }
  // batches that were sold, moved or written off no longer need their expiry alert
  const openExpiry = await Alert.find({ type: 'expiry', isResolved: false, ...(warehouseId ? { warehouse: idStr(warehouseId) } : {}) })
    .select('key')
    .lean();
  const stale = openExpiry.filter((a) => !activeKeys.has(a.key)).map((a) => a._id);
  const resolved = stale.length ? await resolveAlerts({ _id: { $in: stale } }) : 0;
  return { checked: lines.length, created, updated, resolved };
}

/** po_overdue for open POs whose expected delivery date has passed. */
export async function checkOverduePOs(now = new Date()) {
  const overdue = await PurchaseOrder.find({
    status: { $in: ['approved', 'confirmed', 'dispatched', 'partially_received'] },
    expectedDeliveryDate: { $ne: null, $lt: now },
  })
    .populate('supplier', 'name')
    .lean();
  let raised = 0;
  for (const po of overdue) {
    const days = Math.floor((now.getTime() - new Date(po.expectedDeliveryDate!).getTime()) / DAY_MS);
    const r = await raiseAlert({
      type: 'po_overdue',
      severity: days >= 7 ? 'critical' : 'warning',
      warehouse: po.warehouse,
      purchaseOrder: po._id,
      supplier: (po.supplier as unknown as { _id: Types.ObjectId })?._id,
      key: po._id.toHexString(),
      message: `${po.poNumber} from ${(po.supplier as unknown as { name: string })?.name ?? 'supplier'} is ${Math.max(
        0,
        days,
      )} day(s) overdue (expected ${new Date(po.expectedDeliveryDate!).toISOString().slice(0, 10)})`,
    });
    if (r.created) raised++;
  }
  return { overdue: overdue.length, raised };
}

import { Request, Response } from 'express';
import { z } from 'zod';
import { Alert, ALERT_TYPES } from '../models';
import { ApiError } from '../utils/apiError';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { objectId, pageOf, paging } from '../middleware/validate';
import { checkOverduePOs, resolveAlerts, sweepExpiry } from '../services/alerts';
import { sendPage } from './helpers';

export const listAlertsQuery = z.object({
  ...paging,
  resolved: z.enum(['true', 'false']).optional(),
  warehouse: objectId.optional(),
  type: z.enum(ALERT_TYPES).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
});
export const sweepSchema = z.object({ warehouse: objectId.optional() });

export async function listAlerts(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listAlertsQuery>;
  const { page, limit, skip } = pageOf(q, 50);
  const filter: Record<string, unknown> = {};
  if (q.resolved) filter.isResolved = q.resolved === 'true';
  if (q.warehouse) filter.$or = [{ warehouse: q.warehouse }, { warehouse: null }];
  if (q.type) filter.type = q.type;
  if (q.severity) filter.severity = q.severity;
  const [items, total] = await Promise.all([
    Alert.find(filter)
      .populate('product', 'sku name')
      .populate('warehouse', 'code name')
      .populate('supplier', 'name')
      .populate('purchaseOrder', 'poNumber status')
      .populate('resolvedBy', 'name')
      .sort({ isResolved: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Alert.countDocuments(filter),
  ]);
  sendPage(res, items, total, page, limit);
}

export async function resolveAlert(req: Request, res: Response) {
  const user = currentUser(req);
  const a = await Alert.findById(req.params.id);
  if (!a) throw ApiError.notFound('Alert not found');
  if (a.isResolved) throw ApiError.conflict('Alert is already resolved');
  if (user.role === 'warehouse_manager' && a.warehouse && a.warehouse.toHexString() !== user.warehouse) {
    throw ApiError.forbidden('Managers can only resolve alerts of their own warehouse');
  }
  await resolveAlerts({ _id: a._id }, user._id);
  await recordAudit({ action: 'alert.resolve', entityType: 'Alert', entityId: a._id, actor: user, warehouse: a.warehouse, before: a, after: { isResolved: true } });
  res.json(await Alert.findById(a._id).lean());
}

export async function runExpirySweep(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof sweepSchema>;
  const warehouse = user.role === 'warehouse_manager' ? user.warehouse : (b.warehouse ?? null);
  const expiry = await sweepExpiry(new Date(), warehouse);
  const overdue = await checkOverduePOs();
  await recordAudit({ action: 'alert.sweep_expiry', entityType: 'Alert', actor: user, warehouse, after: { expiry, overdue } });
  res.json({ expiry, overdue });
}

/** Supplier disruption (declared by a person, used by the recovery engine and the simulator). */
import { Supplier } from '../models';
import { supplierLeadTimeStats } from '../engines/reorder';
import { ApiError } from '../utils/apiError';
import { snapshot } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import type { AuthUser } from '../middleware/auth';
import { emitAll } from '../sockets';
import { raiseAlert, resolveAlerts } from './alerts';
import { notifySafe } from './notifications';

export function withStats(s: any) {
  const json = typeof s.toJSON === 'function' ? s.toJSON() : s;
  return { ...json, leadTime: supplierLeadTimeStats(json.leadTimeDays, json) };
}

export async function declareDisruption(id: string, input: { expectedDays: number; reason: string }, user: AuthUser) {
  const s = await Supplier.findById(id);
  if (!s) throw ApiError.notFound('Supplier not found');
  const before = snapshot(s);
  s.status = 'disrupted';
  s.disruption = { from: new Date(), expectedDays: input.expectedDays, reason: input.reason } as any;
  await s.save();
  await recordAudit({ action: 'supplier.disruption_declare', entityType: 'Supplier', entityId: s._id, actor: user, before, after: s });
  const message = `${s.name} is disrupted for about ${input.expectedDays} day(s)${input.reason ? `: ${input.reason}` : ''}. Run the recovery engine for affected products.`;
  await raiseAlert({ type: 'supplier_disruption', severity: 'critical', supplier: s._id, key: s._id.toHexString(), message });
  await notifySafe(
    { roles: ['admin', 'warehouse_manager'] },
    { type: 'supplier.disruption', subject: `Supplier disruption: ${s.name}`, body: message, link: `/recovery?supplier=${s._id}` },
  );
  emitAll('supplier:update', withStats(s));
  return s;
}

export async function clearDisruption(id: string, user: AuthUser) {
  const s = await Supplier.findById(id);
  if (!s) throw ApiError.notFound('Supplier not found');
  if (s.status !== 'disrupted') throw ApiError.conflict(`${s.name} is not disrupted`);
  const before = snapshot(s);
  s.status = 'active';
  s.disruption = null;
  await s.save();
  await recordAudit({ action: 'supplier.disruption_clear', entityType: 'Supplier', entityId: s._id, actor: user, before, after: s });
  await resolveAlerts({ type: 'supplier_disruption', key: s._id.toHexString() }, user._id);
  emitAll('supplier:update', withStats(s));
  return s;
}

/**
 * Tracks execution of approved recovery (M5) and redistribution (M7) plans: every linked transfer or PO
 * event is appended to the plan timeline, and the plan completes or fails when its steps do.
 */
import { Types } from 'mongoose';
import { PurchaseOrder, RecoveryPlan, RedistributionPlan, Transfer } from '../models';
import { recordAudit } from '../middleware/audit';
import { emitAll } from '../sockets';
import { idStr, snapshot } from '../utils/ids';
import { notifySafe } from './notifications';

export interface StepEvent {
  event: string;
  detail: string;
  by?: unknown;
}

const FAILED = ['cancelled', 'rejected'];

function timelineEntry(e: StepEvent) {
  return { at: new Date(), by: e.by ? new Types.ObjectId(idStr(e.by)!) : null, event: e.event, detail: e.detail };
}

export async function updateRecoveryProgress(planId: unknown, e?: StepEvent) {
  const plan = await RecoveryPlan.findById(idStr(planId));
  if (!plan) return null;
  if (e) plan.timeline.push(timelineEntry(e));
  if (!['approved', 'in_progress'].includes(plan.status)) {
    if (e) await plan.save();
    return plan;
  }
  const poIds = plan.execution?.purchaseOrders?.length
    ? plan.execution.purchaseOrders
    : plan.execution?.purchaseOrder
      ? [plan.execution.purchaseOrder]
      : [];
  const [transfers, pos] = await Promise.all([
    Transfer.find({ _id: { $in: plan.execution?.transfers ?? [] } }).lean(),
    PurchaseOrder.find({ _id: { $in: poIds } }).lean(),
  ]);
  const before = snapshot(plan);
  const failedT = transfers.find((t) => FAILED.includes(t.status));
  const failedP = pos.find((p) => FAILED.includes(p.status));
  let changed: 'failed' | 'completed' | null = null;
  if (failedT || failedP) {
    plan.status = 'failed';
    plan.timeline.push(
      timelineEntry({
        event: 'failed',
        detail: failedT ? `Transfer ${failedT._id} was ${failedT.status}` : `${failedP!.poNumber} was ${failedP!.status}`,
      }),
    );
    changed = 'failed';
  } else if (transfers.every((t) => t.status === 'completed') && pos.every((p) => p.status === 'received')) {
    plan.status = 'completed';
    plan.execution!.completedAt = new Date();
    plan.timeline.push(timelineEntry({ event: 'completed', detail: 'All transfers received and purchase orders delivered' }));
    changed = 'completed';
  } else if (plan.status === 'approved') {
    plan.status = 'in_progress';
  }
  await plan.save();
  emitAll('recovery:update', { _id: plan._id, status: plan.status, planNo: plan.planNo });
  if (changed) {
    await recordAudit({
      action: `recovery.${changed === 'failed' ? 'fail' : 'complete'}`,
      entityType: 'RecoveryPlan',
      entityId: plan._id,
      actor: e?.by ? idStr(e.by) : null,
      warehouse: plan.targetWarehouse,
      before,
      after: plan,
    });
    await notifySafe(
      { userIds: [plan.createdBy, plan.approvedBy].filter(Boolean) },
      {
        type: `recovery.${changed}`,
        subject: `Recovery plan ${plan.planNo} ${changed}`,
        body: plan.timeline[plan.timeline.length - 1].detail ?? '',
        link: `/recovery/${plan._id}`,
      },
    );
  }
  return plan;
}

export async function updateRedistributionProgress(planId: unknown, e?: StepEvent) {
  const plan = await RedistributionPlan.findById(idStr(planId));
  if (!plan) return null;
  if (e) plan.timeline.push(timelineEntry(e));
  if (!['approved', 'in_progress'].includes(plan.status)) {
    if (e) await plan.save();
    return plan;
  }
  const ids = plan.lines.map((l) => l.transfer).filter(Boolean);
  const transfers = await Transfer.find({ _id: { $in: ids } }).lean();
  const before = snapshot(plan);
  const live = transfers.filter((t) => !FAILED.includes(t.status));
  let changed: string | null = null;
  if (transfers.length && live.length === 0) {
    plan.status = 'cancelled';
    plan.timeline.push(timelineEntry({ event: 'cancelled', detail: 'Every transfer of the plan was cancelled or rejected' }));
    changed = 'cancel';
  } else if (transfers.length && live.every((t) => t.status === 'completed')) {
    plan.status = 'completed';
    const skipped = transfers.length - live.length;
    plan.timeline.push(
      timelineEntry({
        event: 'completed',
        detail: `All ${live.length} transfer(s) received with batch ${plan.batchNo} and its expiry date${
          skipped ? `; ${skipped} transfer(s) were cancelled` : ''
        }`,
      }),
    );
    changed = 'complete';
  } else if (plan.status === 'approved') {
    plan.status = 'in_progress';
  }
  await plan.save();
  emitAll('redistribution:update', { _id: plan._id, status: plan.status, planNo: plan.planNo });
  if (changed) {
    await recordAudit({
      action: `redistribution.${changed}`,
      entityType: 'RedistributionPlan',
      entityId: plan._id,
      actor: e?.by ? idStr(e.by) : null,
      warehouse: plan.sourceWarehouse,
      before,
      after: plan,
    });
  }
  return plan;
}

/** Called after any transfer status change. */
export async function onTransferChanged(transfer: { _id: unknown; plan?: unknown; planModel?: string | null; status: string }, e: StepEvent) {
  if (!transfer.plan) return;
  if (transfer.planModel === 'RecoveryPlan') await updateRecoveryProgress(transfer.plan, e);
  else if (transfer.planModel === 'RedistributionPlan') await updateRedistributionProgress(transfer.plan, e);
}

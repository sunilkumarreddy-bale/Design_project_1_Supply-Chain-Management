/** Tracked transfers: pending_approval -> approved -> in_transit -> completed (or rejected / cancelled). */
import { ClientSession } from 'mongoose';
import { Transfer } from '../models';
import { withTransaction } from '../config/db';
import { ApiError } from '../utils/apiError';
import { idStr, snapshot } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import type { AuthUser } from '../middleware/auth';
import { assertWarehouseScope } from '../middleware/rbac';
import { emitAll } from '../sockets';
import { afterStockChange, putAllocations, requireActiveProduct, requireActiveWarehouse, takeFromStock } from './inventory';
import { onTransferChanged } from './planProgress';
import { notifySafe } from './notifications';

export interface TrackedTransferInput {
  product: string;
  fromWarehouse: string;
  toWarehouse: string;
  quantity: number;
  batchNo?: string | null;
  notes?: string;
  source?: 'manual' | 'rebalance' | 'recovery_plan' | 'redistribution_plan';
  plan?: unknown;
  planModel?: 'RecoveryPlan' | 'RedistributionPlan' | null;
  /** Plans create transfers already approved (the plan approval is the approval). */
  preApproved?: boolean;
}

export async function createTrackedTransfer(input: TrackedTransferInput, user: AuthUser, session?: ClientSession) {
  if (input.fromWarehouse === input.toWarehouse) throw ApiError.badRequest('Source and destination must differ');
  await requireActiveProduct(input.product, session);
  await requireActiveWarehouse(input.fromWarehouse, session);
  await requireActiveWarehouse(input.toWarehouse, session);
  const now = new Date();
  const [t] = await Transfer.create(
    [
      {
        product: input.product,
        fromWarehouse: input.fromWarehouse,
        toWarehouse: input.toWarehouse,
        quantity: input.quantity,
        batchNo: input.batchNo ?? '',
        mode: 'tracked',
        status: input.preApproved ? 'approved' : 'pending_approval',
        source: input.source ?? 'manual',
        plan: input.plan ? idStr(input.plan) : null,
        planModel: input.planModel ?? null,
        initiatedBy: user._id,
        approvedBy: input.preApproved ? user._id : null,
        approvedAt: input.preApproved ? now : null,
        notes: input.notes ?? '',
      },
    ],
    { session },
  );
  return t;
}

export async function requestTrackedTransfer(input: TrackedTransferInput, user: AuthUser) {
  const t = await createTrackedTransfer({ ...input, preApproved: false }, user);
  await recordAudit({ action: 'transfer.request', entityType: 'Transfer', entityId: t._id, actor: user, warehouse: t.fromWarehouse, after: t });
  emitAll('transfer:update', t.toJSON());
  await notifySafe(
    { roles: ['admin'] },
    {
      type: 'transfer.pending_approval',
      subject: 'Transfer awaiting approval',
      body: `${user.name} requested a tracked transfer of ${t.quantity} units`,
      link: '/transfers',
    },
  );
  return t;
}

async function load(id: string) {
  const t = await Transfer.findById(id);
  if (!t) throw ApiError.notFound('Transfer not found');
  return t;
}

function expect(t: { status: string }, allowed: string[], action: string) {
  if (!allowed.includes(t.status)) throw ApiError.conflict(`Cannot ${action} a transfer that is ${t.status.replace(/_/g, ' ')}`);
}

async function finish(
  t: InstanceType<typeof Transfer>,
  before: unknown,
  action: string,
  user: AuthUser,
  event: string,
  detail: string,
) {
  await recordAudit({ action: `transfer.${action}`, entityType: 'Transfer', entityId: t._id, actor: user, warehouse: t.fromWarehouse, before, after: t });
  emitAll('transfer:update', t.toJSON());
  await onTransferChanged(t, { event, detail, by: user._id });
}

export async function approveTransfer(id: string, user: AuthUser) {
  const t = await load(id);
  expect(t, ['pending_approval'], 'approve');
  const before = snapshot(t);
  t.status = 'approved';
  t.approvedBy = user._id;
  t.approvedAt = new Date();
  await t.save();
  await finish(t, before, 'approve', user, 'transfer_approved', `Transfer of ${t.quantity} units approved`);
  return t;
}

export async function rejectTransfer(id: string, reason: string, user: AuthUser) {
  const t = await load(id);
  expect(t, ['pending_approval'], 'reject');
  const before = snapshot(t);
  t.status = 'rejected';
  t.rejectedReason = reason;
  await t.save();
  await finish(t, before, 'reject', user, 'transfer_rejected', `Transfer of ${t.quantity} units rejected: ${reason}`);
  return t;
}

export async function cancelTransfer(id: string, user: AuthUser) {
  const t = await load(id);
  expect(t, ['pending_approval', 'approved'], 'cancel');
  if (user.role === 'warehouse_manager') {
    const own = idStr(t.fromWarehouse) === user.warehouse || idStr(t.toWarehouse) === user.warehouse;
    if (!own) throw ApiError.forbidden('You can only cancel transfers of your own warehouse');
  }
  const before = snapshot(t);
  t.status = 'cancelled';
  await t.save();
  await finish(t, before, 'cancel', user, 'transfer_cancelled', `Transfer of ${t.quantity} units cancelled before dispatch`);
  return t;
}

/** Removes the stock at the source (FEFO, or the transfer's batch) and puts the transfer in transit. */
export async function dispatchTransfer(id: string, user: AuthUser) {
  const pre = await load(id);
  expect(pre, ['approved'], 'dispatch');
  assertWarehouseScope(user, pre.fromWarehouse, 'the source warehouse');
  const before = snapshot(pre);
  const t = await withTransaction(async (session) => {
    const doc = await Transfer.findById(id).session(session);
    if (!doc || doc.status !== 'approved') throw ApiError.conflict('Transfer is no longer approved');
    const allocations = await takeFromStock(
      { product: idStr(doc.product)!, warehouse: idStr(doc.fromWarehouse)!, quantity: doc.quantity, batchNo: doc.batchNo || null },
      session,
    );
    doc.allocations = allocations.map((a) => ({ batchNo: a.batchNo, bin: a.bin, expiryDate: a.expiryDate, quantity: a.quantity })) as any;
    doc.status = 'in_transit';
    doc.dispatchedAt = new Date();
    await doc.save({ session });
    return doc;
  });
  await finish(t, before, 'dispatch', user, 'transfer_dispatched', `Transfer of ${t.quantity} units dispatched`);
  await afterStockChange(t.product, [t.fromWarehouse], { action: 'transfer_dispatch', quantity: t.quantity });
  return t;
}

/** Adds the in-transit allocations at the destination with their batch numbers and expiry dates. */
export async function receiveTransfer(id: string, user: AuthUser, bin?: string | null) {
  const pre = await load(id);
  expect(pre, ['in_transit'], 'receive');
  assertWarehouseScope(user, pre.toWarehouse, 'the destination warehouse');
  const before = snapshot(pre);
  const t = await withTransaction(async (session) => {
    const doc = await Transfer.findById(id).session(session);
    if (!doc || doc.status !== 'in_transit') throw ApiError.conflict('Transfer is no longer in transit');
    const to = await requireActiveWarehouse(doc.toWarehouse, session);
    await putAllocations(
      doc.product,
      to,
      doc.allocations.map((a) => ({ batchNo: a.batchNo ?? '', expiryDate: a.expiryDate ?? null, quantity: a.quantity })),
      session,
      bin,
    );
    doc.status = 'completed';
    doc.receivedAt = new Date();
    doc.receivedBy = user._id;
    await doc.save({ session });
    return doc;
  });
  await finish(t, before, 'receive', user, 'transfer_received', `Transfer of ${t.quantity} units received`);
  await afterStockChange(t.product, [t.toWarehouse], { action: 'transfer_receive', quantity: t.quantity });
  return t;
}

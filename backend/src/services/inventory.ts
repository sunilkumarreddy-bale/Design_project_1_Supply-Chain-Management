/**
 * Stock movements used by the Stock page, Scan and the analytics shortcuts. Quantities only change through
 * services/stockService (the Stock DNA choke point); this module wraps those calls in one transaction each,
 * records the demand history and the action-level audit entry, and refreshes alerts after commit.
 */
import { ClientSession } from 'mongoose';
import { DemandHistory, Transfer } from '../models';
import { ApiError } from '../utils/apiError';
import { idStr } from '../utils/ids';
import { startOfUtcDay } from '../utils/dates';
import { recordAudit } from '../middleware/audit';
import type { AuthUser } from '../middleware/auth';
import { emitWarehouse, emitAll } from '../sockets';
import { evaluateStockAlerts } from './alerts';
import {
  dispatchFefo,
  receiveLot,
  receiveTransfer as receiveTransferLots,
  requireActiveProduct,
  requireActiveWarehouse,
  runStock,
  shipTransfer,
} from './stockService';

export { requireActiveProduct, requireActiveWarehouse, resolveBin, warehouseBins } from './stockService';

export interface ReceiveInput {
  product: string;
  warehouse: string;
  quantity: number;
  bin?: string | null;
  batchNo?: string | null;
  expiryDate?: Date | null;
}

export interface TakeInput {
  product: string;
  warehouse: string;
  quantity: number;
  bin?: string | null;
  batchNo?: string | null;
}

export async function recordDemand(product: unknown, warehouse: unknown, quantity: number, session: ClientSession, at = new Date()) {
  await DemandHistory.updateOne(
    { product: idStr(product), warehouse: idStr(warehouse), date: startOfUtcDay(at) },
    { $inc: { quantity }, $setOnInsert: { source: 'dispatch' } },
    { upsert: true, session },
  );
}

export async function afterStockChange(product: unknown, warehouses: unknown[], extra: Record<string, unknown>) {
  for (const w of warehouses) {
    emitWarehouse('stock:update', w, { product: idStr(product), ...extra });
    try {
      await evaluateStockAlerts(product, w);
    } catch {
      /* alert evaluation must not fail a committed stock movement */
    }
  }
}

export async function receiveStock(input: ReceiveInput, user: AuthUser) {
  const { result } = await runStock(user, async (ctx) => {
    const r = await receiveLot(ctx, {
      product: input.product,
      warehouse: input.warehouse,
      quantity: input.quantity,
      bin: input.bin,
      batchNo: input.batchNo,
      expiryDate: input.expiryDate ?? null,
      birthType: 'purchase_receipt',
      explanation: `Manual receipt of ${input.quantity} on the Stock page (no purchase order)`,
    });
    await recordAudit(
      {
        action: 'stock.receive',
        entityType: 'StockLevel',
        entityId: r.line._id,
        actor: user,
        warehouse: input.warehouse,
        before: r.before,
        after: r.line,
        metadata: { quantity: input.quantity, lot: r.lot._id, dnaCode: r.lot.dnaCode },
      },
      ctx.session,
    );
    return r;
  });
  await afterStockChange(input.product, [input.warehouse], { action: 'receive', quantity: input.quantity });
  return { ...result.line.toJSON(), dnaCode: result.lot.dnaCode, lotCreated: result.created };
}

export async function dispatchStock(input: TakeInput, user: AuthUser, ref: { refType?: string | null; refId?: unknown; explanation?: string } = {}) {
  const { result: allocations } = await runStock(user, async (ctx) => {
    const a = await dispatchFefo(ctx, { ...input, ...ref });
    await recordDemand(input.product, input.warehouse, input.quantity, ctx.session);
    await recordAudit(
      {
        action: 'stock.dispatch',
        entityType: 'Product',
        entityId: input.product,
        actor: user,
        warehouse: input.warehouse,
        before: null,
        after: { allocations: a },
        metadata: { quantity: input.quantity, bin: input.bin ?? null, batchNo: input.batchNo ?? null, refType: ref.refType ?? null, refId: idStr(ref.refId) },
      },
      ctx.session,
    );
    return a;
  });
  await afterStockChange(input.product, [input.warehouse], { action: 'dispatch', quantity: input.quantity });
  return allocations;
}

export interface InstantTransferInput {
  product: string;
  fromWarehouse: string;
  toWarehouse: string;
  quantity: number;
  batchNo?: string | null;
  notes?: string;
  source?: 'manual' | 'rebalance' | 'recovery_plan' | 'redistribution_plan';
}

/** Instant transfer: FEFO pick at the source and put-away at the destination in one transaction. */
export async function instantTransfer(input: InstantTransferInput, user: AuthUser) {
  if (input.fromWarehouse === input.toWarehouse) throw ApiError.badRequest('Source and destination must differ');
  const { result: transfer } = await runStock(user, async (ctx) => {
    await requireActiveProduct(input.product, ctx.session);
    await requireActiveWarehouse(input.fromWarehouse, ctx.session);
    await requireActiveWarehouse(input.toWarehouse, ctx.session);
    const now = new Date();
    const [t] = await Transfer.create(
      [
        {
          product: input.product,
          fromWarehouse: input.fromWarehouse,
          toWarehouse: input.toWarehouse,
          quantity: input.quantity,
          batchNo: input.batchNo ?? '',
          status: 'completed',
          mode: 'instant',
          source: input.source ?? 'manual',
          initiatedBy: user._id,
          approvedBy: user._id,
          approvedAt: now,
          dispatchedAt: now,
          receivedAt: now,
          receivedBy: user._id,
          notes: input.notes ?? '',
        },
      ],
      { session: ctx.session },
    );
    const allocations = await shipTransfer(ctx, t);
    await receiveTransferLots(ctx, t, allocations);
    t.allocations = allocations.map((a) => ({ batchNo: a.batchNo, bin: a.bin, expiryDate: a.expiryDate, quantity: a.quantity, lot: a.lot })) as any;
    await t.save({ session: ctx.session });
    await recordAudit(
      { action: 'transfer.instant', entityType: 'Transfer', entityId: t._id, actor: user, warehouse: input.fromWarehouse, before: null, after: t },
      ctx.session,
    );
    return t;
  });
  emitAll('transfer:update', transfer.toJSON());
  await afterStockChange(input.product, [input.fromWarehouse, input.toWarehouse], { action: 'transfer', quantity: input.quantity });
  return transfer;
}

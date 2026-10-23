/**
 * Stock movements. Every change that touches more than one stock document runs inside a MongoDB transaction;
 * the session is passed down so callers can compose several movements atomically.
 */
import { ClientSession, Types } from 'mongoose';
import { DemandHistory, Product, StockLevel, Transfer, Warehouse } from '../models';
import { allocateFEFO, Allocation } from '../engines/inventoryLogic';
import { withTransaction } from '../config/db';
import { ApiError } from '../utils/apiError';
import { idStr } from '../utils/ids';
import { startOfUtcDay } from '../utils/dates';
import { recordAudit } from '../middleware/audit';
import type { AuthUser } from '../middleware/auth';
import { emitWarehouse, emitAll } from '../sockets';
import { evaluateStockAlerts } from './alerts';

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

export interface StockAllocation extends Allocation {
  lineId: string;
}

export async function requireActiveProduct(id: unknown, session?: ClientSession) {
  const p = await Product.findById(idStr(id)).session(session ?? null);
  if (!p) throw ApiError.notFound('Product not found');
  if (!p.isActive) throw ApiError.badRequest(`Product ${p.sku} is inactive`);
  return p;
}

export async function requireActiveWarehouse(id: unknown, session?: ClientSession) {
  const w = await Warehouse.findById(idStr(id)).session(session ?? null);
  if (!w) throw ApiError.notFound('Warehouse not found');
  if (!w.isActive) throw ApiError.badRequest(`Warehouse ${w.code} is inactive`);
  return w;
}

type WarehouseDoc = Awaited<ReturnType<typeof requireActiveWarehouse>>;

export function warehouseBins(w: WarehouseDoc): string[] {
  return (w.zones ?? []).flatMap((z) => z.bins ?? []);
}

/** Returns the bin to use: the given one (validated against the warehouse layout) or the first bin. */
export function resolveBin(w: WarehouseDoc, bin?: string | null): string {
  const bins = warehouseBins(w);
  const b = (bin ?? '').trim();
  if (!b) return bins[0] ?? '';
  if (bins.length && !bins.includes(b)) throw ApiError.badRequest(`Bin ${b} does not exist in ${w.code}`);
  return b;
}

/** Adds stock to the line for (product, warehouse, batch, bin), creating it if needed. */
export async function addToLine(
  input: { product: unknown; warehouse: unknown; bin: string; batchNo: string; expiryDate: Date | null; quantity: number },
  session: ClientSession,
) {
  const filter = { product: idStr(input.product), warehouse: idStr(input.warehouse), batchNo: input.batchNo, bin: input.bin };
  const before = await StockLevel.findOne(filter).session(session).lean();
  if (before && input.expiryDate && before.expiryDate && before.expiryDate.getTime() !== input.expiryDate.getTime()) {
    throw ApiError.badRequest(
      `Batch ${input.batchNo || '(none)'} in bin ${input.bin || '(none)'} already has expiry ${before.expiryDate
        .toISOString()
        .slice(0, 10)}; use a different batch number`,
    );
  }
  const update: Record<string, unknown> = { $inc: { quantity: input.quantity } };
  if (!before) update.$setOnInsert = { expiryDate: input.expiryDate };
  else if (!before.expiryDate && input.expiryDate) update.$set = { expiryDate: input.expiryDate };
  const line = await StockLevel.findOneAndUpdate(filter, update, { upsert: true, new: true, session, runValidators: true });
  return { line: line!, before };
}

/** FEFO removal across the product's lines at the warehouse (optionally limited to a bin and/or batch). */
export async function takeFromStock(input: TakeInput, session: ClientSession): Promise<StockAllocation[]> {
  const filter: Record<string, unknown> = { product: input.product, warehouse: input.warehouse, quantity: { $gt: 0 } };
  if (input.bin) filter.bin = input.bin;
  if (input.batchNo) filter.batchNo = input.batchNo;
  const lines = await StockLevel.find(filter).session(session).lean();
  let allocations: Allocation[];
  try {
    allocations = allocateFEFO(
      lines.map((l) => ({
        id: l._id.toHexString(),
        batchNo: l.batchNo,
        bin: l.bin,
        expiryDate: l.expiryDate ?? null,
        quantity: l.quantity,
        createdAt: (l as { createdAt?: Date }).createdAt ?? null,
      })),
      input.quantity,
    );
  } catch (e) {
    const scope = [input.batchNo ? `batch ${input.batchNo}` : '', input.bin ? `bin ${input.bin}` : ''].filter(Boolean).join(', ');
    throw ApiError.badRequest(`${(e as Error).message}${scope ? ` (${scope})` : ''}`);
  }
  for (const a of allocations) {
    const r = await StockLevel.updateOne(
      { _id: a.lineId, quantity: { $gte: a.quantity } },
      { $inc: { quantity: -a.quantity } },
      { session },
    );
    if (r.modifiedCount !== 1) throw ApiError.conflict('Stock changed while dispatching, please retry');
  }
  return allocations as StockAllocation[];
}

/** Adds dispatched allocations at a destination, keeping each batch number and expiry date. */
export async function putAllocations(
  product: unknown,
  warehouse: WarehouseDoc,
  allocations: { batchNo: string; expiryDate: Date | null; quantity: number }[],
  session: ClientSession,
  bin?: string | null,
) {
  const target = resolveBin(warehouse, bin);
  const lines = [];
  for (const a of allocations) {
    const { line } = await addToLine(
      { product, warehouse: warehouse._id, bin: target, batchNo: a.batchNo, expiryDate: a.expiryDate, quantity: a.quantity },
      session,
    );
    lines.push(line);
  }
  return lines;
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
  const result = await withTransaction(async (session) => {
    const product = await requireActiveProduct(input.product, session);
    const wh = await requireActiveWarehouse(input.warehouse, session);
    if (product.isPerishable && !input.expiryDate) throw ApiError.badRequest(`${product.sku} is perishable: an expiry date is required`);
    const bin = resolveBin(wh, input.bin);
    const { line, before } = await addToLine(
      {
        product: product._id,
        warehouse: wh._id,
        bin,
        batchNo: (input.batchNo ?? '').trim(),
        expiryDate: input.expiryDate ?? null,
        quantity: input.quantity,
      },
      session,
    );
    return { line, before };
  });
  await recordAudit({
    action: 'stock.receive',
    entityType: 'StockLevel',
    entityId: result.line._id,
    actor: user,
    warehouse: input.warehouse,
    before: result.before,
    after: result.line,
    metadata: { quantity: input.quantity },
  });
  await afterStockChange(input.product, [input.warehouse], { action: 'receive', quantity: input.quantity });
  return result.line;
}

export async function dispatchStock(input: TakeInput, user: AuthUser) {
  const allocations = await withTransaction(async (session) => {
    await requireActiveProduct(input.product, session);
    await requireActiveWarehouse(input.warehouse, session);
    const a = await takeFromStock(input, session);
    await recordDemand(input.product, input.warehouse, input.quantity, session);
    return a;
  });
  await recordAudit({
    action: 'stock.dispatch',
    entityType: 'Product',
    entityId: input.product,
    actor: user,
    warehouse: input.warehouse,
    before: null,
    after: { allocations },
    metadata: { quantity: input.quantity, bin: input.bin ?? null, batchNo: input.batchNo ?? null },
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
  const transfer = await withTransaction(async (session) => {
    await requireActiveProduct(input.product, session);
    await requireActiveWarehouse(input.fromWarehouse, session);
    const to = await requireActiveWarehouse(input.toWarehouse, session);
    const allocations = await takeFromStock(
      { product: input.product, warehouse: input.fromWarehouse, quantity: input.quantity, batchNo: input.batchNo },
      session,
    );
    await putAllocations(input.product, to, allocations, session);
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
          allocations: allocations.map((a) => ({ batchNo: a.batchNo, bin: a.bin, expiryDate: a.expiryDate, quantity: a.quantity })),
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
      { session },
    );
    return t;
  });
  await recordAudit({
    action: 'transfer.instant',
    entityType: 'Transfer',
    entityId: transfer._id,
    actor: user,
    warehouse: input.fromWarehouse,
    before: null,
    after: transfer,
  });
  emitAll('transfer:update', transfer.toJSON());
  await afterStockChange(input.product, [input.fromWarehouse, input.toWarehouse], { action: 'transfer', quantity: input.quantity });
  return transfer;
}

/** Sets a stock line to an absolute quantity (cycle-count reconciliation). */
export async function setLineQuantity(lineId: Types.ObjectId | string, quantity: number, session: ClientSession) {
  const before = await StockLevel.findById(lineId).session(session).lean();
  if (!before) throw ApiError.notFound('Stock line not found');
  const after = await StockLevel.findByIdAndUpdate(lineId, { quantity }, { new: true, session, runValidators: true });
  return { before, after: after! };
}


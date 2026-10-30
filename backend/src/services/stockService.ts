/**
 * The one stock choke point (docs/Stock_DNA_Spec.md C.7). Only this file writes StockLevel quantities.
 * Every function runs inside the caller's transaction (ctx.session) and, for each change:
 * validates the lot's life-state transition, updates the stock slices, updates the lot header counters,
 * appends the hash-chained DNA gene, anchors that gene in the audit chain (same transaction) and seals the
 * lot with a death gene when its last unit leaves. Socket events are queued on ctx and sent after commit.
 */
import { ClientSession, Types } from 'mongoose';
import { DnaEvent, DnaLink, Product, RecoveryPlan, RedistributionPlan, StockLevel, StockLot, Warehouse } from '../models';
import { nextSequence } from '../models/Counter';
import { withTransaction } from '../config/db';
import { env } from '../config/env';
import { ApiError } from '../utils/apiError';
import { idStr } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import type { AuthUser } from '../middleware/auth';
import { GENESIS_HASH } from '../engines/hashChain';
import {
  applyGene,
  BirthType,
  DeathCause,
  deathCauseFor,
  DisposalCause,
  DnaRuleError,
  emptyOut,
  geneHash,
  GeneInput,
  GeneType,
  hashFieldsOf,
  isAlive,
  isDead,
  LotAllocation,
  LotState,
  LotStatus,
  pickBlockReason,
  pickFefoLots,
  sealLot,
  shouldDie,
} from '../engines/dnaEngine';
import { getIO } from '../sockets';
import { notifySafe } from './notifications';

const DAY_MS = 86_400_000;

type ProductDoc = InstanceType<typeof Product>;
type WarehouseDoc = InstanceType<typeof Warehouse>;
export type LotDoc = InstanceType<typeof StockLot>;

export interface StockCtx {
  session: ClientSession;
  actor: AuthUser | null;
  /** Approver recorded on a death caused by an approved disposal. */
  approvedBy?: unknown;
  /** Work to run after the transaction commits (socket events, notifications). */
  after: (() => Promise<void> | void)[];
  /** Genes written in this transaction (returned to callers). */
  genes: GeneRecord[];
}

export interface GeneRecord {
  lot: string;
  dnaCode: string;
  type: GeneType;
  seq: number;
  hash: string;
  qtyAfter: { onHand: number; inTransit: number };
  at: Date;
  warehouse: string | null;
}

/** Runs fn in one transaction with a fresh stock context and performs the queued after-commit work. */
export async function runStock<T>(actor: AuthUser | null, fn: (ctx: StockCtx) => Promise<T>, approvedBy?: unknown): Promise<{ result: T; genes: GeneRecord[] }> {
  let ctxOut: StockCtx | null = null;
  const result = await withTransaction(async (session) => {
    // a fresh context per attempt: a retried transaction must not replay the after-commit work twice
    const ctx: StockCtx = { session, actor, approvedBy, after: [], genes: [] };
    ctxOut = ctx;
    return fn(ctx);
  });
  const ctx = ctxOut as unknown as StockCtx;
  for (const job of ctx.after) {
    try {
      await job();
    } catch {
      /* after-commit notifications must not fail a committed stock change */
    }
  }
  return { result, genes: ctx.genes };
}

// ---------------------------------------------------------------------------------------------------------------
// Validation helpers (reads)

export async function requireActiveProduct(id: unknown, session?: ClientSession | null) {
  const p = await Product.findById(idStr(id)).session(session ?? null);
  if (!p) throw ApiError.notFound('Product not found');
  if (!p.isActive) throw ApiError.badRequest(`Product ${p.sku} is inactive`);
  return p;
}

export async function requireActiveWarehouse(id: unknown, session?: ClientSession | null) {
  const w = await Warehouse.findById(idStr(id)).session(session ?? null);
  if (!w) throw ApiError.notFound('Warehouse not found');
  if (!w.isActive) throw ApiError.badRequest(`Warehouse ${w.code} is inactive`);
  return w;
}

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

function dnaError(e: unknown): never {
  if (e instanceof DnaRuleError) throw ApiError.conflict(e.message);
  throw e;
}

export async function loadLot(id: unknown, session?: ClientSession | null): Promise<LotDoc> {
  const s = idStr(id);
  if (!s || !Types.ObjectId.isValid(s)) throw ApiError.badRequest('Invalid lot id');
  const lot = await StockLot.findById(s).session(session ?? null);
  if (!lot) throw ApiError.notFound('Lot not found');
  return lot;
}

function stateOf(lot: LotDoc): LotState {
  const out = (lot.qtyOutByCause ?? {}) as Record<string, number>;
  const f = (lot.flags ?? {}) as Record<string, boolean>;
  return {
    status: lot.status as LotStatus,
    qtyBorn: lot.qtyBorn ?? 0,
    qtyAdded: lot.qtyAdded ?? 0,
    qtyOnHand: lot.qtyOnHand ?? 0,
    qtyInTransit: lot.qtyInTransit ?? 0,
    qtyReserved: lot.qtyReserved ?? 0,
    qtyOutByCause: { ...emptyOut(), ...Object.fromEntries(Object.entries(out).filter(([, v]) => typeof v === 'number')) },
    flags: {
      onHold: !!f.onHold,
      recalled: !!f.recalled,
      backfilled: !!f.backfilled,
      qcRejected: !!f.qcRejected,
      expiryWarned: !!f.expiryWarned,
    },
    eventCount: lot.eventCount ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Genes

export interface GeneDetails {
  warehouse?: unknown;
  fromWarehouse?: unknown;
  toWarehouse?: unknown;
  bin?: string | null;
  refType?: string | null;
  refId?: unknown;
  explanation: string;
  evidence?: string[];
  at?: Date;
}

function emitDna(event: string, warehouse: string | null, payload: Record<string, unknown>) {
  const io = getIO();
  if (!io) return;
  const rooms = ['all', ...(warehouse ? [`wh:${warehouse}`] : [])];
  io.to(rooms).emit(event, payload);
}

/**
 * Appends one gene: applies it to the lot state (rejecting invalid transitions), writes the DnaEvent with its
 * hash, saves the header with an optimistic check on eventCount, anchors the hash in the audit log and, when
 * the lot just ran out, writes the death gene in the same transaction.
 */
export async function appendGene(ctx: StockCtx, lot: LotDoc, gene: GeneInput, d: GeneDetails): Promise<GeneRecord> {
  const prev = stateOf(lot);
  let effect;
  try {
    effect = applyGene(prev, gene);
  } catch (e) {
    dnaError(e);
  }
  const rec = await writeGene(ctx, lot, prev, effect.state, gene.type, {
    ...d,
    qtyDelta: effect.qtyDelta,
    qtyMoved: effect.qtyMoved,
    cause: (gene.cause as string | null | undefined) ?? null,
  });
  if (shouldDie(effect.state)) await seal(ctx, lot, deathCauseFor(gene), d);
  return rec;
}

async function writeGene(
  ctx: StockCtx,
  lot: LotDoc,
  prev: LotState,
  next: LotState,
  type: GeneType,
  d: GeneDetails & { qtyDelta: number; qtyMoved: number; cause: string | null },
  death?: Record<string, unknown> | null,
): Promise<GeneRecord> {
  const at = d.at ?? new Date();
  const seq = next.eventCount;
  const doc = {
    lot: lot._id,
    seq,
    type,
    at,
    actor: ctx.actor?._id ?? null,
    actorRole: ctx.actor?.role ?? 'system',
    warehouse: idStr(d.warehouse),
    fromWarehouse: idStr(d.fromWarehouse),
    toWarehouse: idStr(d.toWarehouse),
    bin: d.bin ?? null,
    qtyDelta: d.qtyDelta,
    qtyMoved: d.qtyMoved,
    qtyAfter: { onHand: next.qtyOnHand, inTransit: next.qtyInTransit },
    cause: d.cause,
    refType: d.refType ?? null,
    refId: idStr(d.refId),
    explanation: d.explanation,
    evidence: d.evidence ?? [],
  };
  const prevHash = lot.headHash ?? GENESIS_HASH;
  const hash = geneHash(prevHash, hashFieldsOf(doc as unknown as Record<string, unknown>));
  const [ev] = await DnaEvent.create([{ ...doc, prevHash, hash }], { session: ctx.session });

  const set: Record<string, unknown> = {
    status: next.status,
    qtyBorn: next.qtyBorn,
    qtyAdded: next.qtyAdded,
    qtyOnHand: next.qtyOnHand,
    qtyInTransit: next.qtyInTransit,
    qtyReserved: next.qtyReserved,
    qtyOutByCause: next.qtyOutByCause,
    flags: next.flags,
    eventCount: seq,
    headHash: hash,
    lastEventAt: at,
    lastEventType: type,
  };
  if (death) set.death = death;
  const whs = [doc.warehouse, doc.toWarehouse].filter((x): x is string => !!x);
  const update: Record<string, unknown> = { $set: set };
  if (whs.length) update.$addToSet = { warehouses: { $each: whs.map((w) => new Types.ObjectId(w)) } };
  // the seq is taken with the expected count: two writers can never both write the same seq
  const r = await StockLot.updateOne({ _id: lot._id, eventCount: prev.eventCount }, update, { session: ctx.session });
  if (r.matchedCount !== 1) throw ApiError.conflict(`Lot ${lot.dnaCode} changed while recording ${type}, please retry`);
  lot.set(set);
  if (whs.length) for (const w of whs) if (!lot.warehouses.some((x) => idStr(x) === w)) lot.warehouses.push(new Types.ObjectId(w));

  await recordAudit(
    {
      action: `dna.${type}`,
      entityType: 'StockLot',
      entityId: lot._id,
      actor: ctx.actor,
      warehouse: doc.warehouse ?? doc.fromWarehouse ?? doc.toWarehouse,
      before: null,
      after: null,
      metadata: { dnaCode: lot.dnaCode, seq, dnaHash: hash, qtyDelta: d.qtyDelta, qtyMoved: d.qtyMoved, refType: doc.refType, refId: doc.refId },
    },
    ctx.session,
  );

  const rec: GeneRecord = { lot: lot._id.toHexString(), dnaCode: lot.dnaCode, type, seq, hash, qtyAfter: doc.qtyAfter, at, warehouse: doc.warehouse ?? doc.toWarehouse ?? doc.fromWarehouse };
  ctx.genes.push(rec);
  const wh = rec.warehouse;
  ctx.after.push(() => emitDna('dna:event', wh, { lotId: rec.lot, dnaCode: rec.dnaCode, type, qtyAfter: rec.qtyAfter, at, eventId: ev._id.toHexString() }));
  return rec;
}

/** Writes the terminal death gene and the sealed death record. */
async function seal(ctx: StockCtx, lot: LotDoc, cause: DeathCause, d: GeneDetails) {
  const prev = stateOf(lot);
  const product = await Product.findById(lot.product).session(ctx.session).select('sku unitCost').lean();
  const at = new Date();
  let sealed;
  try {
    sealed = sealLot(prev, cause, {
      at,
      bornAt: lot.birth!.at,
      unitCost: lot.birth?.unitCost || product?.unitCost || 0,
      manufactureDate: lot.manufactureDate,
      expiryDate: lot.expiryDate,
    });
  } catch (e) {
    dnaError(e);
  }
  const death = { ...sealed.death, approvedBy: idStr(ctx.approvedBy ?? ctx.actor?._id) ?? null, note: d.explanation };
  const lifeUsed = death.lifeUsedPct === null ? 'unknown' : `${Math.round(death.lifeUsedPct * 100)}%`;
  await writeGene(
    ctx,
    lot,
    prev,
    sealed.state,
    'death',
    {
      warehouse: d.warehouse ?? d.toWarehouse ?? d.fromWarehouse,
      refType: d.refType,
      refId: d.refId,
      explanation: `Lot died: ${cause.replace(/_/g, ' ')} after ${death.lifespanDays} days; shelf life used ${lifeUsed}; value lost ₹${death.valueLost}`,
      qtyDelta: 0,
      qtyMoved: 0,
      cause,
      at,
    },
    death,
  );
  const lotId = lot._id.toHexString();
  ctx.after.push(() => emitDna('dna:death', null, { lotId, dnaCode: lot.dnaCode, cause, valueLost: death.valueLost, at }));
  if (death.valueLost > env.dnaValueLostAlert) {
    ctx.after.push(() =>
      notifySafe(
        { roles: ['admin', 'warehouse_manager'] },
        {
          type: 'dna.death_value_lost',
          subject: `Lot ${lot.dnaCode} died with ₹${death.valueLost} lost`,
          body: `${product?.sku ?? 'Product'} lot ${lot.dnaCode} died (${cause.replace(/_/g, ' ')}); value lost ₹${death.valueLost}.`,
          link: `/dna/${lotId}`,
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Slices (the only StockLevel quantity writes in the codebase)

async function addToSlice(
  ctx: StockCtx,
  input: { product: unknown; warehouse: unknown; bin: string; batchNo: string; expiryDate: Date | null; lot: unknown },
  qty: number,
) {
  const filter = { product: idStr(input.product), warehouse: idStr(input.warehouse), batchNo: input.batchNo, bin: input.bin };
  const before = await StockLevel.findOne(filter).session(ctx.session).lean();
  if (before && before.quantity > 0 && before.lot && idStr(before.lot) !== idStr(input.lot)) {
    throw ApiError.conflict(`Bin ${input.bin || '(none)'} already holds batch ${input.batchNo || '(none)'} of another lot`);
  }
  if (before && before.quantity > 0 && input.expiryDate && before.expiryDate && before.expiryDate.getTime() !== input.expiryDate.getTime()) {
    throw ApiError.badRequest(
      `Batch ${input.batchNo || '(none)'} in bin ${input.bin || '(none)'} already has expiry ${before.expiryDate
        .toISOString()
        .slice(0, 10)}; use a different batch number`,
    );
  }
  const update: Record<string, unknown> = { $inc: { quantity: qty }, $set: { lot: idStr(input.lot) } };
  if (!before || before.quantity === 0) (update.$set as Record<string, unknown>).expiryDate = input.expiryDate;
  else if (!before.expiryDate && input.expiryDate) (update.$set as Record<string, unknown>).expiryDate = input.expiryDate;
  const line = await StockLevel.findOneAndUpdate(filter, update, { upsert: true, new: true, session: ctx.session, runValidators: true });
  return { line: line!, before };
}

async function takeFromSlice(ctx: StockCtx, sliceId: unknown, qty: number) {
  const r = await StockLevel.updateOne({ _id: idStr(sliceId), quantity: { $gte: qty } }, { $inc: { quantity: -qty } }, { session: ctx.session });
  if (r.modifiedCount !== 1) throw ApiError.conflict('Stock changed while it was being moved, please retry');
}

/** Removes qty of a lot at one warehouse, from its slices there (optionally one bin), smallest bins first. */
async function takeLotAt(ctx: StockCtx, lot: LotDoc, warehouse: unknown, qty: number, bin?: string | null) {
  const filter: Record<string, unknown> = { lot: lot._id, warehouse: idStr(warehouse), quantity: { $gt: 0 } };
  if (bin) filter.bin = bin;
  const slices = await StockLevel.find(filter).session(ctx.session).sort({ quantity: 1 }).lean();
  const have = slices.reduce((s, x) => s + x.quantity, 0);
  if (have < qty) throw ApiError.badRequest(`Lot ${lot.dnaCode} has ${have} at this warehouse${bin ? ` (bin ${bin})` : ''}, requested ${qty}`);
  let left = qty;
  const taken: { slice: string; bin: string; quantity: number }[] = [];
  for (const s of slices) {
    if (left <= 0) break;
    const q = Math.min(s.quantity, left);
    await takeFromSlice(ctx, s._id, q);
    taken.push({ slice: s._id.toHexString(), bin: s.bin, quantity: q });
    left -= q;
  }
  return taken;
}

// ---------------------------------------------------------------------------------------------------------------
// Lot creation and adoption

async function nextDnaCode(ctx: StockCtx, sku: string, at: Date) {
  const n = await nextSequence('dna', ctx.session);
  const d = at.toISOString();
  const ymd = d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);
  return `DNA-${sku}-${ymd}-${String(n).padStart(4, '0')}`;
}

async function findAliveLot(ctx: StockCtx, product: unknown, batchNo: string) {
  return StockLot.findOne({ product: idStr(product), batchNo, status: { $in: ['quarantine', 'active', 'expired'] } }).session(ctx.session);
}

interface CreateLotInput {
  product: ProductDoc;
  warehouse: WarehouseDoc;
  bin: string;
  batchNo: string;
  qty: number;
  birthType: BirthType;
  supplier?: unknown;
  unitCost?: number | null;
  expiryDate?: Date | null;
  manufactureDate?: Date | null;
  refType?: string | null;
  refId?: unknown;
  grnNo?: string | null;
  backfilled?: boolean;
  hold?: boolean;
  parentLots?: unknown[];
  at?: Date;
  explanation: string;
}

async function createLot(ctx: StockCtx, input: CreateLotInput) {
  const at = input.at ?? new Date();
  const expiry = input.expiryDate ?? null;
  // manufacture date: given, or derived from the product's shelf life so "shelf life used" can be measured
  const mfg =
    input.manufactureDate ?? (expiry && input.product.shelfLifeDays ? new Date(expiry.getTime() - input.product.shelfLifeDays * DAY_MS) : null);
  const [lot] = await StockLot.create(
    [
      {
        dnaCode: await nextDnaCode(ctx, input.product.sku, at),
        product: input.product._id,
        batchNo: input.batchNo,
        supplier: idStr(input.supplier) ?? null,
        birth: {
          type: input.birthType,
          at,
          warehouse: input.warehouse._id,
          bin: input.bin,
          qty: input.qty,
          unitCost: input.unitCost ?? input.product.unitCost ?? 0,
          refType: input.refType ?? null,
          refId: idStr(input.refId) ?? null,
          grnNo: input.grnNo ?? null,
          backfilled: !!input.backfilled,
        },
        manufactureDate: mfg,
        expiryDate: expiry,
        shelfLifeDays: mfg && expiry ? Math.round((expiry.getTime() - mfg.getTime()) / DAY_MS) : null,
        parentLots: (input.parentLots ?? []).map((x) => idStr(x)),
        status: input.hold ? 'quarantine' : 'active',
        flags: { backfilled: !!input.backfilled },
        warehouses: [input.warehouse._id],
        eventCount: 0,
        headHash: null,
      },
    ],
    { session: ctx.session },
  );
  // the header starts at eventCount 0 with no state; the born gene sets its status and counters
  const fresh = stateOf(lot);
  fresh.status = null;
  let effect;
  try {
    effect = applyGene(fresh, { type: 'born', qty: input.qty, hold: input.hold });
  } catch (e) {
    dnaError(e);
  }
  effect.state.flags.backfilled = !!input.backfilled;
  await writeGene(ctx, lot, { ...fresh, eventCount: 0 }, effect.state, 'born', {
    warehouse: input.warehouse._id,
    bin: input.bin,
    refType: input.refType ?? null,
    refId: input.refId,
    explanation: input.explanation,
    at,
    qtyDelta: effect.qtyDelta,
    qtyMoved: 0,
    cause: null,
  });
  return lot;
}

/** How a backfilled lot was really born, when the purchase history shows it. */
export interface BirthHint {
  birthType: BirthType;
  at: Date;
  supplier?: unknown;
  unitCost?: number | null;
  refType: string;
  refId: unknown;
  grnNo?: string | null;
  explanation: string;
}

const BACKFILL_NOTE = 'Backfilled from existing stock; true birth not recorded';

/** Gives one orphan slice (stock with no DNA lot) a lot: joins the alive lot of its batch or creates one. */
async function adoptOne(ctx: StockCtx, s: InstanceType<typeof StockLevel> | Record<string, any>, hint: BirthHint | null) {
  const product = await Product.findById(s.product).session(ctx.session);
  const wh = await Warehouse.findById(s.warehouse).session(ctx.session);
  if (!product || !wh) return null;
  let lot = await findAliveLot(ctx, s.product, s.batchNo);
  const where = `${wh.code}${s.bin ? ` bin ${s.bin}` : ''}`;
  let created = false;
  if (!lot) {
    lot = await createLot(ctx, {
      product,
      warehouse: wh,
      bin: s.bin,
      batchNo: s.batchNo,
      qty: s.quantity,
      birthType: hint?.birthType ?? 'opening_balance',
      supplier: hint?.supplier ?? product.primarySupplier,
      unitCost: hint?.unitCost ?? null,
      expiryDate: s.expiryDate ?? null,
      refType: hint?.refType ?? null,
      refId: hint?.refId,
      grnNo: hint?.grnNo ?? null,
      backfilled: !hint,
      at: hint?.at ?? (s as { createdAt?: Date }).createdAt ?? new Date(),
      explanation: hint ? `${hint.explanation}: ${s.quantity} at ${where}` : `${BACKFILL_NOTE}: ${s.quantity} found at ${where}`,
    });
    created = true;
  } else {
    await appendGene(ctx, lot, { type: 'receive_more', qty: s.quantity, adopt: true }, {
      warehouse: wh._id,
      bin: s.bin,
      explanation: `${BACKFILL_NOTE}: ${s.quantity} more found at ${where}`,
    });
  }
  await StockLevel.updateOne({ _id: s._id, lot: null }, { $set: { lot: lot._id } }, { session: ctx.session });
  return { lot, created };
}

/**
 * Gives a DNA lot to stock slices that have none (stock created before Stock DNA, or by tools outside the
 * service), inside the caller's transaction. Groups by batch: joins the alive lot of that batch, or creates
 * a backfilled lot whose born gene says the true birth was not recorded.
 */
export async function adoptSlices(ctx: StockCtx, filter: { product?: unknown; warehouse?: unknown; batchNo?: string } = {}) {
  const q: Record<string, unknown> = { lot: null, quantity: { $gt: 0 } };
  if (filter.product) q.product = idStr(filter.product);
  if (filter.warehouse) q.warehouse = idStr(filter.warehouse);
  if (filter.batchNo !== undefined) q.batchNo = filter.batchNo;
  const orphans = await StockLevel.find(q).session(ctx.session).sort({ createdAt: 1, _id: 1 }).lean();
  const created: LotDoc[] = [];
  for (const s of orphans) {
    const r = await adoptOne(ctx, s, null);
    if (r?.created) created.push(r.lot);
  }
  return { adopted: orphans.length, created };
}

/**
 * npm run dna:backfill: one transaction per orphan slice. When the batch number is a received purchase
 * order of that product, the lot is born as that receipt (time, supplier, cost) and is not marked
 * backfilled. Running it again finds no orphans, so it is idempotent.
 */
export async function backfillLots(resolveHint: (slice: Record<string, any>) => Promise<BirthHint | null>) {
  const orphans = await StockLevel.find({ lot: null, quantity: { $gt: 0 } }).sort({ createdAt: 1, _id: 1 }).select('_id').lean();
  let lotsCreated = 0;
  let backfilled = 0;
  let fromHistory = 0;
  for (const o of orphans) {
    const { result } = await runStock(null, async (ctx) => {
      const s = await StockLevel.findOne({ _id: o._id, lot: null }).session(ctx.session).lean();
      if (!s || s.quantity <= 0) return null;
      const alive = await findAliveLot(ctx, s.product, s.batchNo);
      const hint = alive ? null : await resolveHint(s);
      const r = await adoptOne(ctx, s, hint);
      return r ? { created: r.created, fromHistory: !!hint } : null;
    });
    if (result?.created) {
      lotsCreated++;
      if (result.fromHistory) fromHistory++;
      else backfilled++;
    }
  }
  return { slicesAdopted: orphans.length, lotsCreated, backfilled, fromHistory };
}

// ---------------------------------------------------------------------------------------------------------------
// C.7 functions

export interface ReceiveLotInput {
  product: unknown;
  warehouse: unknown;
  quantity: number;
  bin?: string | null;
  batchNo?: string | null;
  expiryDate?: Date | null;
  manufactureDate?: Date | null;
  unitCost?: number | null;
  supplier?: unknown;
  birthType: BirthType;
  refType?: string | null;
  refId?: unknown;
  grnNo?: string | null;
  hold?: boolean;
  explanation?: string;
  at?: Date;
}

/** Receives stock: a new lot is born (born + put_away), or more of an alive lot of the same batch arrives. */
export async function receiveLot(ctx: StockCtx, input: ReceiveLotInput) {
  const product = await requireActiveProduct(input.product, ctx.session);
  const wh = await requireActiveWarehouse(input.warehouse, ctx.session);
  if (product.isPerishable && !input.expiryDate) throw ApiError.badRequest(`${product.sku} is perishable: an expiry date is required`);
  const bin = resolveBin(wh, input.bin);
  const batchNo = (input.batchNo ?? '').trim();
  await adoptSlices(ctx, { product: product._id, batchNo });
  let lot = await findAliveLot(ctx, product._id, batchNo);
  const source = input.explanation ?? `Received ${input.quantity} ${product.unit ?? 'units'} of ${product.sku} at ${wh.code}`;
  let created = false;
  if (lot) {
    if (lot.expiryDate && input.expiryDate && lot.expiryDate.getTime() !== input.expiryDate.getTime()) {
      throw ApiError.badRequest(
        `Batch ${batchNo || '(none)'} already has expiry ${lot.expiryDate.toISOString().slice(0, 10)}; use a different batch number`,
      );
    }
    await appendGene(ctx, lot, { type: 'receive_more', qty: input.quantity }, {
      warehouse: wh._id,
      bin,
      refType: input.refType,
      refId: input.refId,
      explanation: `${source} (more of batch ${batchNo || '(none)'})`,
      at: input.at,
    });
  } else {
    lot = await createLot(ctx, {
      product,
      warehouse: wh,
      bin,
      batchNo,
      qty: input.quantity,
      birthType: input.birthType,
      supplier: input.supplier,
      unitCost: input.unitCost,
      expiryDate: input.expiryDate ?? null,
      manufactureDate: input.manufactureDate ?? null,
      refType: input.refType,
      refId: input.refId,
      grnNo: input.grnNo,
      hold: input.hold,
      at: input.at,
      explanation: source,
    });
    created = true;
    if (bin) {
      await appendGene(ctx, lot, { type: 'put_away' }, { warehouse: wh._id, bin, explanation: `Put away in bin ${bin} at ${wh.code}`, at: input.at });
    }
  }
  const { line, before } = await addToSlice(
    ctx,
    { product: product._id, warehouse: wh._id, bin, batchNo, expiryDate: input.expiryDate ?? lot.expiryDate ?? null, lot: lot._id },
    input.quantity,
  );
  return { lot, line, before, created };
}

/** Moves part of a lot between bins of one warehouse (put_away gene, no quantity change). */
export async function putAway(ctx: StockCtx, lotId: unknown, input: { warehouse: unknown; fromBin: string; toBin: string; quantity: number }) {
  const lot = await loadLot(lotId, ctx.session);
  const wh = await requireActiveWarehouse(input.warehouse, ctx.session);
  const toBin = resolveBin(wh, input.toBin);
  if (toBin === input.fromBin) throw ApiError.badRequest('Choose a different bin');
  if (isDead(lot.status as LotStatus)) throw ApiError.conflict(`Lot ${lot.dnaCode} is dead; its DNA is sealed`);
  await takeLotAt(ctx, lot, wh._id, input.quantity, input.fromBin);
  await addToSlice(ctx, { product: lot.product, warehouse: wh._id, bin: toBin, batchNo: lot.batchNo, expiryDate: lot.expiryDate ?? null, lot: lot._id }, input.quantity);
  return appendGene(ctx, lot, { type: 'put_away' }, {
    warehouse: wh._id,
    bin: toBin,
    explanation: `Moved ${input.quantity} from bin ${input.fromBin || '(none)'} to bin ${toBin} at ${wh.code}`,
  });
}

interface PickRequest {
  product: unknown;
  warehouse: unknown;
  quantity: number;
  bin?: string | null;
  batchNo?: string | null;
}

/** FEFO allocation over the lots at a warehouse, skipping expired, quarantined and recalled lots. */
async function pick(ctx: StockCtx, req: PickRequest, now = new Date()): Promise<(LotAllocation & { dnaCode: string })[]> {
  await adoptSlices(ctx, { product: req.product, warehouse: req.warehouse });
  const filter: Record<string, unknown> = { product: idStr(req.product), warehouse: idStr(req.warehouse), quantity: { $gt: 0 } };
  if (req.bin) filter.bin = req.bin;
  if (req.batchNo) filter.batchNo = req.batchNo;
  const slices = await StockLevel.find(filter).session(ctx.session).lean();
  const lotIds = [...new Set(slices.map((s) => idStr(s.lot)).filter((x): x is string => !!x))];
  const lots = await StockLot.find({ _id: { $in: lotIds } }).session(ctx.session).lean();
  const byId = new Map(lots.map((l) => [l._id.toHexString(), l]));
  if (req.batchNo) {
    // an explicitly chosen batch that is blocked gets a precise error instead of "insufficient stock"
    for (const s of slices) {
      const l = byId.get(idStr(s.lot)!);
      const why = l ? pickBlockReason({ lotStatus: l.status as LotStatus, recalled: !!l.flags?.recalled, expiryDate: s.expiryDate ?? null }, now) : null;
      if (why) throw ApiError.conflict(`Lot ${l!.dnaCode} (batch ${req.batchNo}) cannot be picked: it is ${why}`);
    }
  }
  try {
    return pickFefoLots(
      slices
        .filter((s) => s.lot && byId.has(idStr(s.lot)!))
        .map((s) => {
          const l = byId.get(idStr(s.lot)!)!;
          return {
            id: s._id.toHexString(),
            lot: l._id.toHexString(),
            lotStatus: l.status as LotStatus,
            recalled: !!l.flags?.recalled,
            batchNo: s.batchNo,
            bin: s.bin,
            expiryDate: s.expiryDate ?? null,
            quantity: s.quantity,
            createdAt: (s as { createdAt?: Date }).createdAt ?? null,
          };
        }),
      req.quantity,
      now,
    ).map((a) => ({ ...a, dnaCode: byId.get(a.lot)!.dnaCode }));
  } catch (e) {
    const scope = [req.batchNo ? `batch ${req.batchNo}` : '', req.bin ? `bin ${req.bin}` : ''].filter(Boolean).join(', ');
    if (e instanceof DnaRuleError) throw ApiError.badRequest(`${e.message}${scope ? ` (${scope})` : ''}`);
    throw e;
  }
}

/** Groups allocations by lot, keeping order. */
function byLot<T extends { lot: string; quantity: number }>(allocs: T[]) {
  const m = new Map<string, T[]>();
  for (const a of allocs) m.set(a.lot, [...(m.get(a.lot) ?? []), a]);
  return [...m];
}

function fefoNote(allocs: { dnaCode: string; quantity: number; expiryDate: Date | null }[]) {
  return allocs.map((a) => `${a.dnaCode} x ${a.quantity}${a.expiryDate ? ` (expires ${new Date(a.expiryDate).toISOString().slice(0, 10)})` : ''}`).join('; ');
}

export interface DispatchInput extends PickRequest {
  refType?: string | null;
  refId?: unknown;
  explanation?: string;
}

/**
 * Dispatches by FEFO: one pick_fefo and one dispatch_sale gene per lot drawn from; the explanation lists
 * every lot and the quantity taken. A lot whose last unit leaves dies with cause sold_out.
 */
export async function dispatchFefo(ctx: StockCtx, input: DispatchInput) {
  await requireActiveProduct(input.product, ctx.session);
  const wh = await requireActiveWarehouse(input.warehouse, ctx.session);
  const allocs = await pick(ctx, input);
  const note = fefoNote(allocs);
  for (const [lotId, parts] of byLot(allocs)) {
    const lot = await loadLot(lotId, ctx.session);
    const q = parts.reduce((s, p) => s + p.quantity, 0);
    for (const p of parts) await takeFromSlice(ctx, p.lineId, p.quantity);
    await appendGene(ctx, lot, { type: 'pick_fefo', qty: q }, {
      warehouse: wh._id,
      bin: parts[0].bin,
      refType: input.refType,
      refId: input.refId,
      explanation: `FEFO pick of ${input.quantity} at ${wh.code}: ${note}`,
    });
    await appendGene(ctx, lot, { type: 'dispatch_sale', qty: q }, {
      warehouse: wh._id,
      bin: parts[0].bin,
      refType: input.refType,
      refId: input.refId,
      explanation: input.explanation ?? `Dispatched ${q} from ${wh.code}`,
    });
  }
  return allocs;
}

/** Consumption (production or internal use) of a lot at a warehouse. */
export async function consume(ctx: StockCtx, lotId: unknown, input: { warehouse: unknown; quantity: number; reason: string; refType?: string | null; refId?: unknown }) {
  const lot = await loadLot(lotId, ctx.session);
  const wh = await requireActiveWarehouse(input.warehouse, ctx.session);
  const st = stateOf(lot);
  if (st.status !== 'active' || st.flags.recalled) throw ApiError.conflict(`Lot ${lot.dnaCode} cannot be consumed: it is ${st.flags.recalled ? 'recalled' : st.status}`);
  await takeLotAt(ctx, lot, wh._id, input.quantity);
  return appendGene(ctx, lot, { type: 'consume', qty: input.quantity }, {
    warehouse: wh._id,
    refType: input.refType,
    refId: input.refId,
    explanation: `Consumed ${input.quantity} at ${wh.code}: ${input.reason}`,
  });
}

/** Decision note on every lot an approved plan's transfer draws from (the plan's own numbers). */
async function planNote(ctx: StockCtx, transfer: TransferLike): Promise<{ text: string; refType: string; refId: unknown } | null> {
  if (transfer.plan && transfer.planModel === 'RedistributionPlan') {
    const p = await RedistributionPlan.findById(transfer.plan).session(ctx.session).lean();
    if (!p) return null;
    const line = (p.lines ?? []).find((l) => idStr(l.toWarehouse) === idStr(transfer.toWarehouse));
    const nums = line
      ? `${line.toWarehouseName} can sell ${line.destDailyDemand} x ${line.sellWindowDays} days = ${round(Number(line.destDailyDemand) * Number(line.sellWindowDays))}; holds ${line.destExistingUnits}; capacity ${line.capacityUnits}; move ${line.quantity}`
      : `move ${transfer.quantity}`;
    return { text: `Redistribution plan ${p.planNo}: ${nums}. Residual ${p.residualUnits ?? 0} (${p.residualAdvice}).`, refType: 'redistribution_plan', refId: p._id };
  }
  if (transfer.plan && transfer.planModel === 'RecoveryPlan') {
    const p = await RecoveryPlan.findById(transfer.plan).session(ctx.session).lean();
    if (!p) return null;
    const opt = (p.options ?? []).find((o) => o.optionId === p.selectedOptionId);
    const steps = (opt?.steps ?? []).map((s) => (s.type === 'transfer' ? `transfer ${s.quantity} from ${s.fromWarehouseName}` : `buy ${s.quantity} from ${s.supplierName}`)).join(' + ');
    return {
      text: `Recovery plan ${p.planNo} (${opt?.label ?? 'selected option'}): required ${p.context?.requiredUnits ?? '?'} units; ${steps}; shortage left ${opt?.shortageLeft ?? 0}.`,
      refType: 'recovery_plan',
      refId: p._id,
    };
  }
  if (transfer.source === 'rebalance') {
    return { text: `Rebalance before buying: ${transfer.notes || `move ${transfer.quantity} to cover a shortfall`}`, refType: 'transfer', refId: transfer._id };
  }
  return null;
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

export interface TransferLike {
  _id: unknown;
  product: unknown;
  fromWarehouse: unknown;
  toWarehouse: unknown;
  quantity: number;
  batchNo?: string | null;
  plan?: unknown;
  planModel?: string | null;
  source?: string | null;
  notes?: string | null;
}

export interface TransferAllocation {
  lot: string;
  dnaCode: string;
  batchNo: string;
  bin: string;
  expiryDate: Date | null;
  quantity: number;
}

/** Ships a transfer: FEFO (or the transfer's batch) at the source; transfer_out genes put the stock in transit. */
export async function shipTransfer(ctx: StockCtx, t: TransferLike): Promise<TransferAllocation[]> {
  const from = await requireActiveWarehouse(t.fromWarehouse, ctx.session);
  const to = await requireActiveWarehouse(t.toWarehouse, ctx.session);
  const allocs = await pick(ctx, { product: t.product, warehouse: from._id, quantity: t.quantity, batchNo: t.batchNo || null });
  const note = await planNote(ctx, t);
  for (const [lotId, parts] of byLot(allocs)) {
    const lot = await loadLot(lotId, ctx.session);
    const q = parts.reduce((s, p) => s + p.quantity, 0);
    for (const p of parts) await takeFromSlice(ctx, p.lineId, p.quantity);
    if (note) {
      await appendGene(ctx, lot, { type: 'decision_note' }, { warehouse: from._id, refType: note.refType, refId: note.refId, explanation: note.text });
    }
    if (!t.batchNo) {
      await appendGene(ctx, lot, { type: 'pick_fefo', qty: q }, {
        warehouse: from._id,
        refType: 'transfer',
        refId: t._id,
        explanation: `FEFO pick of ${t.quantity} for transfer to ${to.code}: ${fefoNote(allocs)}`,
      });
    }
    await appendGene(ctx, lot, { type: 'transfer_out', qty: q }, {
      warehouse: from._id,
      fromWarehouse: from._id,
      toWarehouse: to._id,
      bin: parts[0].bin,
      refType: 'transfer',
      refId: t._id,
      explanation: `Shipped ${q} from ${from.code} to ${to.code}`,
    });
  }
  return allocs.map((a) => ({ lot: a.lot, dnaCode: a.dnaCode, batchNo: a.batchNo, bin: a.bin, expiryDate: a.expiryDate, quantity: a.quantity }));
}

/** Receives a shipped transfer at the destination: transfer_in genes, slices keep batch and expiry. */
export async function receiveTransfer(
  ctx: StockCtx,
  t: TransferLike,
  allocations: { lot?: unknown; batchNo?: string | null; expiryDate?: Date | null; quantity: number }[],
  bin?: string | null,
) {
  const from = await requireActiveWarehouse(t.fromWarehouse, ctx.session);
  const to = await requireActiveWarehouse(t.toWarehouse, ctx.session);
  const target = resolveBin(to, bin);
  await adoptSlices(ctx, { product: t.product, warehouse: to._id });
  const lines = [];
  for (const a of allocations) {
    const batchNo = a.batchNo ?? '';
    if (!a.lot) {
      // stock that went into transit before Stock DNA existed: it is born here, marked as backfilled
      const product = await requireActiveProduct(t.product, ctx.session);
      const r = await receiveLot(ctx, {
        product: product._id,
        warehouse: to._id,
        bin: target,
        batchNo,
        expiryDate: a.expiryDate ?? null,
        quantity: a.quantity,
        birthType: 'opening_balance',
        supplier: product.primarySupplier,
        refType: 'transfer',
        refId: t._id,
        explanation: `Backfilled from existing stock; true birth not recorded (in transit from ${from.code} before Stock DNA)`,
      });
      lines.push(r.line);
      continue;
    }
    const lot = await loadLot(a.lot, ctx.session);
    await appendGene(ctx, lot, { type: 'transfer_in', qty: a.quantity }, {
      warehouse: to._id,
      fromWarehouse: from._id,
      toWarehouse: to._id,
      bin: target,
      refType: 'transfer',
      refId: t._id,
      explanation: `Received ${a.quantity} at ${to.code} from ${from.code}`,
    });
    const { line } = await addToSlice(ctx, { product: t.product, warehouse: to._id, bin: target, batchNo, expiryDate: a.expiryDate ?? lot.expiryDate ?? null, lot: lot._id }, a.quantity);
    lines.push(line);
  }
  return lines;
}

/** Reserves stock of a warehouse for a customer order by FEFO, without moving it (reserve genes). */
export async function reserve(ctx: StockCtx, input: { product: unknown; warehouse: unknown; quantity: number; refType: string; refId: unknown }) {
  const wh = await requireActiveWarehouse(input.warehouse, ctx.session);
  const allocs = await pick(ctx, { product: input.product, warehouse: wh._id, quantity: input.quantity });
  const out = [];
  for (const [lotId, parts] of byLot(allocs)) {
    const lot = await loadLot(lotId, ctx.session);
    const q = parts.reduce((s, p) => s + p.quantity, 0);
    await appendGene(ctx, lot, { type: 'reserve', qty: q }, {
      warehouse: wh._id,
      refType: input.refType,
      refId: input.refId,
      explanation: `Reserved ${q} at ${wh.code} for ${input.refType.replace(/_/g, ' ')}`,
    });
    out.push({ lot: lotId, dnaCode: lot.dnaCode, quantity: q });
  }
  return out;
}

/** Releases what a reference reserved on each lot (release_reserve genes). */
export async function releaseReserve(ctx: StockCtx, input: { refType: string; refId: unknown; explanation: string }) {
  const held = await DnaEvent.aggregate([
    { $match: { refType: input.refType, refId: new Types.ObjectId(idStr(input.refId)!), type: { $in: ['reserve', 'release_reserve'] } } },
    { $group: { _id: '$lot', reserved: { $sum: { $cond: [{ $eq: ['$type', 'reserve'] }, '$qtyMoved', { $multiply: ['$qtyMoved', -1] }] } }, warehouse: { $last: '$warehouse' } } },
  ]).session(ctx.session);
  const out = [];
  for (const h of held) {
    if (h.reserved <= 0) continue;
    const lot = await loadLot(h._id, ctx.session);
    if (isDead(lot.status as LotStatus) || (lot.qtyReserved ?? 0) <= 0) continue;
    const q = Math.min(h.reserved, lot.qtyReserved ?? 0);
    await appendGene(ctx, lot, { type: 'release_reserve', qty: q }, { warehouse: h.warehouse, refType: input.refType, refId: input.refId, explanation: input.explanation });
    out.push({ lot: idStr(h._id), quantity: q });
  }
  return out;
}

/** Posts a cycle-count variance to the slice it was counted in (count_adjust gene: shrinkage or added). */
export async function postCountAdjustment(
  ctx: StockCtx,
  input: { product: unknown; warehouse: unknown; bin: string; batchNo: string; expiryDate?: Date | null; variance: number; refId: unknown; countNo: string },
) {
  const filter = { product: idStr(input.product), warehouse: idStr(input.warehouse), batchNo: input.batchNo, bin: input.bin };
  await adoptSlices(ctx, { product: input.product, warehouse: input.warehouse, batchNo: input.batchNo });
  const live = await StockLevel.findOne(filter).session(ctx.session).lean();
  const from = live?.quantity ?? 0;
  if (input.variance < 0) {
    if (!live || from === 0) return null;
    const q = Math.min(from, -input.variance);
    const lot = await loadLot(live.lot, ctx.session);
    await takeFromSlice(ctx, live._id, q);
    await appendGene(ctx, lot, { type: 'count_adjust', qty: -q }, {
      warehouse: input.warehouse,
      bin: input.bin,
      refType: 'stock_count',
      refId: input.refId,
      explanation: `Count ${input.countNo}: system ${from}, counted ${from - q}; shrinkage ${q}`,
    });
    return { lineId: live._id, from, to: from - q, variance: -q };
  }
  if (live && from > 0 && live.lot) {
    const lot = await loadLot(live.lot, ctx.session);
    await appendGene(ctx, lot, { type: 'count_adjust', qty: input.variance }, {
      warehouse: input.warehouse,
      bin: input.bin,
      refType: 'stock_count',
      refId: input.refId,
      explanation: `Count ${input.countNo}: system ${from}, counted ${from + input.variance}; ${input.variance} added`,
    });
    const { line } = await addToSlice(ctx, { ...filter, expiryDate: live.expiryDate ?? null, lot: lot._id }, input.variance);
    return { lineId: line._id, from, to: line.quantity, variance: input.variance };
  }
  // nothing on record in that bin: the counted stock is born here as an opening balance
  const product = await requireActiveProduct(input.product, ctx.session);
  const r = await receiveLot(ctx, {
    product: product._id,
    warehouse: input.warehouse,
    bin: input.bin,
    batchNo: input.batchNo,
    expiryDate: input.expiryDate ?? null,
    quantity: input.variance,
    birthType: 'opening_balance',
    supplier: product.primarySupplier,
    refType: 'stock_count',
    refId: input.refId,
    explanation: `Found ${input.variance} during count ${input.countNo} with no stock on record`,
  });
  return { lineId: r.line._id, from, to: r.line.quantity, variance: input.variance };
}

/** Damage or loss of a lot at a warehouse (damage gene). */
export async function recordDamage(ctx: StockCtx, lotId: unknown, input: { warehouse: unknown; quantity: number; reason: string; bin?: string | null; evidence?: string[] }) {
  const lot = await loadLot(lotId, ctx.session);
  const wh = await requireActiveWarehouse(input.warehouse, ctx.session);
  if (isDead(lot.status as LotStatus)) throw ApiError.conflict(`Lot ${lot.dnaCode} is dead; its DNA is sealed`);
  await takeLotAt(ctx, lot, wh._id, input.quantity, input.bin);
  return appendGene(ctx, lot, { type: 'damage', qty: input.quantity }, {
    warehouse: wh._id,
    bin: input.bin ?? null,
    explanation: `Damaged or lost: ${input.quantity} at ${wh.code}. ${input.reason}`,
    evidence: input.evidence,
  });
}

async function flagGene(ctx: StockCtx, lotId: unknown, type: GeneType, explanation: string) {
  const lot = await loadLot(lotId, ctx.session);
  const gene = await appendGene(ctx, lot, { type }, { warehouse: lot.birth?.warehouse, explanation });
  return { lot, gene };
}

export const holdLot = (ctx: StockCtx, lotId: unknown, reason: string) => flagGene(ctx, lotId, 'qc_hold', `QC hold: ${reason}`);
export const releaseLot = (ctx: StockCtx, lotId: unknown, reason: string) => flagGene(ctx, lotId, 'qc_release', `QC released: ${reason}`);
export const rejectLot = (ctx: StockCtx, lotId: unknown, reason: string) => flagGene(ctx, lotId, 'qc_reject', `QC rejected: ${reason}`);
export const clearRecall = (ctx: StockCtx, lotId: unknown, reason: string) => flagGene(ctx, lotId, 'recall_clear', `Recall cleared: ${reason}`);

/** Flags a recall: dispatch and transfers are blocked at once (C.4). */
export async function flagRecall(ctx: StockCtx, lotId: unknown, reason: string) {
  const r = await flagGene(ctx, lotId, 'recall_flag', `Recall flagged: ${reason}`);
  const lot = r.lot;
  const id = lot._id.toHexString();
  ctx.after.push(() => emitDna('dna:recall', null, { lotId: id, dnaCode: lot.dnaCode, reason }));
  ctx.after.push(() =>
    notifySafe(
      { roles: ['admin', 'warehouse_manager'] },
      { type: 'dna.recall', subject: `Recall: lot ${lot.dnaCode}`, body: `Lot ${lot.dnaCode} (batch ${lot.batchNo || '-'}) was recalled: ${reason}. Dispatch is blocked.`, link: `/dna/${id}` },
    ),
  );
  return r;
}

/** Approved disposal (write_off gene) of a quantity at one warehouse; kills the lot when it was the last. */
export async function disposeLot(
  ctx: StockCtx,
  lotId: unknown,
  input: { warehouse: unknown; quantity: number; cause: DisposalCause; reason: string; evidence?: string[] },
) {
  const lot = await loadLot(lotId, ctx.session);
  const wh = await requireActiveWarehouse(input.warehouse, ctx.session);
  if (isDead(lot.status as LotStatus)) throw ApiError.conflict(`Lot ${lot.dnaCode} is dead; its DNA is sealed`);
  // validate the cause before touching stock
  try {
    applyGene(stateOf(lot), { type: 'write_off', qty: input.quantity, cause: input.cause });
  } catch (e) {
    dnaError(e);
  }
  await takeLotAt(ctx, lot, wh._id, input.quantity);
  return appendGene(ctx, lot, { type: 'write_off', qty: input.quantity, cause: input.cause }, {
    warehouse: wh._id,
    explanation: `Disposed ${input.quantity} at ${wh.code} (${input.cause.replace(/_/g, ' ')}): ${input.reason}`,
    evidence: input.evidence,
  });
}

/** Sends a quantity back to the supplier (return_to_supplier gene). */
export async function returnToSupplier(ctx: StockCtx, lotId: unknown, input: { warehouse: unknown; quantity: number; reason: string }) {
  const lot = await loadLot(lotId, ctx.session);
  const wh = await requireActiveWarehouse(input.warehouse, ctx.session);
  if (isDead(lot.status as LotStatus)) throw ApiError.conflict(`Lot ${lot.dnaCode} is dead; its DNA is sealed`);
  await takeLotAt(ctx, lot, wh._id, input.quantity);
  return appendGene(ctx, lot, { type: 'return_to_supplier', qty: input.quantity }, {
    warehouse: wh._id,
    explanation: `Returned ${input.quantity} to the supplier from ${wh.code}: ${input.reason}`,
  });
}

/**
 * A customer return: always a new child lot (born return_in, in quarantine for QC) linked to its parent
 * with a dnalinks edge. A dead parent is never resurrected.
 */
export async function acceptReturn(
  ctx: StockCtx,
  parentId: unknown,
  input: { warehouse: unknown; quantity: number; bin?: string | null; reason: string; refType?: string | null; refId?: unknown },
) {
  const parent = await loadLot(parentId, ctx.session);
  const product = await requireActiveProduct(parent.product, ctx.session);
  const wh = await requireActiveWarehouse(input.warehouse, ctx.session);
  const sold = parent.qtyOutByCause?.sold ?? 0;
  const returned = await DnaLink.aggregate([{ $match: { parentLot: parent._id, relation: 'return' } }, { $group: { _id: null, q: { $sum: '$qty' } } }]).session(
    ctx.session,
  );
  const already = returned[0]?.q ?? 0;
  if (input.quantity > sold - already) {
    throw ApiError.badRequest(`Lot ${parent.dnaCode} shipped ${sold} to customers and ${already} came back already; cannot accept ${input.quantity}`);
  }
  const n = (await DnaLink.countDocuments({ parentLot: parent._id }).session(ctx.session)) + 1;
  const bin = resolveBin(wh, input.bin);
  const child = await createLot(ctx, {
    product,
    warehouse: wh,
    bin,
    batchNo: `${parent.batchNo || 'LOT'}-R${n}`,
    qty: input.quantity,
    birthType: 'return_in',
    supplier: parent.supplier,
    unitCost: parent.birth?.unitCost ?? null,
    expiryDate: parent.expiryDate ?? null,
    manufactureDate: parent.manufactureDate ?? null,
    refType: input.refType ?? null,
    refId: input.refId,
    hold: true,
    parentLots: [parent._id],
    explanation: `Customer return of ${input.quantity} from lot ${parent.dnaCode} at ${wh.code}: ${input.reason}`,
  });
  const ev = await DnaEvent.findOne({ lot: child._id, seq: 1 }).session(ctx.session).select('_id').lean();
  await DnaLink.create([{ parentLot: parent._id, childLot: child._id, relation: 'return', qty: input.quantity, at: new Date(), eventId: ev?._id ?? null }], {
    session: ctx.session,
  });
  const { line } = await addToSlice(ctx, { product: product._id, warehouse: wh._id, bin, batchNo: child.batchNo, expiryDate: child.expiryDate ?? null, lot: child._id }, input.quantity);
  return { child, line };
}

/** A decision note on a lot (an approved engine decision touched it). */
export async function addDecisionNote(ctx: StockCtx, lotId: unknown, input: { explanation: string; refType: string; refId: unknown; warehouse?: unknown }) {
  const lot = await loadLot(lotId, ctx.session);
  return appendGene(ctx, lot, { type: 'decision_note' }, { warehouse: input.warehouse ?? lot.birth?.warehouse, refType: input.refType, refId: input.refId, explanation: input.explanation });
}

// ---------------------------------------------------------------------------------------------------------------
// Expiry job (C.10)

/**
 * For every alive lot: past expiry with stock left -> expire gene; within the warning window -> one
 * expiry_warning gene. Idempotent: the status and the expiryWarned flag stop duplicates.
 */
export async function runExpiryJob(now = new Date()) {
  const warnBefore = new Date(now.getTime() + env.dnaExpiryWarningDays * DAY_MS);
  const candidates = await StockLot.find({
    status: { $in: ['active', 'quarantine'] },
    expiryDate: { $ne: null, $lte: warnBefore },
  })
    .select('_id')
    .lean();
  let expired = 0;
  let warned = 0;
  for (const c of candidates) {
    const { result } = await runStock(null, async (ctx) => {
      const lot = await loadLot(c._id, ctx.session);
      const st = stateOf(lot);
      const exp = lot.expiryDate!;
      if (st.status === 'active' && exp.getTime() <= now.getTime() && st.qtyOnHand + st.qtyInTransit > 0) {
        await appendGene(ctx, lot, { type: 'expire' }, {
          warehouse: lot.birth?.warehouse,
          explanation: `Expired on ${exp.toISOString().slice(0, 10)} with ${st.qtyOnHand} on hand and ${st.qtyInTransit} in transit; not sellable`,
        });
        const id = lot._id.toHexString();
        ctx.after.push(() =>
          notifySafe(
            { roles: ['admin', 'warehouse_manager'] },
            { type: 'dna.expired', subject: `Lot ${lot.dnaCode} expired with stock left`, body: `${st.qtyOnHand} units of lot ${lot.dnaCode} expired; dispose or return them.`, link: `/dna/${id}` },
          ),
        );
        return 'expired';
      }
      if (exp.getTime() > now.getTime() && !st.flags.expiryWarned && isAlive(st.status)) {
        const days = Math.round(((exp.getTime() - now.getTime()) / DAY_MS) * 10) / 10;
        await appendGene(ctx, lot, { type: 'expiry_warning' }, {
          warehouse: lot.birth?.warehouse,
          explanation: `Expires in ${days} days (${exp.toISOString().slice(0, 10)}) with ${st.qtyOnHand} on hand`,
        });
        return 'warned';
      }
      return null;
    });
    if (result === 'expired') expired++;
    if (result === 'warned') warned++;
  }
  return { checked: candidates.length, expired, warned };
}

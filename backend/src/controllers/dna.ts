import { Request, Response } from 'express';
import { z } from 'zod';
import { StockLevel, StockLot } from '../models';
import { ApiError } from '../utils/apiError';
import { idStr } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { assertWarehouseScope } from '../middleware/rbac';
import { objectId, pageOf, paging, positiveQty } from '../middleware/validate';
import { DISPOSAL_CAUSES, LOT_STATUSES } from '../engines/dnaEngine';
import * as dna from '../services/dna';
import * as stock from '../services/stockService';
import { afterStockChange } from '../services/inventory';
import { notifySafe } from '../services/notifications';
import { sendFile } from './helpers';

const reason = z.string().trim().min(3, 'give a reason (at least 3 characters)').max(500);
const evidence = z.array(z.string().trim().url('must be a URL').max(500)).max(10).optional().default([]);

export const listLotsQuery = z.object({
  ...paging,
  product: objectId.optional(),
  warehouse: objectId.optional(),
  supplier: objectId.optional(),
  status: z.enum(LOT_STATUSES).optional(),
  alive: z.enum(['true', 'false']).optional(),
  expiringInDays: z.coerce.number().int().min(0).max(3650).optional(),
  recalled: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(80).optional(),
});
export const lookupQuery = z
  .object({
    code: z.string().trim().max(80).optional(),
    sku: z.string().trim().max(80).optional(),
    batchNo: z.string().trim().max(60).optional(),
  })
  .refine((v) => v.code || v.sku, { message: 'give a DNA code, or a SKU with a batch number' });
export const recallTraceQuery = z.object({
  supplier: objectId.optional(),
  product: objectId.optional(),
  batchNo: z.string().trim().max(60).optional(),
});
export const reasonSchema = z.object({ reason });
export const disposeSchema = z.object({
  warehouse: objectId,
  quantity: positiveQty,
  cause: z.enum(DISPOSAL_CAUSES),
  reason,
  evidence,
});
export const returnSchema = z.object({ warehouse: objectId, quantity: positiveQty, reason });
export const damageSchema = z.object({
  warehouse: objectId,
  quantity: positiveQty,
  reason,
  bin: z.string().trim().max(60).optional().nullable(),
  evidence,
});
export const consumeSchema = z.object({ warehouse: objectId, quantity: positiveQty, reason });
export const putAwaySchema = z.object({
  warehouse: objectId,
  fromBin: z.string().trim().max(60).default(''),
  toBin: z.string().trim().min(1).max(60),
  quantity: positiveQty,
});
export const acceptReturnSchema = z.object({
  warehouse: objectId,
  quantity: positiveQty,
  bin: z.string().trim().max(60).optional().nullable(),
  reason,
  customerOrder: objectId.optional(),
});
export const decideSchema = z.object({ note: z.string().trim().max(500).optional().default('') });
export const requestParams = z.object({ id: objectId, requestId: objectId });

async function lotFor(req: Request) {
  const lot = await StockLot.findById(req.params.id);
  if (!lot) throw ApiError.notFound('Lot not found');
  return lot;
}

/** Managers and staff may only act on lots that have been in their own warehouse. */
function assertLotScope(req: Request, lot: { warehouses?: unknown[] }) {
  if (!dna.canWriteLot(currentUser(req), lot))
    throw ApiError.forbidden('You can only act on lots in your own warehouse');
}

async function respond(res: Response, lotId: unknown, genes: stock.GeneRecord[], status = 200) {
  const lot = await StockLot.findById(idStr(lotId))
    .select('-requests')
    .populate('product', 'sku name')
    .lean();
  res.status(status).json({ lot, gene: genes[genes.length - 1] ?? null, genes });
}

export async function listLots(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listLotsQuery>;
  const { page, limit } = pageOf(q, 50);
  res.json(await dna.listLots({ ...q, page, limit }, currentUser(req)));
}

export const getLot = async (req: Request, res: Response) =>
  res.json(await dna.getLot(req.params.id, currentUser(req)));
export const timeline = async (req: Request, res: Response) =>
  res.json(await dna.timeline(req.params.id, currentUser(req)));
export const genealogy = async (req: Request, res: Response) =>
  res.json(await dna.genealogy(req.params.id, currentUser(req)));
export const journey = async (req: Request, res: Response) =>
  res.json(await dna.journey(req.params.id, currentUser(req)));
export const lookup = async (req: Request, res: Response) =>
  res.json(await dna.lookup(req.query as z.infer<typeof lookupQuery>, currentUser(req)));
export const stats = async (req: Request, res: Response) => res.json(await dna.stats(currentUser(req)));

export async function verify(req: Request, res: Response) {
  const user = currentUser(req);
  const r = await dna.verifyLot(req.params.id, user);
  await recordAudit({
    action: 'dna.verify',
    entityType: 'StockLot',
    entityId: req.params.id,
    actor: user,
    after: { ok: r.ok, firstBrokenSeq: r.firstBrokenSeq, eventsChecked: r.eventsChecked },
  });
  res.json(r);
}

export async function recallTrace(req: Request, res: Response) {
  res.json(await dna.recallTrace(req.query as z.infer<typeof recallTraceQuery>));
}

export async function certificate(req: Request, res: Response) {
  const lot = await dna.readableLot(req.params.id, currentUser(req));
  sendFile(
    res,
    await dna.certificatePdf(req.params.id, currentUser(req)),
    `${lot.dnaCode}-certificate.pdf`,
    'application/pdf',
  );
}

export async function reconcile(req: Request, res: Response) {
  const r = await dna.reconcileAll();
  await recordAudit({
    action: 'dna.reconcile',
    entityType: 'StockLot',
    actor: currentUser(req),
    after: { lotsChecked: r.lotsChecked, drift: r.drift.length, orphanSlices: r.orphanSlices },
  });
  res.json(r);
}

export async function runExpiryJob(req: Request, res: Response) {
  const r = await stock.runExpiryJob();
  await recordAudit({ action: 'dna.expiry_job', entityType: 'StockLot', actor: currentUser(req), after: r });
  res.json(r);
}

/** hold / release / reject / recall / recall-clear: one flag gene each. */
function flagAction(
  fn: (ctx: stock.StockCtx, id: unknown, reason: string) => Promise<{ gene: stock.GeneRecord }>,
  scoped: boolean,
) {
  return async (req: Request, res: Response) => {
    const user = currentUser(req);
    const lot = await lotFor(req);
    if (scoped) assertLotScope(req, lot);
    const { genes } = await stock.runStock(user, (ctx) =>
      fn(ctx, lot._id, (req.body as { reason: string }).reason),
    );
    await respond(res, lot._id, genes);
  };
}

export const hold = flagAction(stock.holdLot, true);
export const release = flagAction(stock.releaseLot, true);
export const recall = flagAction(stock.flagRecall, false);
export const clearRecall = flagAction(stock.clearRecall, false);

/** QC reject: the reject gene, then a disposal request (cause rejected_at_qc) per warehouse holding the lot. */
export async function reject(req: Request, res: Response) {
  const user = currentUser(req);
  const lot = await lotFor(req);
  assertLotScope(req, lot);
  const why = (req.body as { reason: string }).reason;
  const { genes } = await stock.runStock(user, async (ctx) => {
    const r = await stock.rejectLot(ctx, lot._id, why);
    const fresh = await stock.loadLot(lot._id, ctx.session);
    const held = await StockLevel.aggregate([
      { $match: { lot: fresh._id, quantity: { $gt: 0 } } },
      { $group: { _id: '$warehouse', qty: { $sum: '$quantity' } } },
    ]).session(ctx.session);
    for (const h of held) {
      fresh.requests.push({
        kind: 'dispose',
        cause: 'rejected_at_qc',
        warehouse: h._id,
        qty: h.qty,
        reason: `Rejected at QC: ${why}`,
        requestedBy: user._id,
      } as never);
    }
    await fresh.save({ session: ctx.session });
    return r;
  });
  await notifyRequest(lot.dnaCode, lot._id, 'dispose', `QC rejected by ${user.name}: ${why}`);
  await respond(res, lot._id, genes);
}

async function notifyRequest(dnaCode: string, lotId: unknown, kind: string, body: string) {
  await notifySafe(
    { roles: ['admin'] },
    {
      type: 'dna.request',
      subject: `${kind === 'dispose' ? 'Disposal' : 'Return to supplier'} awaiting approval: ${dnaCode}`,
      body,
      link: `/dna/${idStr(lotId)}`,
    },
  );
}

/**
 * Disposal and return-to-supplier: an admin's request executes at once (the admin is the approver);
 * a manager's request is stored as pending for an admin to approve.
 */
function requestOrExecute(kind: 'dispose' | 'return_to_supplier') {
  return async (req: Request, res: Response) => {
    const user = currentUser(req);
    const lot = await lotFor(req);
    const b = req.body as z.infer<typeof disposeSchema> & z.infer<typeof returnSchema>;
    assertWarehouseScope(user, b.warehouse);
    assertLotScope(req, lot);
    if (user.role === 'admin') {
      const { genes } = await stock.runStock(
        user,
        (ctx) =>
          kind === 'dispose'
            ? stock.disposeLot(ctx, lot._id, {
                warehouse: b.warehouse,
                quantity: b.quantity,
                cause: b.cause,
                reason: b.reason,
                evidence: b.evidence,
              })
            : stock.returnToSupplier(ctx, lot._id, {
                warehouse: b.warehouse,
                quantity: b.quantity,
                reason: b.reason,
              }),
        user._id,
      );
      await afterStockChange(lot.product, [b.warehouse], { action: kind, quantity: b.quantity });
      return respond(res, lot._id, genes);
    }
    if (
      ['depleted', 'expired_disposed', 'written_off', 'recalled_destroyed', 'returned_to_supplier'].includes(
        lot.status,
      )
    ) {
      throw ApiError.conflict(`Lot ${lot.dnaCode} is dead; its DNA is sealed`);
    }
    lot.requests.push({
      kind,
      cause: kind === 'dispose' ? b.cause : null,
      warehouse: b.warehouse,
      qty: b.quantity,
      reason: b.reason,
      evidence: b.evidence ?? [],
      requestedBy: user._id,
    } as never);
    await lot.save();
    const r = lot.requests[lot.requests.length - 1];
    await recordAudit({
      action: `dna.request.${kind}`,
      entityType: 'StockLot',
      entityId: lot._id,
      actor: user,
      warehouse: b.warehouse,
      after: r,
    });
    await notifyRequest(
      lot.dnaCode,
      lot._id,
      kind,
      `${user.name} asks to ${kind === 'dispose' ? `dispose ${b.quantity} (${b.cause})` : `return ${b.quantity} to the supplier`}: ${b.reason}`,
    );
    res.status(202).json({ lot: await StockLot.findById(lot._id).lean(), request: r, pending: true });
  };
}

export const dispose = requestOrExecute('dispose');
export const returnToSupplier = requestOrExecute('return_to_supplier');

export async function approveRequest(req: Request, res: Response) {
  const user = currentUser(req);
  const lot = await lotFor(req);
  const r = lot.requests.id(req.params.requestId);
  if (!r) throw ApiError.notFound('Request not found');
  if (r.status !== 'pending') throw ApiError.conflict(`The request is already ${r.status}`);
  const note = (req.body as { note?: string }).note ?? '';
  const { genes } = await stock.runStock(
    user,
    async (ctx) => {
      const gene =
        r.kind === 'dispose'
          ? await stock.disposeLot(ctx, lot._id, {
              warehouse: r.warehouse,
              quantity: r.qty,
              cause: r.cause as never,
              reason: `${r.reason} (approved by ${user.name})`,
              evidence: r.evidence,
            })
          : await stock.returnToSupplier(ctx, lot._id, {
              warehouse: r.warehouse,
              quantity: r.qty,
              reason: `${r.reason} (approved by ${user.name})`,
            });
      await StockLot.updateOne(
        { _id: lot._id, 'requests._id': r._id, 'requests.status': 'pending' },
        {
          $set: {
            'requests.$.status': 'approved',
            'requests.$.decidedBy': user._id,
            'requests.$.decidedAt': new Date(),
            'requests.$.decisionNote': note,
          },
        },
        { session: ctx.session },
      );
      return gene;
    },
    user._id,
  );
  await afterStockChange(lot.product, [r.warehouse], { action: r.kind, quantity: r.qty });
  await notifySafe(
    { userIds: [r.requestedBy] },
    {
      type: 'dna.request_decided',
      subject: `Request approved: ${lot.dnaCode}`,
      body: `${user.name} approved your ${r.kind.replace(/_/g, ' ')} request`,
      link: `/dna/${lot._id}`,
    },
  );
  await respond(res, lot._id, genes);
}

export async function rejectRequest(req: Request, res: Response) {
  const user = currentUser(req);
  const lot = await lotFor(req);
  const r = lot.requests.id(req.params.requestId);
  if (!r) throw ApiError.notFound('Request not found');
  if (r.status !== 'pending') throw ApiError.conflict(`The request is already ${r.status}`);
  r.status = 'rejected';
  r.decidedBy = user._id;
  r.decidedAt = new Date();
  r.decisionNote = (req.body as { note?: string }).note ?? '';
  await lot.save();
  await recordAudit({
    action: 'dna.request.reject',
    entityType: 'StockLot',
    entityId: lot._id,
    actor: user,
    warehouse: r.warehouse,
    after: r,
  });
  await notifySafe(
    { userIds: [r.requestedBy] },
    {
      type: 'dna.request_decided',
      subject: `Request rejected: ${lot.dnaCode}`,
      body: `${user.name} rejected your ${r.kind.replace(/_/g, ' ')} request. ${r.decisionNote}`,
      link: `/dna/${lot._id}`,
    },
  );
  res.json({ lot: await StockLot.findById(lot._id).lean(), request: r });
}

export async function damage(req: Request, res: Response) {
  const user = currentUser(req);
  const lot = await lotFor(req);
  const b = req.body as z.infer<typeof damageSchema>;
  assertWarehouseScope(user, b.warehouse);
  const { genes } = await stock.runStock(user, (ctx) => stock.recordDamage(ctx, lot._id, b));
  await afterStockChange(lot.product, [b.warehouse], { action: 'damage', quantity: b.quantity });
  await respond(res, lot._id, genes);
}

export async function consume(req: Request, res: Response) {
  const user = currentUser(req);
  const lot = await lotFor(req);
  const b = req.body as z.infer<typeof consumeSchema>;
  assertWarehouseScope(user, b.warehouse);
  const { genes } = await stock.runStock(user, (ctx) => stock.consume(ctx, lot._id, b));
  await afterStockChange(lot.product, [b.warehouse], { action: 'consume', quantity: b.quantity });
  await respond(res, lot._id, genes);
}

export async function putAway(req: Request, res: Response) {
  const user = currentUser(req);
  const lot = await lotFor(req);
  const b = req.body as z.infer<typeof putAwaySchema>;
  assertWarehouseScope(user, b.warehouse);
  const { genes } = await stock.runStock(user, (ctx) => stock.putAway(ctx, lot._id, b));
  await afterStockChange(lot.product, [b.warehouse], { action: 'put_away', quantity: b.quantity });
  await respond(res, lot._id, genes);
}

export async function acceptReturn(req: Request, res: Response) {
  const user = currentUser(req);
  const lot = await lotFor(req);
  const b = req.body as z.infer<typeof acceptReturnSchema>;
  assertWarehouseScope(user, b.warehouse);
  const { result, genes } = await stock.runStock(user, (ctx) =>
    stock.acceptReturn(ctx, lot._id, {
      warehouse: b.warehouse,
      quantity: b.quantity,
      bin: b.bin,
      reason: b.reason,
      refType: b.customerOrder ? 'customer_order' : null,
      refId: b.customerOrder,
    }),
  );
  await afterStockChange(lot.product, [b.warehouse], { action: 'return_in', quantity: b.quantity });
  const child = await StockLot.findById(result.child._id)
    .select('-requests')
    .populate('product', 'sku name')
    .lean();
  res.status(201).json({ lot: child, parent: lot._id, gene: genes[genes.length - 1] ?? null, genes });
}

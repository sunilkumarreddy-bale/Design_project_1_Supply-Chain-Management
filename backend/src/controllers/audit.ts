import { Request, Response } from 'express';
import { z } from 'zod';
import { AuditLog, User } from '../models';
import { createChainVerifier, ChainEntry } from '../engines/hashChain';
import { objectId, pageOf, paging } from '../middleware/validate';
import { toCsv } from '../utils/csv';
import { escapeRegex, sendFile, sendPage, today } from './helpers';

export const listAuditQuery = z.object({
  ...paging,
  entityType: z.string().trim().max(60).optional(),
  action: z.string().trim().max(80).optional(),
  actor: objectId.optional(),
  entityId: z.string().trim().max(60).optional(),
});

function filterOf(q: z.infer<typeof listAuditQuery>) {
  const f: Record<string, unknown> = {};
  if (q.entityType) f.entityType = q.entityType;
  if (q.action) f.action = new RegExp(`^${escapeRegex(q.action)}`);
  if (q.actor) f.actor = q.actor;
  if (q.entityId) f.entityId = q.entityId;
  return f;
}

async function actorNames(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const users = await User.find({ _id: { $in: unique } }).select('name email role').lean();
  return new Map(users.map((u) => [u._id.toHexString(), { name: u.name, email: u.email, role: u.role }]));
}

export async function listAudit(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listAuditQuery>;
  const { page, limit, skip } = pageOf(q, 25);
  const filter = filterOf(q);
  const [items, total] = await Promise.all([AuditLog.find(filter).sort({ seq: -1 }).skip(skip).limit(limit).lean(), AuditLog.countDocuments(filter)]);
  const names = await actorNames(items.map((i) => i.actor));
  sendPage(res, items.map((i) => ({ ...i, actorInfo: i.actor ? names.get(i.actor) ?? null : null })), total, page, limit);
}

/** Streams the whole chain in seq order through the verifier and reports the first broken entry. */
export async function verifyAudit(_req: Request, res: Response) {
  const v = createChainVerifier();
  const cursor = AuditLog.find().sort({ seq: 1 }).lean().cursor();
  for await (const e of cursor) {
    if (!v.next(e as unknown as ChainEntry)) break;
  }
  await cursor.close();
  res.json({ ...v.result(), verifiedAt: new Date() });
}

export async function exportAuditCsv(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listAuditQuery>;
  const items = await AuditLog.find(filterOf(q)).sort({ seq: 1 }).lean();
  const names = await actorNames(items.map((i) => i.actor));
  const csv = toCsv(
    ['seq', 'createdAt', 'actor', 'actorName', 'action', 'entityType', 'entityId', 'warehouse', 'before', 'after', 'metadata', 'prevHash', 'hash'],
    items.map((i) => [
      i.seq,
      i.createdAt,
      i.actor,
      i.actor ? names.get(i.actor)?.name ?? '' : '',
      i.action,
      i.entityType,
      i.entityId,
      i.warehouse,
      i.before,
      i.after,
      i.metadata,
      i.prevHash,
      i.hash,
    ]),
  );
  sendFile(res, csv, `audit-${today()}.csv`, 'text/csv; charset=utf-8');
}

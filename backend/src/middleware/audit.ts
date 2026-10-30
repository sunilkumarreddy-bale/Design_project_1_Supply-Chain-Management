import { ClientSession } from 'mongoose';
import { AuditLog } from '../models';
import { withTransaction } from '../config/db';
import { nextSequence } from '../models/Counter';
import { computeHash, GENESIS_HASH } from '../engines/hashChain';
import { idStr, snapshot } from '../utils/ids';
import type { AuthUser } from './auth';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: unknown;
  actor?: AuthUser | string | null;
  warehouse?: unknown;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

let tail: Promise<unknown> = Promise.resolve();

/**
 * Appends one hash-chained audit entry (F6). Every entry is written in a transaction that increments the
 * Counter("audit") document, so concurrent writers (in this or another process) are serialised by MongoDB:
 * the next writer only sees the counter after the previous entry has committed, and links to its hash.
 *
 * With a session the entry joins the caller's transaction and commits or rolls back with it (used by the
 * stock service so every Stock DNA gene is anchored atomically). Without one, the entry gets its own
 * transaction; those writes are also queued within this process to avoid needless write conflicts.
 */
export function recordAudit(input: AuditInput, session?: ClientSession) {
  if (session) return write(input, session);
  const run = tail.then(() => withTransaction((s) => write(input, s)));
  tail = run.catch(() => undefined);
  return run;
}

async function write(input: AuditInput, session: ClientSession) {
  const seq = await nextSequence('audit', session);
  const prev = await AuditLog.findOne({ seq: { $lt: seq } })
    .sort({ seq: -1 })
    .select('hash')
    .session(session)
    .lean();
  const prevHash = prev?.hash ?? GENESIS_HASH;
  const actor = input.actor && typeof input.actor === 'object' ? input.actor.id : idStr(input.actor);
  const createdAt = new Date();
  const entry = {
    seq,
    action: input.action,
    entityType: input.entityType,
    entityId: idStr(input.entityId),
    actor: actor ?? null,
    warehouse: idStr(input.warehouse),
    before: snapshot(input.before),
    after: snapshot(input.after),
    metadata: snapshot(input.metadata),
    createdAt,
  };
  const hash = computeHash(prevHash, entry);
  const [doc] = await AuditLog.create([{ ...entry, prevHash, hash }], { session });
  return doc;
}

/** Waits until queued audit writes have finished (used by tests and graceful shutdown). */
export async function auditIdle(): Promise<void> {
  await tail;
}

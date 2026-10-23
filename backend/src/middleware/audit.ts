import { AuditLog } from '../models';
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
 * Appends one hash-chained audit entry (F6). Writes are serialised within this process so each entry
 * links to the previous one; the sequence number comes from the atomic Counter("audit").
 */
export function recordAudit(input: AuditInput) {
  const run = tail.then(() => write(input));
  tail = run.catch(() => undefined);
  return run;
}

async function write(input: AuditInput) {
  const seq = await nextSequence('audit');
  const prev = await AuditLog.findOne({ seq: { $lt: seq } })
    .sort({ seq: -1 })
    .select('hash')
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
  return AuditLog.create({ ...entry, prevHash, hash });
}

/** Waits until queued audit writes have finished (used by tests and graceful shutdown). */
export async function auditIdle(): Promise<void> {
  await tail;
}

/** Tamper-evident audit chain (F6). Pure functions: canonical JSON, SHA-256 hashing and chain verification. */
import { createHash } from 'crypto';

export const GENESIS_HASH = '0'.repeat(64);

/** Deterministic JSON: object keys sorted, undefined dropped, non-finite numbers become null. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return normalize((value as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normalize(v)));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const v = normalize((value as Record<string, unknown>)[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return null;
}

export interface ChainEntry {
  seq: number;
  prevHash: string;
  hash: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  actor?: string | null;
  warehouse?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  createdAt: Date | string;
}

export function hashableOf(e: Omit<ChainEntry, 'hash' | 'prevHash'>): Record<string, unknown> {
  return {
    seq: e.seq,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    actor: e.actor ?? null,
    warehouse: e.warehouse ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    metadata: e.metadata ?? null,
    createdAt: new Date(e.createdAt).toISOString(),
  };
}

export function computeHash(prevHash: string, entry: Omit<ChainEntry, 'hash' | 'prevHash'>): string {
  return createHash('sha256')
    .update(prevHash + '|' + canonicalize(hashableOf(entry)))
    .digest('hex');
}

export type VerifyResult =
  | { valid: true; checked: number; headSeq: number | null; headHash: string | null }
  | { valid: false; checked: number; brokenAtSeq: number; reason: string };

/** Incremental verifier so a long chain can be streamed from the database in seq order. */
export function createChainVerifier() {
  let prev: { seq: number; hash: string } | null = null;
  let checked = 0;
  let failure: VerifyResult | null = null;
  return {
    /** Returns false once the chain is broken; further entries are ignored. */
    next(e: ChainEntry): boolean {
      if (failure) return false;
      const expectedSeq = prev ? prev.seq + 1 : 1;
      let reason: string | null = null;
      if (e.seq !== expectedSeq) {
        reason = `Sequence gap: expected #${expectedSeq} but found #${e.seq} (an entry was deleted or inserted)`;
      } else if (e.prevHash !== (prev ? prev.hash : GENESIS_HASH)) {
        reason = `prevHash does not match the hash of entry #${prev ? prev.seq : 0} (chain was altered)`;
      } else if (computeHash(e.prevHash, e) !== e.hash) {
        reason = 'Entry contents do not match its stored hash (the record was modified)';
      }
      if (reason) {
        failure = { valid: false, checked, brokenAtSeq: e.seq, reason };
        return false;
      }
      checked++;
      prev = { seq: e.seq, hash: e.hash };
      return true;
    },
    result(): VerifyResult {
      return failure ?? { valid: true, checked, headSeq: prev ? prev.seq : null, headHash: prev ? prev.hash : null };
    },
  };
}

/**
 * Verifies entries ordered by seq. Deleting the newest entries cannot be detected here: compare the
 * returned head hash with a copy saved earlier for that.
 */
export function verifyChain(entries: ChainEntry[]): VerifyResult {
  const v = createChainVerifier();
  for (const e of entries) if (!v.next(e)) break;
  return v.result();
}

/**
 * Hash for a chain other than the global audit log. The scope name is hashed together with the payload,
 * so an entry from one chain (for example a Stock DNA gene, scope "dna") can never verify inside another.
 * The audit log keeps computeHash above unchanged so existing entries still verify.
 */
export function scopedHash(scope: string, prevHash: string, payload: unknown): string {
  return createHash('sha256')
    .update(prevHash + '|' + canonicalize({ scope, payload }))
    .digest('hex');
}

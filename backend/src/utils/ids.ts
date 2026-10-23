import { Types } from 'mongoose';
import { ApiError } from './apiError';

export function idStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Types.ObjectId) return v.toHexString();
  if (typeof v === 'object' && v !== null && '_id' in v) return idStr((v as { _id: unknown })._id);
  return String(v);
}

export function sameId(a: unknown, b: unknown): boolean {
  const x = idStr(a);
  const y = idStr(b);
  return x !== null && x === y;
}

export function toObjectId(v: unknown, label = 'id'): Types.ObjectId {
  const s = idStr(v);
  if (!s || !Types.ObjectId.isValid(s)) throw ApiError.badRequest(`Invalid ${label}`);
  return new Types.ObjectId(s);
}

/**
 * Converts a mongoose document or plain object into a JSON-safe snapshot for audit before/after.
 * Documents go through toJSON so schema transforms apply (e.g. users never expose passwordHash).
 */
export function snapshot(doc: unknown): unknown {
  if (doc === null || doc === undefined) return null;
  const obj = typeof (doc as { toJSON?: unknown }).toJSON === 'function' ? (doc as any).toJSON() : doc;
  const plain = JSON.parse(JSON.stringify(obj));
  if (plain && typeof plain === 'object' && 'passwordHash' in plain) delete plain.passwordHash;
  return plain;
}

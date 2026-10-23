import { z } from 'zod';
import { dateLike, nullableNumber, objectId, optionalObjectId, pageOf } from '../../src/middleware/validate';

describe('validation helpers', () => {
  it('nullableNumber keeps null and empty as null instead of coercing them to 0', () => {
    const s = nullableNumber(z.coerce.number().min(0));
    expect(s.parse(null)).toBeNull();
    expect(s.parse('')).toBeNull();
    expect(s.parse('5')).toBe(5);
    expect(s.parse(0)).toBe(0);
    expect(() => s.parse(-1)).toThrow();
    expect(() => s.parse('abc')).toThrow();
  });
  it('validates object ids and optional ids', () => {
    expect(objectId.safeParse('6adb5b9203154f078dbf8c43').success).toBe(true);
    expect(objectId.safeParse('nope').success).toBe(false);
    expect(optionalObjectId.parse('')).toBeNull();
    expect(optionalObjectId.parse(undefined)).toBeNull();
  });
  it('parses dates and rejects invalid ones', () => {
    expect(dateLike.parse('2026-01-02')).toEqual(new Date('2026-01-02'));
    expect(dateLike.parse('')).toBeNull();
    expect(dateLike.safeParse('not a date').success).toBe(false);
  });
  it('computes paging', () => {
    expect(pageOf({ page: 3, limit: 10 })).toEqual({ page: 3, limit: 10, skip: 20 });
    expect(pageOf({}, 25)).toEqual({ page: 1, limit: 25, skip: 0 });
  });
});

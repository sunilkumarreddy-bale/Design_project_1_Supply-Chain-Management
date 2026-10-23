import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { z } from 'zod';
import { signToken, verifyToken } from '../../src/utils/jwt';
import { assertOwnSupplier, assertWarehouseScope, canWriteWarehouse, hasRole, requireRole, scopeToOwnWarehouse } from '../../src/middleware/rbac';
import { errorHandler, notFound } from '../../src/middleware/errorHandler';
import { ApiError } from '../../src/utils/apiError';
import type { AuthUser } from '../../src/middleware/auth';

const user = (role: AuthUser['role'], warehouse: string | null = null, supplier: string | null = null): AuthUser => ({
  _id: new mongoose.Types.ObjectId(),
  id: 'u1',
  name: 'U',
  email: 'u@x',
  role,
  warehouse,
  supplier,
});

function run(mw: (req: any, res: any, next: (e?: unknown) => void) => void, req: any) {
  let err: unknown = 'not-called';
  mw(req, {}, (e?: unknown) => {
    err = e;
  });
  return err;
}

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  return res;
}

describe('JWT', () => {
  it('signs and verifies a token', () => {
    const t = signToken({ sub: 'abc', role: 'admin' });
    expect(verifyToken(t)).toEqual({ sub: 'abc', role: 'admin' });
  });
  it('rejects expired, tampered and foreign tokens', () => {
    expect(() => verifyToken(signToken({ sub: 'abc', role: 'admin' }, '-10s'))).toThrow(/expired/);
    const t = signToken({ sub: 'abc', role: 'admin' });
    expect(() => verifyToken(t.slice(0, -2) + 'xx')).toThrow();
    expect(() => verifyToken(jwt.sign({ sub: 'abc' }, 'another-secret'))).toThrow();
  });
});

describe('RBAC guard', () => {
  it('allows listed roles and denies others with 403', () => {
    const guard = requireRole('admin', 'warehouse_manager');
    expect(run(guard, { user: user('admin') })).toBeUndefined();
    expect(run(guard, { user: user('warehouse_manager') })).toBeUndefined();
    const denied = run(guard, { user: user('staff') }) as ApiError;
    expect(denied.status).toBe(403);
    expect((run(guard, {}) as ApiError).status).toBe(401);
  });
  it('scopes managers and staff to their own warehouse; admin bypasses; suppliers never write stock', () => {
    expect(canWriteWarehouse(user('admin'), 'w2')).toBe(true);
    expect(canWriteWarehouse(user('staff', 'w1'), 'w1')).toBe(true);
    expect(canWriteWarehouse(user('staff', 'w1'), 'w2')).toBe(false);
    expect(canWriteWarehouse(user('supplier'), 'w1')).toBe(false);
    expect(() => assertWarehouseScope(user('warehouse_manager', 'w1'), 'w2')).toThrow(ApiError);
    const mw = scopeToOwnWarehouse();
    expect(run(mw, { user: user('staff', 'w1'), body: { warehouse: 'w1' } })).toBeUndefined();
    expect((run(mw, { user: user('staff', 'w1'), body: { warehouse: 'w9' } }) as ApiError).status).toBe(403);
    expect((run(mw, { body: {} }) as ApiError).status).toBe(401);
  });
  it('limits suppliers to their own records', () => {
    expect(() => assertOwnSupplier(user('supplier', null, 's1'), 's1')).not.toThrow();
    expect(() => assertOwnSupplier(user('supplier', null, 's1'), 's2')).toThrow(/own records/);
    expect(() => assertOwnSupplier(user('admin'), 's2')).not.toThrow();
    expect(hasRole(user('staff'), 'staff', 'admin')).toBe(true);
    expect(hasRole(undefined, 'admin')).toBe(false);
  });
});

describe('error handler', () => {
  const handle = (err: unknown) => {
    const res = mockRes();
    errorHandler(err, {} as any, res, () => undefined);
    return res;
  };
  it('maps known errors to status codes and the error shape', () => {
    expect(handle(ApiError.conflict('dup')).statusCode).toBe(409);
    const zodErr = z.object({ a: z.string() }).safeParse({}).error!;
    const r = handle(zodErr);
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'a' }] });
    expect(handle(new RangeError('Insufficient stock')).body.error).toEqual({ message: 'Insufficient stock', code: 'BAD_REQUEST' });
    expect(handle({ code: 11000, keyValue: { sku: 'X' } }).body.error).toEqual({ message: 'Already exists: sku=X', code: 'DUPLICATE' });
    expect(handle({ type: 'entity.too.large' }).statusCode).toBe(413);
    expect(handle({ type: 'entity.parse.failed' }).statusCode).toBe(400);
    expect(handle(new mongoose.Error.CastError('ObjectId', 'x', '_id')).statusCode).toBe(400);
    const ve = new mongoose.Error.ValidationError();
    ve.addError('qty', new mongoose.Error.ValidatorError({ message: 'qty bad', path: 'qty' }));
    expect(handle(ve).body.error.message).toBe('qty bad');
    expect(handle(new Error('boom'))).toMatchObject({ statusCode: 500, body: { error: { message: 'Something went wrong' } } });
  });
  it('returns 404 for unknown routes', () => {
    let e: ApiError | undefined;
    notFound({ method: 'GET', originalUrl: '/x' } as any, {} as any, (x?: unknown) => (e = x as ApiError));
    expect(e!.status).toBe(404);
  });
});

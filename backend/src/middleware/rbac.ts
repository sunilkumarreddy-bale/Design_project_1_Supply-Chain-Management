import { NextFunction, Request, Response } from 'express';
import { Role } from '../models';
import { ApiError } from '../utils/apiError';
import { idStr } from '../utils/ids';
import type { AuthUser } from './auth';

export const ALL_ROLES: Role[] = ['admin', 'warehouse_manager', 'staff', 'supplier'];
export const INTERNAL_ROLES: Role[] = ['admin', 'warehouse_manager', 'staff'];
export const MANAGERS: Role[] = ['admin', 'warehouse_manager'];

export function hasRole(user: AuthUser | undefined, ...roles: Role[]): boolean {
  return !!user && roles.includes(user.role);
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`This action requires one of the roles: ${roles.join(', ')}`));
    }
    next();
  };
}

/** True when the user's writes are limited to their own warehouse (managers and staff). */
export function isWarehouseScoped(user: AuthUser): boolean {
  return user.role === 'warehouse_manager' || user.role === 'staff';
}

export function canWriteWarehouse(user: AuthUser, warehouseId: unknown): boolean {
  if (user.role === 'admin') return true;
  if (!isWarehouseScoped(user)) return false;
  return !!user.warehouse && user.warehouse === idStr(warehouseId);
}

/** Throws 403 unless an admin, or a manager/staff member writing to their own warehouse. */
export function assertWarehouseScope(user: AuthUser, warehouseId: unknown, what = 'this warehouse'): void {
  if (!canWriteWarehouse(user, warehouseId)) {
    throw ApiError.forbidden(`You can only change stock for your own warehouse (not ${what})`);
  }
}

/**
 * Middleware form: reads the warehouse id from the request (body field by default) and enforces scoping.
 */
export function scopeToOwnWarehouse(pick: (req: Request) => unknown = (req) => req.body?.warehouse) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw ApiError.unauthorized();
      assertWarehouseScope(req.user, pick(req));
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Suppliers may only touch records that belong to their own supplier. */
export function assertOwnSupplier(user: AuthUser, supplierId: unknown): void {
  if (user.role !== 'supplier') return;
  if (!user.supplier || user.supplier !== idStr(supplierId)) {
    throw ApiError.forbidden('Suppliers can only access their own records');
  }
}

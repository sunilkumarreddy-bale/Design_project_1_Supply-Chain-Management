import { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { Role, User } from '../models';
import { ApiError } from '../utils/apiError';
import { verifyToken } from '../utils/jwt';

export interface AuthUser {
  _id: Types.ObjectId;
  id: string;
  name: string;
  email: string;
  role: Role;
  warehouse: string | null;
  supplier: string | null;
}

export async function loadAuthUser(token: string): Promise<AuthUser> {
  let payload;
  try {
    payload = verifyToken(token);
  } catch (e) {
    const expired = (e as Error).name === 'TokenExpiredError';
    throw ApiError.unauthorized(expired ? 'Session expired, please sign in again' : 'Invalid token');
  }
  if (!Types.ObjectId.isValid(payload.sub)) throw ApiError.unauthorized('Invalid token');
  const user = await User.findById(payload.sub).lean();
  if (!user) throw ApiError.unauthorized('User no longer exists');
  if (!user.isActive) throw ApiError.unauthorized('Account is deactivated');
  return {
    _id: user._id,
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    role: user.role as Role,
    warehouse: user.warehouse ? user.warehouse.toHexString() : null,
    supplier: user.supplier ? user.supplier.toHexString() : null,
  };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw ApiError.unauthorized();
    req.user = await loadAuthUser(token);
    next();
  } catch (e) {
    next(e);
  }
}

/** Returns the signed-in user or throws 401 (for use inside handlers after requireAuth). */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

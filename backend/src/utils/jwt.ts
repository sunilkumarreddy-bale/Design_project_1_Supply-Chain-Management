import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  sub: string;
  role: string;
}

export function signToken(payload: JwtPayload, expiresIn: string = env.jwtExpiresIn): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn } as SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (typeof decoded === 'string' || !decoded.sub) throw new Error('Invalid token payload');
  return { sub: String(decoded.sub), role: String((decoded as Record<string, unknown>).role) };
}

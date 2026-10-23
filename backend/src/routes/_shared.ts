import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

/** Stricter limit for login and registration (brute-force protection). */
export const authLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: Math.max(20, Math.floor(env.rateLimitMax / 10)),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts, please try again later', code: 'RATE_LIMITED' } },
});

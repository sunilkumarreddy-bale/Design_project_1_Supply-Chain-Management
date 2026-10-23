import { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ApiError } from '../utils/apiError';
import { env } from '../config/env';

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let message = 'Something went wrong';
  let code = 'INTERNAL_ERROR';
  let details: unknown;

  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
    code = err.code;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    message = err.issues.map((i) => `${i.path.join('.') || 'body'} ${i.message}`).join('; ');
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join('; ');
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'BAD_REQUEST';
    message = `Invalid value for ${err.path}`;
  } else if (err instanceof RangeError) {
    status = 400;
    code = 'BAD_REQUEST';
    message = err.message;
  } else if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    const keyValue = (err as { keyValue?: Record<string, unknown> }).keyValue ?? {};
    message = `Already exists: ${Object.entries(keyValue)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`;
  } else if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  } else if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'Malformed JSON body';
  } else if (typeof err === 'object' && err && (err as { name?: string }).name === 'MulterError') {
    status = 400;
    code = 'UPLOAD_ERROR';
    message = (err as Error).message;
  }

  if (status >= 500 && !env.isTest) console.error(err);
  const body: { error: { message: string; code: string; details?: unknown } } = { error: { message, code } };
  if (details !== undefined) body.error.details = details;
  res.status(status).json(body);
}

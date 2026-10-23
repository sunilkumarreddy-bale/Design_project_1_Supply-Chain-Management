import { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { z, ZodTypeAny } from 'zod';

export const objectId = z
  .string({ required_error: 'is required' })
  .refine((v) => Types.ObjectId.isValid(v) && /^[0-9a-fA-F]{24}$/.test(v), { message: 'must be a valid id' });

export const optionalObjectId = z.union([objectId, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));

/** Accepts ISO date strings or Date objects; empty becomes null. */
export const dateLike = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === null || v === '') return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a valid date' });
      return z.NEVER;
    }
    return d;
  });

export const positiveQty = z.coerce.number({ invalid_type_error: 'must be a number' }).positive('must be greater than 0');
export const nonNegative = z.coerce.number({ invalid_type_error: 'must be a number' }).min(0, 'must be 0 or more');

export const paging = {
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
};

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** Validates and replaces req.body / req.query / req.params with the parsed values. */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const idParam = { params: z.object({ id: objectId }) };

export function pageOf(query: { page?: number; limit?: number }, defaultLimit = 50) {
  const page = query.page ?? 1;
  const limit = query.limit ?? defaultLimit;
  return { page, limit, skip: (page - 1) * limit };
}

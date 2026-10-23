import { Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../utils/apiError';
import { currentUser } from '../middleware/auth';
import { canWriteWarehouse } from '../middleware/rbac';
import { objectId, positiveQty } from '../middleware/validate';
import { buildInsights, rebalanceSuggestions } from '../services/planning';
import { instantTransfer } from '../services/inventory';
import { requestTrackedTransfer } from '../services/transfers';

export const insightsQuery = z.object({ warehouse: objectId.optional() });
export const rebalanceQuery = z.object({ product: objectId.optional() });
export const executeRebalanceSchema = z
  .object({ product: objectId, from: objectId, to: objectId, quantity: positiveQty })
  .refine((v) => v.from !== v.to, { message: 'must differ from the source', path: ['to'] });

export async function insights(req: Request, res: Response) {
  res.json(await buildInsights((req.query as z.infer<typeof insightsQuery>).warehouse ?? null));
}

export async function rebalance(req: Request, res: Response) {
  const items = await rebalanceSuggestions((req.query as z.infer<typeof rebalanceQuery>).product);
  res.json({ items, total: items.length });
}

/**
 * Executes one rebalance suggestion. Admins and the source warehouse's manager move stock instantly;
 * the destination's manager can only request it, which creates a tracked transfer for approval.
 */
export async function executeRebalance(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof executeRebalanceSchema>;
  const input = { product: b.product, fromWarehouse: b.from, toWarehouse: b.to, quantity: b.quantity, source: 'rebalance' as const, notes: 'Rebalance before you buy' };
  if (canWriteWarehouse(user, b.from)) {
    const transfer = await instantTransfer(input, user);
    return res.status(201).json({ mode: 'instant', transfer });
  }
  if (canWriteWarehouse(user, b.to)) {
    const transfer = await requestTrackedTransfer(input, user);
    return res.status(201).json({ mode: 'tracked', transfer });
  }
  throw ApiError.forbidden('You can only move stock into or out of your own warehouse');
}

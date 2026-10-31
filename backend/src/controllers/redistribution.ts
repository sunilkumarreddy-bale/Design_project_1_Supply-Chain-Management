import { Request, Response } from 'express';
import { z } from 'zod';
import { RedistributionPlan, REDISTRIBUTION_STATUSES, StockLot, Transfer } from '../models';
import { ApiError } from '../utils/apiError';
import { currentUser } from '../middleware/auth';
import { objectId, pageOf, paging, nullableNumber } from '../middleware/validate';
import * as svc from '../services/redistribution';
import { sendPage } from './helpers';

const margin = nullableNumber(z.coerce.number().min(0, 'must be 0 or more')).optional().transform((v) => v ?? null);

export const analyzeSchema = z.object({ stockLevelId: objectId, minShelfLifeDays: margin });
export const listPlansQuery = z.object({ ...paging, status: z.enum(REDISTRIBUTION_STATUSES).optional() });
export const rejectSchema = z.object({ reason: z.string().trim().min(1, 'is required').max(500) });

export async function scan(_req: Request, res: Response) {
  const items = await svc.scan();
  res.json({ items, total: items.length, scannedAt: new Date() });
}

export async function analyze(req: Request, res: Response) {
  const b = req.body as z.infer<typeof analyzeSchema>;
  res.json(await svc.analyzeBatch(b.stockLevelId, b.minShelfLifeDays));
}

export async function proposePlan(req: Request, res: Response) {
  const b = req.body as z.infer<typeof analyzeSchema>;
  res.status(201).json(await svc.proposePlan(b.stockLevelId, b.minShelfLifeDays, currentUser(req)));
}

export async function listPlans(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listPlansQuery>;
  const { page, limit, skip } = pageOf(q, 50);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  const [items, total] = await Promise.all([
    RedistributionPlan.find(filter)
      .populate('product', 'sku name')
      .populate('sourceWarehouse', 'code name')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RedistributionPlan.countDocuments(filter),
  ]);
  sendPage(res, items.map((p) => ({ ...p, timeline: undefined })), total, page, limit);
}

export async function getPlan(req: Request, res: Response) {
  const plan = await RedistributionPlan.findById(req.params.id)
    .populate('product', 'sku name unit')
    .populate('sourceWarehouse', 'code name')
    .populate('lines.toWarehouse', 'code name')
    .populate('createdBy', 'name')
    .populate('approvedBy', 'name')
    .populate('timeline.by', 'name')
    .lean();
  if (!plan) throw ApiError.notFound('Redistribution plan not found');
  const transfers = await Transfer.find({ _id: { $in: plan.lines.map((l) => l.transfer).filter(Boolean) } })
    .populate('toWarehouse', 'code name')
    .lean();
  const lots = await StockLot.find({ product: (plan.product as unknown as { _id: unknown })._id, batchNo: plan.batchNo }).select('dnaCode status').sort({ createdAt: 1 }).lean();
  res.json({ ...plan, transfers, dnaLots: lots, dnaCodes: lots.map((l) => l.dnaCode) });
}

export async function approvePlan(req: Request, res: Response) {
  res.json(await svc.approvePlan(req.params.id, currentUser(req)));
}

export async function rejectPlan(req: Request, res: Response) {
  res.json(await svc.rejectPlan(req.params.id, (req.body as z.infer<typeof rejectSchema>).reason, currentUser(req)));
}

export async function cancelPlan(req: Request, res: Response) {
  res.json(await svc.cancelPlan(req.params.id, currentUser(req)));
}

import { Request, Response } from 'express';
import { z } from 'zod';
import { PurchaseOrder, RecoveryPlan, RECOVERY_STATUSES, Transfer } from '../models';
import { ApiError } from '../utils/apiError';
import { currentUser } from '../middleware/auth';
import { objectId, pageOf, paging, nullableNumber } from '../middleware/validate';
import * as svc from '../services/recovery';
import { sendPage } from './helpers';

const optionalPositive = nullableNumber(z.coerce.number().positive('must be greater than 0')).optional().transform((v) => v ?? null);

export const analysisInputSchema = z.object({
  product: objectId,
  warehouse: objectId,
  horizonDays: optionalPositive,
  requiredUnits: optionalPositive,
  excludeSupplier: z.union([objectId, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  trigger: z
    .object({
      kind: z.enum(['supplier_delay', 'shortage_alert', 'manual']),
      supplier: z.union([objectId, z.null()]).optional(),
      delayDays: nullableNumber().optional(),
    })
    .nullable()
    .optional(),
});

export const proposeSchema = z.object({ analysisInput: analysisInputSchema, selectedOptionId: z.string().min(1, 'is required') });
export const listPlansQuery = z.object({ ...paging, status: z.enum(RECOVERY_STATUSES).optional() });
export const rejectSchema = z.object({ reason: z.string().trim().min(1, 'is required').max(500) });

export async function analyzeRecovery(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof analysisInputSchema>;
  if (user.role === 'warehouse_manager' && user.warehouse !== b.warehouse) {
    throw ApiError.forbidden('Managers can only analyze recovery for their own warehouse');
  }
  res.json(await svc.analyze(b));
}

export async function proposePlan(req: Request, res: Response) {
  const b = req.body as z.infer<typeof proposeSchema>;
  const plan = await svc.proposePlan(b.analysisInput, b.selectedOptionId, currentUser(req));
  res.status(201).json(plan);
}

export async function listPlans(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listPlansQuery>;
  const { page, limit, skip } = pageOf(q, 50);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  const [items, total] = await Promise.all([
    RecoveryPlan.find(filter)
      .populate('product', 'sku name')
      .populate('targetWarehouse', 'code name')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RecoveryPlan.countDocuments(filter),
  ]);
  sendPage(
    res,
    items.map((p) => {
      const opt = p.options.find((o) => o.optionId === p.selectedOptionId);
      return { ...p, selectedOption: opt ?? null, options: undefined, timeline: undefined };
    }),
    total,
    page,
    limit,
  );
}

export async function getPlan(req: Request, res: Response) {
  const plan = await RecoveryPlan.findById(req.params.id)
    .populate('product', 'sku name unit')
    .populate('targetWarehouse', 'code name')
    .populate('trigger.supplier', 'name')
    .populate('createdBy', 'name')
    .populate('approvedBy', 'name')
    .populate('timeline.by', 'name')
    .lean();
  if (!plan) throw ApiError.notFound('Recovery plan not found');
  const poIds = plan.execution?.purchaseOrders?.length ? plan.execution.purchaseOrders : plan.execution?.purchaseOrder ? [plan.execution.purchaseOrder] : [];
  const [transfers, purchaseOrders] = await Promise.all([
    Transfer.find({ _id: { $in: plan.execution?.transfers ?? [] } })
      .populate('fromWarehouse', 'code name')
      .populate('toWarehouse', 'code name')
      .lean(),
    PurchaseOrder.find({ _id: { $in: poIds } }).populate('supplier', 'name').lean(),
  ]);
  res.json({ ...plan, selectedOption: plan.options.find((o) => o.optionId === plan.selectedOptionId) ?? null, transfers, purchaseOrders });
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

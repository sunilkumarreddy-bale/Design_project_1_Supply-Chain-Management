import { Request, Response } from 'express';
import { z } from 'zod';
import { PO_STATUSES, PurchaseOrder } from '../models';
import { ApiError } from '../utils/apiError';
import { currentUser } from '../middleware/auth';
import { assertOwnSupplier } from '../middleware/rbac';
import { dateLike, objectId, pageOf, paging, positiveQty } from '../middleware/validate';
import * as svc from '../services/purchaseOrders';
import { sendPage } from './helpers';

export const listPOQuery = z.object({
  ...paging,
  status: z.union([z.enum(PO_STATUSES), z.string().regex(/^[a-z_,]+$/)]).optional(),
  supplier: objectId.optional(),
  warehouse: objectId.optional(),
  source: z.enum(['manual', 'auto_reorder', 'recovery_plan']).optional(),
});

export const createPOSchema = z.object({
  supplier: objectId,
  warehouse: objectId,
  items: z
    .array(z.object({ product: objectId, quantityOrdered: positiveQty, unitCost: z.coerce.number().min(0).optional().nullable() }))
    .min(1, 'add at least one line'),
  expectedDeliveryDate: dateLike,
  notes: z.string().max(1000).default(''),
  draft: z.boolean().default(false),
});

export const autoDraftSchema = z.object({ warehouse: objectId });
export const rejectSchema = z.object({ reason: z.string().trim().min(1, 'is required').max(500) });
export const confirmSchema = z.object({
  confirmedQty: z.coerce.number().min(0, 'must be 0 or more'),
  confirmedDate: dateLike.refine((d) => d !== null, 'is required'),
});
export const dispatchSchema = z.object({
  carrier: z.string().trim().min(1, 'is required').max(100),
  trackingNo: z.string().trim().max(100).default(''),
  eta: dateLike,
});
export const receiveSchema = z.object({
  receivedItems: z
    .array(
      z.object({
        product: objectId,
        quantityReceived: z.coerce.number().min(0, 'must be 0 or more'),
        batchNo: z.string().trim().max(60).optional().nullable(),
        expiryDate: dateLike,
        bin: z.string().trim().max(60).optional().nullable(),
      }),
    )
    .min(1, 'add at least one line'),
  logDiscrepancy: z.boolean().default(false),
  notes: z.string().max(1000).optional(),
});

const populate = (q: any) =>
  q
    .populate('supplier', 'name email phone status')
    .populate('warehouse', 'code name')
    .populate('items.product', 'sku name unit isPerishable')
    .populate('createdBy', 'name')
    .populate('approvedBy', 'name')
    .populate('receivedBy', 'name')
    .populate('recoveryPlan', 'planNo status');

export async function listPOs(req: Request, res: Response) {
  const user = currentUser(req);
  const q = req.query as unknown as z.infer<typeof listPOQuery>;
  const { page, limit, skip } = pageOf(q, 50);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status.includes(',') ? { $in: q.status.split(',') } : q.status;
  if (q.warehouse) filter.warehouse = q.warehouse;
  if (q.source) filter.source = q.source;
  if (user.role === 'supplier') {
    filter.supplier = user.supplier;
    // suppliers never see internal drafts or POs still awaiting internal approval
    filter.status = filter.status ?? { $nin: ['draft', 'pending_approval', 'rejected'] };
  } else if (q.supplier) filter.supplier = q.supplier;
  const [items, total] = await Promise.all([
    populate(PurchaseOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)),
    PurchaseOrder.countDocuments(filter),
  ]);
  sendPage(res, items.map((p: any) => p.toJSON()), total, page, limit);
}

export async function getPO(req: Request, res: Response) {
  const user = currentUser(req);
  const po = await populate(PurchaseOrder.findById(req.params.id));
  if (!po) throw ApiError.notFound('Purchase order not found');
  if (user.role === 'supplier') {
    assertOwnSupplier(user, po.supplier);
    if (['draft', 'pending_approval', 'rejected'].includes(po.status)) throw ApiError.notFound('Purchase order not found');
  }
  res.json(po.toJSON());
}

const reload = async (id: unknown) => (await populate(PurchaseOrder.findById(id))).toJSON();

export async function createPO(req: Request, res: Response) {
  const po = await svc.createManualPO(req.body, currentUser(req));
  res.status(201).json(await reload(po._id));
}

export async function submitPO(req: Request, res: Response) {
  const po = await svc.submitDraftPO(req.params.id, currentUser(req));
  res.json(await reload(po._id));
}

export async function autoDraftPOs(req: Request, res: Response) {
  res.json(await svc.autoDraft((req.body as z.infer<typeof autoDraftSchema>).warehouse, currentUser(req)));
}

export async function approvePO(req: Request, res: Response) {
  const po = await svc.approvePO(req.params.id, currentUser(req));
  res.json(await reload(po._id));
}

export async function rejectPO(req: Request, res: Response) {
  const po = await svc.rejectPO(req.params.id, (req.body as z.infer<typeof rejectSchema>).reason, currentUser(req));
  res.json(await reload(po._id));
}

export async function confirmPO(req: Request, res: Response) {
  const b = req.body as z.infer<typeof confirmSchema>;
  const po = await svc.confirmPO(req.params.id, { confirmedQty: b.confirmedQty, confirmedDate: b.confirmedDate! }, currentUser(req));
  res.json(await reload(po._id));
}

export async function dispatchPO(req: Request, res: Response) {
  const po = await svc.dispatchPO(req.params.id, req.body, currentUser(req));
  res.json(await reload(po._id));
}

export async function receivePO(req: Request, res: Response) {
  const r = await svc.receivePO(req.params.id, req.body, currentUser(req));
  res.json({ ...r, purchaseOrder: await reload(r.purchaseOrder._id) });
}

export async function cancelPO(req: Request, res: Response) {
  const po = await svc.cancelPO(req.params.id, currentUser(req));
  res.json(await reload(po._id));
}

export async function payPO(req: Request, res: Response) {
  const po = await svc.payPO(req.params.id, currentUser(req));
  res.json(await reload(po._id));
}

import { Request, Response } from 'express';
import { z } from 'zod';
import { Discrepancy } from '../models';
import { ApiError } from '../utils/apiError';
import { snapshot } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { assertWarehouseScope } from '../middleware/rbac';
import { nonNegative, objectId, optionalObjectId, pageOf, paging } from '../middleware/validate';
import { uploadFile } from '../integrations/storage';
import { raiseAlert, resolveAlerts } from '../services/alerts';
import { sendPage } from './helpers';

export const listDiscrepanciesQuery = z.object({
  ...paging,
  status: z.enum(['open', 'resolved']).optional(),
  warehouse: objectId.optional(),
  purchaseOrder: objectId.optional(),
});
export const createDiscrepancySchema = z.object({
  type: z.enum(['receipt_mismatch', 'count_variance', 'damage', 'other']),
  purchaseOrder: optionalObjectId,
  product: optionalObjectId,
  warehouse: objectId,
  expectedQty: nonNegative.default(0),
  actualQty: nonNegative.default(0),
  notes: z.string().max(1000).default(''),
});
export const updateDiscrepancySchema = z.object({
  status: z.enum(['open', 'resolved']).optional(),
  resolution: z.string().max(1000).optional(),
  notes: z.string().max(1000).optional(),
});

const populate = (q: any) =>
  q
    .populate('product', 'sku name')
    .populate('warehouse', 'code name')
    .populate('purchaseOrder', 'poNumber')
    .populate('createdBy', 'name')
    .populate('resolvedBy', 'name');

export async function listDiscrepancies(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listDiscrepanciesQuery>;
  const { page, limit, skip } = pageOf(q, 50);
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.warehouse) filter.warehouse = q.warehouse;
  if (q.purchaseOrder) filter.purchaseOrder = q.purchaseOrder;
  const [items, total] = await Promise.all([
    populate(Discrepancy.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)).lean(),
    Discrepancy.countDocuments(filter),
  ]);
  sendPage(res, items, total, page, limit);
}

export async function createDiscrepancy(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof createDiscrepancySchema>;
  assertWarehouseScope(user, b.warehouse);
  const d = await Discrepancy.create({ ...b, createdBy: user._id });
  await recordAudit({ action: 'discrepancy.create', entityType: 'Discrepancy', entityId: d._id, actor: user, warehouse: d.warehouse, after: d });
  await raiseAlert({
    type: 'discrepancy',
    severity: 'warning',
    product: d.product,
    warehouse: d.warehouse,
    purchaseOrder: d.purchaseOrder,
    key: d._id.toHexString(),
    message: `${d.type.replace(/_/g, ' ')}: expected ${d.expectedQty}, actual ${d.actualQty}${d.notes ? ` (${d.notes})` : ''}`,
  });
  res.status(201).json(await populate(Discrepancy.findById(d._id)).lean());
}

export async function updateDiscrepancy(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof updateDiscrepancySchema>;
  const d = await Discrepancy.findById(req.params.id);
  if (!d) throw ApiError.notFound('Discrepancy not found');
  assertWarehouseScope(user, d.warehouse);
  const before = snapshot(d);
  if (b.notes !== undefined) d.notes = b.notes;
  if (b.resolution !== undefined) d.resolution = b.resolution;
  if (b.status === 'resolved' && d.status !== 'resolved') {
    if (!d.resolution) throw ApiError.badRequest('Describe the resolution before resolving');
    d.status = 'resolved';
    d.resolvedBy = user._id;
    d.resolvedAt = new Date();
  } else if (b.status === 'open') {
    d.status = 'open';
    d.resolvedBy = null;
    d.resolvedAt = null;
  }
  await d.save();
  await recordAudit({ action: 'discrepancy.update', entityType: 'Discrepancy', entityId: d._id, actor: user, warehouse: d.warehouse, before, after: d });
  if (d.status === 'resolved') await resolveAlerts({ type: 'discrepancy', key: d._id.toHexString() }, user._id);
  res.json(await populate(Discrepancy.findById(d._id)).lean());
}

export async function uploadEvidence(req: Request, res: Response) {
  const user = currentUser(req);
  const file = req.file;
  if (!file) throw ApiError.badRequest('Attach a file in the "file" field');
  if (!/^(image\/|application\/pdf)/.test(file.mimetype)) throw ApiError.badRequest('Evidence must be an image or a PDF');
  const d = await Discrepancy.findById(req.params.id);
  if (!d) throw ApiError.notFound('Discrepancy not found');
  assertWarehouseScope(user, d.warehouse);
  const before = snapshot(d);
  const up = await uploadFile({ buffer: file.buffer, filename: file.originalname, mimeType: file.mimetype, folder: 'evidence', kind: 'attachment' });
  d.evidence.push(up.url);
  await d.save();
  await recordAudit({ action: 'discrepancy.evidence', entityType: 'Discrepancy', entityId: d._id, actor: user, warehouse: d.warehouse, before, after: d, metadata: { driver: up.driver } });
  res.json(await populate(Discrepancy.findById(d._id)).lean());
}

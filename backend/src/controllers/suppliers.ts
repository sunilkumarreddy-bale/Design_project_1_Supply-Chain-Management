import { Request, Response } from 'express';
import { z } from 'zod';
import { Supplier, SupplierOffer, User } from '../models';
import { ApiError } from '../utils/apiError';
import { snapshot } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { assertOwnSupplier } from '../middleware/rbac';
import { dateLike, objectId, optionalObjectId } from '../middleware/validate';
import * as svc from '../services/suppliers';
import { withStats } from '../services/suppliers';

const location = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).nullable();

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1, 'is required'),
  contactName: z.string().trim().default(''),
  email: z.union([z.string().trim().email('must be a valid email'), z.literal('')]).default(''),
  phone: z.string().trim().default(''),
  address: z.string().trim().default(''),
  location: location.optional(),
  leadTimeDays: z.coerce.number().min(0, 'must be 0 or more').default(7),
});

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
  isActive: z.boolean().optional(),
});

export const disruptionSchema = z.object({
  expectedDays: z.coerce.number().int().min(1, 'must be at least 1 day').max(365),
  reason: z.string().trim().max(300).default(''),
});

export async function listSuppliers(req: Request, res: Response) {
  const user = currentUser(req);
  const filter = user.role === 'supplier' ? { _id: user.supplier } : {};
  const items = await Supplier.find(filter).sort({ name: 1 }).lean();
  res.json({ items: items.map(withStats), total: items.length, page: 1, limit: items.length });
}

export async function getSupplier(req: Request, res: Response) {
  const user = currentUser(req);
  assertOwnSupplier(user, req.params.id);
  const s = await Supplier.findById(req.params.id).lean();
  if (!s) throw ApiError.notFound('Supplier not found');
  const offers = await SupplierOffer.find({ supplier: s._id }).populate('product', 'sku name unit').lean();
  res.json({ ...withStats(s), offers });
}

/** Admins register suppliers; a supplier user without a linked record creates its own and is linked to it. */
export async function createSupplier(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof createSupplierSchema>;
  if (user.role === 'supplier' && user.supplier) throw ApiError.conflict('Your account is already linked to a supplier record');
  const s = await Supplier.create({ ...b, location: b.location ?? null });
  if (user.role === 'supplier') await User.updateOne({ _id: user._id }, { supplier: s._id });
  await recordAudit({ action: 'supplier.create', entityType: 'Supplier', entityId: s._id, actor: user, after: s });
  res.status(201).json(withStats(s));
}

export async function updateSupplier(req: Request, res: Response) {
  const b = req.body as z.infer<typeof updateSupplierSchema>;
  const s = await Supplier.findById(req.params.id);
  if (!s) throw ApiError.notFound('Supplier not found');
  const before = snapshot(s);
  Object.assign(s, b);
  if (b.status === 'inactive') s.isActive = false;
  if (b.status === 'active') {
    s.isActive = true;
    s.disruption = null;
  }
  await s.save();
  await recordAudit({ action: 'supplier.update', entityType: 'Supplier', entityId: s._id, actor: currentUser(req), before, after: s });
  res.json(withStats(s));
}

export async function declareDisruption(req: Request, res: Response) {
  const s = await svc.declareDisruption(req.params.id, req.body as z.infer<typeof disruptionSchema>, currentUser(req));
  res.json(withStats(s));
}

export async function clearDisruption(req: Request, res: Response) {
  const s = await svc.clearDisruption(req.params.id, currentUser(req));
  res.json(withStats(s));
}

/* ------------------------------------------------------------ offers */

export const listOffersQuery = z.object({ supplier: objectId.optional(), product: objectId.optional() });

export const createOfferSchema = z.object({
  supplier: optionalObjectId,
  product: objectId,
  capacityUnits: z.coerce.number().min(0, 'must be 0 or more'),
  minOrderQty: z.coerce.number().min(0).default(1),
  leadTimeDays: z.coerce.number().min(0, 'must be 0 or more'),
  unitCost: z.coerce.number().min(0, 'must be 0 or more'),
  validUntil: dateLike,
  isActive: z.boolean().default(true),
});

export const updateOfferSchema = createOfferSchema.omit({ supplier: true, product: true }).partial();

export async function listOffers(req: Request, res: Response) {
  const user = currentUser(req);
  const q = req.query as z.infer<typeof listOffersQuery>;
  const filter: Record<string, unknown> = {};
  if (q.product) filter.product = q.product;
  if (user.role === 'supplier') filter.supplier = user.supplier;
  else if (q.supplier) filter.supplier = q.supplier;
  const items = await SupplierOffer.find(filter).populate('supplier', 'name status').populate('product', 'sku name unit').sort({ createdAt: -1 }).lean();
  res.json({ items, total: items.length, page: 1, limit: items.length });
}

export async function createOffer(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof createOfferSchema>;
  const supplierId = user.role === 'supplier' ? user.supplier : b.supplier;
  if (!supplierId) throw ApiError.badRequest('supplier is required');
  if (!(await Supplier.exists({ _id: supplierId }))) throw ApiError.badRequest('Supplier not found');
  if (b.capacityUnits < b.minOrderQty) throw ApiError.badRequest('Capacity must be at least the minimum order quantity');
  const offer = await SupplierOffer.create({ ...b, supplier: supplierId });
  await recordAudit({ action: 'supplier_offer.create', entityType: 'SupplierOffer', entityId: offer._id, actor: user, after: offer });
  res.status(201).json(await SupplierOffer.findById(offer._id).populate('supplier', 'name status').populate('product', 'sku name unit').lean());
}

export async function updateOffer(req: Request, res: Response) {
  const user = currentUser(req);
  const offer = await SupplierOffer.findById(req.params.id);
  if (!offer) throw ApiError.notFound('Offer not found');
  assertOwnSupplier(user, offer.supplier);
  const before = snapshot(offer);
  Object.assign(offer, req.body);
  if (offer.capacityUnits < offer.minOrderQty) throw ApiError.badRequest('Capacity must be at least the minimum order quantity');
  await offer.save();
  await recordAudit({ action: 'supplier_offer.update', entityType: 'SupplierOffer', entityId: offer._id, actor: user, before, after: offer });
  res.json(await SupplierOffer.findById(offer._id).populate('supplier', 'name status').populate('product', 'sku name unit').lean());
}

export async function deleteOffer(req: Request, res: Response) {
  const user = currentUser(req);
  const offer = await SupplierOffer.findById(req.params.id);
  if (!offer) throw ApiError.notFound('Offer not found');
  assertOwnSupplier(user, offer.supplier);
  await offer.deleteOne();
  await recordAudit({ action: 'supplier_offer.delete', entityType: 'SupplierOffer', entityId: offer._id, actor: user, before: offer });
  res.json({ ok: true });
}

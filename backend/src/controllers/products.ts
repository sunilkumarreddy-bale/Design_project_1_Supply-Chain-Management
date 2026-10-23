import { Request, Response } from 'express';
import { z } from 'zod';
import { Product, StockLevel, Supplier } from '../models';
import { ApiError } from '../utils/apiError';
import { snapshot } from '../utils/ids';
import { qrDataUrl } from '../utils/qrcode';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { objectId, optionalObjectId, pageOf, paging } from '../middleware/validate';
import { uploadFile } from '../integrations/storage';
import { resolveLeadTime } from '../engines/reorder';
import { explainProductAt, onHandMap, supplierInput } from '../services/planning';
import { escapeRegex, sendPage } from './helpers';

const nonNeg = (label = 'must be 0 or more') => z.coerce.number({ invalid_type_error: 'must be a number' }).min(0, label);
const nullableNonNeg = z.union([z.coerce.number().min(0, 'must be 0 or more'), z.null(), z.literal('')]).transform((v) => (v === '' ? null : v));

const productFields = {
  sku: z.string().trim().min(1, 'is required').max(40).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, 'is required').max(200),
  description: z.string().max(2000).default(''),
  category: z.string().trim().max(80).default('General'),
  unit: z.string().trim().max(20).default('pcs'),
  unitCost: nonNeg(),
  unitPrice: nonNeg(),
  primarySupplier: optionalObjectId,
  avgDailyDemand: nonNeg().default(1),
  demandStdDev: nonNeg().default(0),
  leadTimeDaysOverride: nullableNonNeg.optional(),
  serviceLevelZ: z.coerce.number().min(0).max(5).default(1.65),
  orderCost: nonNeg().default(20),
  holdingCostPerUnitYear: z.coerce.number().positive('must be greater than 0').default(2),
  annualDemandOverride: nullableNonNeg.optional(),
  isPerishable: z.boolean().default(false),
  shelfLifeDays: nullableNonNeg.optional(),
  minShelfLifeDays: nonNeg().default(1),
  isActive: z.boolean().optional(),
};

export const createProductSchema = z.object(productFields).superRefine((v, ctx) => {
  if (v.isPerishable && !v.shelfLifeDays) ctx.addIssue({ code: 'custom', path: ['shelfLifeDays'], message: 'is required for perishable products' });
});

export const updateProductSchema = z
  .object(Object.fromEntries(Object.entries(productFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])) as {
    [K in keyof typeof productFields]: z.ZodOptional<(typeof productFields)[K]>;
  })
  .strict();

export const listProductsQuery = z.object({ ...paging, q: z.string().optional(), includeInactive: z.enum(['true', 'false']).optional() });
export const explainQuery = z.object({ warehouse: objectId.optional() });
export const scanSchema = z.object({ payload: z.string().trim().min(1, 'is required').max(200) });

async function checkSupplier(id: string | null | undefined) {
  if (id && !(await Supplier.exists({ _id: id }))) throw ApiError.badRequest('Primary supplier not found');
}

function decorate(p: any, onHand?: number) {
  const supplier = p.primarySupplier && typeof p.primarySupplier === 'object' ? p.primarySupplier : null;
  const lt = resolveLeadTime(p, supplier ? supplierInput(supplier) : null);
  return {
    ...p,
    primarySupplier: supplier ? { _id: supplier._id, name: supplier.name, status: supplier.status, leadTimeDays: supplier.leadTimeDays } : p.primarySupplier,
    leadTime: { days: lt.leadDays, std: lt.sigmaLead, source: lt.source, samples: lt.samples },
    ...(onHand !== undefined ? { totalOnHand: onHand } : {}),
  };
}

export async function listProducts(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listProductsQuery>;
  const { page, limit, skip } = pageOf(q, 200);
  const filter: Record<string, unknown> = q.includeInactive === 'true' ? {} : { isActive: true };
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q.trim()), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { category: rx }];
  }
  const [items, total] = await Promise.all([
    Product.find(filter).populate('primarySupplier').sort({ sku: 1 }).skip(skip).limit(limit).lean({ virtuals: true }),
    Product.countDocuments(filter),
  ]);
  const oh = await onHandMap(items.map((p) => p._id));
  sendPage(res, items.map((p) => decorate(p, oh.get(`*:${p._id.toHexString()}`) ?? 0)), total, page, limit);
}

export async function getProduct(req: Request, res: Response) {
  const p = await Product.findById(req.params.id).populate('primarySupplier').lean();
  if (!p) throw ApiError.notFound('Product not found');
  const lines = await StockLevel.find({ product: p._id, quantity: { $gt: 0 } }).populate('warehouse', 'code name').sort({ expiryDate: 1 }).lean();
  const byWarehouse = new Map<string, { warehouse: unknown; quantity: number; batches: number; nearestExpiry: Date | null }>();
  for (const l of lines) {
    const w = l.warehouse as unknown as { _id: { toHexString(): string } };
    const k = w._id.toHexString();
    const cur = byWarehouse.get(k) ?? { warehouse: l.warehouse, quantity: 0, batches: 0, nearestExpiry: null };
    cur.quantity += l.quantity;
    cur.batches += 1;
    if (l.expiryDate && (!cur.nearestExpiry || l.expiryDate < cur.nearestExpiry)) cur.nearestExpiry = l.expiryDate;
    byWarehouse.set(k, cur);
  }
  const stock = [...byWarehouse.values()];
  res.json({ ...decorate(p, stock.reduce((s, x) => s + x.quantity, 0)), stock, lines });
}

export async function createProduct(req: Request, res: Response) {
  const b = req.body as z.infer<typeof createProductSchema>;
  await checkSupplier(b.primarySupplier);
  if (await Product.exists({ sku: b.sku })) throw ApiError.conflict(`SKU ${b.sku} already exists`);
  const p = await Product.create({ ...b, qrPayload: b.sku });
  await recordAudit({ action: 'product.create', entityType: 'Product', entityId: p._id, actor: currentUser(req), after: p });
  res.status(201).json(decorate(await Product.findById(p._id).populate('primarySupplier').lean()));
}

export async function updateProduct(req: Request, res: Response) {
  const b = req.body as z.infer<typeof updateProductSchema>;
  const p = await Product.findById(req.params.id);
  if (!p) throw ApiError.notFound('Product not found');
  if (b.primarySupplier !== undefined) await checkSupplier(b.primarySupplier);
  if (b.sku && b.sku !== p.sku && (await Product.exists({ sku: b.sku }))) throw ApiError.conflict(`SKU ${b.sku} already exists`);
  const before = snapshot(p);
  for (const [k, v] of Object.entries(b)) if (v !== undefined) (p as any)[k] = v;
  if (b.sku) p.qrPayload = b.sku;
  if (p.isPerishable && !p.shelfLifeDays) throw ApiError.badRequest('shelfLifeDays is required for perishable products');
  await p.save();
  await recordAudit({ action: 'product.update', entityType: 'Product', entityId: p._id, actor: currentUser(req), before, after: p });
  res.json(decorate(await Product.findById(p._id).populate('primarySupplier').lean()));
}

export async function uploadProductImage(req: Request, res: Response) {
  const file = req.file;
  if (!file) throw ApiError.badRequest('Attach an image in the "image" field');
  if (!file.mimetype.startsWith('image/')) throw ApiError.badRequest('Only image files are accepted');
  const p = await Product.findById(req.params.id);
  if (!p) throw ApiError.notFound('Product not found');
  const before = snapshot(p);
  const up = await uploadFile({ buffer: file.buffer, filename: file.originalname, mimeType: file.mimetype, folder: 'products', kind: 'image' });
  p.imageUrl = up.url;
  await p.save();
  await recordAudit({ action: 'product.image', entityType: 'Product', entityId: p._id, actor: currentUser(req), before, after: p, metadata: { driver: up.driver } });
  res.json({ imageUrl: up.url, driver: up.driver });
}

export async function productQr(req: Request, res: Response) {
  const p = await Product.findById(req.params.id).lean();
  if (!p) throw ApiError.notFound('Product not found');
  const payload = p.qrPayload || p.sku;
  res.json({ payload, sku: p.sku, name: p.name, dataUrl: await qrDataUrl(payload) });
}

export async function scanProduct(req: Request, res: Response) {
  const { payload } = req.body as z.infer<typeof scanSchema>;
  const text = payload.trim();
  const p = await Product.findOne({ $or: [{ qrPayload: text }, { sku: text.toUpperCase() }] }).populate('primarySupplier').lean();
  if (!p) throw ApiError.notFound(`No product matches "${text}"`);
  const lines = await StockLevel.find({ product: p._id, quantity: { $gt: 0 } }).populate('warehouse', 'code name').sort({ expiryDate: 1 }).lean();
  res.json({ product: decorate(p, lines.reduce((s, l) => s + l.quantity, 0)), lines });
}

export async function explainProduct(req: Request, res: Response) {
  const q = req.query as z.infer<typeof explainQuery>;
  const r = await explainProductAt(req.params.id, q.warehouse ?? null);
  res.json({
    product: { _id: r.product._id, sku: r.product.sku, name: r.product.name },
    warehouse: r.warehouseId,
    onHand: r.onHand,
    onOrder: r.onOrder,
    demand: r.demand,
    explanation: r.explanation,
  });
}

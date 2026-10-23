import { Request, Response } from 'express';
import { z } from 'zod';
import { User, Warehouse } from '../models';
import { ApiError } from '../utils/apiError';
import { snapshot } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { optionalObjectId } from '../middleware/validate';
import { getMapsDriver } from '../integrations/maps';

const zone = z.object({
  code: z.string().trim().min(1, 'zone code is required').max(20),
  name: z.string().trim().max(60).optional().default(''),
  bins: z.array(z.string().trim().min(1).max(20)).default([]),
});
const location = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).nullable();

export const createWarehouseSchema = z.object({
  code: z.string().trim().min(2, 'must be at least 2 characters').max(20),
  name: z.string().trim().min(1, 'is required'),
  address: z.string().trim().max(300).default(''),
  city: z.string().trim().max(100).default(''),
  location: location.optional(),
  zones: z.array(zone).default([]),
  manager: optionalObjectId,
});

export const updateWarehouseSchema = createWarehouseSchema.partial().extend({ isActive: z.boolean().optional() });

function checkZones(zones: { code: string; bins: string[] }[]) {
  const codes = zones.map((z) => z.code.toUpperCase());
  if (new Set(codes).size !== codes.length) throw ApiError.badRequest('Zone codes must be unique');
  const bins = zones.flatMap((z) => z.bins);
  if (new Set(bins).size !== bins.length) throw ApiError.badRequest('Bin codes must be unique within a warehouse');
}

async function geocodeIfNeeded(address: string, city: string) {
  const text = [address, city].filter(Boolean).join(', ');
  if (!text) return null;
  try {
    const g = await getMapsDriver().geocode(text);
    return { lat: g.lat, lng: g.lng };
  } catch {
    return null;
  }
}

const populate = (q: any) => q.populate('manager', 'name email');

export async function listWarehouses(_req: Request, res: Response) {
  const items = await populate(Warehouse.find().sort({ code: 1 }));
  res.json({ items: items.map((w: any) => w.toJSON()), total: items.length, page: 1, limit: items.length });
}

export async function getWarehouse(req: Request, res: Response) {
  const w = await populate(Warehouse.findById(req.params.id));
  if (!w) throw ApiError.notFound('Warehouse not found');
  res.json(w.toJSON());
}

async function checkManager(id: string | null | undefined) {
  if (!id) return;
  const u = await User.findById(id).lean();
  if (!u) throw ApiError.badRequest('Manager not found');
  if (u.role !== 'warehouse_manager' && u.role !== 'admin') throw ApiError.badRequest('The manager must be a warehouse manager or admin');
}

export async function createWarehouse(req: Request, res: Response) {
  const b = req.body as z.infer<typeof createWarehouseSchema>;
  checkZones(b.zones);
  await checkManager(b.manager);
  const loc = b.location ?? (await geocodeIfNeeded(b.address, b.city));
  const w = await Warehouse.create({ ...b, location: loc, manager: b.manager ?? null });
  await recordAudit({ action: 'warehouse.create', entityType: 'Warehouse', entityId: w._id, actor: currentUser(req), warehouse: w._id, after: w });
  res.status(201).json((await populate(Warehouse.findById(w._id))).toJSON());
}

export async function updateWarehouse(req: Request, res: Response) {
  const user = currentUser(req);
  const b = req.body as z.infer<typeof updateWarehouseSchema>;
  if (user.role === 'warehouse_manager' && user.warehouse !== req.params.id) {
    throw ApiError.forbidden('Managers can only edit their own warehouse');
  }
  const w = await Warehouse.findById(req.params.id);
  if (!w) throw ApiError.notFound('Warehouse not found');
  if (user.role === 'warehouse_manager' && (b.isActive !== undefined || b.manager !== undefined || b.code !== undefined)) {
    throw ApiError.forbidden('Only an admin can change the code, manager or active state');
  }
  const before = snapshot(w);
  if (b.zones) checkZones(b.zones);
  if ('manager' in req.body) await checkManager(b.manager);
  const { location: loc, manager, ...rest } = b;
  Object.assign(w, rest);
  if ('manager' in req.body) w.manager = (manager ?? null) as any;
  if (loc !== undefined) w.location = loc as any;
  const addressChanged = b.address !== undefined || b.city !== undefined;
  if (loc === undefined && (!w.location?.lat || addressChanged)) {
    const g = await geocodeIfNeeded(w.address, w.city);
    if (g) w.location = g as any;
  }
  await w.save();
  await recordAudit({ action: 'warehouse.update', entityType: 'Warehouse', entityId: w._id, actor: user, warehouse: w._id, before, after: w });
  res.json((await populate(Warehouse.findById(w._id))).toJSON());
}

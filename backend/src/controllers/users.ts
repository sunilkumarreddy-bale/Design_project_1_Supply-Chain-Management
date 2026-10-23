import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ROLES, Supplier, User, Warehouse } from '../models';
import { ApiError } from '../utils/apiError';
import { snapshot } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';
import { optionalObjectId, pageOf, paging } from '../middleware/validate';
import { BCRYPT_ROUNDS } from './auth';
import { escapeRegex, sendPage } from './helpers';

const e164 = z.union([z.string().regex(/^\+[1-9]\d{6,14}$/, 'must be in E.164 format'), z.literal('')]);

export const listUsersQuery = z.object({ ...paging, role: z.enum(ROLES).optional(), q: z.string().optional() });

export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'is required'),
  email: z.string().trim().toLowerCase().email('must be a valid email'),
  password: z.string().min(8, 'must be at least 8 characters'),
  role: z.enum(ROLES),
  warehouse: optionalObjectId,
  supplier: optionalObjectId,
  phone: e164.optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  warehouse: optionalObjectId,
  supplier: optionalObjectId,
  phone: e164.optional(),
});

export const resetPasswordSchema = z.object({ newPassword: z.string().min(8, 'must be at least 8 characters') });

async function checkScope(role: string, warehouse: string | null | undefined, supplier: string | null | undefined) {
  if (role === 'supplier') {
    if (!supplier) throw ApiError.badRequest('A supplier user must be linked to a supplier');
    if (!(await Supplier.exists({ _id: supplier }))) throw ApiError.badRequest('Supplier not found');
  }
  if (warehouse && !(await Warehouse.exists({ _id: warehouse }))) throw ApiError.badRequest('Warehouse not found');
}

const populate = (q: any) => q.populate('warehouse', 'code name').populate('supplier', 'name');

export async function listUsers(req: Request, res: Response) {
  const q = req.query as unknown as z.infer<typeof listUsersQuery>;
  const { page, limit, skip } = pageOf(q, 100);
  const filter: Record<string, unknown> = {};
  if (q.role) filter.role = q.role;
  if (q.q) filter.$or = [{ name: new RegExp(escapeRegex(q.q), 'i') }, { email: new RegExp(escapeRegex(q.q), 'i') }];
  const [items, total] = await Promise.all([populate(User.find(filter).sort({ name: 1 }).skip(skip).limit(limit)), User.countDocuments(filter)]);
  sendPage(res, items.map((u: any) => u.toJSON()), total, page, limit);
}

export async function createUser(req: Request, res: Response) {
  const b = req.body as z.infer<typeof createUserSchema>;
  await checkScope(b.role, b.warehouse, b.supplier);
  if (await User.exists({ email: b.email })) throw ApiError.conflict('An account with this email already exists');
  const user = await User.create({
    name: b.name,
    email: b.email,
    passwordHash: await bcrypt.hash(b.password, BCRYPT_ROUNDS),
    role: b.role,
    warehouse: b.role === 'admin' || b.role === 'supplier' ? null : b.warehouse,
    supplier: b.role === 'supplier' ? b.supplier : null,
    phone: b.phone || undefined,
  });
  await recordAudit({ action: 'user.create', entityType: 'User', entityId: user._id, actor: currentUser(req), warehouse: user.warehouse, after: user });
  res.status(201).json((await populate(User.findById(user._id))).toJSON());
}

export async function updateUser(req: Request, res: Response) {
  const b = req.body as z.infer<typeof updateUserSchema>;
  const me = currentUser(req);
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (user._id.equals(me._id) && (b.isActive === false || (b.role && b.role !== 'admin'))) {
    throw ApiError.badRequest('You cannot deactivate yourself or remove your own admin role');
  }
  const before = snapshot(user);
  const role = b.role ?? user.role;
  const warehouse = 'warehouse' in req.body ? b.warehouse : user.warehouse?.toHexString();
  const supplier = 'supplier' in req.body ? b.supplier : user.supplier?.toHexString();
  await checkScope(role, warehouse, supplier);
  if (b.name !== undefined) user.name = b.name;
  if (b.phone !== undefined) user.phone = b.phone || undefined;
  if (b.isActive !== undefined) user.isActive = b.isActive;
  user.role = role;
  user.warehouse = role === 'admin' || role === 'supplier' ? null : ((warehouse ?? null) as any);
  user.supplier = role === 'supplier' ? ((supplier ?? null) as any) : null;
  await user.save();
  await recordAudit({ action: 'user.update', entityType: 'User', entityId: user._id, actor: me, warehouse: user.warehouse, before, after: user });
  res.json((await populate(User.findById(user._id))).toJSON());
}

export async function resetPassword(req: Request, res: Response) {
  const { newPassword } = req.body as z.infer<typeof resetPasswordSchema>;
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await user.save();
  await recordAudit({ action: 'user.reset_password', entityType: 'User', entityId: user._id, actor: currentUser(req) });
  res.json({ ok: true });
}

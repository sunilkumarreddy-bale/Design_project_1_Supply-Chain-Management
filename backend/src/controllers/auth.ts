import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../models';
import { ApiError } from '../utils/apiError';
import { signToken } from '../utils/jwt';
import { snapshot } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import { currentUser } from '../middleware/auth';

export const BCRYPT_ROUNDS = 10;
const password = z.string().min(8, 'must be at least 8 characters').max(128);
const e164 = z.union([z.string().regex(/^\+[1-9]\d{6,14}$/, 'must be in E.164 format, e.g. +919876543210'), z.literal('')]);

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(100),
  email: z.string().trim().toLowerCase().email('must be a valid email'),
  password,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('must be a valid email'),
  password: z.string().min(1, 'is required'),
});

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: e164.optional(),
  notify: z.object({ inApp: z.boolean(), email: z.boolean(), sms: z.boolean() }).partial().optional(),
});

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1, 'is required'), newPassword: password });

async function populatedUser(id: unknown) {
  return User.findById(id).populate('warehouse', 'code name').populate('supplier', 'name');
}

/** Self-registration always creates a staff account without a warehouse; an admin assigns scope later. */
export async function register(req: Request, res: Response) {
  const { name, email, password: pw } = req.body as z.infer<typeof registerSchema>;
  if (await User.exists({ email })) throw ApiError.conflict('An account with this email already exists');
  const user = await User.create({ name, email, passwordHash: await bcrypt.hash(pw, BCRYPT_ROUNDS), role: 'staff' });
  await recordAudit({ action: 'user.register', entityType: 'User', entityId: user._id, actor: user._id.toHexString(), after: user });
  const token = signToken({ sub: user._id.toHexString(), role: user.role });
  res.status(201).json({ token, user: (await populatedUser(user._id))!.toJSON() });
}

export async function login(req: Request, res: Response) {
  const { email, password: pw } = req.body as z.infer<typeof loginSchema>;
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(pw, user.passwordHash))) throw ApiError.unauthorized('Invalid email or password');
  if (!user.isActive) throw ApiError.unauthorized('Account is deactivated');
  user.lastLoginAt = new Date();
  await user.save();
  await recordAudit({ action: 'user.login', entityType: 'User', entityId: user._id, actor: user._id.toHexString(), warehouse: user.warehouse, metadata: { ip: req.ip } });
  const token = signToken({ sub: user._id.toHexString(), role: user.role });
  res.json({ token, user: (await populatedUser(user._id))!.toJSON() });
}

export async function me(req: Request, res: Response) {
  const user = await populatedUser(currentUser(req).id);
  if (!user) throw ApiError.notFound('User not found');
  res.json(user.toJSON());
}

export async function updateMe(req: Request, res: Response) {
  const body = req.body as z.infer<typeof updateMeSchema>;
  const user = await User.findById(currentUser(req).id);
  if (!user) throw ApiError.notFound('User not found');
  const before = snapshot(user);
  if (body.name !== undefined) user.name = body.name;
  if (body.phone !== undefined) user.phone = body.phone || undefined;
  if (body.notify) {
    for (const [k, v] of Object.entries(body.notify)) if (v !== undefined) (user.notify as Record<string, boolean>)[k] = v;
  }
  if (user.notify?.sms && !user.phone) throw ApiError.badRequest('Add a phone number to receive SMS notifications');
  await user.save();
  await recordAudit({ action: 'user.update_profile', entityType: 'User', entityId: user._id, actor: currentUser(req), before, after: user });
  res.json((await populatedUser(user._id))!.toJSON());
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
  const user = await User.findById(currentUser(req).id);
  if (!user) throw ApiError.notFound('User not found');
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw ApiError.badRequest('Current password is incorrect');
  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await user.save();
  await recordAudit({ action: 'user.change_password', entityType: 'User', entityId: user._id, actor: currentUser(req) });
  res.json({ ok: true });
}

import { Request, Response } from 'express';
import { z } from 'zod';
import { Notification } from '../models';
import { ApiError } from '../utils/apiError';
import { currentUser } from '../middleware/auth';
import { pageOf, paging } from '../middleware/validate';

export const listNotificationsQuery = z.object({ ...paging, unread: z.enum(['true', 'false']).optional() });

export async function listNotifications(req: Request, res: Response) {
  const user = currentUser(req);
  const q = req.query as unknown as z.infer<typeof listNotificationsQuery>;
  const { page, limit, skip } = pageOf(q, 20);
  const filter: Record<string, unknown> = { user: user._id, channel: 'in_app' };
  if (q.unread === 'true') filter.readAt = null;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: user._id, channel: 'in_app', readAt: null }),
  ]);
  res.json({ items, total, page, limit, unread });
}

export async function markRead(req: Request, res: Response) {
  const user = currentUser(req);
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: user._id, channel: 'in_app' },
    { status: 'read', readAt: new Date() },
    { new: true },
  ).lean();
  if (!n) throw ApiError.notFound('Notification not found');
  res.json(n);
}

export async function markAllRead(req: Request, res: Response) {
  const user = currentUser(req);
  const r = await Notification.updateMany({ user: user._id, channel: 'in_app', readAt: null }, { status: 'read', readAt: new Date() });
  res.json({ updated: r.modifiedCount });
}

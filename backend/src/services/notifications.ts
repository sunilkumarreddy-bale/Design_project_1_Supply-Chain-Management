import { Types } from 'mongoose';
import { Notification, Role, User } from '../models';
import { sendEmail } from '../integrations/email';
import { sendSms } from '../integrations/sms';
import { emitUser } from '../sockets';
import { idStr } from '../utils/ids';
import { env } from '../config/env';

export interface NotifyTarget {
  userIds?: unknown[];
  roles?: Role[];
  /** With roles: limits managers and staff to this warehouse (admins are always included). */
  warehouse?: unknown;
  supplier?: unknown;
}

export interface NotifyMessage {
  type: string;
  subject: string;
  body: string;
  link?: string;
}

let deliveryTail: Promise<unknown> = Promise.resolve();

/** Resolves the target to active users. */
export async function resolveRecipients(target: NotifyTarget) {
  const or: Record<string, unknown>[] = [];
  const ids = (target.userIds ?? []).map(idStr).filter((x): x is string => !!x && Types.ObjectId.isValid(x));
  if (ids.length) or.push({ _id: { $in: ids } });
  if (target.roles?.length) {
    const wh = idStr(target.warehouse);
    for (const role of target.roles) {
      if (role === 'admin') or.push({ role });
      else if (role === 'supplier') or.push(target.supplier ? { role, supplier: idStr(target.supplier) } : { role });
      else or.push(wh ? { role, warehouse: wh } : { role });
    }
  } else if (target.supplier) {
    or.push({ role: 'supplier', supplier: idStr(target.supplier) });
  }
  if (!or.length) return [];
  return User.find({ $or: or, isActive: true }).lean();
}

/**
 * Creates an in-app notification for each recipient (pushed over Socket.io), then queues email and SMS
 * according to each user's preferences. External deliveries run in the background; their outcome
 * (sent/failed, provider id, error) is written back to the notification record.
 */
export async function notify(target: NotifyTarget, msg: NotifyMessage) {
  const users = await resolveRecipients(target);
  const created = [];
  for (const u of users) {
    const prefs = u.notify ?? { inApp: true, email: true, sms: false };
    if (prefs.inApp !== false) {
      const n = await Notification.create({
        user: u._id,
        channel: 'in_app',
        type: msg.type,
        subject: msg.subject,
        body: msg.body,
        link: msg.link ?? '',
        status: 'sent',
      });
      created.push(n);
      emitUser(u._id, 'notification:new', n.toJSON());
    }
    if (prefs.email && u.email) {
      const n = await Notification.create({
        user: u._id,
        channel: 'email',
        type: msg.type,
        subject: msg.subject,
        body: msg.body,
        link: msg.link ?? '',
        status: 'queued',
      });
      created.push(n);
      queueDelivery(n._id, () =>
        sendEmail({ to: u.email, subject: msg.subject, text: `${msg.body}${msg.link ? `\n\nOpen: ${linkUrl(msg.link)}` : ''}` }),
      );
    }
    if (prefs.sms && u.phone) {
      const n = await Notification.create({
        user: u._id,
        channel: 'sms',
        type: msg.type,
        subject: msg.subject,
        body: msg.body,
        link: msg.link ?? '',
        status: 'queued',
      });
      created.push(n);
      queueDelivery(n._id, () => sendSms({ to: u.phone!, body: `${msg.subject}: ${msg.body}`.slice(0, 480) }));
    }
  }
  return created;
}

function linkUrl(link: string): string {
  return /^https?:/.test(link) ? link : `${env.clientOrigin.replace(/\/$/, '')}${link.startsWith('/') ? '' : '/'}${link}`;
}

function queueDelivery(notificationId: Types.ObjectId, send: () => Promise<{ id: string }>) {
  deliveryTail = deliveryTail.then(async () => {
    try {
      const r = await send();
      await Notification.updateOne({ _id: notificationId }, { status: 'sent', providerMessageId: r.id, error: '' });
    } catch (e) {
      await Notification.updateOne({ _id: notificationId }, { status: 'failed', error: (e as Error).message.slice(0, 500) });
    }
  });
}

/**
 * Emails / texts an external contact that has no user account (e.g. a supplier's contact address).
 * Outcomes are not stored as notifications because there is no user to attach them to.
 */
export function notifyContact(contact: { email?: string | null; phone?: string | null }, msg: NotifyMessage): void {
  if (contact.email) {
    deliveryTail = deliveryTail.then(() =>
      sendEmail({ to: contact.email!, subject: msg.subject, text: msg.body }).catch((e) => {
        if (!env.isTest) console.error('contact email failed', (e as Error).message);
      }),
    );
  }
  if (contact.phone && /^\+[1-9]\d{6,14}$/.test(contact.phone)) {
    deliveryTail = deliveryTail.then(() =>
      sendSms({ to: contact.phone!, body: `${msg.subject}: ${msg.body}`.slice(0, 480) }).catch((e) => {
        if (!env.isTest) console.error('contact sms failed', (e as Error).message);
      }),
    );
  }
}

/** Resolves once every queued email/SMS delivery has finished. */
export async function flushNotifications(): Promise<void> {
  let current: Promise<unknown>;
  do {
    current = deliveryTail;
    await current;
  } while (current !== deliveryTail);
}

/** Notification failures never fail the business action that triggered them. */
export async function notifySafe(target: NotifyTarget, msg: NotifyMessage): Promise<void> {
  try {
    await notify(target, msg);
  } catch (e) {
    if (!env.isTest) console.error('notify failed', e);
  }
}

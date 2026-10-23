import { randomUUID } from 'crypto';
import { env } from '../../config/env';
import { mockOutbox } from '../outbox';
import type { SmsDriver } from './index';

export const consoleSmsDriver: SmsDriver = {
  name: 'console',
  async send(msg) {
    const id = `console-sms-${randomUUID()}`;
    mockOutbox.push({ channel: 'sms', driver: 'console', payload: { id, ...msg } });
    if (!env.silentNotifications) console.log(`[sms:console] to=${msg.to} body="${msg.body.slice(0, 80)}"`);
    return { id, driver: 'console' };
  },
};

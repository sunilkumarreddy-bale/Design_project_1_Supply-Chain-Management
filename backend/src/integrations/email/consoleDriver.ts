import { randomUUID } from 'crypto';
import { env } from '../../config/env';
import { mockOutbox } from '../outbox';
import type { EmailDriver } from './index';

export const consoleEmailDriver: EmailDriver = {
  name: 'console',
  async send(msg) {
    const id = `console-email-${randomUUID()}`;
    mockOutbox.push({ channel: 'email', driver: 'console', payload: { id, ...msg } });
    if (!env.silentNotifications) console.log(`[email:console] to=${msg.to} subject="${msg.subject}"`);
    return { id, driver: 'console' };
  },
};

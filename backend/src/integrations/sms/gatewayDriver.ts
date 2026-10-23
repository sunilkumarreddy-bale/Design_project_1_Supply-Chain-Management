import { env } from '../../config/env';
import { httpJson } from '../http';
import type { SmsDriver } from './index';

/** Generic HTTP SMS gateway: POST {to, from, message} with a bearer API key; expects {id} or {messageId}. */
export const gatewaySmsDriver: SmsDriver = {
  name: 'gateway',
  async send(msg) {
    const g = env.smsGateway;
    const res = await httpJson<{ id?: string; messageId?: string }>(g.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${g.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: msg.to, from: g.sender, message: msg.body }),
    });
    return { id: String(res?.id ?? res?.messageId ?? 'gateway'), driver: 'gateway' };
  },
};

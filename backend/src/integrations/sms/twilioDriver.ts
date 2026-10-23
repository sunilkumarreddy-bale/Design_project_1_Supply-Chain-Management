import { env } from '../../config/env';
import { httpJson } from '../http';
import type { SmsDriver } from './index';

export const twilioSmsDriver: SmsDriver = {
  name: 'twilio',
  async send(msg) {
    const { accountSid, authToken, from } = env.twilio;
    const body = new URLSearchParams({ To: msg.to, From: from, Body: msg.body });
    const res = await httpJson<{ sid: string }>(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );
    return { id: res.sid, driver: 'twilio' };
  },
};

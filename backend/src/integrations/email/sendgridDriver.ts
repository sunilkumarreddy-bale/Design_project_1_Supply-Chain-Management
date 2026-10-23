import { env } from '../../config/env';
import type { EmailDriver } from './index';

export const sendgridEmailDriver: EmailDriver = {
  name: 'sendgrid',
  async send(msg) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.sendgridApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: msg.to }] }],
        from: { email: env.emailFrom },
        subject: msg.subject,
        content: [
          { type: 'text/plain', value: msg.text },
          ...(msg.html ? [{ type: 'text/html', value: msg.html }] : []),
        ],
      }),
    });
    if (!res.ok) throw new Error(`SendGrid error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { id: res.headers.get('x-message-id') ?? 'sendgrid', driver: 'sendgrid' };
  },
};

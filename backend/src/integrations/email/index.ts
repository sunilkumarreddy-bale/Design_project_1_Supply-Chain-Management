import { env } from '../../config/env';
import { consoleEmailDriver } from './consoleDriver';
import { sendgridEmailDriver } from './sendgridDriver';
import { smtpEmailDriver } from './smtpDriver';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailResult {
  id: string;
  driver: string;
}

export interface EmailDriver {
  name: string;
  send(msg: EmailMessage): Promise<EmailResult>;
}

/** Picks the real driver when its keys are present, otherwise the console driver. */
export function getEmailDriver(): EmailDriver {
  const provider = env.emailProvider;
  if (provider === 'sendgrid' && env.sendgridApiKey) return sendgridEmailDriver;
  if (provider === 'smtp' && env.smtp.host) return smtpEmailDriver;
  return consoleEmailDriver;
}

export function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  return getEmailDriver().send(msg);
}

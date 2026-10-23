import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env';
import type { EmailDriver } from './index';

let transporter: Transporter | null = null;
let transporterKey = '';

function getTransporter(): Transporter {
  const s = env.smtp;
  const key = `${s.host}:${s.port}:${s.user}:${s.secure}`;
  if (!transporter || key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    });
    transporterKey = key;
  }
  return transporter;
}

export const smtpEmailDriver: EmailDriver = {
  name: 'smtp',
  async send(msg) {
    const info = await getTransporter().sendMail({
      from: env.emailFrom,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { id: info.messageId, driver: 'smtp' };
  },
};

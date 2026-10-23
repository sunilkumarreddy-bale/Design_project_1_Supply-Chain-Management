import { env } from '../../config/env';
import { consoleSmsDriver } from './consoleDriver';
import { gatewaySmsDriver } from './gatewayDriver';
import { twilioSmsDriver } from './twilioDriver';

export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsResult {
  id: string;
  driver: string;
}

export interface SmsDriver {
  name: string;
  send(msg: SmsMessage): Promise<SmsResult>;
}

export function getSmsDriver(): SmsDriver {
  const p = env.smsProvider;
  const t = env.twilio;
  if (p === 'twilio' && t.accountSid && t.authToken && t.from) return twilioSmsDriver;
  if (p === 'gateway' && env.smsGateway.url && env.smsGateway.apiKey) return gatewaySmsDriver;
  return consoleSmsDriver;
}

export function sendSms(msg: SmsMessage): Promise<SmsResult> {
  return getSmsDriver().send(msg);
}

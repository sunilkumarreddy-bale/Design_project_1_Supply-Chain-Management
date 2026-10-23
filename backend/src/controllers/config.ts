import { Request, Response } from 'express';
import { env } from '../config/env';
import { getEmailDriver } from '../integrations/email';
import { getSmsDriver } from '../integrations/sms';
import { getStorageDriver } from '../integrations/storage';
import { getMapsDriver } from '../integrations/maps';
import { getPaymentsDriver, paymentsEnabled } from '../integrations/payments';

/** Feature flags and which integration drivers are active (real or mock), for the UI. */
export async function getConfig(_req: Request, res: Response) {
  res.json({
    paymentsEnabled: paymentsEnabled(),
    drivers: {
      email: getEmailDriver().name,
      sms: getSmsDriver().name,
      images: getStorageDriver('image').name,
      documents: getStorageDriver('document').name,
      maps: getMapsDriver().name,
      payments: paymentsEnabled() ? getPaymentsDriver().name : 'disabled',
    },
    environment: env.nodeEnv,
  });
}

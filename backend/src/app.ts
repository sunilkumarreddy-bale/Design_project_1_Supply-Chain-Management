import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import api from './routes';
import { errorHandler, notFound } from './middleware/errorHandler';
import { UPLOAD_DIR } from './integrations/storage/localDriver';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.clientOrigin.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  if (!env.isTest) app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
  app.use(
    '/api',
    rateLimit({
      windowMs: env.rateLimitWindowMs,
      limit: env.rateLimitMax,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { message: 'Too many requests, please slow down', code: 'RATE_LIMITED' } },
    }),
  );
  // files stored by the local (mock) storage driver
  app.use('/uploads', express.static(UPLOAD_DIR, { fallthrough: false, maxAge: '1d' }));
  app.use('/api', api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

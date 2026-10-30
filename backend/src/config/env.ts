import path from 'path';
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'test') {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

/** Reads the environment on every access so tests can change variables at runtime. */
export const env = {
  get nodeEnv() {
    return str('NODE_ENV', 'development');
  },
  get isTest() {
    return str('NODE_ENV') === 'test';
  },
  get port() {
    return num('PORT', 4000);
  },
  get mongoUri() {
    return str('MONGODB_URI', 'mongodb://localhost:27017/smart_inventory?replicaSet=rs0&directConnection=true');
  },
  get jwtSecret() {
    const s = str('JWT_SECRET');
    if (!s && str('NODE_ENV') === 'production') throw new Error('JWT_SECRET must be set in production');
    return s || 'dev-only-insecure-secret';
  },
  get jwtExpiresIn() {
    return str('JWT_EXPIRES_IN', '8h');
  },
  get clientOrigin() {
    return str('CLIENT_ORIGIN', 'http://localhost:5173');
  },
  get publicBaseUrl() {
    return str('PUBLIC_BASE_URL', `http://localhost:${num('PORT', 4000)}`);
  },
  get rateLimitWindowMs() {
    return num('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
  },
  get rateLimitMax() {
    return num('RATE_LIMIT_MAX', 1000);
  },
  get schedulerIntervalMinutes() {
    return num('SCHEDULER_INTERVAL_MINUTES', 60);
  },
  /** Stock DNA: days before expiry when the expiry job writes an expiry_warning gene. */
  get dnaExpiryWarningDays() {
    return num('DNA_EXPIRY_WARNING_DAYS', 2);
  },
  /** Stock DNA: notify admins when a lot dies with more value lost than this (INR). */
  get dnaValueLostAlert() {
    return num('DNA_VALUE_LOST_ALERT', 1000);
  },
  get storageProvider() {
    return str('STORAGE_PROVIDER').toLowerCase();
  },
  get cloudinaryUrl() {
    return str('CLOUDINARY_URL');
  },
  get awsS3Bucket() {
    return str('AWS_S3_BUCKET');
  },
  get awsRegion() {
    return str('AWS_REGION', 'ap-south-1');
  },
  get emailProvider() {
    return str('EMAIL_PROVIDER', 'console').toLowerCase();
  },
  get emailFrom() {
    return str('EMAIL_FROM', 'no-reply@smart-inventory.local');
  },
  get sendgridApiKey() {
    return str('SENDGRID_API_KEY');
  },
  get smtp() {
    return {
      host: str('SMTP_HOST'),
      port: num('SMTP_PORT', 587),
      user: str('SMTP_USER'),
      pass: str('SMTP_PASS'),
      secure: bool('SMTP_SECURE', false),
    };
  },
  get smsProvider() {
    return str('SMS_PROVIDER', 'console').toLowerCase();
  },
  get twilio() {
    return {
      accountSid: str('TWILIO_ACCOUNT_SID'),
      authToken: str('TWILIO_AUTH_TOKEN'),
      from: str('TWILIO_FROM_NUMBER'),
    };
  },
  get smsGateway() {
    return { url: str('SMS_GATEWAY_URL'), apiKey: str('SMS_GATEWAY_API_KEY'), sender: str('SMS_GATEWAY_SENDER') };
  },
  get googleMapsApiKey() {
    return str('GOOGLE_MAPS_API_KEY');
  },
  get enablePayments() {
    return bool('ENABLE_PAYMENTS', false);
  },
  get paymentsProvider() {
    return str('PAYMENTS_PROVIDER', 'razorpay').toLowerCase();
  },
  get razorpay() {
    return { keyId: str('RAZORPAY_KEY_ID'), keySecret: str('RAZORPAY_KEY_SECRET') };
  },
  get stripeSecretKey() {
    return str('STRIPE_SECRET_KEY');
  },
  get silentNotifications() {
    return bool('SILENT_NOTIFICATIONS', false);
  },
};

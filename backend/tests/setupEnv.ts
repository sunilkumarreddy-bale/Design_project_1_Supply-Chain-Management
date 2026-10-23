import { existsSync } from 'fs';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.RATE_LIMIT_MAX = '100000';
process.env.EMAIL_PROVIDER = 'console';
process.env.SMS_PROVIDER = 'console';
process.env.GOOGLE_MAPS_API_KEY = '';
process.env.CLOUDINARY_URL = '';
process.env.STORAGE_PROVIDER = '';
process.env.SCHEDULER_INTERVAL_MINUTES = '0';
process.env.SILENT_NOTIFICATIONS = 'true';
if (!process.env.MONGOMS_SYSTEM_BINARY && existsSync('/opt/mongo/bin/mongod')) {
  process.env.MONGOMS_SYSTEM_BINARY = '/opt/mongo/bin/mongod';
  process.env.MONGOMS_VERSION = '7.0.45';
}

import { getEmailDriver, sendEmail } from '../../src/integrations/email';
import { getSmsDriver, sendSms } from '../../src/integrations/sms';
import { getMapsDriver, haversineKm, leadDaysFromKm } from '../../src/integrations/maps';
import { getPaymentsDriver } from '../../src/integrations/payments';
import { getStorageDriver } from '../../src/integrations/storage';
import { parseCloudinaryUrl } from '../../src/integrations/storage/cloudinaryDriver';
import { mockOutbox } from '../../src/integrations/outbox';

const KEYS = [
  'EMAIL_PROVIDER', 'SENDGRID_API_KEY', 'SMTP_HOST', 'SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER',
  'SMS_GATEWAY_URL', 'SMS_GATEWAY_API_KEY', 'GOOGLE_MAPS_API_KEY', 'PAYMENTS_PROVIDER', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
  'STRIPE_SECRET_KEY', 'CLOUDINARY_URL', 'AWS_S3_BUCKET', 'STORAGE_PROVIDER',
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => KEYS.forEach((k) => (saved[k] = process.env[k])));
afterEach(() => {
  KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  jest.restoreAllMocks();
});

const okJson = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

describe('adapter selection: mock without keys, real with keys', () => {
  it('email: console by default, SendGrid with a key, SMTP with a host', async () => {
    expect(getEmailDriver().name).toBe('console');
    mockOutbox.clear();
    await sendEmail({ to: 'a@b.c', subject: 's', text: 't' });
    expect(mockOutbox.list('email')).toHaveLength(1);
    process.env.EMAIL_PROVIDER = 'sendgrid';
    expect(getEmailDriver().name).toBe('console');
    process.env.SENDGRID_API_KEY = 'SG.key';
    expect(getEmailDriver().name).toBe('sendgrid');
    const f = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 202, headers: { 'x-message-id': 'm-1' } }));
    expect(await sendEmail({ to: 'a@b.c', subject: 's', text: 't' })).toEqual({ id: 'm-1', driver: 'sendgrid' });
    expect(f.mock.calls[0][0]).toBe('https://api.sendgrid.com/v3/mail/send');
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = 'smtp.example.com';
    expect(getEmailDriver().name).toBe('smtp');
  });

  it('sms: console by default, Twilio and generic gateway with keys', async () => {
    expect(getSmsDriver().name).toBe('console');
    Object.assign(process.env, { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15550001111' });
    expect(getSmsDriver().name).toBe('twilio');
    const f = jest.spyOn(global, 'fetch').mockResolvedValue(okJson({ sid: 'SM1' }));
    expect(await sendSms({ to: '+919800000001', body: 'hi' })).toEqual({ id: 'SM1', driver: 'twilio' });
    expect(String(f.mock.calls[0][0])).toContain('/Accounts/AC1/Messages.json');
    Object.assign(process.env, { SMS_PROVIDER: 'gateway', SMS_GATEWAY_URL: 'https://sms.example.com/send', SMS_GATEWAY_API_KEY: 'k' });
    expect(getSmsDriver().name).toBe('gateway');
    f.mockResolvedValue(okJson({ messageId: 'g-7' }));
    expect(await sendSms({ to: '+919800000001', body: 'hi' })).toEqual({ id: 'g-7', driver: 'gateway' });
  });

  it('maps: deterministic mock, Google with a key; 400 km/day lead time', async () => {
    const mock = getMapsDriver();
    expect(mock.name).toBe('mock');
    expect(await mock.geocode('Chennai')).toMatchObject({ lat: 13.0827, lng: 80.2707 });
    const a = await mock.geocode('Somewhere unknown');
    expect(await mock.geocode('Somewhere unknown')).toEqual(a);
    expect(leadDaysFromKm(0)).toBe(1);
    expect(leadDaysFromKm(401)).toBe(2);
    expect(haversineKm({ lat: 12.9716, lng: 77.5946 }, { lat: 13.0827, lng: 80.2707 })).toBeCloseTo(290, -1);
    process.env.GOOGLE_MAPS_API_KEY = 'gk';
    const g = getMapsDriver();
    expect(g.name).toBe('google');
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(okJson({ status: 'OK', results: [{ formatted_address: 'X', geometry: { location: { lat: 1, lng: 2 } } }] }));
    expect(await g.geocode('X')).toMatchObject({ lat: 1, lng: 2, driver: 'google' });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(okJson({ status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: 346000 }, duration: { value: 7200 } }] }] }));
    expect(await g.distance({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })).toEqual({ distanceKm: 346, durationHours: 2, driver: 'google' });
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(okJson({ status: 'REQUEST_DENIED', error_message: 'bad key', results: [] }));
    await expect(g.geocode('Y')).rejects.toThrow(/REQUEST_DENIED/);
  });

  it('payments: mock by default, Razorpay and Stripe with keys', async () => {
    expect(getPaymentsDriver().name).toBe('mock');
    Object.assign(process.env, { PAYMENTS_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'rk', RAZORPAY_KEY_SECRET: 'rs' });
    const rp = getPaymentsDriver();
    expect(rp.name).toBe('razorpay');
    const f = jest.spyOn(global, 'fetch').mockResolvedValue(okJson({ id: 'order_1' }));
    expect(await rp.createOrder({ amountInr: 100.5, receipt: 'PO-1', description: 'd' })).toEqual({ provider: 'razorpay', reference: 'order_1', status: 'pending' });
    expect(JSON.parse(String((f.mock.calls[0][1] as RequestInit).body)).amount).toBe(10050);
    Object.assign(process.env, { PAYMENTS_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test' });
    f.mockResolvedValue(okJson({ id: 'pi_1' }));
    expect((await getPaymentsDriver().createOrder({ amountInr: 1, receipt: 'r', description: 'd' })).reference).toBe('pi_1');
  });

  it('storage: local without keys, Cloudinary for images, S3 for documents', () => {
    expect(getStorageDriver('image').name).toBe('local');
    process.env.CLOUDINARY_URL = 'cloudinary://key:secret@demo';
    expect(parseCloudinaryUrl(process.env.CLOUDINARY_URL)).toEqual({ apiKey: 'key', apiSecret: 'secret', cloudName: 'demo' });
    expect(getStorageDriver('image').name).toBe('cloudinary');
    expect(getStorageDriver('document').name).toBe('cloudinary');
    process.env.AWS_S3_BUCKET = 'bucket';
    expect(getStorageDriver('document').name).toBe('s3');
    expect(getStorageDriver('attachment').name).toBe('cloudinary');
    process.env.STORAGE_PROVIDER = 's3';
    expect(getStorageDriver('image').name).toBe('s3');
  });
});

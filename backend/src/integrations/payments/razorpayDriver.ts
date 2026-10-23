import { env } from '../../config/env';
import { httpJson } from '../http';
import type { PaymentsDriver } from './index';

export const razorpayDriver: PaymentsDriver = {
  name: 'razorpay',
  async createOrder(input) {
    const { keyId, keySecret } = env.razorpay;
    const r = await httpJson<{ id: string }>('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: Math.round(input.amountInr * 100),
        currency: 'INR',
        receipt: input.receipt.slice(0, 40),
        notes: { description: input.description },
      }),
    });
    return { provider: 'razorpay', reference: r.id, status: 'pending' };
  },
};

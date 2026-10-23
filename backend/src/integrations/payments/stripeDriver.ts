import { env } from '../../config/env';
import { httpJson } from '../http';
import type { PaymentsDriver } from './index';

export const stripeDriver: PaymentsDriver = {
  name: 'stripe',
  async createOrder(input) {
    const body = new URLSearchParams({
      amount: String(Math.round(input.amountInr * 100)),
      currency: 'inr',
      description: input.description,
      'metadata[receipt]': input.receipt,
    });
    const r = await httpJson<{ id: string }>('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    return { provider: 'stripe', reference: r.id, status: 'pending' };
  },
};

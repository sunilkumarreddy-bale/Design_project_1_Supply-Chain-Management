import { env } from '../../config/env';
import { mockPaymentsDriver } from './mockDriver';
import { razorpayDriver } from './razorpayDriver';
import { stripeDriver } from './stripeDriver';

export interface PaymentOrderInput {
  amountInr: number;
  receipt: string;
  description: string;
}

export interface PaymentOrderResult {
  provider: string;
  reference: string;
  status: 'pending' | 'paid';
}

export interface PaymentsDriver {
  name: string;
  createOrder(input: PaymentOrderInput): Promise<PaymentOrderResult>;
}

export function paymentsEnabled(): boolean {
  return env.enablePayments;
}

export function getPaymentsDriver(): PaymentsDriver {
  if (env.paymentsProvider === 'razorpay' && env.razorpay.keyId && env.razorpay.keySecret) return razorpayDriver;
  if (env.paymentsProvider === 'stripe' && env.stripeSecretKey) return stripeDriver;
  return mockPaymentsDriver;
}

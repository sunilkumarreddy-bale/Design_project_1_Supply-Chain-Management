import { randomUUID } from 'crypto';
import { mockOutbox } from '../outbox';
import type { PaymentsDriver } from './index';

export const mockPaymentsDriver: PaymentsDriver = {
  name: 'mock',
  async createOrder(input) {
    const reference = `mock_pay_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    mockOutbox.push({ channel: 'payments', driver: 'mock', payload: { reference, ...input } });
    return { provider: 'mock', reference, status: 'pending' };
  },
};

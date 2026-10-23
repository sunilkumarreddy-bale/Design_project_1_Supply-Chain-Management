import { daysUntil, humanize, rupees } from '../utils/format';
import { collect, nonNegative, phoneE164, positive } from '../utils/validate';

describe('formatting and validation helpers', () => {
  it('formats INR with Indian grouping and the rupee sign', () => {
    expect(rupees(6600)).toBe('₹6,600.00');
    expect(rupees(125000.5)).toBe('₹1,25,000.50');
    expect(rupees(null)).toBe('—');
  });
  it('humanizes enum values and counts days', () => {
    expect(humanize('pending_approval')).toBe('Pending approval');
    expect(daysUntil(new Date(Date.now() + 2.5 * 864e5))).toBe(2);
  });
  it('validates numbers and phones', () => {
    expect(positive('0', 'Qty')).toBe('Qty must be greater than 0');
    expect(nonNegative('', 'Min', true)).toBeUndefined();
    expect(phoneE164('98765')).toMatch(/E\.164/);
    expect(collect({ a: undefined, b: 'bad' })).toEqual({ b: 'bad' });
  });
});

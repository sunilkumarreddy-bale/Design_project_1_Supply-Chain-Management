import { ClientSession } from 'mongoose';
import { nextSequence } from '../models/Counter';

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** PO-YYYY-000001 */
export async function nextPoNumber(session?: ClientSession): Promise<string> {
  const seq = await nextSequence('po', session);
  return `PO-${new Date().getUTCFullYear()}-${pad(seq, 6)}`;
}

/** RP-YYYY-0001 */
export async function nextRecoveryPlanNo(session?: ClientSession): Promise<string> {
  const seq = await nextSequence('rp', session);
  return `RP-${new Date().getUTCFullYear()}-${pad(seq, 4)}`;
}

/** XP-YYYY-0001 */
export async function nextRedistributionPlanNo(session?: ClientSession): Promise<string> {
  const seq = await nextSequence('xp', session);
  return `XP-${new Date().getUTCFullYear()}-${pad(seq, 4)}`;
}

/** CC-YYYY-0001 */
export async function nextCountNo(session?: ClientSession): Promise<string> {
  const seq = await nextSequence('cc', session);
  return `CC-${new Date().getUTCFullYear()}-${pad(seq, 4)}`;
}

/** CO-YYYY-0001, used when a customer order is created without an order number. */
export async function nextCustomerOrderNo(session?: ClientSession): Promise<string> {
  const seq = await nextSequence('co', session);
  return `CO-${new Date().getUTCFullYear()}-${pad(seq, 4)}`;
}

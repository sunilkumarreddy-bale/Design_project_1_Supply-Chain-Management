/**
 * npm run dna:backfill — gives every existing stock slice without a DNA lot a lot (docs/Stock_DNA_Spec.md C.10).
 * Where the batch number is a received purchase order for that product, the birth comes from that order;
 * otherwise the lot is born as an opening balance marked "Backfilled from existing stock; true birth not recorded".
 * Idempotent: a second run finds nothing to do.
 */
import { connectDB, disconnectDB } from '../config/db';
import { PurchaseOrder, StockLot } from '../models';
import { auditIdle } from '../middleware/audit';
import { backfillLots, BirthHint } from '../services/stockService';
import { idStr } from '../utils/ids';

export async function purchaseHint(slice: Record<string, any>): Promise<BirthHint | null> {
  if (!slice.batchNo) return null;
  const po = await PurchaseOrder.findOne({ poNumber: slice.batchNo, 'items.product': slice.product }).lean();
  if (!po || !['received', 'partially_received'].includes(po.status)) return null;
  const item = po.items.find((i) => idStr(i.product) === idStr(slice.product));
  return {
    birthType: 'purchase_receipt',
    at: po.actualDeliveryDate ?? (po as { updatedAt?: Date }).updatedAt ?? new Date(),
    supplier: po.supplier,
    unitCost: item?.unitCost ?? null,
    refType: 'purchase_order',
    refId: po._id,
    explanation: `Born from ${po.poNumber} (receipt found in the purchase history during backfill)`,
  };
}

async function main() {
  await connectDB();
  const r = await backfillLots(purchaseHint);
  await auditIdle();
  const total = await StockLot.countDocuments();
  console.log(
    `Stock DNA backfill: ${r.slicesAdopted} slices adopted, ${r.lotsCreated} lots created ` +
      `(${r.backfilled} backfilled with no recorded birth, ${r.fromHistory} born from purchase history); ${total} lots in total`,
  );
  await disconnectDB();
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error('Backfill failed', e);
    await disconnectDB();
    process.exit(1);
  });
}

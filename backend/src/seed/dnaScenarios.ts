/**
 * Stock DNA seed scenarios (docs/Stock_DNA_Spec.md C.13). All data here is illustrative. Every change goes
 * through the stock service with a back-dated clock, so each lot carries a real, verifiable DNA story:
 *
 *  1. Milk, born to dead in 6 days (MLK-DNA-001): 500 received at Bengaluru, 380 moved to Chennai by an
 *     executed redistribution plan and sold on customer orders there, the 120 left at Bengaluru expire and
 *     are written off.
 *  2. USB-C cable, long life (CBL-LONG-01): received at Chennai, several dispatches, a count adjustment, alive.
 *  3. Recalled lot (BOX-RC-01): held at two warehouses, one customer order shipped, recall flagged.
 *  4. Quarantined lot (THP-QC-01) waiting for QC release.
 *  5. Depleted lot (BAT-SO-01, sold out) and its customer-return child lot (BAT-SO-01-R1).
 *  6. Backfilled lot (CBL-LEGACY-01) whose true birth was not recorded.
 */
import {
  CustomerOrder,
  Product,
  PurchaseOrder,
  RedistributionPlan,
  StockCount,
  StockLot,
  Supplier,
  Transfer,
  User,
  Warehouse,
} from '../models';
import type { AuthUser } from '../middleware/auth';
import { nextCountNo, nextPoNumber, nextRedistributionPlanNo } from '../services/counters';
import {
  acceptReturn,
  disposeLot,
  dispatchFefo,
  expireLot,
  flagRecall,
  postCountAdjustment,
  receiveLot,
  receiveTransfer,
  recordLegacyBalance,
  runStock,
  shipTransfer,
} from '../services/stockService';
import { DAY_MS } from '../utils/dates';

export const DNA_SCENARIO_BATCHES = [
  'MLK-DNA-001',
  'CBL-LONG-01',
  'BOX-RC-01',
  'THP-QC-01',
  'BAT-SO-01',
  'CBL-LEGACY-01',
];

type UserDoc = InstanceType<typeof User>;

function asActor(u: UserDoc): AuthUser {
  return {
    _id: u._id,
    id: u._id.toHexString(),
    name: u.name,
    email: u.email,
    role: u.role,
    warehouse: u.warehouse ? String(u.warehouse) : null,
    supplier: u.supplier ? String(u.supplier) : null,
  };
}

/** Creates the six scenarios unless they already exist. Returns the number of lots created. */
export async function seedDnaScenarios(now = new Date()): Promise<{ skipped: boolean; lots: number }> {
  if (await StockLot.exists({ batchNo: 'MLK-DNA-001' })) return { skipped: true, lots: 0 };
  const sku = async (s: string) => (await Product.findOne({ sku: s }))!;
  const whc = async (c: string) => (await Warehouse.findOne({ code: c }))!;
  const [milk, cable, box, paste, battery] = await Promise.all(
    ['SKU-MLK-020', 'SKU-CBL-002', 'SKU-BOX-003', 'SKU-THP-005', 'SKU-BAT-004'].map(sku),
  );
  const [blr, chn, ccu] = await Promise.all(['WH-NORTH', 'WH-SOUTH', 'WH-EAST'].map(whc));
  const admin = asActor((await User.findOne({ email: 'admin@example.com' }))!);
  const manager = asActor((await User.findOne({ email: 'manager@example.com' }))!);
  const staff = asActor((await User.findOne({ email: 'staff@example.com' }))!);
  const initech = (await Supplier.findOne({ name: /Initech/ }))!;
  const globex = (await Supplier.findOne({ name: /Globex/ }))!;
  const day = (offset: number) => new Date(now.getTime() + offset * DAY_MS);

  const receivedPO = async (
    supplier: typeof initech,
    warehouse: typeof blr,
    product: typeof milk,
    qty: number,
    unitCost: number,
    at: Date,
  ) =>
    PurchaseOrder.create({
      poNumber: await nextPoNumber(),
      supplier: supplier._id,
      warehouse: warehouse._id,
      items: [{ product: product._id, quantityOrdered: qty, quantityReceived: qty, unitCost }],
      status: 'received',
      source: 'manual',
      createdBy: manager._id,
      approvedBy: admin._id,
      approvedAt: new Date(at.getTime() - 2 * DAY_MS),
      expectedDeliveryDate: at,
      actualDeliveryDate: at,
      receivedBy: staff._id,
      notes: 'Stock DNA demo (illustrative)',
    });
  const order = async (
    orderNo: string,
    warehouse: typeof blr,
    product: typeof milk,
    qty: number,
    due: Date,
  ) =>
    CustomerOrder.create({
      orderNo,
      customerName: `Demo customer ${orderNo.slice(-2)}`,
      warehouse: warehouse._id,
      items: [{ product: product._id, quantity: qty }],
      requiredBy: due,
      priority: 'normal',
      createdBy: manager._id,
    });
  const ship = async (o: InstanceType<typeof CustomerOrder>, batchNo: string, at: Date, actor: AuthUser) => {
    const line = o.items[0];
    await runStock(
      actor,
      (ctx) =>
        dispatchFefo(ctx, {
          product: line.product,
          warehouse: o.warehouse,
          quantity: line.quantity,
          batchNo,
          refType: 'customer_order',
          refId: o._id,
          explanation: `Shipped ${line.quantity} on customer order ${o.orderNo}`,
        }),
      undefined,
      at,
    );
    line.quantityFulfilled = line.quantity;
    o.status = 'fulfilled';
    await o.save();
  };
  let lots = 0;

  // 1. Milk: born to dead in 6 days -------------------------------------------------------------------------------
  {
    const born = day(-7);
    const expiry = day(-1);
    const po = await receivedPO(initech, blr, milk, 500, 25, born);
    await runStock(
      staff,
      (ctx) =>
        receiveLot(ctx, {
          product: milk._id,
          warehouse: blr._id,
          bin: 'A1',
          batchNo: 'MLK-DNA-001',
          expiryDate: expiry,
          quantity: 500,
          unitCost: 25,
          supplier: initech._id,
          birthType: 'purchase_receipt',
          refType: 'purchase_order',
          refId: po._id,
          grnNo: `GRN-${po.poNumber}`,
          explanation: `Received 500 packets against ${po.poNumber} at WH-NORTH (illustrative)`,
        }),
      undefined,
      born,
    );
    lots++;
    const plan = await RedistributionPlan.create({
      planNo: await nextRedistributionPlanNo(),
      status: 'completed',
      product: milk._id,
      batchNo: 'MLK-DNA-001',
      sourceWarehouse: blr._id,
      sourceQuantity: 500,
      expiryDate: expiry,
      shelfLifeDaysLeft: 5.5,
      minShelfLifeDays: 1,
      sourceDailyDemand: 0,
      sourceOwnSalesUnits: 0,
      surplusUnits: 500,
      lines: [
        {
          toWarehouse: chn._id,
          toWarehouseName: chn.name,
          quantity: 380,
          transferLeadDays: 1,
          transferCostPerUnit: 1.5,
          sellWindowDays: 4,
          destDailyDemand: 120,
          destExistingUnits: 100,
          capacityUnits: 380,
          expectedSoldBeforeExpiry: 380,
        },
      ],
      residualUnits: 120,
      residualAdvice: 'markdown',
      explanation: [
        'Warehouse B can sell 120/day x 4 days = 480 before expiry; it holds 100; capacity 380 (illustrative)',
      ],
      createdBy: manager._id,
      approvedBy: admin._id,
      approvedAt: day(-6.6),
      timeline: [
        {
          at: day(-6.7),
          by: manager._id,
          event: 'proposed',
          detail: 'Seeded Stock DNA scenario (illustrative)',
        },
        { at: day(-6.6), by: admin._id, event: 'approved', detail: 'Approved' },
        { at: day(-5), by: manager._id, event: 'completed', detail: 'Transfer received' },
      ],
    });
    const t = await Transfer.create({
      product: milk._id,
      fromWarehouse: blr._id,
      toWarehouse: chn._id,
      quantity: 380,
      batchNo: 'MLK-DNA-001',
      status: 'approved',
      mode: 'tracked',
      source: 'redistribution_plan',
      plan: plan._id,
      planModel: 'RedistributionPlan',
      initiatedBy: admin._id,
      approvedBy: admin._id,
      approvedAt: day(-6.6),
    });
    plan.lines[0].transfer = t._id;
    await plan.save();
    const { result: allocations } = await runStock(
      staff,
      (ctx) => shipTransfer(ctx, t),
      undefined,
      day(-6.5),
    );
    t.allocations = allocations.map((a) => ({
      batchNo: a.batchNo,
      bin: a.bin,
      expiryDate: a.expiryDate,
      quantity: a.quantity,
      lot: a.lot,
    })) as never;
    Object.assign(t, { status: 'in_transit', dispatchedAt: day(-6.5) });
    await t.save();
    await runStock(manager, (ctx) => receiveTransfer(ctx, t, allocations), undefined, day(-5.5));
    Object.assign(t, { status: 'completed', receivedAt: day(-5.5), receivedBy: manager._id });
    await t.save();
    const sales = [
      ['CO-DNA-M1', 100, -5],
      ['CO-DNA-M2', 95, -4],
      ['CO-DNA-M3', 95, -3],
      ['CO-DNA-M4', 90, -2],
    ] as const;
    for (const [no, qty, at] of sales)
      await ship(await order(no, chn, milk, qty, day(at + 1)), 'MLK-DNA-001', day(at), manager);
    const lot = (await StockLot.findOne({ batchNo: 'MLK-DNA-001' }))!;
    await runStock(null, (ctx) => expireLot(ctx, lot._id), undefined, day(-0.95));
    await runStock(
      admin,
      (ctx) =>
        disposeLot(ctx, lot._id, {
          warehouse: blr._id,
          quantity: 120,
          cause: 'expired',
          reason: 'Expired milk sent to waste (illustrative)',
        }),
      admin._id,
      day(-0.9),
    );
  }

  // 2. USB-C cable: long life at Chennai ---------------------------------------------------------------------------
  {
    const born = day(-40);
    const po = await receivedPO(globex, chn, cable, 300, 120, born);
    await runStock(
      staff,
      (ctx) =>
        receiveLot(ctx, {
          product: cable._id,
          warehouse: chn._id,
          bin: 'A2',
          batchNo: 'CBL-LONG-01',
          quantity: 300,
          unitCost: 120,
          supplier: globex._id,
          birthType: 'purchase_receipt',
          refType: 'purchase_order',
          refId: po._id,
          grnNo: `GRN-${po.poNumber}`,
          explanation: `Received 300 against ${po.poNumber} at WH-SOUTH (illustrative)`,
        }),
      undefined,
      born,
    );
    lots++;
    for (const [qty, at] of [
      [60, -35],
      [50, -28],
      [40, -20],
      [50, -12],
    ] as const) {
      await runStock(
        manager,
        (ctx) =>
          dispatchFefo(ctx, {
            product: cable._id,
            warehouse: chn._id,
            quantity: qty,
            batchNo: 'CBL-LONG-01',
            explanation: `Dispatched ${qty} from WH-SOUTH (illustrative)`,
          }),
        undefined,
        day(at),
      );
    }
    const count = await StockCount.create({
      countNo: await nextCountNo(),
      warehouse: chn._id,
      status: 'reconciled',
      lines: [
        {
          product: cable._id,
          bin: 'A2',
          batchNo: 'CBL-LONG-01',
          systemQty: 100,
          countedQty: 97,
          variance: -3,
          reason: 'Missing on shelf (illustrative)',
        },
      ],
      createdBy: manager._id,
      submittedAt: day(-10),
      reconciledBy: manager._id,
      reconciledAt: day(-10),
    });
    await runStock(
      manager,
      (ctx) =>
        postCountAdjustment(ctx, {
          product: cable._id,
          warehouse: chn._id,
          bin: 'A2',
          batchNo: 'CBL-LONG-01',
          variance: -3,
          refId: count._id,
          countNo: count.countNo,
        }),
      undefined,
      day(-10),
    );
  }

  // 3. Recalled lot at two warehouses with one customer order shipped ---------------------------------------------
  {
    const born = day(-15);
    const po = await receivedPO(initech, blr, box, 200, 15, born);
    await runStock(
      staff,
      (ctx) =>
        receiveLot(ctx, {
          product: box._id,
          warehouse: blr._id,
          bin: 'B2',
          batchNo: 'BOX-RC-01',
          quantity: 200,
          unitCost: 15,
          supplier: initech._id,
          birthType: 'purchase_receipt',
          refType: 'purchase_order',
          refId: po._id,
          grnNo: `GRN-${po.poNumber}`,
          explanation: `Received 200 against ${po.poNumber} at WH-NORTH (illustrative)`,
        }),
      undefined,
      born,
    );
    lots++;
    const t = await Transfer.create({
      product: box._id,
      fromWarehouse: blr._id,
      toWarehouse: chn._id,
      quantity: 60,
      batchNo: 'BOX-RC-01',
      status: 'completed',
      mode: 'instant',
      source: 'manual',
      initiatedBy: manager._id,
      approvedBy: manager._id,
      approvedAt: day(-12),
      dispatchedAt: day(-12),
      receivedAt: day(-12),
      receivedBy: manager._id,
      notes: 'Stock DNA demo (illustrative)',
    });
    await runStock(
      manager,
      async (ctx) => {
        const a = await shipTransfer(ctx, t);
        await receiveTransfer(ctx, t, a);
        t.allocations = a.map((x) => ({
          batchNo: x.batchNo,
          bin: x.bin,
          expiryDate: x.expiryDate,
          quantity: x.quantity,
          lot: x.lot,
        })) as never;
        await t.save({ session: ctx.session });
      },
      undefined,
      day(-12),
    );
    await ship(await order('CO-DNA-R1', blr, box, 40, day(-7)), 'BOX-RC-01', day(-8), manager);
    const lot = (await StockLot.findOne({ batchNo: 'BOX-RC-01' }))!;
    await runStock(
      admin,
      (ctx) => flagRecall(ctx, lot._id, 'Supplier notice: carton glue fails humidity test (illustrative)'),
      undefined,
      day(-2),
    );
  }

  // 4. Quarantined lot waiting for QC ------------------------------------------------------------------------------
  await runStock(
    staff,
    (ctx) =>
      receiveLot(ctx, {
        product: paste._id,
        warehouse: blr._id,
        bin: 'A3',
        batchNo: 'THP-QC-01',
        expiryDate: day(300),
        quantity: 60,
        supplier: paste.primarySupplier,
        birthType: 'purchase_receipt',
        hold: true,
        explanation: 'Received 60 tubes held for QC inspection (illustrative)',
      }),
    undefined,
    day(-1),
  );
  lots++;

  // 5. Sold-out lot and its customer-return child ------------------------------------------------------------------
  {
    await runStock(
      staff,
      (ctx) =>
        receiveLot(ctx, {
          product: battery._id,
          warehouse: blr._id,
          bin: 'A3',
          batchNo: 'BAT-SO-01',
          expiryDate: day(400),
          quantity: 40,
          supplier: battery.primarySupplier,
          birthType: 'purchase_receipt',
          explanation: 'Received 40 batteries (illustrative)',
        }),
      undefined,
      day(-20),
    );
    lots++;
    const o = await order('CO-DNA-S1', blr, battery, 40, day(-9));
    await ship(o, 'BAT-SO-01', day(-10), manager);
    const parent = (await StockLot.findOne({ batchNo: 'BAT-SO-01' }))!;
    await runStock(
      manager,
      (ctx) =>
        acceptReturn(ctx, parent._id, {
          warehouse: blr._id,
          bin: 'A3',
          quantity: 3,
          reason: 'Customer returned unopened packs (illustrative)',
          refType: 'customer_order',
          refId: o._id,
        }),
      undefined,
      day(-6),
    );
    lots++;
  }

  // 6. Backfilled lot: stock carried over without a recorded birth -------------------------------------------------
  await runStock(
    null,
    (ctx) =>
      recordLegacyBalance(ctx, {
        product: cable._id,
        warehouse: ccu._id,
        bin: 'A1',
        batchNo: 'CBL-LEGACY-01',
        quantity: 15,
        at: day(-60),
      }),
    undefined,
    day(-60),
  );
  lots++;
  return { skipped: false, lots };
}

/** npm run seed:dna — adds the scenarios to an already seeded database (skips when they exist). */
async function main() {
  const { connectDB, disconnectDB } = await import('../config/db');
  const { auditIdle } = await import('../middleware/audit');
  const { flushNotifications } = await import('../services/notifications');
  await connectDB();
  const r = await seedDnaScenarios();
  await auditIdle();
  await flushNotifications();
  console.log(
    r.skipped
      ? 'Stock DNA scenarios already present, nothing to do'
      : `Stock DNA scenarios seeded: ${r.lots} lots (illustrative data)`,
  );
  await disconnectDB();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('seed:dna failed', e);
    process.exit(1);
  });
}

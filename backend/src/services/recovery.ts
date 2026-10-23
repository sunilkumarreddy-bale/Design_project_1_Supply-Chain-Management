/** Self-Healing Recovery Engine service (M5): loads live data, runs the pure engine, manages plans. */
import { Types } from 'mongoose';
import {
  OPEN_PO_STATUSES,
  PurchaseOrder,
  RecoveryPlan,
  StockLevel,
  Supplier,
  SupplierOffer,
  Warehouse,
} from '../models';
import { analyzeRecovery, RecoveryResult, SupplierOfferInput, TransferSourceInput } from '../engines/recoveryEngine';
import { withTransaction } from '../config/db';
import { ApiError } from '../utils/apiError';
import { addDays } from '../utils/dates';
import { idStr, snapshot } from '../utils/ids';
import { fmt, rupees } from '../utils/format';
import { recordAudit } from '../middleware/audit';
import type { AuthUser } from '../middleware/auth';
import { emitAll } from '../sockets';
import { demandAt, loadPlanningProduct, minStockAt, onHandMap } from './planning';
import { resolveRoute } from './routes';
import { nextPoNumber, nextRecoveryPlanNo } from './counters';
import { raiseAlert, resolveAlerts } from './alerts';
import { notifySafe } from './notifications';
import { createTrackedTransfer } from './transfers';
import { notifySupplierOfApproval } from './purchaseOrders';
import { requireActiveWarehouse } from './inventory';

export interface RecoveryAnalysisInput {
  product: string;
  warehouse: string;
  horizonDays?: number | null;
  requiredUnits?: number | null;
  excludeSupplier?: string | null;
  trigger?: { kind: 'supplier_delay' | 'shortage_alert' | 'manual'; supplier?: string | null; delayDays?: number | null } | null;
}

export interface RecoveryAnalysis {
  input: RecoveryAnalysisInput;
  product: { _id: string; sku: string; name: string; unitCost: number };
  targetWarehouse: { _id: string; code: string; name: string };
  excludedSupplier: { _id: string; name: string } | null;
  horizonSource: string;
  trigger: { kind: string; supplier: string | null; delayDays: number | null };
  asOf: Date;
  result: RecoveryResult;
}

export async function analyze(input: RecoveryAnalysisInput, now = new Date()): Promise<RecoveryAnalysis> {
  const product = await loadPlanningProduct(input.product);
  const target = await requireActiveWarehouse(input.warehouse);
  const primary = product.primarySupplier ?? null;

  type SupplierRef = { _id: Types.ObjectId; name: string; status: string; disruption?: { expectedDays: number } | null };
  let excluded: SupplierRef | null = null;
  if (input.excludeSupplier) {
    const s = await Supplier.findById(input.excludeSupplier).lean();
    if (!s) throw ApiError.notFound('Supplier to exclude not found');
    excluded = s as unknown as SupplierRef;
  } else if (primary && primary.status === 'disrupted') {
    excluded = primary as unknown as SupplierRef;
  }

  let horizon = input.horizonDays ?? null;
  let horizonSource = 'given';
  if (!horizon) {
    const disrupted = excluded?.disruption ? excluded : primary?.status === 'disrupted' ? primary : null;
    if (disrupted?.disruption?.expectedDays) {
      horizon = disrupted.disruption.expectedDays;
      horizonSource = `${disrupted.name} disruption (${disrupted.disruption.expectedDays} days)`;
    } else {
      horizon = 7;
      horizonSource = 'default 7 days';
    }
  }
  horizon = Math.max(1, horizon);

  const T = target._id.toHexString();
  const horizonEnd = addDays(now, horizon);
  const [ohT, demandT, minT, openPOs] = await Promise.all([
    onHandMap([product._id], [T]),
    demandAt(product, T, now),
    minStockAt(product, T),
    PurchaseOrder.find({
      warehouse: T,
      status: { $in: OPEN_PO_STATUSES },
      'items.product': product._id,
      expectedDeliveryDate: { $ne: null, $lte: horizonEnd },
      ...(excluded ? { supplier: { $ne: excluded._id } } : {}),
    }).lean(),
  ]);
  const inbound = openPOs.reduce((s, po) => {
    const it = po.items.find((i) => i.product.equals(product._id));
    return s + (it ? Math.max(0, it.quantityOrdered - it.quantityReceived) : 0);
  }, 0);
  const onHand = ohT.get(`${T}:${product._id.toHexString()}`) ?? 0;

  // transfer sources: other active warehouses holding stock with a (stored or estimated) route to the target
  const holders = await StockLevel.distinct('warehouse', { product: product._id, quantity: { $gt: 0 }, warehouse: { $ne: target._id } });
  const warehouses = await Warehouse.find({ _id: { $in: holders }, isActive: true }).lean();
  const ohAll = await onHandMap([product._id], warehouses.map((w) => w._id));
  const transferSources: TransferSourceInput[] = [];
  for (const w of warehouses) {
    const route = await resolveRoute(w._id, T);
    if (!route) continue;
    const id = w._id.toHexString();
    const [d, m] = await Promise.all([demandAt(product, id, now), minStockAt(product, id)]);
    transferSources.push({
      warehouseId: id,
      warehouseName: w.name,
      onHand: ohAll.get(`${id}:${product._id.toHexString()}`) ?? 0,
      minStock: m.minStock,
      dailyDemand: d.mean,
      leadTimeDays: route.leadTimeDays,
      costPerUnit: route.costPerUnit,
      estimatedRoute: route.estimated,
    });
  }

  const offers = await SupplierOffer.find({ product: product._id, isActive: true }).populate('supplier').lean();
  const supplierOffers: SupplierOfferInput[] = offers
    .filter((o) => {
      const s = o.supplier as unknown as { _id: Types.ObjectId; status: string; isActive: boolean } | null;
      if (!s || !s.isActive || s.status !== 'active') return false;
      if (excluded && s._id.equals(excluded._id)) return false;
      return !o.validUntil || new Date(o.validUntil) >= now;
    })
    .map((o) => {
      const s = o.supplier as unknown as { _id: Types.ObjectId; name: string };
      return {
        supplierId: s._id.toHexString(),
        supplierName: s.name,
        capacityUnits: o.capacityUnits,
        minOrderQty: o.minOrderQty,
        leadTimeDays: o.leadTimeDays,
        unitCost: o.unitCost,
        offerId: o._id.toHexString(),
      };
    });

  const result = analyzeRecovery({
    productName: product.name,
    targetWarehouseName: target.name,
    horizonDays: horizon,
    requiredUnits: input.requiredUnits ?? null,
    onHand,
    inbound,
    dailyDemand: demandT.mean,
    minStock: minT.minStock,
    transferSources,
    supplierOffers,
  });
  const trigger = input.trigger
    ? { kind: input.trigger.kind, supplier: input.trigger.supplier ?? null, delayDays: input.trigger.delayDays ?? null }
    : excluded
      ? { kind: 'supplier_delay', supplier: excluded._id.toHexString(), delayDays: horizon }
      : { kind: 'manual', supplier: null, delayDays: null };
  return {
    input: { ...input, horizonDays: input.horizonDays ?? null },
    product: { _id: product._id.toHexString(), sku: product.sku, name: product.name, unitCost: product.unitCost },
    targetWarehouse: { _id: T, code: target.code, name: target.name },
    excludedSupplier: excluded ? { _id: excluded._id.toHexString(), name: excluded.name } : null,
    horizonSource,
    trigger,
    asOf: now,
    result,
  };
}

function scopeCheck(user: AuthUser, warehouseId: unknown) {
  if (user.role === 'warehouse_manager' && user.warehouse !== idStr(warehouseId)) {
    throw ApiError.forbidden('Managers can only propose or cancel plans for their own warehouse');
  }
}

export async function proposePlan(analysisInput: RecoveryAnalysisInput, selectedOptionId: string, user: AuthUser) {
  scopeCheck(user, analysisInput.warehouse);
  const a = await analyze(analysisInput);
  if (!a.result.needed) throw ApiError.conflict('No shortage within the horizon any more; nothing to propose');
  const option = a.result.options.find((o) => o.optionId === selectedOptionId);
  if (!option) throw ApiError.conflict('The selected option is no longer available, please analyze again');
  const plan = await RecoveryPlan.create({
    planNo: await nextRecoveryPlanNo(),
    status: 'proposed',
    trigger: a.trigger,
    product: a.product._id,
    targetWarehouse: a.targetWarehouse._id,
    context: { ...a.result.context, asOf: a.asOf },
    options: a.result.options,
    selectedOptionId,
    createdBy: user._id,
    timeline: [
      {
        at: new Date(),
        by: user._id,
        event: 'proposed',
        detail: `${option.label}: covers ${fmt(Math.min(option.coveredUnits, a.result.context.requiredUnits))} of ${fmt(
          a.result.context.requiredUnits,
        )} units for ${rupees(option.totalCost)}, ETA ${fmt(option.etaDays)} day(s)`,
      },
    ],
  });
  await recordAudit({ action: 'recovery.propose', entityType: 'RecoveryPlan', entityId: plan._id, actor: user, warehouse: plan.targetWarehouse, after: plan });
  await raiseAlert({
    type: 'recovery_proposed',
    severity: 'warning',
    product: plan.product,
    warehouse: plan.targetWarehouse,
    plan: plan._id,
    key: plan._id.toHexString(),
    message: `Recovery plan ${plan.planNo} for ${a.product.sku} at ${a.targetWarehouse.name} awaits approval (${option.label}, ${rupees(
      option.totalCost,
    )})`,
  });
  await notifySafe(
    { roles: ['admin'] },
    {
      type: 'recovery.proposed',
      subject: `Recovery plan ${plan.planNo} proposed`,
      body: `${user.name} proposed "${option.label}" for ${a.product.sku} at ${a.targetWarehouse.name}: shortage left ${fmt(
        option.shortageLeft,
      )}, cost ${rupees(option.totalCost)}`,
      link: `/recovery/${plan._id}`,
    },
  );
  emitAll('recovery:update', { _id: plan._id, status: plan.status, planNo: plan.planNo });
  return plan;
}

export async function loadPlan(id: string) {
  const plan = await RecoveryPlan.findById(id);
  if (!plan) throw ApiError.notFound('Recovery plan not found');
  return plan;
}

/** Approval executes the selected option in one transaction: tracked transfers (approved) and approved PO(s). */
export async function approvePlan(id: string, user: AuthUser) {
  const pre = await loadPlan(id);
  if (pre.status !== 'proposed') throw ApiError.conflict(`Plan ${pre.planNo} is ${pre.status}, only proposed plans can be approved`);
  const before = snapshot(pre);
  const option = pre.options.find((o) => o.optionId === pre.selectedOptionId);
  if (!option) throw ApiError.conflict('Selected option is missing from the plan');

  const out = await withTransaction(async (session) => {
    const plan = await RecoveryPlan.findById(id).session(session);
    if (!plan || plan.status !== 'proposed') throw ApiError.conflict('Plan is no longer proposed');
    const transfers = [];
    for (const st of option.steps.filter((s) => s.type === 'transfer')) {
      const t = await createTrackedTransfer(
        {
          product: idStr(plan.product)!,
          fromWarehouse: idStr(st.fromWarehouse)!,
          toWarehouse: idStr(plan.targetWarehouse)!,
          quantity: st.quantity,
          source: 'recovery_plan',
          plan: plan._id,
          planModel: 'RecoveryPlan',
          preApproved: true,
          notes: `Recovery plan ${plan.planNo}`,
        },
        user,
        session,
      );
      transfers.push(t);
    }
    const purchases = option.steps.filter((s) => s.type === 'purchase');
    const bySupplier = new Map<string, typeof purchases>();
    for (const p of purchases) {
      const k = idStr(p.supplier)!;
      if (!bySupplier.has(k)) bySupplier.set(k, []);
      bySupplier.get(k)!.push(p);
    }
    const pos = [];
    const now = new Date();
    for (const [supplierId, steps] of bySupplier) {
      const qty = steps.reduce((s, x) => s + x.quantity, 0);
      const lead = Math.max(...steps.map((s) => s.leadTimeDays ?? 0));
      const [po] = await PurchaseOrder.create(
        [
          {
            poNumber: await nextPoNumber(session),
            supplier: supplierId,
            warehouse: plan.targetWarehouse,
            items: [{ product: plan.product, quantityOrdered: qty, quantityReceived: 0, unitCost: steps[0].unitCost }],
            status: 'approved',
            source: 'recovery_plan',
            recoveryPlan: plan._id,
            expectedDeliveryDate: addDays(now, Math.max(1, Math.ceil(lead))),
            createdBy: plan.createdBy,
            approvedBy: user._id,
            approvedAt: now,
            notes: `Recovery plan ${plan.planNo}`,
          },
        ],
        { session },
      );
      pos.push(po);
    }
    plan.status = 'in_progress';
    plan.approvedBy = user._id;
    plan.approvedAt = now;
    plan.execution = {
      transfers: transfers.map((t) => t._id),
      purchaseOrder: pos[0]?._id ?? null,
      purchaseOrders: pos.map((p) => p._id),
      completedAt: null,
    } as any;
    plan.timeline.push({ at: now, by: user._id, event: 'approved', detail: `Approved by ${user.name}` });
    plan.timeline.push({
      at: now,
      by: user._id,
      event: 'in_progress',
      detail: `Created ${transfers.length} transfer(s) and ${pos.length} purchase order(s)${pos.length ? `: ${pos.map((p) => p.poNumber).join(', ')}` : ''}`,
    });
    await plan.save({ session });
    return { plan, transfers, pos };
  });

  const { plan, transfers, pos } = out;
  for (const t of transfers) {
    await recordAudit({ action: 'transfer.create', entityType: 'Transfer', entityId: t._id, actor: user, warehouse: t.fromWarehouse, after: t, metadata: { plan: plan.planNo } });
    emitAll('transfer:update', t.toJSON());
  }
  for (const po of pos) {
    await recordAudit({ action: 'po.create', entityType: 'PurchaseOrder', entityId: po._id, actor: user, warehouse: po.warehouse, after: po, metadata: { plan: plan.planNo } });
    emitAll('po:approved', po.toJSON());
    await notifySupplierOfApproval(po, await Supplier.findById(po.supplier));
  }
  await recordAudit({ action: 'recovery.approve', entityType: 'RecoveryPlan', entityId: plan._id, actor: user, warehouse: plan.targetWarehouse, before, after: plan });
  await resolveAlerts({ type: 'recovery_proposed', key: plan._id.toHexString() }, user._id);
  emitAll('recovery:update', { _id: plan._id, status: plan.status, planNo: plan.planNo });
  await notifySafe(
    { userIds: [plan.createdBy] },
    { type: 'recovery.approved', subject: `Recovery plan ${plan.planNo} approved`, body: `Approved by ${user.name}`, link: `/recovery/${plan._id}` },
  );
  return plan;
}

export async function rejectPlan(id: string, reason: string, user: AuthUser) {
  const plan = await loadPlan(id);
  if (plan.status !== 'proposed') throw ApiError.conflict(`Plan ${plan.planNo} is ${plan.status}`);
  const before = snapshot(plan);
  plan.status = 'rejected';
  plan.rejectedReason = reason;
  plan.timeline.push({ at: new Date(), by: user._id, event: 'rejected', detail: reason });
  await plan.save();
  await recordAudit({ action: 'recovery.reject', entityType: 'RecoveryPlan', entityId: plan._id, actor: user, warehouse: plan.targetWarehouse, before, after: plan });
  await resolveAlerts({ type: 'recovery_proposed', key: plan._id.toHexString() }, user._id);
  emitAll('recovery:update', { _id: plan._id, status: plan.status, planNo: plan.planNo });
  await notifySafe(
    { userIds: [plan.createdBy] },
    { type: 'recovery.rejected', subject: `Recovery plan ${plan.planNo} rejected`, body: reason, link: `/recovery/${plan._id}` },
  );
  return plan;
}

export async function cancelPlan(id: string, user: AuthUser) {
  const plan = await loadPlan(id);
  scopeCheck(user, plan.targetWarehouse);
  if (plan.status !== 'proposed') throw ApiError.conflict(`Only proposed plans can be cancelled (plan is ${plan.status})`);
  const before = snapshot(plan);
  plan.status = 'cancelled';
  plan.timeline.push({ at: new Date(), by: user._id, event: 'cancelled', detail: `Cancelled by ${user.name}` });
  await plan.save();
  await recordAudit({ action: 'recovery.cancel', entityType: 'RecoveryPlan', entityId: plan._id, actor: user, warehouse: plan.targetWarehouse, before, after: plan });
  await resolveAlerts({ type: 'recovery_proposed', key: plan._id.toHexString() }, user._id);
  emitAll('recovery:update', { _id: plan._id, status: plan.status, planNo: plan.planNo });
  return plan;
}

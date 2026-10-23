/** Expiry-Aware Stock Redistribution service (M7): scan, analyze, propose and execute plans. */
import { RedistributionPlan, StockLevel, StockPolicy, Warehouse } from '../models';
import { analyzeRedistribution, RedistributionDestination, RedistributionResult } from '../engines/redistributionEngine';
import { projectExpiryWaste } from '../engines/inventoryLogic';
import { withTransaction } from '../config/db';
import { ApiError } from '../utils/apiError';
import { DAY_MS } from '../utils/dates';
import { idStr, snapshot } from '../utils/ids';
import { fmt } from '../utils/format';
import { recordAudit } from '../middleware/audit';
import type { AuthUser } from '../middleware/auth';
import { emitAll } from '../sockets';
import { demandAt, demandMap, loadPlanningProduct, loadPlanningProducts, onHandMap, onOrderMap, posKey } from './planning';
import { resolveRoute } from './routes';
import { nextRedistributionPlanNo } from './counters';
import { raiseAlert, resolveAlerts } from './alerts';
import { notifySafe } from './notifications';
import { createTrackedTransfer } from './transfers';

export interface BatchAnalysis {
  stockLevelId: string;
  product: { _id: string; sku: string; name: string; unitCost: number; minShelfLifeDays: number };
  source: { _id: string; code: string; name: string };
  batchNo: string;
  bin: string;
  quantity: number;
  expiryDate: Date;
  asOf: Date;
  result: RedistributionResult;
  notes: string[];
}

export async function analyzeBatch(stockLevelId: string, minShelfLifeDays?: number | null, now = new Date()): Promise<BatchAnalysis> {
  const line = await StockLevel.findById(stockLevelId).lean();
  if (!line) throw ApiError.notFound('Stock line not found');
  if (!line.expiryDate) throw ApiError.badRequest('This stock line has no expiry date');
  if (line.quantity <= 0) throw ApiError.badRequest('This stock line is empty');
  const product = await loadPlanningProduct(line.product);
  const source = await Warehouse.findById(line.warehouse).lean();
  if (!source) throw ApiError.notFound('Warehouse not found');
  const A = source._id.toHexString();
  const m = minShelfLifeDays ?? product.minShelfLifeDays ?? 1;
  const dA = await demandAt(product, A, now);

  const others = await Warehouse.find({ _id: { $ne: source._id }, isActive: true }).lean();
  const ids = others.map((w) => w._id.toHexString());
  const [oh, oo, dm, policies] = await Promise.all([
    onHandMap([product._id], ids),
    onOrderMap([product._id], ids),
    demandMap([product], ids, now),
    StockPolicy.find({ product: product._id, warehouse: { $in: ids } }).lean(),
  ]);
  const destinations: RedistributionDestination[] = [];
  const notes: string[] = [];
  for (const w of others) {
    const id = w._id.toHexString();
    const key = posKey(id, product._id);
    const d = dm.get(key)!.mean;
    if (!(d > 0)) {
      notes.push(`${w.name}: no demand for ${product.sku}, not a destination`);
      continue;
    }
    const route = await resolveRoute(A, id);
    if (!route) {
      notes.push(`${w.name}: no route from ${source.name} and no location to estimate one`);
      continue;
    }
    destinations.push({
      warehouseId: id,
      warehouseName: w.name,
      leadTimeDays: route.leadTimeDays,
      costPerUnit: route.costPerUnit,
      dailyDemand: d,
      onHand: oh.get(key) ?? 0,
      onOrder: oo.get(key) ?? 0,
      maxStock: policies.find((p) => p.warehouse.toHexString() === id)?.maxStock ?? null,
    });
  }
  const result = analyzeRedistribution({
    batch: {
      stockLevelId,
      productName: product.name,
      batchNo: line.batchNo,
      quantity: line.quantity,
      expiryDate: line.expiryDate,
      warehouseId: A,
      warehouseName: source.name,
      unitCost: product.unitCost,
    },
    now,
    minShelfLifeDays: m,
    sourceDailyDemand: dA.mean,
    destinations,
  });
  result.explanation.push(...notes);
  return {
    stockLevelId,
    product: {
      _id: product._id.toHexString(),
      sku: product.sku,
      name: product.name,
      unitCost: product.unitCost,
      minShelfLifeDays: product.minShelfLifeDays ?? 1,
    },
    source: { _id: A, code: source.code, name: source.name },
    batchNo: line.batchNo,
    bin: line.bin,
    quantity: line.quantity,
    expiryDate: line.expiryDate,
    asOf: now,
    result,
    notes,
  };
}

/** Scans every dated batch; returns candidate plans (not saved) for batches with projected waste > 0. */
export async function scan(now = new Date()) {
  const lines = await StockLevel.find({ expiryDate: { $ne: null }, quantity: { $gt: 0 } }).lean();
  if (!lines.length) return [];
  const productIds = [...new Set(lines.map((l) => l.product.toHexString()))];
  const products = await loadPlanningProducts({ _id: { $in: productIds } });
  const whIds = [...new Set(lines.map((l) => l.warehouse.toHexString()))];
  const dm = await demandMap(products, whIds, now);
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    const k = posKey(l.warehouse, l.product);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(l);
  }
  const candidates = [];
  for (const [k, ls] of groups) {
    const product = products.find((p) => p._id.equals(ls[0].product));
    if (!product) continue;
    const proj = projectExpiryWaste(
      ls.map((l) => ({ id: l._id.toHexString(), batchNo: l.batchNo, bin: l.bin, expiryDate: l.expiryDate, quantity: l.quantity })),
      dm.get(k)?.mean ?? product.avgDailyDemand,
      now,
      product.unitCost,
    );
    for (const pl of proj.lines.filter((x) => x.wasteUnits > 0)) {
      const analysis = await analyzeBatch(pl.id!, null, now);
      candidates.push({
        ...analysis,
        daysLeft: Math.floor((pl.expiryDate.getTime() - now.getTime()) / DAY_MS),
        projectedWaste: pl.wasteUnits,
        valueAtRisk: pl.valueAtRisk,
      });
    }
  }
  return candidates.sort((a, b) => b.valueAtRisk - a.valueAtRisk);
}

function scopeCheck(user: AuthUser, warehouseId: unknown) {
  if (user.role === 'warehouse_manager' && user.warehouse !== idStr(warehouseId)) {
    throw ApiError.forbidden('Managers can only propose or cancel plans for their own warehouse');
  }
}

export async function proposePlan(stockLevelId: string, minShelfLifeDays: number | null | undefined, user: AuthUser) {
  const a = await analyzeBatch(stockLevelId, minShelfLifeDays);
  scopeCheck(user, a.source._id);
  if (!a.result.lines.length) throw ApiError.conflict('No destination can sell this batch before it expires; nothing to propose');
  const r = a.result;
  const plan = await RedistributionPlan.create({
    planNo: await nextRedistributionPlanNo(),
    status: 'proposed',
    product: a.product._id,
    stockLevel: a.stockLevelId,
    batchNo: a.batchNo,
    sourceWarehouse: a.source._id,
    sourceQuantity: a.quantity,
    expiryDate: a.expiryDate,
    shelfLifeDaysLeft: r.shelfLifeDaysLeft,
    minShelfLifeDays: r.minShelfLifeDays,
    sourceDailyDemand: r.sourceDailyDemand,
    sourceOwnSalesUnits: r.sourceOwnSalesUnits,
    surplusUnits: r.surplusUnits,
    lines: r.lines.map((l) => ({ ...l, transfer: null })),
    residualUnits: r.residualUnits,
    residualAdvice: r.residualAdvice,
    explanation: r.explanation,
    createdBy: user._id,
    timeline: [
      {
        at: new Date(),
        by: user._id,
        event: 'proposed',
        detail: `Move ${fmt(r.allocatedUnits)} of ${fmt(a.quantity)} units to ${r.lines.map((l) => l.toWarehouseName).join(', ')}; residual ${fmt(
          r.residualUnits,
        )} (${r.residualAdvice})`,
      },
    ],
  });
  await recordAudit({ action: 'redistribution.propose', entityType: 'RedistributionPlan', entityId: plan._id, actor: user, warehouse: plan.sourceWarehouse, after: plan });
  await raiseAlert({
    type: 'redistribution_proposed',
    severity: 'warning',
    product: plan.product,
    warehouse: plan.sourceWarehouse,
    plan: plan._id,
    key: plan._id.toHexString(),
    message: `Redistribution plan ${plan.planNo} for ${a.product.sku} batch ${a.batchNo || '(none)'} (${fmt(r.shelfLifeDaysLeft)} days left) awaits approval`,
  });
  await notifySafe(
    { roles: ['admin'] },
    {
      type: 'redistribution.proposed',
      subject: `Redistribution plan ${plan.planNo} proposed`,
      body: `${user.name} proposes moving ${fmt(r.allocatedUnits)} units of ${a.product.sku} from ${a.source.name} before expiry`,
      link: `/redistribution?plan=${plan._id}`,
    },
  );
  emitAll('redistribution:update', { _id: plan._id, status: plan.status, planNo: plan.planNo });
  return plan;
}

export async function loadPlan(id: string) {
  const plan = await RedistributionPlan.findById(id);
  if (!plan) throw ApiError.notFound('Redistribution plan not found');
  return plan;
}

/** Approval creates one approved tracked transfer per line, each limited to the plan's batch. */
export async function approvePlan(id: string, user: AuthUser) {
  const pre = await loadPlan(id);
  if (pre.status !== 'proposed') throw ApiError.conflict(`Plan ${pre.planNo} is ${pre.status}, only proposed plans can be approved`);
  const before = snapshot(pre);
  const { plan, transfers } = await withTransaction(async (session) => {
    const plan = await RedistributionPlan.findById(id).session(session);
    if (!plan || plan.status !== 'proposed') throw ApiError.conflict('Plan is no longer proposed');
    const available = await StockLevel.aggregate([
      { $match: { product: plan.product, warehouse: plan.sourceWarehouse, batchNo: plan.batchNo } },
      { $group: { _id: null, q: { $sum: '$quantity' } } },
    ]).session(session);
    const needed = plan.lines.reduce((s, l) => s + l.quantity, 0);
    if ((available[0]?.q ?? 0) < needed) {
      throw ApiError.conflict(`Batch ${plan.batchNo} now holds ${available[0]?.q ?? 0} units, fewer than the ${needed} planned; analyze again`);
    }
    const transfers = [];
    for (const line of plan.lines) {
      const t = await createTrackedTransfer(
        {
          product: idStr(plan.product)!,
          fromWarehouse: idStr(plan.sourceWarehouse)!,
          toWarehouse: idStr(line.toWarehouse)!,
          quantity: line.quantity,
          batchNo: plan.batchNo,
          source: 'redistribution_plan',
          plan: plan._id,
          planModel: 'RedistributionPlan',
          preApproved: true,
          notes: `Redistribution plan ${plan.planNo}`,
        },
        user,
        session,
      );
      line.transfer = t._id;
      transfers.push(t);
    }
    const now = new Date();
    plan.status = 'in_progress';
    plan.approvedBy = user._id;
    plan.approvedAt = now;
    plan.timeline.push({ at: now, by: user._id, event: 'approved', detail: `Approved by ${user.name}` });
    plan.timeline.push({ at: now, by: user._id, event: 'in_progress', detail: `Created ${transfers.length} tracked transfer(s)` });
    await plan.save({ session });
    return { plan, transfers };
  });
  for (const t of transfers) {
    await recordAudit({ action: 'transfer.create', entityType: 'Transfer', entityId: t._id, actor: user, warehouse: t.fromWarehouse, after: t, metadata: { plan: plan.planNo } });
    emitAll('transfer:update', t.toJSON());
  }
  await recordAudit({ action: 'redistribution.approve', entityType: 'RedistributionPlan', entityId: plan._id, actor: user, warehouse: plan.sourceWarehouse, before, after: plan });
  await resolveAlerts({ type: 'redistribution_proposed', key: plan._id.toHexString() }, user._id);
  emitAll('redistribution:update', { _id: plan._id, status: plan.status, planNo: plan.planNo });
  await notifySafe(
    { userIds: [plan.createdBy] },
    { type: 'redistribution.approved', subject: `Redistribution plan ${plan.planNo} approved`, body: `Approved by ${user.name}`, link: `/redistribution?plan=${plan._id}` },
  );
  return plan;
}

async function close(id: string, status: 'rejected' | 'cancelled', user: AuthUser, reason = '') {
  const plan = await loadPlan(id);
  if (status === 'cancelled') scopeCheck(user, plan.sourceWarehouse);
  if (plan.status !== 'proposed') throw ApiError.conflict(`Only proposed plans can be ${status} (plan is ${plan.status})`);
  const before = snapshot(plan);
  plan.status = status;
  if (reason) plan.rejectedReason = reason;
  plan.timeline.push({ at: new Date(), by: user._id, event: status, detail: reason || `${status} by ${user.name}` });
  await plan.save();
  await recordAudit({
    action: `redistribution.${status === 'rejected' ? 'reject' : 'cancel'}`,
    entityType: 'RedistributionPlan',
    entityId: plan._id,
    actor: user,
    warehouse: plan.sourceWarehouse,
    before,
    after: plan,
  });
  await resolveAlerts({ type: 'redistribution_proposed', key: plan._id.toHexString() }, user._id);
  emitAll('redistribution:update', { _id: plan._id, status: plan.status, planNo: plan.planNo });
  if (status === 'rejected') {
    await notifySafe(
      { userIds: [plan.createdBy] },
      { type: 'redistribution.rejected', subject: `Redistribution plan ${plan.planNo} rejected`, body: reason, link: `/redistribution?plan=${plan._id}` },
    );
  }
  return plan;
}

export const rejectPlan = (id: string, reason: string, user: AuthUser) => close(id, 'rejected', user, reason);
export const cancelPlan = (id: string, user: AuthUser) => close(id, 'cancelled', user);

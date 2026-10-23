/**
 * Planning service: loads live positions (on-hand, on-order), per-warehouse demand and supplier lead-time
 * statistics, and feeds them to the pure reorder / analytics engines.
 */
import { Types } from 'mongoose';
import {
  DemandHistory,
  OPEN_PO_STATUSES,
  Product,
  PurchaseOrder,
  StockLevel,
  StockPolicy,
  Warehouse,
} from '../models';
import { explainReorder, ReorderExplanation, ReorderSupplierInput, resolveLeadTime } from '../engines/reorder';
import {
  classifyABC,
  classifyXYZ,
  coefficientOfVariation,
  daysOfCover,
  DemandEstimate,
  estimateDemand,
  policyHint,
  recommendedZ,
} from '../engines/analytics';
import { planRebalance, projectExpiryWaste } from '../engines/inventoryLogic';
import { minStockFor } from '../engines/recoveryEngine';
import { addDays, DAY_MS, startOfUtcDay } from '../utils/dates';
import { idStr } from '../utils/ids';
import { fmt } from '../utils/format';
import { ApiError } from '../utils/apiError';

export const DEMAND_WINDOW_DAYS = 30;
export const ALL = '*';

export const posKey = (warehouse: unknown, product: unknown) => `${idStr(warehouse) ?? ALL}:${idStr(product)}`;

type Id = Types.ObjectId | string;
const oid = (v: Id) => (typeof v === 'string' ? new Types.ObjectId(v) : v);

export interface PlanningProduct {
  _id: Types.ObjectId;
  sku: string;
  name: string;
  category?: string;
  unit?: string;
  unitCost: number;
  unitPrice: number;
  avgDailyDemand: number;
  demandStdDev: number;
  leadTimeDaysOverride?: number | null;
  serviceLevelZ: number;
  orderCost: number;
  holdingCostPerUnitYear: number;
  annualDemandOverride?: number | null;
  isPerishable?: boolean;
  minShelfLifeDays?: number;
  primarySupplier?: PlanningSupplier | null;
}

export interface PlanningSupplier {
  _id: Types.ObjectId;
  name: string;
  status: string;
  leadTimeDays: number;
  leadTimeSamples: number;
  leadTimeSum: number;
  leadTimeSumSq: number;
  disruption?: { from: Date; expectedDays: number; reason: string } | null;
}

export function supplierInput(s: PlanningSupplier | null | undefined): ReorderSupplierInput | null {
  if (!s) return null;
  return {
    name: s.name,
    leadTimeDays: s.leadTimeDays,
    leadTimeSamples: s.leadTimeSamples ?? 0,
    leadTimeSum: s.leadTimeSum ?? 0,
    leadTimeSumSq: s.leadTimeSumSq ?? 0,
  };
}

export async function loadPlanningProducts(filter: Record<string, unknown> = { isActive: true }): Promise<PlanningProduct[]> {
  return Product.find(filter).populate('primarySupplier').lean() as unknown as Promise<PlanningProduct[]>;
}

export async function loadPlanningProduct(productId: Id): Promise<PlanningProduct> {
  const p = (await Product.findById(productId).populate('primarySupplier').lean()) as unknown as PlanningProduct | null;
  if (!p) throw ApiError.notFound('Product not found');
  return p;
}

/** On-hand per (warehouse, product); also per product network-wide under warehouse "*". */
export async function onHandMap(productIds?: Id[], warehouseIds?: Id[]): Promise<Map<string, number>> {
  const match: Record<string, unknown> = {};
  if (productIds) match.product = { $in: productIds.map(oid) };
  if (warehouseIds) match.warehouse = { $in: warehouseIds.map(oid) };
  const rows = await StockLevel.aggregate<{ _id: { w: Types.ObjectId; p: Types.ObjectId }; q: number }>([
    { $match: match },
    { $group: { _id: { w: '$warehouse', p: '$product' }, q: { $sum: '$quantity' } } },
  ]);
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(posKey(r._id.w, r._id.p), r.q);
    m.set(posKey(null, r._id.p), (m.get(posKey(null, r._id.p)) ?? 0) + r.q);
  }
  return m;
}

/** Outstanding quantities (ordered - received) on open POs per (warehouse, product) and network-wide. */
export async function onOrderMap(productIds?: Id[], warehouseIds?: Id[]): Promise<Map<string, number>> {
  const match: Record<string, unknown> = { status: { $in: OPEN_PO_STATUSES } };
  if (warehouseIds) match.warehouse = { $in: warehouseIds.map(oid) };
  const pipeline: Record<string, unknown>[] = [{ $match: match }, { $unwind: '$items' }];
  if (productIds) pipeline.push({ $match: { 'items.product': { $in: productIds.map(oid) } } });
  pipeline.push({
    $group: {
      _id: { w: '$warehouse', p: '$items.product' },
      q: { $sum: { $max: [0, { $subtract: ['$items.quantityOrdered', '$items.quantityReceived'] }] } },
    },
  });
  const rows = await PurchaseOrder.aggregate<{ _id: { w: Types.ObjectId; p: Types.ObjectId }; q: number }>(pipeline as any);
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(posKey(r._id.w, r._id.p), r.q);
    m.set(posKey(null, r._id.p), (m.get(posKey(null, r._id.p)) ?? 0) + r.q);
  }
  return m;
}

/**
 * Demand estimates d(w,p), sigma(w,p) from the last 30 full days of DemandHistory.
 * With warehouseIds = null the history of all warehouses is summed per day (network demand).
 */
export async function demandMap(
  products: PlanningProduct[],
  warehouseIds: Id[] | null,
  now: Date = new Date(),
): Promise<Map<string, DemandEstimate>> {
  const end = startOfUtcDay(now);
  const start = addDays(end, -DEMAND_WINDOW_DAYS);
  const match: Record<string, unknown> = {
    product: { $in: products.map((p) => p._id) },
    date: { $gte: start, $lt: end },
  };
  if (warehouseIds) match.warehouse = { $in: warehouseIds.map(oid) };
  const rows = await DemandHistory.find(match).select('product warehouse date quantity').lean();
  const grouped = new Map<string, { date: Date; quantity: number }[]>();
  for (const r of rows) {
    const key = warehouseIds ? posKey(r.warehouse, r.product) : posKey(null, r.product);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({ date: r.date, quantity: r.quantity });
  }
  const out = new Map<string, DemandEstimate>();
  const whs = warehouseIds ? warehouseIds.map((w) => idStr(w)!) : [null];
  for (const p of products) {
    for (const w of whs) {
      const key = posKey(w, p._id);
      out.set(key, estimateDemand(grouped.get(key) ?? [], p.avgDailyDemand, DEMAND_WINDOW_DAYS, now, p.demandStdDev));
    }
  }
  return out;
}

export async function demandAt(product: PlanningProduct, warehouseId: Id | null, now = new Date()) {
  const m = await demandMap([product], warehouseId ? [warehouseId] : null, now);
  return m.get(posKey(warehouseId, product._id))!;
}

export function explainWith(
  product: PlanningProduct,
  onHand: number,
  onOrder: number,
  demand: DemandEstimate,
): ReorderExplanation {
  return explainReorder({
    product: {
      sku: product.sku,
      name: product.name,
      avgDailyDemand: product.avgDailyDemand,
      demandStdDev: product.demandStdDev,
      leadTimeDaysOverride: product.leadTimeDaysOverride ?? null,
      serviceLevelZ: product.serviceLevelZ,
      orderCost: product.orderCost,
      holdingCostPerUnitYear: product.holdingCostPerUnitYear,
      annualDemandOverride: product.annualDemandOverride ?? null,
    },
    supplier: supplierInput(product.primarySupplier),
    onHand,
    onOrder,
    demand: { mean: demand.mean, std: demand.std, source: demand.source, samples: demand.samples },
  });
}

export interface PositionExplanation {
  product: PlanningProduct;
  warehouseId: string | null;
  onHand: number;
  onOrder: number;
  demand: DemandEstimate;
  explanation: ReorderExplanation;
}

/** F1 explanation for one product at one warehouse (or network-wide when warehouseId is null). */
export async function explainProductAt(productId: Id, warehouseId: Id | null): Promise<PositionExplanation> {
  const product = await loadPlanningProduct(productId);
  const whs = warehouseId ? [warehouseId] : undefined;
  const [oh, oo, demand] = await Promise.all([
    onHandMap([product._id], whs),
    onOrderMap([product._id], whs),
    demandAt(product, warehouseId),
  ]);
  const key = posKey(warehouseId, product._id);
  const onHand = oh.get(key) ?? 0;
  const onOrder = oo.get(key) ?? 0;
  return {
    product,
    warehouseId: idStr(warehouseId),
    onHand,
    onOrder,
    demand,
    explanation: explainWith(product, onHand, onOrder, demand),
  };
}

/** minStock(w,p) = StockPolicy.minStock ?? ceil(safetyStock(p,w)) */
export async function minStockAt(product: PlanningProduct, warehouseId: Id, demand?: DemandEstimate) {
  const policy = await StockPolicy.findOne({ product: product._id, warehouse: warehouseId }).lean();
  const d = demand ?? (await demandAt(product, warehouseId));
  const ss = explainWith(product, 0, 0, d).policy.safetyStock;
  return { minStock: minStockFor(policy?.minStock ?? null, ss), maxStock: policy?.maxStock ?? null, policy };
}

/**
 * Products tracked at a warehouse: they have a stock line (even empty), a stock policy or demand history there.
 * Untracked products are left out of per-warehouse reordering so a warehouse never orders items it does not carry.
 */
export async function trackedProductsAt(warehouseId: Id): Promise<Set<string>> {
  const [lines, policies, history] = await Promise.all([
    StockLevel.distinct('product', { warehouse: warehouseId }),
    StockPolicy.distinct('product', { warehouse: warehouseId }),
    DemandHistory.distinct('product', { warehouse: warehouseId }),
  ]);
  return new Set([...lines, ...policies, ...history].map((p) => idStr(p)!));
}

/** Warehouses where the product is tracked: it has stock lines or a stock policy. */
export async function trackedWarehouses(productId: Id): Promise<string[]> {
  const [lines, policies] = await Promise.all([
    StockLevel.distinct('warehouse', { product: productId }),
    StockPolicy.distinct('warehouse', { product: productId }),
  ]);
  return [...new Set([...lines, ...policies].map((w) => idStr(w)!))];
}

export interface RebalanceSuggestion {
  product: { _id: string; sku: string; name: string };
  from: { _id: string; code: string; name: string };
  to: { _id: string; code: string; name: string };
  quantity: number;
  explanation: string;
}

/** F4 rebalance for one product across the warehouses where it is tracked, with per-warehouse reorder points. */
export async function rebalanceForProduct(product: PlanningProduct, warehouseNames: Map<string, { code: string; name: string }>) {
  const whs = (await trackedWarehouses(product._id)).filter((w) => warehouseNames.has(w));
  if (whs.length < 2) return { result: null, positions: [] as { warehouse: string; onHand: number; onOrder: number; reorderPoint: number }[] };
  const [oh, oo, dm] = await Promise.all([onHandMap([product._id], whs), onOrderMap([product._id], whs), demandMap([product], whs)]);
  const positions = whs.map((w) => {
    const key = posKey(w, product._id);
    const onHand = oh.get(key) ?? 0;
    const onOrder = oo.get(key) ?? 0;
    const e = explainWith(product, onHand, onOrder, dm.get(key)!);
    return { warehouse: w, onHand, onOrder, reorderPoint: e.policy.reorderPoint, demand: dm.get(key)!.mean };
  });
  const tracked = positions.filter((p) => p.demand > 0 || p.onHand > 0);
  const result = planRebalance({ positions: tracked, reorderPoint: 0 });
  return { result, positions: tracked };
}

export async function rebalanceSuggestions(productId?: Id): Promise<RebalanceSuggestion[]> {
  const products = await loadPlanningProducts(productId ? { _id: productId, isActive: true } : { isActive: true });
  const warehouses = await Warehouse.find({ isActive: true }).select('code name').lean();
  const names = new Map(warehouses.map((w) => [w._id.toHexString(), { code: w.code, name: w.name }]));
  const out: RebalanceSuggestion[] = [];
  for (const product of products) {
    const { result, positions } = await rebalanceForProduct(product, names);
    if (!result) continue;
    for (const t of result.transfers) {
      const from = positions.find((p) => p.warehouse === t.from)!;
      const to = positions.find((p) => p.warehouse === t.to)!;
      const keep = Math.ceil(1.5 * from.reorderPoint);
      out.push({
        product: { _id: product._id.toHexString(), sku: product.sku, name: product.name },
        from: { _id: t.from, ...names.get(t.from)! },
        to: { _id: t.to, ...names.get(t.to)! },
        quantity: t.quantity,
        explanation:
          `${names.get(t.to)!.name}: position ${fmt(to.onHand + to.onOrder)} <= reorder point ${to.reorderPoint} ` +
          `(deficit ${to.reorderPoint + 1 - (to.onHand + to.onOrder)}); ${names.get(t.from)!.name} keeps ${keep} ` +
          `(1.5 x reorder point ${from.reorderPoint}) and has ${fmt(from.onHand - keep)} surplus`,
      });
    }
  }
  return out;
}

export type InsightStatus = 'reorder' | 'overstock' | 'no_demand' | 'ok';

export async function buildInsights(warehouseId: Id | null, now = new Date()) {
  let products = await loadPlanningProducts();
  if (warehouseId) {
    const tracked = await trackedProductsAt(warehouseId);
    products = products.filter((p) => tracked.has(p._id.toHexString()));
  }
  const whs = warehouseId ? [warehouseId] : undefined;
  const ids = products.map((p) => p._id);
  const [oh, oo, dm] = await Promise.all([
    onHandMap(ids, whs),
    onOrderMap(ids, whs),
    demandMap(products, warehouseId ? [warehouseId] : null, now),
  ]);
  const rows = products.map((p) => {
    const key = posKey(warehouseId, p._id);
    const onHand = oh.get(key) ?? 0;
    const onOrder = oo.get(key) ?? 0;
    const demand = dm.get(key)!;
    const e = explainWith(p, onHand, onOrder, demand);
    return { p, onHand, onOrder, demand, e, annualValue: e.inputs.annualDemand * p.unitCost };
  });
  const abc = new Map(classifyABC(rows.map((r) => ({ id: r.p._id.toHexString(), annualValue: r.annualValue }))).map((a) => [a.id, a]));
  const items = rows.map(({ p, onHand, onOrder, demand, e, annualValue }) => {
    const a = abc.get(p._id.toHexString())!;
    const cv = coefficientOfVariation(demand.mean, demand.std);
    const xyz = classifyXYZ(cv);
    const lt = resolveLeadTime(p, supplierInput(p.primarySupplier));
    const rop = e.policy.reorderPoint;
    const status: InsightStatus =
      e.inputs.avgDailyDemand <= 0 ? 'no_demand' : e.shouldReorder ? 'reorder' : rop > 0 && onHand > 5 * rop ? 'overstock' : 'ok';
    return {
      product: {
        _id: p._id.toHexString(),
        sku: p.sku,
        name: p.name,
        category: p.category,
        unit: p.unit,
        unitCost: p.unitCost,
        isPerishable: !!p.isPerishable,
        supplierName: p.primarySupplier?.name ?? null,
      },
      abc: a.abc,
      xyz,
      class: `${a.abc}${xyz}`,
      policyHint: policyHint(a.abc, xyz),
      annualDemand: e.inputs.annualDemand,
      annualValue,
      valueShare: a.share,
      demandMean: demand.mean,
      demandStd: demand.std,
      demandCV: cv,
      demandSource: demand.source,
      onHand,
      onOrder,
      position: e.position,
      reorderPoint: rop,
      safetyStock: e.policy.safetyStock,
      eoq: e.policy.economicOrderQuantity,
      leadTimeDays: lt.leadDays,
      leadTimeStd: lt.sigmaLead,
      leadTimeSource: lt.source,
      leadTimeSamples: lt.samples,
      promisedLeadTimeDays: p.primarySupplier?.leadTimeDays ?? null,
      daysOfCover: daysOfCover(onHand, demand.mean),
      status,
      shouldReorder: e.shouldReorder,
      suggestedOrderQty: e.orderQuantity,
      currentZ: p.serviceLevelZ,
      recommendedZ: recommendedZ(a.abc),
      explanation: e,
    };
  });
  items.sort((x, y) => y.annualValue - x.annualValue);
  const expiryRisk = await expiryRiskFor(products, warehouseId, now);
  return { warehouse: idStr(warehouseId), generatedAt: now, items, expiryRisk };
}

export interface ExpiryRiskRow {
  stockLevelId: string;
  product: { _id: string; sku: string; name: string };
  warehouse: { _id: string; code: string; name: string };
  batchNo: string;
  bin: string;
  expiryDate: Date;
  daysLeft: number;
  units: number;
  dailyDemand: number;
  projectedWaste: number;
  valueAtRisk: number;
}

/** F5 expiry-waste projection for every dated batch, using per-warehouse demand. */
export async function expiryRiskFor(products: PlanningProduct[], warehouseId: Id | null, now = new Date()): Promise<ExpiryRiskRow[]> {
  const match: Record<string, unknown> = { expiryDate: { $ne: null }, quantity: { $gt: 0 } };
  if (warehouseId) match.warehouse = oid(warehouseId);
  const lines = await StockLevel.find(match).lean();
  if (!lines.length) return [];
  const byProduct = new Map(products.map((p) => [p._id.toHexString(), p]));
  const whIds = [...new Set(lines.map((l) => l.warehouse.toHexString()))];
  const warehouses = await Warehouse.find({ _id: { $in: whIds } }).select('code name').lean();
  const whName = new Map(warehouses.map((w) => [w._id.toHexString(), w]));
  const relevant = products.filter((p) => lines.some((l) => l.product.equals(p._id)));
  const dm = await demandMap(relevant, whIds, now);
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    const key = posKey(l.warehouse, l.product);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  const out: ExpiryRiskRow[] = [];
  for (const [key, ls] of groups) {
    const p = byProduct.get(idStr(ls[0].product)!);
    const w = whName.get(idStr(ls[0].warehouse)!);
    if (!p || !w) continue;
    const d = dm.get(key)?.mean ?? p.avgDailyDemand;
    const proj = projectExpiryWaste(
      ls.map((l) => ({ id: l._id.toHexString(), batchNo: l.batchNo, bin: l.bin, expiryDate: l.expiryDate, quantity: l.quantity })),
      d,
      now,
      p.unitCost,
    );
    for (const pl of proj.lines) {
      out.push({
        stockLevelId: pl.id!,
        product: { _id: p._id.toHexString(), sku: p.sku, name: p.name },
        warehouse: { _id: w._id.toHexString(), code: w.code, name: w.name },
        batchNo: pl.batchNo,
        bin: pl.bin,
        expiryDate: pl.expiryDate,
        daysLeft: Math.floor((pl.expiryDate.getTime() - now.getTime()) / DAY_MS),
        units: pl.quantity,
        dailyDemand: d,
        projectedWaste: pl.wasteUnits,
        valueAtRisk: pl.valueAtRisk,
      });
    }
  }
  return out.sort((a, b) => b.valueAtRisk - a.valueAtRisk || a.daysLeft - b.daysLeft);
}

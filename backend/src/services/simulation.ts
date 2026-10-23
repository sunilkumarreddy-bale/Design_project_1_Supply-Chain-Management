/** Domino Effect Predictor service (M6): builds simulator inputs from live data and stores runs. */
import { Types } from 'mongoose';
import {
  CustomerOrder,
  DisruptionScenario,
  ProductDependency,
  PurchaseOrder,
  SimulationRun,
  StockLevel,
  StockPolicy,
  Supplier,
  SupplierOffer,
  Warehouse,
} from '../models';
import {
  ALL_STRATEGIES,
  buildGraph,
  compareStrategies,
  Disruption,
  GraphData,
  nodeId,
  positionKey,
  Receipt,
  sensitivitySweep,
  SimInput,
  SimOrderLine,
  SimPosition,
  StrategyName,
  StrategySources,
  traverseImpact,
} from '../engines/simulationEngine';
import { SupplierOfferInput } from '../engines/recoveryEngine';
import { ApiError } from '../utils/apiError';
import { addDays, DAY_MS } from '../utils/dates';
import { idStr } from '../utils/ids';
import { recordAudit } from '../middleware/audit';
import type { AuthUser } from '../middleware/auth';
import { emitAll } from '../sockets';
import { demandMap, loadPlanningProducts, minStockAt, onHandMap, PlanningProduct, posKey } from './planning';
import { resolveRoute } from './routes';
import { analyze, proposePlan, RecoveryAnalysisInput } from './recovery';

const RECEIPT_STATUSES = ['approved', 'confirmed', 'dispatched', 'partially_received'];

export async function loadGraphData(): Promise<GraphData> {
  const [suppliers, products, offers, deps, lineKeys, policyKeys, warehouses, orders] = await Promise.all([
    Supplier.find({ isActive: true }).select('name').lean(),
    loadPlanningProducts(),
    SupplierOffer.find({ isActive: true }).select('supplier product').lean(),
    ProductDependency.find().lean(),
    StockLevel.aggregate<{ _id: { w: Types.ObjectId; p: Types.ObjectId } }>([
      { $match: { quantity: { $gt: 0 } } },
      { $group: { _id: { w: '$warehouse', p: '$product' } } },
    ]),
    StockPolicy.find().select('product warehouse').lean(),
    Warehouse.find({ isActive: true }).select('name').lean(),
    CustomerOrder.find({ status: 'open' }).lean(),
  ]);
  const whName = new Map(warehouses.map((w) => [w._id.toHexString(), w.name]));
  const posSet = new Map<string, { warehouseId: string; warehouseName: string; productId: string }>();
  const addPos = (w: unknown, p: unknown) => {
    const wid = idStr(w)!;
    const pid = idStr(p)!;
    if (!whName.has(wid)) return;
    posSet.set(positionKey(wid, pid), { warehouseId: wid, warehouseName: whName.get(wid)!, productId: pid });
  };
  for (const k of lineKeys) addPos(k._id.w, k._id.p);
  for (const pol of policyKeys) addPos(pol.warehouse, pol.product);
  for (const o of orders) for (const it of o.items) addPos(o.warehouse, it.product);
  return {
    suppliers: suppliers.map((s) => ({ id: s._id.toHexString(), name: s.name })),
    products: products.map((p) => ({
      id: p._id.toHexString(),
      name: p.name,
      sku: p.sku,
      primarySupplierId: p.primarySupplier ? p.primarySupplier._id.toHexString() : null,
    })),
    offers: offers.map((o) => ({ supplierId: o.supplier.toHexString(), productId: o.product.toHexString() })),
    dependencies: deps.map((d) => ({
      componentProductId: d.componentProduct.toHexString(),
      finishedProductId: d.finishedProduct.toHexString(),
      quantityPer: d.quantityPer,
    })),
    positions: [...posSet.values()],
    orders: orders.map((o) => ({
      orderId: o._id.toHexString(),
      orderNo: o.orderNo,
      warehouseId: o.warehouse.toHexString(),
      productIds: [...new Set(o.items.map((i) => i.product.toHexString()))],
    })),
  };
}

export async function dependencyGraph(supplier?: string | null, product?: string | null) {
  const data = await loadGraphData();
  const graph = buildGraph(data);
  const start = supplier ? nodeId.supplier(supplier) : product ? nodeId.product(product) : null;
  if (!start) return { graph, affectedNodeIds: [], paths: {} };
  return traverseImpact(graph, start);
}

export interface ScenarioInput {
  name?: string;
  type: 'supplier_stop' | 'supplier_delay' | 'component_stop';
  supplier?: string | null;
  product?: string | null;
  startDay?: number;
  durationDays: number;
  horizonDays?: number;
  backorders?: boolean;
}

export interface RunInput {
  scenario?: string | null;
  inline?: ScenarioInput | null;
  strategies?: StrategyName[];
  sweep?: boolean;
  safetyStockMultiplier?: number;
}

function validateScenario(s: ScenarioInput) {
  if ((s.type === 'supplier_stop' || s.type === 'supplier_delay') && !s.supplier) throw ApiError.badRequest('A supplier is required for this scenario type');
  if (s.type === 'component_stop' && !s.product) throw ApiError.badRequest('A component product is required for component_stop');
}

export async function createScenario(input: ScenarioInput, user: AuthUser) {
  validateScenario(input);
  const s = await DisruptionScenario.create({
    name: input.name || `${input.type.replace('_', ' ')} for ${input.durationDays} days`,
    type: input.type,
    supplier: input.type === 'component_stop' ? null : input.supplier,
    product: input.type === 'component_stop' ? input.product : null,
    startDay: input.startDay ?? 0,
    durationDays: input.durationDays,
    horizonDays: input.horizonDays ?? 30,
    backorders: input.backorders ?? false,
    createdBy: user._id,
  });
  await recordAudit({ action: 'simulation.scenario_create', entityType: 'DisruptionScenario', entityId: s._id, actor: user, after: s });
  return s;
}

/** Builds the simulator input for a scenario from live stock, demand, POs, orders and dependencies. */
export async function buildSimulation(scenario: Required<Omit<ScenarioInput, 'name' | 'supplier' | 'product'>> & {
  supplier: string | null;
  product: string | null;
}, now = new Date()) {
  const data = await loadGraphData();
  const graph = buildGraph(data);
  const start = scenario.type === 'component_stop' ? nodeId.product(scenario.product!) : nodeId.supplier(scenario.supplier!);
  if (!graph.nodes.some((n) => n.id === start)) throw ApiError.notFound('The disrupted supplier or component was not found');
  const impact = traverseImpact(graph, start);
  const affected = new Set(impact.affectedNodeIds);

  const positionKeys = new Set<string>();
  for (const n of impact.graph.nodes) if (n.type === 'position' && affected.has(n.id)) positionKeys.add(n.refId);
  // finished products are assembled from components held at the same warehouse
  for (const key of [...positionKeys]) {
    const [w, p] = key.split(':');
    for (const d of data.dependencies.filter((x) => x.finishedProductId === p)) {
      if (data.positions.some((x) => x.warehouseId === w && x.productId === d.componentProductId)) positionKeys.add(positionKey(w, d.componentProductId));
    }
  }
  const keys = [...positionKeys].map((k) => {
    const [w, p] = k.split(':');
    return { key: k, w, p };
  });
  const productIds = [...new Set(keys.map((k) => k.p))];
  const warehouseIds = [...new Set(keys.map((k) => k.w))];
  const products = productIds.length ? await loadPlanningProducts({ _id: { $in: productIds } }) : [];
  const byId = new Map(products.map((p) => [p._id.toHexString(), p]));
  const whs = await Warehouse.find({ _id: { $in: warehouseIds } }).select('name').lean();
  const whName = new Map(whs.map((w) => [w._id.toHexString(), w.name]));
  const [oh, dm, pos] = await Promise.all([
    onHandMap(productIds, warehouseIds),
    products.length ? demandMap(products, warehouseIds, now) : Promise.resolve(new Map()),
    PurchaseOrder.find({ status: { $in: RECEIPT_STATUSES }, warehouse: { $in: warehouseIds }, 'items.product': { $in: productIds } })
      .populate('supplier', 'leadTimeDays')
      .lean(),
  ]);
  const dayOf = (d: Date) => Math.max(1, Math.ceil((new Date(d).getTime() - now.getTime()) / DAY_MS));

  const positions: SimPosition[] = [];
  for (const { key, w, p } of keys) {
    const product = byId.get(p);
    if (!product || !whName.has(w)) continue;
    const receipts: Receipt[] = [];
    for (const po of pos.filter((x) => x.warehouse.toHexString() === w)) {
      const it = po.items.find((i) => i.product.toHexString() === p);
      const qty = it ? it.quantityOrdered - it.quantityReceived : 0;
      if (qty <= 0) continue;
      const sup = po.supplier as unknown as { _id: Types.ObjectId; leadTimeDays: number } | null;
      const expected = po.expectedDeliveryDate ?? addDays(po.approvedAt ?? now, sup?.leadTimeDays ?? 7);
      receipts.push({ day: dayOf(expected), quantity: qty, supplierId: sup?._id.toHexString() ?? null, reference: po.poNumber });
    }
    const demand = dm.get(posKey(w, p));
    const { minStock } = await minStockAt(product, w, demand);
    positions.push({
      key,
      warehouseId: w,
      warehouseName: whName.get(w)!,
      productId: p,
      productName: product.name,
      sku: product.sku,
      unitPrice: product.unitPrice,
      onHand: oh.get(posKey(w, p)) ?? 0,
      dailyDemand: demand?.mean ?? product.avgDailyDemand,
      minStock,
      receipts,
    });
  }

  const orderDocs = await CustomerOrder.find({ status: 'open', warehouse: { $in: warehouseIds }, 'items.product': { $in: productIds } }).lean();
  const orders: SimOrderLine[] = [];
  for (const o of orderDocs) {
    for (const it of o.items) {
      const k = positionKey(o.warehouse.toHexString(), it.product.toHexString());
      if (!positionKeys.has(k)) continue;
      const remaining = it.quantity - (it.quantityFulfilled ?? 0);
      if (remaining <= 0) continue;
      orders.push({
        orderId: o._id.toHexString(),
        orderNo: o.orderNo,
        customerName: o.customerName,
        warehouseId: o.warehouse.toHexString(),
        productId: it.product.toHexString(),
        quantity: remaining,
        dueDay: dayOf(o.requiredBy),
        priority: o.priority as SimOrderLine['priority'],
        unitPrice: it.unitPrice ?? byId.get(it.product.toHexString())?.unitPrice ?? null,
      });
    }
  }

  const disruption: Disruption = {
    type: scenario.type,
    supplierId: scenario.supplier,
    productId: scenario.product,
    startDay: scenario.startDay,
    durationDays: scenario.durationDays,
  };
  const input: SimInput = {
    horizonDays: scenario.horizonDays,
    backorders: scenario.backorders,
    disruption,
    positions,
    dependencies: data.dependencies.filter((d) => productIds.includes(d.componentProductId) && productIds.includes(d.finishedProductId)),
    orders,
  };
  const sources = await strategySources(positions, products, scenario.supplier);
  return { input, sources, impact };
}

async function strategySources(positions: SimPosition[], products: PlanningProduct[], disruptedSupplier: string | null): Promise<StrategySources> {
  const warehouseIds = [...new Set(positions.map((p) => p.warehouseId))];
  const routes: StrategySources['routes'] = [];
  for (const a of warehouseIds) {
    for (const b of warehouseIds) {
      if (a === b) continue;
      const r = await resolveRoute(a, b);
      if (r) routes.push({ fromWarehouseId: a, toWarehouseId: b, leadTimeDays: r.leadTimeDays, costPerUnit: r.costPerUnit });
    }
  }
  const now = new Date();
  const offers = await SupplierOffer.find({ product: { $in: products.map((p) => p._id) }, isActive: true }).populate('supplier').lean();
  const offersByProduct: Record<string, SupplierOfferInput[]> = {};
  for (const o of offers) {
    const s = o.supplier as unknown as { _id: Types.ObjectId; name: string; status: string; isActive: boolean } | null;
    if (!s || !s.isActive || s.status !== 'active' || s._id.toHexString() === disruptedSupplier) continue;
    if (o.validUntil && new Date(o.validUntil) < now) continue;
    const pid = o.product.toHexString();
    (offersByProduct[pid] ??= []).push({
      supplierId: s._id.toHexString(),
      supplierName: s.name,
      capacityUnits: o.capacityUnits,
      minOrderQty: o.minOrderQty,
      leadTimeDays: o.leadTimeDays,
      unitCost: o.unitCost,
    });
  }
  return { routes, offersByProduct };
}

export async function runSimulation(params: RunInput, user: AuthUser) {
  let scenarioDoc = null;
  let s: ScenarioInput;
  if (params.scenario) {
    scenarioDoc = await DisruptionScenario.findById(params.scenario).lean();
    if (!scenarioDoc) throw ApiError.notFound('Scenario not found');
    s = {
      name: scenarioDoc.name,
      type: scenarioDoc.type,
      supplier: idStr(scenarioDoc.supplier),
      product: idStr(scenarioDoc.product),
      startDay: scenarioDoc.startDay,
      durationDays: scenarioDoc.durationDays,
      horizonDays: scenarioDoc.horizonDays,
      backorders: scenarioDoc.backorders,
    };
  } else if (params.inline) {
    s = params.inline;
  } else {
    throw ApiError.badRequest('Provide a saved scenario id or an inline scenario');
  }
  validateScenario(s);
  const normalized = {
    type: s.type,
    supplier: s.type === 'component_stop' ? null : (s.supplier ?? null),
    product: s.type === 'component_stop' ? (s.product ?? null) : null,
    startDay: s.startDay ?? 0,
    durationDays: s.durationDays,
    horizonDays: s.horizonDays ?? 30,
    backorders: s.backorders ?? false,
  };
  const { input, sources, impact } = await buildSimulation(normalized);
  const multiplier = params.safetyStockMultiplier ?? 1;
  input.safetyStockMultiplier = multiplier;
  const strategies = params.strategies?.length ? params.strategies : ALL_STRATEGIES;
  const withNone: StrategyName[] = strategies.includes('none') ? strategies : ['none', ...strategies];
  const cmp = compareStrategies(input, sources, withNone);
  const sweep = params.sweep ? sensitivitySweep(input, sources, withNone) : null;

  const run = await SimulationRun.create({
    scenario: scenarioDoc?._id ?? null,
    scenarioSnapshot: { name: s.name ?? null, ...normalized },
    ranAt: new Date(),
    ranBy: user._id,
    parameters: { horizonDays: normalized.horizonDays, safetyStockMultiplier: multiplier, backorders: normalized.backorders },
    graph: { nodes: impact.graph.nodes, edges: impact.graph.edges, affectedNodeIds: impact.affectedNodeIds, paths: impact.paths },
    baseline: {
      metrics: cmp.baseline.metrics,
      perPosition: cmp.baseline.perPosition,
      orders: cmp.baseline.orders,
      dailySeries: cmp.baseline.perPosition.map((p) => ({ key: p.key, label: `${p.sku} @ ${p.warehouseName}`, daily: p.daily })),
    },
    strategies: cmp.strategies.map((st) => ({
      name: st.name,
      metrics: st.metrics,
      deltas: st.deltas,
      actions: st.actions,
      perPosition: st.perPosition,
      orders: st.orders,
    })),
    sweep,
  });
  await recordAudit({
    action: 'simulation.run',
    entityType: 'SimulationRun',
    entityId: run._id,
    actor: user,
    after: { scenario: run.scenarioSnapshot, baseline: cmp.baseline.metrics },
  });
  emitAll('simulation:done', { _id: run._id, ranBy: user.id });
  return run;
}

/** Turns one strategy of a run, for one shortage position, into a proposed recovery plan. */
export async function createRecoveryPlanFromRun(runId: string, body: { strategy: StrategyName; positionKey: string }, user: AuthUser) {
  const run = await SimulationRun.findById(runId).lean();
  if (!run) throw ApiError.notFound('Simulation run not found');
  if (body.strategy === 'none') throw ApiError.badRequest('Choose a strategy with actions (transfers, alternative_supplier or combined)');
  const strategies = (run.strategies ?? []) as { name: string; actions: { toKey: string; quantity: number }[] }[];
  const strategy = strategies.find((s) => s.name === body.strategy);
  if (!strategy) throw ApiError.notFound(`Strategy ${body.strategy} is not part of this run`);
  const [warehouse, product] = body.positionKey.split(':');
  if (!Types.ObjectId.isValid(warehouse) || !Types.ObjectId.isValid(product)) throw ApiError.badRequest('Invalid position key');
  const snap = run.scenarioSnapshot as { type: string; supplier: string | null; startDay: number; durationDays: number };
  let required = strategy.actions.filter((a) => a.toKey === body.positionKey).reduce((s, a) => s + a.quantity, 0);
  if (required <= 0) {
    const baseline = run.baseline as { perPosition: { key: string; unmetUnits: number }[] };
    required = Math.ceil(baseline.perPosition.find((p) => p.key === body.positionKey)?.unmetUnits ?? 0);
  }
  if (required <= 0) throw ApiError.badRequest('This position has no shortage in the run');
  const analysisInput: RecoveryAnalysisInput = {
    product,
    warehouse,
    horizonDays: Math.max(1, snap.startDay + snap.durationDays),
    requiredUnits: required,
    excludeSupplier: snap.type === 'component_stop' ? null : snap.supplier,
    trigger: snap.supplier
      ? { kind: 'supplier_delay', supplier: snap.supplier, delayDays: snap.durationDays }
      : { kind: 'manual', supplier: null, delayDays: null },
  };
  const analysis = await analyze(analysisInput);
  const options = analysis.result.options;
  const pick =
    body.strategy === 'transfers'
      ? options.find((o) => o.steps.every((s) => s.type === 'transfer'))
      : body.strategy === 'alternative_supplier'
        ? options.find((o) => o.steps.every((s) => s.type === 'purchase'))
        : options[0];
  if (!pick) throw ApiError.conflict(`The recovery engine found no ${body.strategy.replace('_', ' ')} option for this position now`);
  return proposePlan(analysisInput, pick.optionId, user);
}


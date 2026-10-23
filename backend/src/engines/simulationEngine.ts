/**
 * Domino Effect Predictor (M6). Pure, deterministic functions:
 *  - dependency graph building and breadth-first impact traversal,
 *  - day-by-day inventory-flow simulation with component assembly and customer-order evaluation,
 *  - recovery strategies (transfers, alternative supplier, combined) built with the recovery engine,
 *  - a sensitivity sweep over disruption length and safety-stock multiplier.
 */
import { analyzeRecovery, SupplierOfferInput } from './recoveryEngine';

/* ------------------------------------------------------------------ graph */

export type NodeType = 'supplier' | 'product' | 'position' | 'order';
export type EdgeKind = 'supplies' | 'offers' | 'component_of' | 'stocked_at' | 'ordered_by';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  refId: string;
  warehouseId?: string;
  productId?: string;
  affected: boolean;
  depth: number | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  quantityPer?: number;
  affected: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphData {
  suppliers: { id: string; name: string }[];
  products: { id: string; name: string; sku: string; primarySupplierId: string | null }[];
  offers: { supplierId: string; productId: string }[];
  dependencies: { componentProductId: string; finishedProductId: string; quantityPer: number }[];
  positions: { warehouseId: string; warehouseName: string; productId: string }[];
  orders: { orderId: string; orderNo: string; warehouseId: string; productIds: string[] }[];
}

export const nodeId = {
  supplier: (id: string) => `supplier:${id}`,
  product: (id: string) => `product:${id}`,
  position: (w: string, p: string) => `position:${w}:${p}`,
  order: (id: string) => `order:${id}`,
};

export function positionKey(warehouseId: string, productId: string): string {
  return `${warehouseId}:${productId}`;
}

export function buildGraph(data: GraphData): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const productName = new Map(data.products.map((p) => [p.id, p.name]));
  const addNode = (n: Omit<GraphNode, 'affected' | 'depth'>) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { ...n, affected: false, depth: null });
  };
  const edgeSet = new Set<string>();
  const addEdge = (e: Omit<GraphEdge, 'affected'>) => {
    const k = `${e.from}>${e.to}>${e.kind}`;
    if (edgeSet.has(k) || !nodes.has(e.from) || !nodes.has(e.to)) return;
    edgeSet.add(k);
    edges.push({ ...e, affected: false });
  };
  for (const s of data.suppliers) addNode({ id: nodeId.supplier(s.id), type: 'supplier', label: s.name, refId: s.id });
  for (const p of data.products)
    addNode({ id: nodeId.product(p.id), type: 'product', label: `${p.sku} ${p.name}`, refId: p.id, productId: p.id });
  for (const pos of data.positions) {
    addNode({
      id: nodeId.position(pos.warehouseId, pos.productId),
      type: 'position',
      label: `${productName.get(pos.productId) ?? pos.productId} @ ${pos.warehouseName}`,
      refId: positionKey(pos.warehouseId, pos.productId),
      warehouseId: pos.warehouseId,
      productId: pos.productId,
    });
  }
  for (const o of data.orders)
    addNode({ id: nodeId.order(o.orderId), type: 'order', label: o.orderNo, refId: o.orderId, warehouseId: o.warehouseId });

  for (const p of data.products) {
    if (p.primarySupplierId) addEdge({ from: nodeId.supplier(p.primarySupplierId), to: nodeId.product(p.id), kind: 'supplies' });
  }
  for (const o of data.offers) addEdge({ from: nodeId.supplier(o.supplierId), to: nodeId.product(o.productId), kind: 'offers' });
  for (const d of data.dependencies)
    addEdge({
      from: nodeId.product(d.componentProductId),
      to: nodeId.product(d.finishedProductId),
      kind: 'component_of',
      quantityPer: d.quantityPer,
    });
  for (const pos of data.positions)
    addEdge({ from: nodeId.product(pos.productId), to: nodeId.position(pos.warehouseId, pos.productId), kind: 'stocked_at' });
  for (const o of data.orders)
    for (const pid of o.productIds)
      addEdge({ from: nodeId.position(o.warehouseId, pid), to: nodeId.order(o.orderId), kind: 'ordered_by' });

  return { nodes: [...nodes.values()], edges };
}

export interface ImpactResult {
  graph: Graph;
  affectedNodeIds: string[];
  paths: Record<string, string[]>;
}

/**
 * Breadth-first traversal from the disrupted node. Alternative-sourcing ("offers") edges are shown in the
 * graph but not followed: an alternative supplier is a way out of a disruption, not a dependency.
 */
export function traverseImpact(graph: Graph, startId: string): ImpactResult {
  const out = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (e.kind === 'offers') continue;
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e);
  }
  const depth = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  if (graph.nodes.some((n) => n.id === startId)) {
    depth.set(startId, 0);
    parent.set(startId, null);
    queue.push(startId);
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of out.get(id) ?? []) {
      if (depth.has(e.to)) continue;
      depth.set(e.to, depth.get(id)! + 1);
      parent.set(e.to, id);
      queue.push(e.to);
    }
  }
  const paths: Record<string, string[]> = {};
  for (const id of depth.keys()) {
    const path: string[] = [];
    let cur: string | null = id;
    while (cur) {
      path.unshift(cur);
      cur = parent.get(cur) ?? null;
    }
    paths[id] = path;
  }
  const nodes = graph.nodes.map((n) => ({ ...n, affected: depth.has(n.id), depth: depth.get(n.id) ?? null }));
  const edges = graph.edges.map((e) => ({
    ...e,
    affected: e.kind !== 'offers' && depth.has(e.from) && depth.has(e.to) && parent.get(e.to) !== undefined,
  }));
  return { graph: { nodes, edges }, affectedNodeIds: [...depth.keys()], paths };
}

/* ------------------------------------------------------------- simulation */

export type DisruptionType = 'supplier_stop' | 'supplier_delay' | 'component_stop';

export interface Disruption {
  type: DisruptionType;
  supplierId?: string | null;
  productId?: string | null;
  startDay: number;
  durationDays: number;
}

export interface Receipt {
  day: number;
  quantity: number;
  supplierId: string | null;
  reference?: string;
}

export interface SimPosition {
  key: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  sku: string;
  unitPrice: number;
  onHand: number;
  dailyDemand: number;
  minStock: number;
  receipts: Receipt[];
}

export interface SimDependency {
  componentProductId: string;
  finishedProductId: string;
  quantityPer: number;
}

export type Priority = 'low' | 'normal' | 'high';

export interface SimOrderLine {
  orderId: string;
  orderNo: string;
  customerName: string;
  warehouseId: string;
  productId: string;
  quantity: number;
  dueDay: number;
  priority: Priority;
  unitPrice?: number | null;
}

export interface SimAction {
  type: 'transfer' | 'purchase';
  label: string;
  toKey: string;
  fromKey?: string;
  supplierId?: string;
  quantity: number;
  dispatchDay: number;
  arrivalDay: number;
  cost: number;
}

export interface SimInput {
  horizonDays: number;
  backorders: boolean;
  disruption: Disruption;
  positions: SimPosition[];
  dependencies: SimDependency[];
  orders: SimOrderLine[];
  actions?: SimAction[];
  safetyStockMultiplier?: number;
}

export interface DayPoint {
  day: number;
  stock: number;
  receipts: number;
  demand: number;
  pulledDemand: number;
  sold: number;
  unmet: number;
}

export interface PositionResult {
  key: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  sku: string;
  onHand: number;
  dailyDemand: number;
  isAssembled: boolean;
  stockoutDay: number | null;
  unmetUnits: number;
  soldUnits: number;
  demandUnits: number;
  minCoverDays: number | null;
  delayedReceipts: { reference?: string; quantity: number; fromDay: number; toDay: number }[];
  daily: DayPoint[];
}

export type OrderStatus = 'on_time' | 'at_risk' | 'late';

export interface OrderLineResult extends SimOrderLine {
  warehouseName: string;
  productName: string;
  status: OrderStatus;
  daysLate: number;
  unfilled: number;
  coverDaysAfter: number | null;
}

export interface OrderResult {
  orderId: string;
  orderNo: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  dueDay: number;
  priority: Priority;
  status: OrderStatus;
  daysLate: number;
  unfilled: number;
  lines: OrderLineResult[];
}

export interface SimMetrics {
  shortageUnits: number;
  lateOrders: number;
  atRiskOrders: number;
  onTimeOrders: number;
  lostRevenue: number;
  serviceLevel: number;
  affectedPositions: number;
  actionCost: number;
  etaDays: number | null;
}

export interface SimResult {
  metrics: SimMetrics;
  perPosition: PositionResult[];
  orders: OrderResult[];
}

const EPS = 1e-9;
const round2 = (n: number) => Math.round(n * 100) / 100;
const PRIORITY_RANK: Record<Priority, number> = { high: 3, normal: 2, low: 1 };

/** Shifts receipts affected by the disruption. Returns the adjusted receipts and the moves made. */
export function applyDisruption(
  receipts: Receipt[],
  productId: string,
  d: Disruption,
): { receipts: Receipt[]; moved: PositionResult['delayedReceipts'] } {
  const end = d.startDay + d.durationDays;
  const moved: PositionResult['delayedReceipts'] = [];
  const out = receipts.map((r) => {
    let hit = false;
    let toDay = r.day;
    if (d.type === 'supplier_stop' && r.supplierId && r.supplierId === d.supplierId && r.day > d.startDay && r.day <= end) {
      hit = true;
      toDay = end + 1;
    } else if (d.type === 'supplier_delay' && r.supplierId && r.supplierId === d.supplierId && r.day > d.startDay) {
      hit = true;
      toDay = r.day + d.durationDays;
    } else if (d.type === 'component_stop' && productId === d.productId && r.day > d.startDay && r.day <= end) {
      hit = true;
      toDay = end + 1;
    }
    if (hit && toDay !== r.day) moved.push({ reference: r.reference, quantity: r.quantity, fromDay: r.day, toDay });
    return hit ? { ...r, day: toDay } : r;
  });
  return { receipts: out, moved };
}

/** Effective starting position when the safety-stock portion of on-hand is scaled (sensitivity sweep). */
export function scalePosition(p: SimPosition, multiplier: number): SimPosition {
  if (multiplier === 1) return p;
  return {
    ...p,
    onHand: Math.max(0, Math.round(p.onHand + (multiplier - 1) * p.minStock)),
    minStock: Math.max(0, Math.round(p.minStock * multiplier)),
  };
}

export function simulate(input: SimInput): SimResult {
  const H = Math.max(1, Math.floor(input.horizonDays));
  const mult = input.safetyStockMultiplier ?? 1;
  const positions = input.positions.map((p) => scalePosition(p, mult));
  const byKey = new Map(positions.map((p) => [p.key, p]));

  // finished products that can be assembled from component positions at the same warehouse
  const compsOf = new Map<string, { key: string; q: number }[]>();
  for (const p of positions) {
    const comps = input.dependencies
      .filter((d) => d.finishedProductId === p.productId)
      .map((d) => ({ key: positionKey(p.warehouseId, d.componentProductId), q: d.quantityPer }))
      .filter((c) => byKey.has(c.key));
    if (comps.length) compsOf.set(p.key, comps);
  }

  const receiptsByKey = new Map<string, number[]>();
  const moves = new Map<string, PositionResult['delayedReceipts']>();
  for (const p of positions) {
    const arr = new Array(H + 2).fill(0);
    const { receipts, moved } = applyDisruption(p.receipts, p.productId, input.disruption);
    for (const r of receipts) if (r.day >= 1 && r.day <= H) arr[r.day] += r.quantity;
    receiptsByKey.set(p.key, arr);
    moves.set(p.key, moved);
  }
  const inByKey = new Map<string, number[]>();
  const outByKey = new Map<string, number[]>();
  for (const p of positions) {
    inByKey.set(p.key, new Array(H + 2).fill(0));
    outByKey.set(p.key, new Array(H + 2).fill(0));
  }
  for (const a of input.actions ?? []) {
    if (a.fromKey && outByKey.has(a.fromKey) && a.dispatchDay >= 1 && a.dispatchDay <= H) {
      outByKey.get(a.fromKey)![a.dispatchDay] += a.quantity;
    }
    if (inByKey.has(a.toKey) && a.arrivalDay >= 1 && a.arrivalDay <= H) inByKey.get(a.toKey)![a.arrivalDay] += a.quantity;
  }

  const stock = new Map(positions.map((p) => [p.key, p.onHand]));
  const backlog = new Map(positions.map((p) => [p.key, 0]));
  const daily = new Map<string, DayPoint[]>(positions.map((p) => [p.key, []]));
  const stockSeries = new Map<string, number[]>(positions.map((p) => [p.key, [p.onHand]]));
  const totals = new Map(positions.map((p) => [p.key, { sold: 0, demand: 0, unmet: 0 }]));

  for (let t = 1; t <= H; t++) {
    const avail = new Map<string, number>();
    const received = new Map<string, number>();
    for (const p of positions) {
      const inQty = receiptsByKey.get(p.key)![t] + inByKey.get(p.key)![t];
      let a = stock.get(p.key)! + inQty;
      // a transfer cannot ship more than the donor holds on the dispatch day
      a -= Math.min(outByKey.get(p.key)![t], a);
      avail.set(p.key, a);
      received.set(p.key, inQty);
    }
    const dayDemand = new Map<string, number>();
    const served = new Map<string, number>();
    const pulled = new Map<string, number>();
    const remaining = new Map<string, number>();
    // own demand (plus backlog) served from each position's own stock
    for (const p of positions) {
      const dmd = p.dailyDemand + (input.backorders ? backlog.get(p.key)! : 0);
      const s = Math.min(avail.get(p.key)!, dmd);
      avail.set(p.key, avail.get(p.key)! - s);
      dayDemand.set(p.key, dmd);
      served.set(p.key, s);
      remaining.set(p.key, dmd - s);
    }
    // unserved finished-product demand is assembled from components (demand pulled through the BOM)
    for (const p of positions) {
      const comps = compsOf.get(p.key);
      const rem = remaining.get(p.key)!;
      if (!comps || rem <= EPS) continue;
      for (const c of comps) pulled.set(c.key, (pulled.get(c.key) ?? 0) + rem * c.q);
      const assembled = Math.max(0, Math.min(rem, ...comps.map((c) => avail.get(c.key)! / c.q)));
      if (assembled > EPS) {
        for (const c of comps) avail.set(c.key, avail.get(c.key)! - assembled * c.q);
        served.set(p.key, served.get(p.key)! + assembled);
        remaining.set(p.key, rem - assembled);
      }
    }
    for (const p of positions) {
      const unmet = Math.max(0, remaining.get(p.key)!);
      const st = Math.max(0, avail.get(p.key)!);
      stock.set(p.key, st);
      stockSeries.get(p.key)!.push(st);
      if (input.backorders) backlog.set(p.key, unmet);
      const tot = totals.get(p.key)!;
      tot.sold += served.get(p.key)!;
      tot.demand += p.dailyDemand;
      tot.unmet = input.backorders ? unmet : tot.unmet + unmet;
      daily.get(p.key)!.push({
        day: t,
        stock: round2(st),
        receipts: round2(received.get(p.key)!),
        demand: round2(dayDemand.get(p.key)!),
        pulledDemand: round2(pulled.get(p.key) ?? 0),
        sold: round2(served.get(p.key)!),
        unmet: round2(unmet),
      });
    }
  }

  const perPosition: PositionResult[] = positions.map((p) => {
    const days = daily.get(p.key)!;
    const stockout = days.find((d) => d.stock <= EPS && d.unmet > EPS);
    const covers = p.dailyDemand > 0 ? stockSeries.get(p.key)!.slice(1).map((s) => s / p.dailyDemand) : [];
    const tot = totals.get(p.key)!;
    return {
      key: p.key,
      warehouseId: p.warehouseId,
      warehouseName: p.warehouseName,
      productId: p.productId,
      productName: p.productName,
      sku: p.sku,
      onHand: p.onHand,
      dailyDemand: p.dailyDemand,
      isAssembled: compsOf.has(p.key),
      stockoutDay: stockout ? stockout.day : null,
      unmetUnits: round2(tot.unmet),
      soldUnits: round2(tot.sold),
      demandUnits: round2(tot.demand),
      minCoverDays: covers.length ? round2(Math.min(...covers)) : null,
      delayedReceipts: moves.get(p.key)!,
      daily: days,
    };
  });

  const orders = evaluateOrders(input, positions, compsOf, stockSeries, H);

  const shortageUnits = perPosition.reduce((s, p) => s + p.unmetUnits, 0);
  const lostRevenue = perPosition.reduce((s, p) => s + p.unmetUnits * (byKey.get(p.key)!.unitPrice || 0), 0);
  const totalDemand = perPosition.reduce((s, p) => s + p.demandUnits, 0);
  const totalSold = perPosition.reduce((s, p) => s + Math.min(p.soldUnits, p.demandUnits), 0);
  const actions = input.actions ?? [];
  const metrics: SimMetrics = {
    shortageUnits: round2(shortageUnits),
    lateOrders: orders.filter((o) => o.status === 'late').length,
    atRiskOrders: orders.filter((o) => o.status === 'at_risk').length,
    onTimeOrders: orders.filter((o) => o.status === 'on_time').length,
    lostRevenue: round2(lostRevenue),
    serviceLevel: totalDemand > 0 ? Math.round((totalSold / totalDemand) * 10000) / 10000 : 1,
    affectedPositions: perPosition.filter((p) => p.unmetUnits > EPS).length,
    actionCost: round2(actions.reduce((s, a) => s + a.cost, 0)),
    etaDays: actions.length ? Math.max(...actions.map((a) => a.arrivalDay)) : null,
  };
  return { metrics, perPosition, orders };
}

function evaluateOrders(
  input: SimInput,
  positions: SimPosition[],
  compsOf: Map<string, { key: string; q: number }[]>,
  stockSeries: Map<string, number[]>,
  H: number,
): OrderResult[] {
  const byKey = new Map(positions.map((p) => [p.key, p]));
  const consumed = new Map<string, number>();
  const availableAt = (key: string, t: number): number => {
    const own = stockSeries.get(key)?.[t] ?? 0;
    const comps = compsOf.get(key);
    const assemble = comps ? Math.max(0, Math.min(...comps.map((c) => (stockSeries.get(c.key)?.[t] ?? 0) / c.q))) : 0;
    return own + assemble - (consumed.get(key) ?? 0);
  };
  const lines = [...input.orders].sort(
    (a, b) => a.dueDay - b.dueDay || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.orderNo.localeCompare(b.orderNo),
  );
  const results: OrderLineResult[] = [];
  for (const line of lines) {
    const key = positionKey(line.warehouseId, line.productId);
    const pos = byKey.get(key);
    const due = Math.min(H, Math.max(1, Math.ceil(line.dueDay)));
    const base = {
      ...line,
      warehouseName: pos?.warehouseName ?? '',
      productName: pos?.productName ?? '',
    };
    if (!pos) {
      results.push({ ...base, status: 'late', daysLate: H - due + 1, unfilled: line.quantity, coverDaysAfter: null });
      continue;
    }
    const atDue = availableAt(key, due);
    if (atDue + EPS >= line.quantity) {
      consumed.set(key, (consumed.get(key) ?? 0) + line.quantity);
      const coverAfter = pos.dailyDemand > 0 ? (atDue - line.quantity) / pos.dailyDemand : null;
      results.push({
        ...base,
        status: coverAfter !== null && coverAfter < 1 ? 'at_risk' : 'on_time',
        daysLate: 0,
        unfilled: 0,
        coverDaysAfter: coverAfter === null ? null : round2(coverAfter),
      });
      continue;
    }
    let filledDay: number | null = null;
    let best = Math.max(0, atDue);
    for (let t = due + 1; t <= H; t++) {
      const a = availableAt(key, t);
      best = Math.max(best, a);
      if (a + EPS >= line.quantity) {
        filledDay = t;
        break;
      }
    }
    if (filledDay !== null) {
      consumed.set(key, (consumed.get(key) ?? 0) + line.quantity);
      results.push({ ...base, status: 'late', daysLate: filledDay - due, unfilled: 0, coverDaysAfter: null });
    } else {
      const filled = Math.min(line.quantity, Math.max(0, best));
      consumed.set(key, (consumed.get(key) ?? 0) + filled);
      results.push({
        ...base,
        status: 'late',
        daysLate: H - due + 1,
        unfilled: round2(line.quantity - filled),
        coverDaysAfter: null,
      });
    }
  }
  const grouped = new Map<string, OrderLineResult[]>();
  for (const r of results) {
    if (!grouped.has(r.orderId)) grouped.set(r.orderId, []);
    grouped.get(r.orderId)!.push(r);
  }
  const rank: Record<OrderStatus, number> = { on_time: 0, at_risk: 1, late: 2 };
  return [...grouped.values()].map((ls) => {
    const worst = ls.reduce((w, l) => (rank[l.status] > rank[w] ? l.status : w), 'on_time' as OrderStatus);
    return {
      orderId: ls[0].orderId,
      orderNo: ls[0].orderNo,
      customerName: ls[0].customerName,
      warehouseId: ls[0].warehouseId,
      warehouseName: ls[0].warehouseName,
      dueDay: Math.min(...ls.map((l) => l.dueDay)),
      priority: ls[0].priority,
      status: worst,
      daysLate: Math.max(...ls.map((l) => l.daysLate)),
      unfilled: round2(ls.reduce((s, l) => s + l.unfilled, 0)),
      lines: ls,
    };
  });
}

/* ------------------------------------------------------------- strategies */

export type StrategyName = 'none' | 'transfers' | 'alternative_supplier' | 'combined';
export const ALL_STRATEGIES: StrategyName[] = ['none', 'transfers', 'alternative_supplier', 'combined'];

export interface RouteInfo {
  fromWarehouseId: string;
  toWarehouseId: string;
  leadTimeDays: number;
  costPerUnit: number;
}

export interface StrategySources {
  routes: RouteInfo[];
  offersByProduct: Record<string, SupplierOfferInput[]>;
}

export interface StrategyResult extends SimResult {
  name: StrategyName;
  actions: SimAction[];
  deltas: {
    shortageUnits: number;
    lateOrders: number;
    atRiskOrders: number;
    lostRevenue: number;
    serviceLevel: number;
  };
}

/** Units each directly supplied position needs to cover baseline lost demand and late order lines. */
export function shortageByPosition(input: SimInput, baseline: SimResult): Map<string, number> {
  const req = new Map<string, number>();
  const add = (k: string, v: number) => req.set(k, (req.get(k) ?? 0) + v);
  const deps = input.dependencies;
  const keys = new Set(input.positions.map((p) => p.key));
  const compsFor = (p: { warehouseId: string; productId: string }) =>
    deps
      .filter((d) => d.finishedProductId === p.productId)
      .map((d) => ({ key: positionKey(p.warehouseId, d.componentProductId), q: d.quantityPer }))
      .filter((c) => keys.has(c.key));
  const lateUnits = new Map<string, number>();
  for (const o of baseline.orders)
    for (const l of o.lines)
      if (l.status === 'late') {
        const k = positionKey(l.warehouseId, l.productId);
        lateUnits.set(k, (lateUnits.get(k) ?? 0) + l.quantity);
      }
  for (const p of baseline.perPosition) {
    const need = p.unmetUnits + (lateUnits.get(p.key) ?? 0);
    if (need <= EPS) continue;
    const comps = compsFor(p);
    if (comps.length) for (const c of comps) add(c.key, need * c.q);
    else add(p.key, need);
  }
  for (const [k, v] of req) req.set(k, Math.ceil(v - EPS));
  return req;
}

export function planStrategyActions(
  strategy: StrategyName,
  input: SimInput,
  baseline: SimResult,
  sources: StrategySources,
): SimAction[] {
  if (strategy === 'none') return [];
  const mult = input.safetyStockMultiplier ?? 1;
  const positions = input.positions.map((p) => scalePosition(p, mult));
  const byKey = new Map(positions.map((p) => [p.key, p]));
  const need = shortageByPosition(input, baseline);
  const horizon = Math.max(1, Math.min(input.horizonDays, input.disruption.startDay + input.disruption.durationDays));
  const disrupted = input.disruption.supplierId ?? null;
  const usedFromDonor = new Map<string, number>();
  const actions: SimAction[] = [];
  const order = [...need.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [key, required] of order) {
    const target = byKey.get(key);
    if (!target || required <= 0) continue;
    const transferSources =
      strategy === 'alternative_supplier'
        ? []
        : positions
            .filter((p) => p.productId === target.productId && p.key !== key && !need.has(p.key))
            .map((p) => {
              const route = sources.routes.find((r) => r.fromWarehouseId === p.warehouseId && r.toWarehouseId === target.warehouseId);
              if (!route) return null;
              return {
                warehouseId: p.warehouseId,
                warehouseName: p.warehouseName,
                onHand: p.onHand - (usedFromDonor.get(p.key) ?? 0),
                minStock: p.minStock,
                dailyDemand: p.dailyDemand,
                leadTimeDays: route.leadTimeDays,
                costPerUnit: route.costPerUnit,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
    const supplierOffers =
      strategy === 'transfers'
        ? []
        : (sources.offersByProduct[target.productId] ?? []).filter((o) => o.supplierId !== disrupted);
    const result = analyzeRecovery({
      productName: target.productName,
      targetWarehouseName: target.warehouseName,
      horizonDays: horizon,
      requiredUnits: required,
      onHand: target.onHand,
      inbound: 0,
      dailyDemand: target.dailyDemand,
      minStock: target.minStock,
      transferSources,
      supplierOffers,
    });
    const best = result.options[0];
    if (!best) continue;
    for (const st of best.steps) {
      const arrivalDay = Math.max(1, Math.ceil(st.leadTimeDays));
      if (st.type === 'transfer') {
        const fromKey = positionKey(st.fromWarehouse!, target.productId);
        usedFromDonor.set(fromKey, (usedFromDonor.get(fromKey) ?? 0) + st.quantity);
        actions.push({
          type: 'transfer',
          label: `Transfer ${st.quantity} ${target.sku} ${st.fromWarehouseName} -> ${target.warehouseName}`,
          fromKey,
          toKey: key,
          quantity: st.quantity,
          dispatchDay: 1,
          arrivalDay,
          cost: st.cost,
        });
      } else {
        actions.push({
          type: 'purchase',
          label: `Buy ${st.quantity} ${target.sku} from ${st.supplierName} for ${target.warehouseName}`,
          supplierId: st.supplier,
          toKey: key,
          quantity: st.quantity,
          dispatchDay: 1,
          arrivalDay,
          cost: st.cost,
        });
      }
    }
  }
  return actions;
}

function deltas(b: SimMetrics, s: SimMetrics): StrategyResult['deltas'] {
  return {
    shortageUnits: round2(s.shortageUnits - b.shortageUnits),
    lateOrders: s.lateOrders - b.lateOrders,
    atRiskOrders: s.atRiskOrders - b.atRiskOrders,
    lostRevenue: round2(s.lostRevenue - b.lostRevenue),
    serviceLevel: Math.round((s.serviceLevel - b.serviceLevel) * 10000) / 10000,
  };
}

export function compareStrategies(
  input: SimInput,
  sources: StrategySources,
  strategies: StrategyName[] = ALL_STRATEGIES,
): { baseline: SimResult; strategies: StrategyResult[] } {
  const baseline = simulate({ ...input, actions: [] });
  const out: StrategyResult[] = [];
  for (const name of strategies) {
    const actions = planStrategyActions(name, input, baseline, sources);
    const result = name === 'none' ? baseline : simulate({ ...input, actions });
    out.push({ name, actions, ...result, deltas: deltas(baseline.metrics, result.metrics) });
  }
  return { baseline, strategies: out };
}

export const SWEEP_DURATIONS = [3, 5, 7, 10];
export const SWEEP_MULTIPLIERS = [0.5, 1, 1.5];

export interface SweepCell {
  durationDays: number;
  safetyStockMultiplier: number;
  shortageUnits: Record<StrategyName, number>;
  lateOrders: Record<StrategyName, number>;
}

export interface SweepResult {
  durations: number[];
  multipliers: number[];
  strategies: StrategyName[];
  cells: SweepCell[];
}

export function sensitivitySweep(
  input: SimInput,
  sources: StrategySources,
  strategies: StrategyName[] = ALL_STRATEGIES,
  durations: number[] = SWEEP_DURATIONS,
  multipliers: number[] = SWEEP_MULTIPLIERS,
): SweepResult {
  const cells: SweepCell[] = [];
  for (const durationDays of durations) {
    for (const m of multipliers) {
      const cellInput: SimInput = { ...input, safetyStockMultiplier: m, disruption: { ...input.disruption, durationDays } };
      const cmp = compareStrategies(cellInput, sources, strategies);
      const shortageUnits = {} as Record<StrategyName, number>;
      const lateOrders = {} as Record<StrategyName, number>;
      for (const s of cmp.strategies) {
        shortageUnits[s.name] = s.metrics.shortageUnits;
        lateOrders[s.name] = s.metrics.lateOrders;
      }
      cells.push({ durationDays, safetyStockMultiplier: m, shortageUnits, lateOrders });
    }
  }
  return { durations, multipliers, strategies, cells };
}

/** Shared types mirroring the API responses. Ids are strings; dates are ISO strings. */

export type Role = 'admin' | 'warehouse_manager' | 'staff' | 'supplier';

export interface Ref {
  _id: string;
}
export interface WarehouseRef extends Ref {
  code: string;
  name: string;
}
export interface ProductRef extends Ref {
  sku: string;
  name: string;
  unit?: string;
}
export interface SupplierRef extends Ref {
  name: string;
  status?: SupplierStatus;
}
export interface UserRef extends Ref {
  name: string;
  email?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface NotifyPrefs {
  inApp: boolean;
  email: boolean;
  sms: boolean;
}

export interface User {
  _id: string;
  name: string;
  email: string;
  role: Role;
  warehouse: WarehouseRef | null;
  supplier: SupplierRef | null;
  phone?: string;
  notify: NotifyPrefs;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt?: string;
}

export interface Zone {
  code: string;
  name: string;
  bins: string[];
}

export interface Warehouse {
  _id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  location: { lat: number; lng: number } | null;
  zones: Zone[];
  manager: UserRef | null;
  isActive: boolean;
}

export type SupplierStatus = 'active' | 'disrupted' | 'inactive';

export interface LeadTimeStats {
  mean: number;
  std: number;
  samples: number;
  observedMean: number | null;
  source: 'nominal' | 'blended';
}

export interface Supplier {
  _id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  leadTimeDays: number;
  performanceScore: number;
  onTimeDeliveries: number;
  lateDeliveries: number;
  totalOrders: number;
  leadTimeSamples: number;
  status: SupplierStatus;
  disruption: { from: string; expectedDays: number; reason: string } | null;
  isActive: boolean;
  leadTime: LeadTimeStats;
}

export interface SupplierOffer {
  _id: string;
  supplier: SupplierRef;
  product: ProductRef;
  capacityUnits: number;
  minOrderQty: number;
  leadTimeDays: number;
  unitCost: number;
  validUntil: string | null;
  isActive: boolean;
}

export type LeadTimeSource = 'override' | 'blended' | 'nominal' | 'default';

export interface Product {
  _id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  unitCost: number;
  unitPrice: number;
  imageUrl: string;
  primarySupplier: { _id: string; name: string; status: SupplierStatus; leadTimeDays: number } | null;
  avgDailyDemand: number;
  demandStdDev: number;
  leadTimeDaysOverride: number | null;
  serviceLevelZ: number;
  orderCost: number;
  holdingCostPerUnitYear: number;
  annualDemandOverride: number | null;
  isPerishable: boolean;
  shelfLifeDays: number | null;
  minShelfLifeDays: number;
  qrPayload: string;
  isActive: boolean;
  totalOnHand?: number;
  leadTime: { days: number; std: number; source: LeadTimeSource; samples: number };
}

export interface StockLine {
  _id: string;
  product: ProductRef & { unitCost?: number; isPerishable?: boolean };
  warehouse: WarehouseRef;
  bin: string;
  batchNo: string;
  expiryDate: string | null;
  quantity: number;
  reorderPoint: number;
  lot?: string | null;
  createdAt?: string;
}

export interface Allocation {
  lineId?: string;
  lot?: string;
  dnaCode?: string;
  batchNo: string;
  bin: string;
  expiryDate: string | null;
  quantity: number;
}

export type TransferStatus = 'pending_approval' | 'approved' | 'in_transit' | 'completed' | 'rejected' | 'cancelled';

export interface Transfer {
  _id: string;
  product: ProductRef;
  fromWarehouse: WarehouseRef;
  toWarehouse: WarehouseRef;
  quantity: number;
  batchNo: string;
  status: TransferStatus;
  mode: 'instant' | 'tracked';
  allocations: Allocation[];
  source: 'manual' | 'rebalance' | 'recovery_plan' | 'redistribution_plan';
  plan: string | null;
  planModel: 'RecoveryPlan' | 'RedistributionPlan' | null;
  initiatedBy: UserRef | null;
  approvedBy: UserRef | null;
  approvedAt: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  receivedBy: UserRef | null;
  rejectedReason: string;
  notes: string;
  createdAt: string;
}

export interface ReorderExplanation {
  inputs: {
    avgDailyDemand: number;
    demandStdDev: number;
    demandSource: 'history' | 'fallback' | 'product';
    leadDays: number;
    sigmaLead: number;
    leadTimeSource: LeadTimeSource;
    leadTimeSamples: number;
    z: number;
    annualDemand: number;
    orderCost: number;
    holdingCost: number;
    onHand: number;
    onOrder: number;
  };
  policy: { safetyStock: number; reorderPoint: number; economicOrderQuantity: number };
  position: number;
  shouldReorder: boolean;
  orderQuantity: number;
  steps: string[];
}

export type POStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'confirmed'
  | 'dispatched'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export interface POItem {
  _id: string;
  product: ProductRef & { isPerishable?: boolean };
  quantityOrdered: number;
  quantityReceived: number;
  unitCost: number;
  reorderExplanation: ReorderExplanation | null;
}

export interface PurchaseOrder {
  _id: string;
  poNumber: string;
  supplier: SupplierRef & { email?: string };
  warehouse: WarehouseRef;
  items: POItem[];
  status: POStatus;
  autoGenerated: boolean;
  source: 'manual' | 'auto_reorder' | 'recovery_plan';
  recoveryPlan: { _id: string; planNo: string; status: string } | null;
  expectedDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  supplierConfirmedQty: number | null;
  supplierConfirmedDate: string | null;
  dispatchInfo: { dispatchedAt: string | null; carrier: string; trackingNo: string; eta: string | null };
  createdBy: UserRef | null;
  approvedBy: UserRef | null;
  approvedAt: string | null;
  rejectedReason: string;
  notes: string;
  payment: { status: 'none' | 'pending' | 'paid'; provider: string; reference: string };
  totalCost: number;
  createdAt: string;
}

export interface AutoDraftResult {
  warehouse: WarehouseRef;
  evaluated: number;
  created: PurchaseOrder[];
  avoidedByTransfer: {
    product: ProductRef;
    deficit: number;
    reorderPoint: number;
    position: number;
    transfers: { from: WarehouseRef; to: WarehouseRef; quantity: number }[];
    explanation: string;
  }[];
  skipped: { product: ProductRef; reason: string; suggestion?: string }[];
}

export type AlertType =
  | 'low_stock'
  | 'overstock'
  | 'expiry'
  | 'po_pending_approval'
  | 'po_overdue'
  | 'supplier_disruption'
  | 'recovery_proposed'
  | 'redistribution_proposed'
  | 'count_variance'
  | 'discrepancy';
export type Severity = 'info' | 'warning' | 'critical';

export interface Alert {
  _id: string;
  type: AlertType;
  severity: Severity;
  product: ProductRef | null;
  warehouse: WarehouseRef | null;
  supplier: SupplierRef | null;
  purchaseOrder: { _id: string; poNumber: string; status: POStatus } | null;
  plan: string | null;
  message: string;
  isResolved: boolean;
  resolvedAt: string | null;
  resolvedBy: UserRef | null;
  createdAt: string;
}

export interface Notification {
  _id: string;
  type: string;
  subject: string;
  body: string;
  link: string;
  status: 'queued' | 'sent' | 'failed' | 'read';
  readAt: string | null;
  createdAt: string;
}

export interface Overview {
  products: number;
  warehouses: number;
  suppliers: number;
  openAlerts: number;
  pendingPOs: number;
  lowStockLines: number;
  totalUnits: number;
  stockValue: number;
}

export interface InsightRow {
  product: ProductRef & { category: string; unitCost: number; isPerishable: boolean; supplierName: string | null };
  abc: 'A' | 'B' | 'C';
  xyz: 'X' | 'Y' | 'Z';
  class: string;
  policyHint: string;
  annualDemand: number;
  annualValue: number;
  valueShare: number;
  demandMean: number;
  demandStd: number;
  demandCV: number | null;
  demandSource: 'history' | 'fallback';
  onHand: number;
  onOrder: number;
  position: number;
  reorderPoint: number;
  safetyStock: number;
  eoq: number;
  leadTimeDays: number;
  leadTimeStd: number;
  leadTimeSource: LeadTimeSource;
  leadTimeSamples: number;
  promisedLeadTimeDays: number | null;
  daysOfCover: number | null;
  status: 'reorder' | 'overstock' | 'no_demand' | 'ok';
  shouldReorder: boolean;
  suggestedOrderQty: number;
  currentZ: number;
  recommendedZ: number;
  explanation: ReorderExplanation;
}

export interface ExpiryRiskRow {
  stockLevelId: string;
  dnaCode?: string | null;
  lot?: string | null;
  lotStatus?: string | null;
  product: ProductRef;
  warehouse: WarehouseRef;
  batchNo: string;
  bin: string;
  expiryDate: string;
  daysLeft: number;
  units: number;
  dailyDemand: number;
  projectedWaste: number;
  valueAtRisk: number;
}

export interface Insights {
  warehouse: string | null;
  generatedAt: string;
  items: InsightRow[];
  expiryRisk: ExpiryRiskRow[];
}

export interface RebalanceSuggestion {
  product: ProductRef;
  from: WarehouseRef;
  to: WarehouseRef;
  quantity: number;
  explanation: string;
}

export interface AuditEntry {
  _id: string;
  seq: number;
  prevHash: string;
  hash: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string | null;
  actorInfo: { name: string; email: string; role: Role } | null;
  warehouse: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
}

export type VerifyResult =
  | { valid: true; checked: number; headSeq: number | null; headHash: string | null; verifiedAt: string }
  | { valid: false; checked: number; brokenAtSeq: number; reason: string; verifiedAt: string };

export interface PlanStep {
  type: 'transfer' | 'purchase';
  fromWarehouse?: string;
  fromWarehouseName?: string;
  supplier?: string;
  supplierName?: string;
  quantity: number;
  unitCost: number;
  leadTimeDays: number;
  cost: number;
}

export interface RecoveryOption {
  optionId: string;
  label: string;
  steps: PlanStep[];
  coveredUnits: number;
  shortageLeft: number;
  totalCost: number;
  etaDays: number;
  feasible: boolean;
  constraintChecks: { name: string; passed: boolean; detail: string }[];
  explanation: string[];
  rank: number;
}

export interface RecoveryContext {
  onHand: number;
  inboundWithinHorizon: number;
  dailyDemand: number;
  minStock: number;
  horizonDays: number;
  requiredUnits: number;
  asOf?: string;
}

export interface RecoveryInput {
  product: string;
  warehouse: string;
  horizonDays?: number | null;
  requiredUnits?: number | null;
  excludeSupplier?: string | null;
}

export interface RecoveryAnalysis {
  input: RecoveryInput;
  product: ProductRef & { unitCost: number };
  targetWarehouse: WarehouseRef;
  excludedSupplier: { _id: string; name: string } | null;
  horizonSource: string;
  asOf: string;
  result: {
    needed: boolean;
    message: string;
    context: RecoveryContext;
    sources: {
      kind: 'transfer' | 'purchase';
      id: string;
      name: string;
      capacity: number;
      minOrderQty: number;
      leadTimeDays: number;
      unitCost: number;
      feasible: boolean;
      reason: string;
      detail: string;
    }[];
    options: RecoveryOption[];
  };
}

export type RecoveryStatus = 'proposed' | 'approved' | 'in_progress' | 'completed' | 'rejected' | 'cancelled' | 'failed';

export interface TimelineEntry {
  at: string;
  by: UserRef | string | null;
  event: string;
  detail: string;
}

export interface RecoveryPlan {
  _id: string;
  planNo: string;
  status: RecoveryStatus;
  trigger: { kind: string; supplier: SupplierRef | string | null; delayDays: number | null };
  product: ProductRef;
  targetWarehouse: WarehouseRef;
  context: RecoveryContext;
  options?: RecoveryOption[];
  selectedOptionId: string;
  selectedOption: RecoveryOption | null;
  createdBy: UserRef | null;
  approvedBy: UserRef | null;
  approvedAt: string | null;
  rejectedReason: string;
  execution?: { transfers: string[]; purchaseOrder: string | null; purchaseOrders: string[]; completedAt: string | null };
  timeline?: TimelineEntry[];
  transfers?: Transfer[];
  purchaseOrders?: (Omit<PurchaseOrder, 'supplier'> & { supplier: SupplierRef })[];
  dnaLots?: { _id: string; dnaCode: string; status: string; batchNo: string }[];
  createdAt: string;
}

export interface RedistributionLine {
  toWarehouse: string | WarehouseRef;
  toWarehouseName: string;
  quantity: number;
  transferLeadDays: number;
  transferCostPerUnit: number;
  sellWindowDays: number;
  destDailyDemand: number;
  destExistingUnits: number;
  capacityUnits: number;
  expectedSoldBeforeExpiry: number;
  transfer?: string | null;
}

export interface RedistributionResult {
  shelfLifeDaysLeft: number;
  minShelfLifeDays: number;
  sourceDailyDemand: number;
  sourceOwnSalesUnits: number;
  surplusUnits: number;
  destinations: {
    warehouseId: string;
    warehouseName: string;
    transferLeadDays: number;
    transferCostPerUnit: number;
    destDailyDemand: number;
    destExistingUnits: number;
    destOnOrder: number;
    sellWindowDays: number;
    capacityUnits: number;
    eligible: boolean;
    reason: string;
  }[];
  lines: RedistributionLine[];
  allocatedUnits: number;
  residualUnits: number;
  residualAdvice: 'markdown' | 'donate' | 'dispose' | 'none';
  transportCost: number;
  explanation: string[];
}

export interface BatchAnalysis {
  stockLevelId: string;
  product: ProductRef & { unitCost: number; minShelfLifeDays: number };
  source: WarehouseRef;
  batchNo: string;
  bin: string;
  quantity: number;
  expiryDate: string;
  asOf: string;
  result: RedistributionResult;
  daysLeft?: number;
  projectedWaste?: number;
  valueAtRisk?: number;
  lot?: { lot: string; dnaCode: string; status: string; recalled: boolean; remainingShelfDays: number | null; sellable: boolean } | null;
}

export type RedistributionStatus = 'proposed' | 'approved' | 'in_progress' | 'completed' | 'rejected' | 'cancelled';

export interface RedistributionPlan {
  _id: string;
  planNo: string;
  status: RedistributionStatus;
  product: ProductRef;
  batchNo: string;
  sourceWarehouse: WarehouseRef;
  sourceQuantity: number;
  expiryDate: string;
  shelfLifeDaysLeft: number;
  minShelfLifeDays: number;
  sourceOwnSalesUnits: number;
  surplusUnits: number;
  lines: RedistributionLine[];
  residualUnits: number;
  residualAdvice: 'markdown' | 'donate' | 'dispose' | 'none';
  explanation: string[];
  createdBy: UserRef | null;
  approvedBy: UserRef | null;
  rejectedReason: string;
  timeline?: TimelineEntry[];
  transfers?: Transfer[];
  dnaLots?: { _id: string; dnaCode: string; status: string }[];
  createdAt: string;
}

export interface CustomerOrder {
  _id: string;
  orderNo: string;
  customerName: string;
  warehouse: WarehouseRef;
  items: { _id: string; product: ProductRef & { unitPrice?: number }; quantity: number; quantityFulfilled: number; unitPrice: number | null }[];
  requiredBy: string;
  priority: 'low' | 'normal' | 'high';
  status: 'open' | 'fulfilled' | 'late' | 'cancelled';
}

export interface ProductDependency {
  _id: string;
  componentProduct: ProductRef;
  finishedProduct: ProductRef;
  quantityPer: number;
}

export interface GraphNode {
  id: string;
  type: 'supplier' | 'product' | 'position' | 'order';
  label: string;
  refId: string;
  affected: boolean;
  depth: number | null;
}
export interface GraphEdge {
  from: string;
  to: string;
  kind: 'supplies' | 'offers' | 'component_of' | 'stocked_at' | 'ordered_by';
  quantityPer?: number;
  affected: boolean;
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

export interface SimPosition {
  key: string;
  warehouseName: string;
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

export interface SimOrder {
  orderId: string;
  orderNo: string;
  customerName: string;
  warehouseName: string;
  dueDay: number;
  priority: string;
  status: 'on_time' | 'at_risk' | 'late';
  daysLate: number;
  unfilled: number;
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

export type StrategyName = 'none' | 'transfers' | 'alternative_supplier' | 'combined';

export interface SimulationRun {
  _id: string;
  scenario: string | null;
  scenarioSnapshot: { name: string | null; type: string; supplier: string | null; product: string | null; startDay: number; durationDays: number; horizonDays: number; backorders: boolean };
  ranAt: string;
  ranBy: UserRef | null;
  parameters: { horizonDays: number; safetyStockMultiplier: number; backorders: boolean };
  graph?: { nodes: GraphNode[]; edges: GraphEdge[]; affectedNodeIds: string[] };
  baseline: { metrics: SimMetrics; perPosition?: SimPosition[]; orders?: SimOrder[] };
  strategies: {
    name: StrategyName;
    metrics: SimMetrics;
    deltas?: { shortageUnits: number; lateOrders: number; atRiskOrders: number; lostRevenue: number; serviceLevel: number };
    actions?: { type: string; label: string; toKey: string; quantity: number; arrivalDay: number; cost: number }[];
    perPosition?: SimPosition[];
    orders?: SimOrder[];
  }[];
  sweep: {
    durations: number[];
    multipliers: number[];
    strategies: StrategyName[];
    cells: { durationDays: number; safetyStockMultiplier: number; shortageUnits: Record<StrategyName, number>; lateOrders: Record<StrategyName, number> }[];
  } | null;
}

export interface Scenario {
  _id: string;
  name: string;
  type: 'supplier_stop' | 'supplier_delay' | 'component_stop';
  supplier: SupplierRef | null;
  product: ProductRef | null;
  startDay: number;
  durationDays: number;
  horizonDays: number;
  backorders: boolean;
}

export interface StockCountLine {
  _id: string;
  product: ProductRef;
  bin: string;
  batchNo: string;
  systemQty: number;
  countedQty: number | null;
  variance: number | null;
  reason: string;
}

export interface StockCount {
  _id: string;
  countNo: string;
  warehouse: WarehouseRef;
  status: 'open' | 'submitted' | 'reconciled' | 'cancelled';
  lines: StockCountLine[];
  lineCount?: number;
  countedLines?: number;
  varianceLines?: number;
  createdBy: UserRef | null;
  submittedAt: string | null;
  reconciledAt: string | null;
  reconciledBy: UserRef | null;
  createdAt: string;
}

export interface Discrepancy {
  _id: string;
  type: 'receipt_mismatch' | 'count_variance' | 'damage' | 'other';
  purchaseOrder: { _id: string; poNumber: string } | null;
  product: ProductRef | null;
  warehouse: WarehouseRef;
  expectedQty: number;
  actualQty: number;
  evidence: string[];
  notes: string;
  status: 'open' | 'resolved';
  resolution: string;
  createdAt: string;
}

export interface StockPolicy {
  _id: string;
  product: ProductRef;
  warehouse: WarehouseRef;
  minStock: number | null;
  maxStock: number | null;
}

export interface TransferRoute {
  _id: string;
  fromWarehouse: WarehouseRef;
  toWarehouse: WarehouseRef;
  leadTimeDays: number;
  costPerUnit: number;
  distanceKm: number | null;
  estimated: boolean;
}

export interface AppConfig {
  paymentsEnabled: boolean;
  drivers: Record<string, string>;
  environment: string;
}

export interface PendingApprovals {
  purchaseOrders: (PurchaseOrder & { totalCost: number })[];
  recoveryPlans: { _id: string; planNo: string; product: ProductRef; targetWarehouse: WarehouseRef; option: RecoveryOption | null; createdAt: string }[];
  redistributionPlans: { _id: string; planNo: string; product: ProductRef; sourceWarehouse: WarehouseRef; batchNo: string; units: number; createdAt: string }[];
  transfers: Transfer[];
}

// ---------------------------------------------------------------------------------------------------------------
// Stock DNA

export type LotStatus = 'quarantine' | 'active' | 'expired' | 'depleted' | 'expired_disposed' | 'written_off' | 'recalled_destroyed' | 'returned_to_supplier';
export type DeathCause = 'sold_out' | 'consumed' | 'expired' | 'damaged' | 'recalled' | 'returned_to_supplier' | 'rejected_at_qc' | 'written_off';
export type DisposalCause = 'expired' | 'damaged' | 'recalled' | 'rejected_at_qc' | 'written_off';
export const ALIVE_LOT_STATUSES: LotStatus[] = ['quarantine', 'active', 'expired'];

export interface OutByCause {
  sold: number;
  consumed: number;
  expired: number;
  damaged: number;
  shrinkage: number;
  recalled: number;
  returnedToSupplier: number;
  writtenOff: number;
}

export interface LotDeath {
  at: string;
  cause: DeathCause;
  lifespanDays: number;
  lifeUsedPct: number | null;
  valueLost: number;
  approvedBy?: UserRef | string | null;
  note?: string;
}

export interface LotRequest {
  _id: string;
  kind: 'dispose' | 'return_to_supplier';
  cause: DisposalCause | null;
  warehouse: string;
  qty: number;
  reason: string;
  evidence: string[];
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: UserRef | string;
  requestedAt: string;
  decidedBy?: UserRef | string | null;
  decidedAt?: string | null;
  decisionNote?: string;
}

export interface StockLot {
  _id: string;
  dnaCode: string;
  product: ProductRef & { unit?: string; unitCost?: number };
  batchNo: string;
  supplier: (Ref & { name: string }) | null;
  birth: {
    type: 'purchase_receipt' | 'opening_balance' | 'return_in';
    at: string;
    warehouse: WarehouseRef | string;
    bin: string;
    qty: number;
    unitCost: number;
    refType: string | null;
    refId: string | null;
    grnNo: string | null;
    backfilled: boolean;
  };
  manufactureDate: string | null;
  expiryDate: string | null;
  shelfLifeDays: number | null;
  parentLots: string[];
  status: LotStatus;
  qtyBorn: number;
  qtyAdded: number;
  qtyOnHand: number;
  qtyInTransit: number;
  qtyReserved: number;
  qtyOutByCause: OutByCause;
  flags: { onHold: boolean; recalled: boolean; backfilled: boolean; qcRejected: boolean; expiryWarned: boolean };
  warehouses: string[];
  death: LotDeath | null;
  eventCount: number;
  headHash: string | null;
  lastEventAt: string | null;
  lastEventType: string | null;
  lastVerify?: { at: string | null; ok: boolean | null; firstBrokenSeq: number | null };
  requests?: LotRequest[];
  createdAt: string;
}

export interface LotListItem extends StockLot {
  locations: { warehouse: WarehouseRef; qty: number }[];
  lifeUsedPct: number | null;
  remainingShelfDays: number | null;
}

export interface JourneyStop {
  warehouse: WarehouseRef & { city?: string };
  arrivedAt: string;
  departedAt: string | null;
  dwellDays: number;
  transitDaysBefore: number | null;
}

export interface LotDetail extends StockLot {
  metrics: {
    ageDays: number;
    lifeUsedPct: number | null;
    remainingShelfDays: number | null;
    depletionPct: number;
    dwellByLocation: Record<string, number>;
    journey: JourneyStop[];
    hops: number;
    holdingCostAccrued: number;
    holdingCostNote: string;
  };
  slices: { _id: string; warehouse: WarehouseRef; bin: string; quantity: number; expiryDate: string | null }[];
  invariantOk: boolean;
}

export interface Gene {
  _id: string;
  lot: string;
  seq: number;
  type: string;
  at: string;
  actor: (UserRef & { role?: string }) | null;
  actorRole: string;
  warehouse: WarehouseRef | null;
  fromWarehouse: WarehouseRef | null;
  toWarehouse: WarehouseRef | null;
  bin: string | null;
  qtyDelta: number;
  qtyMoved: number;
  qtyAfter: { onHand: number; inTransit: number };
  cause: string | null;
  refType: string | null;
  refId: string | null;
  explanation: string;
  evidence: string[];
  hash: string;
  prevHash: string;
  daysSincePrevious: number | null;
}

export interface Genealogy {
  lot: string;
  nodes: { _id: string; dnaCode: string; batchNo: string; status: LotStatus; qtyBorn: number; qtyOnHand: number; role: 'self' | 'ancestor' | 'descendant' }[];
  edges: { parentLot: string; childLot: string; relation: string; qty: number; at: string }[];
}

export interface LotVerifyResult {
  ok: boolean;
  eventsChecked: number;
  firstBrokenSeq: number | null;
  reason: string | null;
  anchoredOk: boolean;
  anchorProblems: { seq: number; reason: string }[];
  checkedAt: string;
  dnaCode: string;
}

export interface DnaWrite {
  lot: StockLot;
  gene: { lot: string; dnaCode: string; type: string; seq: number } | null;
  pending?: boolean;
  request?: LotRequest;
}

export interface DnaStats {
  alive: number;
  dead: number;
  recalledAlive: number;
  expiringSoon: number;
  deathsByCause: { cause: DeathCause; count: number; avgLifespanDays: number; avgLifeUsedPct: number | null; valueLost: number }[];
  averageLifespanDays: number | null;
  averageLifeUsedAtDeath: number | null;
  valueLostByCause: { expired: number; damaged: number; shrinkage: number; recalled: number; writtenOff: number };
  diedThisMonthByCause: { cause: DeathCause; count: number; valueLost: number }[];
  valueLostThisMonth: { expired: number; damaged: number; total: number };
}

export interface TraceWarehouse {
  warehouse: WarehouseRef;
  qtyReceived: number;
}
export interface TraceOrder {
  refId: string;
  qty: number;
  orderNo: string | null;
}

export interface RecallTrace {
  matched: number;
  lots: {
    lot: { _id: string; dnaCode: string; batchNo: string; status: LotStatus; product: ProductRef; supplier: (Ref & { name: string }) | null; flags: StockLot['flags']; qtyBorn: number; qtyOnHand: number };
    backward: { supplier: (Ref & { name: string }) | null; birthType: string; purchaseOrder: string | null; grnNo: string | null; receivedAt: string; receivingWarehouse: WarehouseRef | null; parents: { lot: string; parent: string; relation: string; qty: number }[] };
    forward: {
      warehousesReached: TraceWarehouse[];
      orders: TraceOrder[];
      qtyDispatchedToOrders: number;
      qtyStillAlive: number;
      lots: { lot: string; dnaCode: string; status: LotStatus; depth: number; qtyAlive: number; qtyDispatched: number }[];
    };
  }[];
  summary: { warehousesReached: TraceWarehouse[]; orders: TraceOrder[]; qtyDispatchedToOrders: number; qtyStillAlive: number };
}

export interface ReconcileResult {
  lotsChecked: number;
  drift: { lot: string; dnaCode: string; genesOnHand: number; headerOnHand: number; slicesOnHand: number; invariantOk: boolean }[];
  orphanSlices: number;
  checkedAt: string;
}

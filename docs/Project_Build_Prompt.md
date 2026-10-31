0.1 What the product is

A multi-warehouse inventory and procurement platform for retailers, warehouses and distribution centres. Every stock movement is recorded once and shown to every role in real time. Replenishment is automated with a deterministic, explainable reorder engine (reorder point, safety stock, EOQ). Staff scan QR codes from any browser camera, so no RFID or IoT hardware is needed. Role-based access, a tamper-evident audit trail, and live dashboards are built in.

On top of the core platform, build six unique features and three new decision modules:

ID	Name	One line
F1	Glass-box reorder	Every drafted PO line stores the full derivation: inputs, formulas with real numbers, final quantity
F2	Inventory-position reordering	Trigger on on-hand + on-order, order whole multiples of EOQ, never double-order
F3	Supplier-reliability feedback loop	Learn real supplier lead time and its variance from received POs and raise safety stock for late suppliers
F4	Rebalance before you buy	Move surplus stock from another warehouse before raising a PO
F5	FEFO picking + expiry-waste projection	Earliest-expiring batch leaves first; project units that will expire unsold
F6	Tamper-evident audit log	SHA-256 hash chain; verification locates the first broken entry
M5	Self-Healing Recovery Engine	When a supplier cannot deliver, compare transfers and alternative suppliers and recommend a feasible recovery plan for approval
M6	Domino Effect Predictor	Simulate a disruption through a dependency graph and day-by-day inventory flow; compare recovery strategies
M7	Expiry-Aware Stock Redistribution	Recommend moving only the quantity a destination can sell before expiry, accounting for transport time and its existing stock

Also included: ABC-XYZ classification with a service-level recommendation, days of cover, scan-to-act, cycle counts and reconciliation, supplier portal (confirm and dispatch), in-app, email and SMS notifications, CSV and PDF reports.

0.2 My tech stack (use these, do not substitute)

Frontend: React.js with TypeScript, Vite, Redux Toolkit (RTK Query or thunks), React Router, Socket.io client, Recharts, html5-qrcode (scanner), qrcode.react (QR display), Axios, plain CSS or CSS modules (no UI framework required). Backend: Node.js LTS, Express.js (TypeScript), Socket.io, JWT authentication (jsonwebtoken), Mongoose, bcrypt (bcryptjs is fine), helmet, cors, express-rate-limit, morgan, zod (request validation), pdfkit (PDF reports). Database: MongoDB (Atlas for production, local or docker for development), Mongoose transactions for multi-document stock changes (use a replica set locally via docker so transactions work). Cloud and delivery: AWS (EC2 for the API, S3 for documents), Vercel for the frontend, GitHub + GitHub Actions for CI, Cloudinary for images and attachments. Integrations: Google Maps API (warehouse map, geocoding, distance for transfer lead time), an Email API (SendGrid or SMTP via nodemailer), an SMS gateway API (Twilio-style), Razorpay or Stripe (optional, behind a feature flag). Testing and tools: Jest + Supertest + mongodb-memory-server, Postman collection, MongoDB Compass-friendly schema, k6 script for load tests. Runtime: Windows 10/11 or Ubuntu.

Integration rule: every external service sits behind a small adapter interface with two drivers: a real driver (reads keys from .env) and a console/mock driver (used automatically when keys are missing). The whole app must run end to end with no API keys.

0.3 Hard rules
No machine learning and no Python. All decision logic is plain, deterministic, unit-tested TypeScript with fixed formulas. Every recommendation must come with a human-readable explanation built from the real numbers.
Human approval: the system never creates a PO, transfer or recovery action on its own authority. It proposes; an authorised person approves.
Audit everything: every mutating action writes a hash-chained audit entry with actor, before and after state.
Atomic stock: any change that touches more than one stock document runs in a MongoDB transaction.
RBAC on every route (roles: admin, warehouse_manager, supplier, staff), plus warehouse scoping for manager and staff on write actions.
Complete code only: no stubs, no TODO, no placeholder text. Every button listed in this document must exist, be wired to a real endpoint, and handle loading, empty and error states.
Honest status: the README must separate "implemented and tested" from "needs credentials or deployment". Do not claim performance or accuracy numbers you have not measured.
Write tests as you go. A phase is done only when npm test passes.
Keep money as numbers in INR (display with the rupee sign). Dates are stored as UTC ISO dates; "days" are whole or fractional days as stated.
0.4 Repository layout
smart-inventory-scm/
  README.md
  docker-compose.yml
  .github/workflows/ci.yml
  backend/
    package.json  tsconfig.json  jest.config.ts  .env.example  Dockerfile
    src/
      server.ts  app.ts
      config/        env.ts  db.ts
      middleware/    auth.ts  rbac.ts  validate.ts  errorHandler.ts  audit.ts
      models/        (one file per collection, Section 1)
      routes/        index.ts + one file per module
      controllers/   one file per module
      services/      planning.ts  alerts.ts  recovery.ts  redistribution.ts  simulation.ts  notifications.ts  reports.ts  counters.ts
      engines/       reorder.ts  inventoryLogic.ts  analytics.ts  hashChain.ts  recoveryEngine.ts  redistributionEngine.ts  simulationEngine.ts   (pure, no database)
      integrations/  email/  sms/  storage/  maps/  payments/   (adapter + real + mock)
      sockets/       index.ts
      seed/          seed.ts  scenarios.ts
      utils/         apiError.ts  asyncHandler.ts  jwt.ts  qrcode.ts
    tests/           unit/  integration/
  frontend/
    package.json  tsconfig.json  vite.config.ts  vercel.json  .env.example  Dockerfile
    src/
      main.tsx  App.tsx
      api/           client.ts  endpoints per module
      app/           store.ts
      features/      auth/  realtime/  notifications/
      components/    Layout  ProtectedRoute  DataTable  StatCard  Badge  ExplainPanel  RebalanceList  Modal  Toast  ConfirmDialog  FormField  EmptyState  Pager  QrScanner
      pages/         (Section 5)
      types/         shared TypeScript types mirroring the API
PART 1: DATABASE DESIGN (MongoDB / Mongoose)

General rules: timestamps: true on every collection unless stated; every ref is an ObjectId; add the listed indexes; validate with Mongoose schema rules and zod at the API edge. IDs in API responses are _id strings.

1.1 Entity relationship summary
User --(supplier role)--> Supplier            User --(manager/staff)--> Warehouse
Product --primarySupplier--> Supplier         SupplierOffer: Supplier x Product (alternative sourcing)
StockLevel: Product x Warehouse x Batch       StockPolicy: Product x Warehouse (min/max)
PurchaseOrder: Supplier + Warehouse + items[Product]
Transfer: Product, fromWarehouse -> toWarehouse         TransferRoute: Warehouse x Warehouse (lead time, cost)
CustomerOrder: Warehouse + items[Product]               ProductDependency: componentProduct -> finishedProduct
DemandHistory: Product x Warehouse x Day
RecoveryPlan -> (Transfers[], PurchaseOrder)            RedistributionPlan -> Transfer[]
DisruptionScenario -> SimulationRun[]
StockCount (cycle count) -> variances -> stock adjustments
Discrepancy -> PurchaseOrder / Product
Alert, Notification, AuditLog (hash chain), Counter (atomic sequences)
1.2 Core collections
users
Field	Type	Rules
name	String	required, trim
email	String	required, unique, lowercase
passwordHash	String	required (bcrypt, 10 rounds)
role	String enum	admin, warehouse_manager, supplier, staff; default staff
supplier	ObjectId → Supplier	required when role is supplier
warehouse	ObjectId → Warehouse	scope for manager and staff; null for admin
phone	String	for SMS, E.164
notify	{ inApp: Bool=true, email: Bool=true, sms: Bool=false }	preferences
isActive	Boolean	default true
lastLoginAt	Date	
warehouses

code (unique, uppercase), name, address, city, location {lat, lng} (Google Maps), zones[] {code, name, bins[String]}, manager (User), isActive.

suppliers

name, contactName, email, phone, address, location {lat, lng}, leadTimeDays (promised, default 7), performanceScore (0 to 100, default 100), onTimeDeliveries, lateDeliveries, totalOrders, lead-time learning accumulators leadTimeSamples, leadTimeSum, leadTimeSumSq, status enum active | disrupted | inactive (set to disrupted when a disruption is declared), disruption {from: Date, expectedDays: Number, reason: String} or null, isActive.

products

sku (unique, uppercase), name, description, category, unit, unitCost, unitPrice, imageUrl (Cloudinary), primarySupplier, avgDailyDemand (default 1), demandStdDev (σ, default 0), leadTimeDaysOverride (nullable), serviceLevelZ (default 1.65), orderCost (S, default 20), holdingCostPerUnitYear (H, default 2), annualDemandOverride (nullable), isPerishable (Boolean), shelfLifeDays (nullable), minShelfLifeDays (default 1; minimum acceptable shelf life when sold), qrPayload, isActive. Text index on name and sku.

stocklevels (one document per product + warehouse + batch + bin)

product, warehouse, bin, batchNo, expiryDate (nullable), quantity (≥ 0), reorderPoint (snapshot). Indexes: {product, warehouse, batchNo, bin}, {expiryDate}, {warehouse}.

stockpolicies (optional per product and warehouse override)

product, warehouse, minStock (default = ceil of computed safety stock), maxStock (nullable), unique on {product, warehouse}. Minimum stock for the recovery engine is minStock if present, else ceil(safetyStock).

purchaseorders

poNumber (unique, from Counter, format PO-YYYY-000001), supplier, warehouse, items[] {product, quantityOrdered, quantityReceived, unitCost, reorderExplanation (Mixed, F1)}, status enum: draft, pending_approval, approved, rejected, confirmed (supplier confirmed), dispatched, partially_received, received, cancelled; autoGenerated (Boolean), source enum manual | auto_reorder | recovery_plan, recoveryPlan (ref, nullable), expectedDeliveryDate, actualDeliveryDate, supplierConfirmedQty/supplierConfirmedDate, dispatchInfo {dispatchedAt, carrier, trackingNo, eta}, createdBy, approvedBy, approvedAt, rejectedReason, receivedBy, notes, payment {status enum none|pending|paid, provider, reference} (optional, feature flag). Virtual totalCost.

transfers

product, fromWarehouse, toWarehouse, quantity, batchNo, status enum: pending_approval, approved, in_transit, completed, rejected, cancelled; mode enum instant | tracked (instant = move immediately and complete; tracked = approval then dispatch then receive); allocations[] {batchNo, bin, expiryDate, quantity} (FEFO actually used); source enum manual | rebalance | recovery_plan | redistribution_plan; plan (ref to RecoveryPlan or RedistributionPlan), initiatedBy, approvedBy, dispatchedAt, receivedAt, receivedBy, notes.

alerts

type enum: low_stock, overstock, expiry, po_pending_approval, po_overdue, supplier_disruption, recovery_proposed, redistribution_proposed, count_variance, discrepancy; severity (info|warning|critical), product, warehouse, purchaseOrder, plan (ref), message, isResolved, resolvedAt, resolvedBy. De-duplicate open alerts by {type, product, warehouse}; auto-resolve when the condition clears.

auditlogs (append-only, hash-chained, F6)

seq (unique, from Counter), prevHash, hash, action (e.g. stock.receive, po.approve, recovery.approve), entityType, entityId, actor, warehouse, before, after, metadata, createdAt (set explicitly, covered by the hash). Schema option minimize: false, timestamps: false.

counters

_id (name, e.g. po, audit), seq. Use findOneAndUpdate({_id}, {$inc:{seq:1}}, {new:true, upsert:true}) so PO numbers and audit sequence numbers are atomic across multiple server instances.

1.3 Collections for the new modules and workflows
supplieroffers (alternative sourcing, used by M5 and M6)

supplier, product, capacityUnits (max units the supplier can deliver per order or within the horizon), minOrderQty, leadTimeDays, unitCost, validUntil (nullable), isActive. Unique on {supplier, product}.

transferroutes

fromWarehouse, toWarehouse, leadTimeDays (may be fractional), costPerUnit, distanceKm (optional, filled from Google Maps), unique on {fromWarehouse, toWarehouse}. If a route is missing, use Google Maps distance (when available) divided by 400 km/day (rounded up to whole days, minimum 1) and a default cost, and mark the route estimated: true.

demandhistory

product, warehouse, date (day, UTC midnight), quantity (units dispatched or sold that day), source enum dispatch | import | seed. Unique on {product, warehouse, date}. Every dispatch increments today's row. Used to compute per-warehouse demand: d(w,p) = mean daily quantity over the last 30 days (including zero days), σd(w,p) = standard deviation; fall back to product.avgDailyDemand when fewer than 7 days of history exist.

customerorders

orderNo (unique), customerName, warehouse, items[] {product, quantity, quantityFulfilled}, requiredBy (Date), priority enum low|normal|high, status enum open | fulfilled | late | cancelled, unitPrice per line (optional). Used by the Domino simulator to find downstream orders.

productdependencies (bill of materials link)

componentProduct, finishedProduct, quantityPer (units of component per finished unit), unique on {componentProduct, finishedProduct}. Used by graph traversal (component stops → finished product affected).

recoveryplans (M5)
{
  planNo (unique, from Counter "rp", e.g. RP-2026-0001),
  status: "proposed" | "approved" | "in_progress" | "completed" | "rejected" | "cancelled" | "failed",
  trigger: { kind: "supplier_delay" | "shortage_alert" | "manual", supplier, delayDays },
  product, targetWarehouse,
  context: { onHand, inboundWithinHorizon, dailyDemand, minStock, horizonDays, requiredUnits, asOf },
  options: [ { optionId, label, steps:[ { type:"transfer"|"purchase", fromWarehouse?, supplier?, quantity, unitCost, leadTimeDays, cost } ],
               coveredUnits, shortageLeft, totalCost, etaDays, feasible, constraintChecks:[{name, passed, detail}], explanation:[String], rank } ],
  selectedOptionId,
  createdBy, approvedBy, approvedAt, rejectedReason,
  execution: { transfers:[ObjectId], purchaseOrder:ObjectId|null, completedAt },
  timeline: [ { at, by, event, detail } ]
}
redistributionplans (M7)
{
  planNo (Counter "xp", e.g. XP-2026-0001), status: "proposed" | "approved" | "in_progress" | "completed" | "rejected" | "cancelled",
  product, batchNo, sourceWarehouse, sourceQuantity, expiryDate, shelfLifeDaysLeft, minShelfLifeDays,
  sourceOwnSalesUnits, surplusUnits,
  lines: [ { toWarehouse, quantity, transferLeadDays, sellWindowDays, destDailyDemand, destExistingUnits, capacityUnits, expectedSoldBeforeExpiry, transfer:ObjectId|null } ],
  residualUnits (still at risk after the plan), residualAdvice ("markdown" | "donate" | "dispose" | "none"),
  explanation:[String], createdBy, approvedBy, approvedAt, timeline:[...]
}
disruptionscenarios and simulationruns (M6)

disruptionscenarios: name, type enum supplier_stop | supplier_delay | component_stop, supplier (or product for component_stop), startDay (default 0), durationDays, horizonDays (default 30), backorders (Boolean, default false: unmet demand is lost), createdBy. simulationruns: scenario, ranAt, ranBy, parameters {horizonDays, safetyStockMultiplier, backorders}, graph {nodes[], edges[]}, baseline {metrics, perPosition[], orders[], dailySeries[]}, strategies[] {name: none|transfers|alternative_supplier|combined, metrics, actions[], perPosition[], orders[]}, sweep[] (optional matrix of results for different disruption lengths and safety-stock multipliers).

stockcounts (cycle counts and reconciliation)

countNo (Counter "cc"), warehouse, status enum open | submitted | reconciled | cancelled, lines[] {product, bin, batchNo, systemQty, countedQty, variance, reason}, createdBy, submittedAt, reconciledBy, reconciledAt. Reconciling creates stock adjustments (audited) and, for variances above a threshold, a count_variance alert.

discrepancies (scan mismatch)

type enum receipt_mismatch | count_variance | damage | other, purchaseOrder, product, warehouse, expectedQty, actualQty, evidence[] (Cloudinary URLs), notes, status enum open | resolved, createdBy, resolvedBy, resolution.

notifications

user, channel enum in_app | email | sms, type, subject, body, link, status enum queued | sent | failed | read, providerMessageId, error, readAt.

PART 2: BACKEND SPECIFICATION
2.1 Setup
Express app with helmet, cors (origin from CLIENT_ORIGIN, credentials true), express-rate-limit (window and max from env), morgan, JSON body limit 1 MB, central error handler returning { error: { message, code, details? } }.
GET /api/health → { ok, service, time }.
Env (.env.example lists all): PORT, MONGODB_URI, JWT_SECRET, JWT_EXPIRES_IN=8h, CLIENT_ORIGIN, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, CLOUDINARY_URL, EMAIL_PROVIDER, SENDGRID_API_KEY or SMTP vars, SMS_PROVIDER, TWILIO_* (or generic gateway vars), GOOGLE_MAPS_API_KEY, ENABLE_PAYMENTS=false, RAZORPAY_* / STRIPE_*, AWS_S3_BUCKET, AWS_REGION.
Socket.io on the same HTTP server, CORS to the client origin; authenticate the socket handshake with the JWT.
2.2 Authentication and RBAC
POST /api/auth/register (self-registration creates staff unless an admin creates the user; supplier accounts are created by admin or through supplier onboarding).
POST /api/auth/login → { token, user }, updates lastLoginAt, writes audit user.login.
GET /api/auth/me; PATCH /api/auth/me (name, phone, notify preferences); POST /api/auth/change-password (current + new).
Middleware: requireAuth (verifies JWT, loads user, rejects inactive) and requireRole(...roles). scopeToOwnWarehouse: for warehouse_manager and staff, writes must target their own warehouse (admin bypasses).
Permission matrix (reads are allowed for every signed-in role unless noted)
Action	admin	warehouse_manager	staff	supplier
Manage users, reset passwords	yes	no	no	no
Create warehouse / edit warehouse	yes / yes	no / yes (own)	no	no
Create and edit products	yes	yes	no	no
Register supplier / edit supplier / manage offers	yes	no / no / yes	no	own supplier record and own offers
Receive and dispatch stock	yes	yes	yes	no
Transfer stock (instant)	yes	yes	no	no
Create PO, run auto-draft	yes	yes	no	no
Approve or reject PO	yes	no	no	no
Supplier confirm and dispatch PO	no	no	no	yes (own POs only)
Receive goods against PO	yes	yes	yes	no
Run recovery engine / propose plans	yes	yes	no	no
Approve recovery or redistribution plan	yes	no	no	no
Dispatch and receive tracked transfers	yes	yes	yes	no
Run redistribution scan, run simulations	yes	yes	no	no
Cycle counts: create and submit / reconcile	yes / yes	yes / yes	create and submit / no	no
Resolve alerts, expiry sweep	yes	yes	no	no
Insights, rebalance suggestions	yes	yes	no	no
View and verify audit log	yes	yes	no	no
Reports and exports	yes	yes	no	supplier sees own scorecard
2.3 REST API (prefix /api)

Return JSON. Validate bodies with zod. List endpoints accept page, limit where noted. All mutating endpoints write an audit entry and, where relevant, emit a socket event.

Users, warehouses, suppliers, products
Method and path	Roles	Behaviour
GET /users, POST /users, PATCH /users/:id, POST /users/:id/reset-password	admin	list, create (any role, link supplier or warehouse), update role / active / warehouse, reset password
GET /warehouses, GET /warehouses/:id	all	
POST /warehouses	admin	create with zones and bins and location
PATCH /warehouses/:id	admin, manager (own)	update; geocode address via Maps adapter when location missing
GET /suppliers, GET /suppliers/:id	all (supplier sees own)	include learned lead time stats
POST /suppliers	admin, supplier	create (supplier role creates own record and links to the user)
PATCH /suppliers/:id	admin	edit details, status
POST /suppliers/:id/disruption	admin, manager	body { expectedDays, reason }: sets status disrupted, raises supplier_disruption alert, notifies admins and managers, offers "Run recovery"
DELETE /suppliers/:id/disruption	admin, manager	clears disruption
GET/POST/PATCH/DELETE /supplier-offers (?supplier&product)	admin, manager, supplier (own)	alternative sourcing offers
GET /products?q= , GET /products/:id	all	search by name or SKU, include current stock summary
POST /products, PATCH /products/:id	admin, manager	create or update; generates qrPayload = SKU
POST /products/:id/image	admin, manager	upload to Cloudinary adapter, store imageUrl
GET /products/:id/qr	all	returns QR as PNG data URL
POST /products/scan	all	body { payload } (SKU or QR text) → product, 404 if unknown
GET /products/:id/explain?warehouse=	admin, manager, staff	the F1 explanation for that product at that warehouse
Stock
Method and path	Roles	Behaviour
GET /stock?warehouse=&product=	all	stock lines populated with product and warehouse
GET /stock/summary?warehouse=	all	per product totals (on-hand, value, batches, nearest expiry)
POST /stock/receive	admin, manager, staff	body { product, warehouse, quantity, bin?, batchNo?, expiryDate? }; transaction; merges into the same batch/bin line; audit; socket stock:update; re-evaluates alerts
POST /stock/dispatch	same	body { product, warehouse, quantity, bin?, batchNo? }; FEFO allocation across batches when batchNo is omitted; 400 if insufficient; returns { allocations }; increments DemandHistory for today; audit; socket; alerts
POST /stock/transfer	admin, manager	body { product, fromWarehouse, toWarehouse, quantity, batchNo?, notes?, mode? }; mode=instant (default): FEFO pick at source, create stock at destination with the same batch numbers and expiry dates, in one transaction, status completed; mode=tracked: creates Transfer pending_approval
GET /stock/transfers?status=&warehouse=	all	list transfers
POST /transfers/:id/approve	admin	pending_approval → approved
POST /transfers/:id/reject	admin	with reason
POST /transfers/:id/dispatch	admin, manager, staff (source warehouse)	removes stock at source (FEFO, transaction), status in_transit, stores allocations
POST /transfers/:id/receive	admin, manager, staff (destination warehouse)	adds stock at destination with batch and expiry, status completed, receivedAt; completes parent plan step
POST /transfers/:id/cancel	admin, manager	only before dispatch
POST /stock-counts, GET /stock-counts, GET /stock-counts/:id	create: admin, manager, staff	create a count for a warehouse pre-filled with system quantities
PATCH /stock-counts/:id	same	enter counted quantities
POST /stock-counts/:id/submit	same	status submitted, compute variances
POST /stock-counts/:id/reconcile	admin, manager	apply variances as audited adjustments in a transaction; raise count_variance alert above 5% variance
GET/POST/PATCH /discrepancies	admin, manager, staff (create)	record and resolve mismatches, with evidence upload POST /discrepancies/:id/evidence
GET/PUT /stock-policies?product=&warehouse=	admin, manager	min and max stock overrides
GET/PUT /transfer-routes	admin, manager	lead time and cost per warehouse pair; POST /transfer-routes/estimate uses Google Maps distance
Purchase orders
Method and path	Roles	Behaviour
GET /purchase-orders?status=&supplier=&warehouse=	all (supplier sees own)	
GET /purchase-orders/:id	all (scoped)	
POST /purchase-orders	admin, manager	manual PO (status pending_approval; draft allowed via flag)
POST /purchase-orders/auto-draft	admin, manager	body { warehouse }; the F2 + F4 auto-draft algorithm (Section 3.3); returns { created: [PO], avoidedByTransfer: [...], skipped: [...] }
POST /purchase-orders/:id/approve	admin	→ approved; notifies supplier by email and SMS; audit
POST /purchase-orders/:id/reject	admin	body { reason } → rejected
POST /purchase-orders/:id/confirm	supplier (own)	body { confirmedQty, confirmedDate } → confirmed, sets expectedDeliveryDate
POST /purchase-orders/:id/dispatch	supplier (own)	body { carrier, trackingNo, eta } → dispatched
POST /purchase-orders/:id/receive	admin, manager, staff	body { receivedItems: [{ product, quantityReceived, batchNo?, expiryDate? }] }; transaction: adds stock, updates quantityReceived; status partially_received or received; on full receipt records observed lead time (whole days from approvedAt to now, minimum 1), updates the supplier's accumulators (F3), on-time vs late counts and performanceScore; if received less than ordered by line, offers to log a discrepancy; resolves alerts; audit; socket po:received
POST /purchase-orders/:id/cancel	admin	
POST /purchase-orders/:id/pay	admin	only when ENABLE_PAYMENTS=true; creates Razorpay or Stripe order via adapter, mock driver returns a fake reference
Alerts, dashboard, analytics, audit
Method and path	Roles	Behaviour
GET /alerts?resolved=&warehouse=&type=	all	
POST /alerts/:id/resolve	admin, manager	
POST /alerts/sweep-expiry	admin, manager	create expiry alerts for batches expiring within 14 days (critical when 3 days or fewer)
GET /dashboard/overview?warehouse=	all	KPIs: products, warehouses, suppliers, open alerts, pending POs, low-stock lines, total units, total stock value
GET /dashboard/stock-by-value, GET /dashboard/po-funnel	all	chart data (top 20 by value; counts by PO status)
GET /analytics/insights?warehouse=	admin, manager	per product: ABC, XYZ, class, annual value, value share, demand CV, on-hand, on-order, reorder point, safety stock, EOQ, learned lead time and its source, days of cover, status (`reorder
GET /analytics/rebalance	admin, manager	network-wide rebalance suggestions { product, from, to, quantity }
POST /analytics/rebalance/execute	admin, manager	executes one suggestion as an instant transfer
PATCH /products/:id with serviceLevelZ	admin, manager	used by the "Apply recommended z" button
GET /audit?entityType=&action=&actor=&page=&limit=	admin, manager	newest first
GET /audit/verify	admin, manager	returns { valid, checked, headSeq, headHash } or { valid:false, brokenAtSeq, reason }
GET /audit/export.csv	admin, manager	
New modules
Method and path	Roles	Behaviour
POST /recovery/analyze	admin, manager	body { product, warehouse, horizonDays?, requiredUnits?, excludeSupplier?, trigger? }; runs the recovery engine (3.7) without saving; returns ranked options
POST /recovery/plans	admin, manager	body { analysisInput, selectedOptionId }: saves a proposed plan, raises recovery_proposed alert, notifies approvers
GET /recovery/plans?status=, GET /recovery/plans/:id	admin, manager	
POST /recovery/plans/:id/approve	admin	in one transaction creates tracked transfers (status approved) and a PO (status approved, source recovery_plan); plan → approved then in_progress; notifies supplier; audit
POST /recovery/plans/:id/reject	admin	body { reason }
POST /recovery/plans/:id/cancel	admin, manager	before execution only
(progress)	system	when linked transfers and PO complete, plan → completed and timeline updated; if any step is cancelled or rejected, plan → failed
POST /redistribution/scan	admin, manager	scans all dated batches; returns candidate plans (not saved) for batches whose projected waste is above 0
POST /redistribution/analyze	admin, manager	body { stockLevelId, minShelfLifeDays? } for one batch
POST /redistribution/plans	admin, manager	save a proposed plan, alert redistribution_proposed
GET /redistribution/plans, GET /redistribution/plans/:id	admin, manager	
POST /redistribution/plans/:id/approve	admin	creates tracked transfers, plan → in_progress
POST /redistribution/plans/:id/reject, /cancel	admin / admin, manager	
GET/POST/PATCH/DELETE /customer-orders	admin, manager	CRUD for the simulator's downstream orders
GET/POST/DELETE /product-dependencies	admin, manager	BOM links
GET /simulation/graph?supplier=&product=	admin, manager	the dependency graph (nodes and edges) built from live data
POST /simulation/scenarios, GET /simulation/scenarios	admin, manager	save and list scenarios
POST /simulation/run	admin, manager	body `{ scenario
GET /simulation/runs, GET /simulation/runs/:id	admin, manager	
POST /simulation/runs/:id/create-recovery-plan	admin, manager	turns a chosen strategy for a chosen shortage into a proposed recovery plan
GET /reports/stock.csv, /reports/purchase-orders.csv, /reports/suppliers.csv, /reports/expiry.csv	admin, manager	CSV
GET /reports/stock.pdf, /reports/purchase-orders.pdf, /reports/supplier-scorecard.pdf?supplier=	admin, manager (supplier: own scorecard)	PDF via pdfkit
GET /notifications, POST /notifications/:id/read, POST /notifications/read-all	all	the signed-in user's in-app notifications
POST /maps/geocode, POST /maps/distance	admin, manager	Maps adapter (mock returns deterministic values)
2.4 Real-time events (Socket.io)

Clients join all and wh:<warehouseId> rooms after the authenticated handshake. Emit: stock:update {warehouse, product, ...}, alert:new, po:<event> (created, approved, rejected, confirmed, dispatched, received), transfer:update, recovery:update, redistribution:update, simulation:done, notification:new (to the user's own room user:<id>).

2.5 Alert rules
low_stock: inventory position (on-hand + on-order) at or below the reorder point. Severity critical when total on-hand is 0, else warning.
overstock: on-hand above 5 × reorder point (info).
expiry: a batch expires within 14 days (critical at 3 days or fewer).
po_pending_approval, po_overdue (expected delivery date passed and not received).
supplier_disruption, recovery_proposed, redistribution_proposed, count_variance, discrepancy.
De-duplicate open alerts by {type, product, warehouse} (update the message instead of creating another). Auto-resolve low_stock and overstock when the condition clears. Every new alert is emitted over Socket.io and, for critical severity, sent by email and SMS to users who enabled those channels.
2.6 Notification service

notify(userIds | role, {type, subject, body, link}) creates an in-app notification for each user, then (per the user's notify preferences) queues email and SMS through the adapters. Record status, providerMessageId and error. Events that notify: PO approved (supplier), PO confirmed and dispatched (managers), critical alerts, recovery or redistribution plan proposed (admins), plan approved (proposer), supplier disruption declared.

PART 3: ALGORITHMS (pure functions in engines/, 100% unit-tested)
3.1 Reorder engine (F1, F2, F3)
safetyStock = z * sqrt( L * sigmaD^2 + d^2 * sigmaL^2 )          // equals z*sigmaD*sqrt(L) when sigmaL = 0
reorderPoint = ceil( d * L + safetyStock )
EOQ = ceil( sqrt( 2 * D * S / H ) )                               // D = annualDemandOverride ?? d*365 ; 0 if D = 0 ; H must be > 0
position = onHand + onOrder
shouldReorder = (d > 0) AND position <= reorderPoint
orderQuantity = smallest k*EOQ such that position + k*EOQ > reorderPoint   (k >= 1)

Lead time precedence: product.leadTimeDaysOverride > supplier statistics > 7-day default. Supplier lead-time statistics (F3):

nominal = supplier.leadTimeDays ; n = leadTimeSamples ; sum, sumSq = accumulators
if n == 0: mean = nominal, std = 0, source = "nominal"
else: observedMean = sum/n ; variance = n>1 ? max(0,(sumSq - n*observedMean^2)/(n-1)) : 0
      mean = (3*nominal + sum) / (3 + n)      // shrinkage: 3 virtual deliveries at the promised value
      std = sqrt(variance) ; source = "blended"
applyLeadTimeSample(acc, days): n+1, sum+days, sumSq+days^2     (days >= 0)

Explanation object (F1) returned by explainReorder({product, supplier, onHand, onOrder}): { inputs: {avgDailyDemand, demandStdDev, leadDays, sigmaLead, leadTimeSource, z, annualDemand, orderCost, holdingCost, onHand, onOrder}, policy: {safetyStock, reorderPoint, economicOrderQuantity}, position, shouldReorder, orderQuantity, steps: [ "Safety stock = 1.65 x sqrt(11.9 x 6^2 + 40^2 x 2.1^2) = 138.4", "Reorder point = 40 x 11.9 + 138.4 = 615", ... ] } where every step string contains the real numbers. This object is stored on each auto-drafted PO line (reorderExplanation).

3.2 Inventory logic

FEFO allocation allocateFEFO(lines, qty): sort lines with quantity > 0 by earliest expiryDate (undated last), tie-break oldest createdAt; take greedily; throw RangeError("Insufficient stock: have X, requested Y") if not enough; qty must be > 0.

Expiry-waste projection projectExpiryWaste(lines, dailyDemand, now): for dated lines sorted by days left; demandByExpiry = d * daysLeft; sellThrough = min(quantity, max(0, demandByExpiry - soldSoFar)); soldSoFar += sellThrough; wasteUnits = ceil(quantity - sellThrough). Value at risk = waste × unitCost.

Rebalance planRebalance({positions, reorderPoint, keepFactor = 1.5}):

keep = ceil(keepFactor * reorderPoint)
needy = tracked warehouses with onHand + onOrder <= reorderPoint, deficit = reorderPoint + 1 - position, sorted by deficit desc
donors = tracked warehouses with onHand - keep > 0, surplus = onHand - keep, sorted by surplus desc
for each needy: take from the donor with the largest remaining surplus until covered
return { needs:[{warehouse, deficit, covered, uncovered}], transfers:[{from,to,quantity}], totalSurplus }

Example test: ROP 100; North onHand 400 (keeps 150, surplus 250); South position 40 (deficit 61) → transfer 61 North → South.

ABC-XYZ: ABC by cumulative share of annual consumption value (annual demand × unit cost): class A while the item starts before 80%, B before 95%, else C. XYZ by coefficient of variation of daily demand: X ≤ 0.25, Y ≤ 0.5, else Z (demand 0 → Z). Recommended z by ABC class: A 2.05 (about 98%), B 1.65 (95%), C 1.28 (90%). daysOfCover = onHand / d (null when d = 0). Provide a policy hint text for each of the nine classes (AX, AY, AZ, BX, BY, BZ, CX, CY, CZ).

3.3 Auto-draft PO (F2 + F4)

For POST /purchase-orders/auto-draft {warehouse}:

Load all active products, positions per warehouse (on-hand from stock, on-order = outstanding quantities on POs in pending_approval, approved, confirmed, dispatched, partially_received).
For each product at the target warehouse compute the reorder explanation. Skip when not shouldReorder (this makes a second run a no-op: no double ordering).
Run planRebalance. If transfers can cover the deficit, do not buy: return it under avoidedByTransfer with the suggested transfers (the manager can execute them with one click).
For the remaining shortfall, draft a PO line with quantityOrdered = orderQuantity and the explanation. Group lines by primary supplier into one PO per supplier with status pending_approval, autoGenerated: true, source: "auto_reorder". Skip products whose supplier is disrupted (list them under skipped with reason, and suggest the recovery engine).
Audit, alert po_pending_approval, notify admins.
3.4 Hash chain (F6)
canonicalize(value): deterministic JSON with sorted keys, undefined dropped, non-finite numbers -> null
hashable = { seq, action, entityType, entityId, actor, warehouse, before, after, metadata, createdAt(ISO) }
hash = sha256( prevHash + "|" + canonicalize(hashable) ) ; first entry prevHash = 64 zeros
recordAudit(): get seq from Counter("audit"), read previous entry's hash, compute and insert (serialize writes per process)
verifyChain(entries ordered by seq): for each entry check
   1. seq == previous seq + 1                 else reason "Sequence gap ... (an entry was deleted or inserted)"
   2. prevHash == previous entry's hash       else reason "prevHash does not match ... (chain was altered)"
   3. recompute hash == stored hash           else reason "Entry contents do not match its stored hash (the record was modified)"
   returns { valid:true, checked, headSeq, headHash } or { valid:false, checked, brokenAtSeq, reason }

Note in the UI and README: deleting the newest entries is only detectable by comparing the head hash with a copy saved earlier.

3.5 Demand estimation

estimateDemand(history, fallbackDaily, days = 30) → { mean, std, samples, source: "history" | "fallback" }. History source requires at least 7 distinct days of data; zero days inside the window count as zeros.

3.6 Minimum stock and transferable stock
minStock(w,p) = StockPolicy.minStock ?? ceil(safetyStock(p,w))
transferable(w,p,H) = max( 0, onHand(w,p) - minStock(w,p) - ceil( d(w,p) * H ) )

H is the planning horizon in days (for the recovery engine, the supplier's delay).

3.7 Self-Healing Recovery Engine (M5)

Inputs: product, targetWarehouse, horizonDays H (default: the disrupted supplier's expectedDays, else 7), optional requiredUnits, optional excludeSupplier (default: the product's primary supplier when it is disrupted).

1. Context: onHand(T), inbound(T,H) = outstanding quantities on POs expected within H days from non-excluded suppliers,
            d(T), minStock(T)
   requiredUnits = given ?? max(0, ceil(d(T)*H) + minStock(T) - (onHand(T) + inbound(T,H)))
   if requiredUnits == 0 -> return { needed:false, message:"No shortage within the horizon" }
2. Transfer sources: for every other warehouse w with a TransferRoute w->T:
      cap(w) = transferable(w, p, H), leadDays = route.leadTimeDays, unitCost = route.costPerUnit
      feasible if cap > 0 and leadDays <= H
3. Supplier sources: SupplierOffer rows for p, excluding the disrupted supplier, active, validUntil ok:
      cap = capacityUnits, MOQ = minOrderQty, leadDays, unitCost ; feasible if leadDays <= H and capacity >= MOQ
4. Candidate plans (each fills at most requiredUnits, quantities never exceed a source's cap, supplier quantities respect MOQ):
      A "Transfers only": fill from transfer sources cheapest-first
      B "Supplier only" for each supplier offer: min(cap, required) (raised to MOQ if needed and cap allows)
      C "Transfers first, then cheapest supplier(s)"
      D "Cheapest overall": all feasible sources sorted by unit cost, greedy
      E "Fastest": all feasible sources sorted by lead time, then cost
   De-duplicate identical plans.
5. For each plan compute: coveredUnits, shortageLeft = required - covered, totalCost = sum(qty * unitCost), etaDays = max lead time of used steps,
   constraintChecks: ["donor stays at or above minimum stock", "lead time within horizon", "supplier capacity respected", "MOQ respected"].
6. Rank: shortageLeft ascending, then totalCost ascending, then etaDays ascending. Return the top 3 with rank, label, and explanation strings
   such as "Transfer 200 units from Warehouse B (stock 435 - minimum 200 - 5/day x 7 days = 200 available, 1 day, Rs 2/unit)".

Required unit test (Example A): Warehouse A: onHand 10, d = 30/day, minStock 100, H = 7, inbound 0 → required = 210 + 100 − 10 = 300. Warehouse B: onHand 435, minStock 200, d = 5/day → transferable = 435 − 200 − 35 = 200, route lead 1 day, Rs 2/unit. Alternative supplier offer: capacity 100, lead 3 days, Rs 62/unit. Expected ranking: (1) transfer 200 from B + purchase 100 from the alternative supplier: shortage left 0, cost 200×2 + 100×62 = Rs 6,600, ETA 3 days; (2) transfers only: shortage left 100; (3) supplier only: shortage left 200.

Approval execution: see Section 2.3 (approve creates tracked transfers and a PO in one transaction; the plan tracks each step in execution and timeline).

3.8 Domino Effect Predictor (M6)

Graph (built from live data):

Nodes: supplier, product, warehouse-position (product at warehouse), order (CustomerOrder).
Edges: supplier → product (primary supplier or SupplierOffer), component product → finished product (ProductDependency, with quantityPer), product → warehouse-position (stock exists or policy exists), warehouse-position → order (order's warehouse and product).
Traversal: breadth-first from the disrupted node (supplier, or component product), following edges; collect affected products, positions and orders; record the path for display.

Inventory-flow simulation (day-by-day, day 1..horizon, default 30; deterministic):

for each affected position (w,p):
   stock[0] = onHand(w,p)
   receipts[t] = outstanding PO quantities expected on day t
        from the disrupted supplier: receipts expected on days <= startDay + duration are moved to day (startDay + duration + 1)   (a delay)
        from other suppliers: unchanged
   demand[t] = d(w,p) for every day (plus finished-product demand pulled through ProductDependency: componentDemand = finishedDemand * quantityPer)
   for t = 1..horizon:
        available = stock[t-1] + receipts[t]
        sold[t] = min(available, demand[t]) ; unmet[t] = demand[t] - sold[t]
        stock[t] = available - sold[t]     (if backorders=true, unmet accumulates and is served first from later receipts; default false = lost sales)
   metrics per position: stockoutDay (first day stock reaches 0 with unmet > 0), unmetUnits, minCoverDays
Orders: process CustomerOrders for the affected products sorted by requiredBy then priority desc; an order line is filled from the position's available stock up to its requiredBy day;
   order status "on_time" | "at_risk" (cover below 1 day around the due date) | "late"; unfilled units and days late recorded.
Totals: shortageUnits, lateOrders, atRiskOrders, lostRevenue = unmet * unitPrice, serviceLevel = sold / total demand.

Strategies compared (each re-runs the simulation with its actions applied):

none (baseline with the disruption and no action)
transfers: rebalance using the recovery engine's transfer sources
alternative_supplier: use the best feasible supplier offers
combined: the recovery engine's top plan Output a comparison table: strategy, shortage units, late orders, lost revenue, cost of actions, ETA, service level, and before versus after deltas. Sensitivity sweep (optional): disruption length ∈ {3, 5, 7, 10} days × safety-stock multiplier ∈ {0.5, 1, 1.5}: returns a matrix of shortage units per strategy so the user can compare strategies under different inventory constraints. Required acceptance test: component maker stops 5 days; baseline shows at least one affected warehouse and at least one late order; combined shows shortage units less than or equal to baseline and never negative stock.
3.9 Expiry-Aware Stock Redistribution (M7)

Inputs: a batch StockLevel (product p, source warehouse A, quantity Q, expiryDate), minShelfLifeDays m (default product.minShelfLifeDays = 1).

shelfLeft = floor( days from now to expiryDate )
A's own sales: ownSales = floor( d(A,p) * max(0, shelfLeft - m) )            // what A can sell itself before the margin
surplus = max(0, Q - ownSales)
for each destination B != A with a TransferRoute A->B and demand history or fallback demand for p:
     lead = route.leadTimeDays
     sellWindow = shelfLeft - lead - m                                        // days B can still sell it at acceptable shelf life
     if sellWindow <= 0: not eligible
     capacity(B) = max(0, floor( d(B,p) * sellWindow ) - onHand(B,p) - onOrder(B,p) )     // existing stock sells first (conservative)
     (optional) capacity(B) = min(capacity(B), maxStock(B) - onHand(B,p) when a max is set)
allocate surplus to destinations in order of highest capacity first (ties: lowest cost, shortest lead) until surplus is used or capacity is exhausted
residual = surplus - allocated  -> advice "markdown" (if residual > 0 and shelfLeft > m), "donate" (if close to expiry), "dispose" (expired), "none" (residual 0)
explanation lines list each number used (shelf life left, lead time, margin, window, demand, existing stock, capacity)

Required unit test (Example B): Warehouse A holds 500 milk packets, 6 days shelf life left, d(A) = 0. Warehouse B: d = 120/day, route lead 1 day, existing stock 100, margin m = 1 day. Then sellWindow = 6 − 1 − 1 = 4; capacity = 120 × 4 − 100 = 380; transfer = min(500, 380) = 380, residual = 120 stays at A. With m = 0 and B empty, capacity = 120 × 5 = 600, so all 500 move.

PART 4: SEED DATA (npm run seed, supports --if-empty)

Passwords for all accounts: Password123!.

Email	Role	Scope
admin@example.com	admin	all
manager@example.com	warehouse_manager	Warehouse A (North)
staff@example.com	staff	Warehouse A (North)
supplier@example.com	supplier	linked to Acme
supplier2@example.com	supplier	linked to Initech

Warehouses: WH-NORTH "Warehouse A" (Bengaluru, zones A with bins A1 to A3, B with bins B1, B2), WH-SOUTH "Warehouse B" (Chennai, zone A bins A1, A2), WH-EAST "Warehouse C" (Kolkata, zone A). Add lat/lng. Suppliers: Acme Components (promised 5 days), Globex Traders (promised 10 days, history of six deliveries 12, 14, 11, 15, 13, 12 days so the learned lead time is about 11.9 days and the score is low), Initech Supplies (promised 3 days). Products (at least): SKU-STL-001 Steel Bracket, SKU-CBL-002 USB-C Cable (Globex), SKU-BOX-003 Corrugated Box, SKU-BAT-004 Li-ion Battery Pack (two batches, near-term and later expiry, to show FEFO), SKU-THP-005 Thermal Paste (slow, erratic, expiring: class CZ and expiry risk), SKU-CMP-010 Critical Component X (primary Acme), SKU-ASM-030 Assembled Unit (depends on component X, quantityPer 1), SKU-MLK-020 Fresh Milk Packet (perishable, shelf life 6 days, minShelfLifeDays 1). Stock and policies for the demos:

Example A (recovery): Component X at Warehouse A: onHand 10, d = 30/day, minStock 100, its Acme PO delayed; at Warehouse B: onHand 435, d = 5/day, minStock 200. Route B→A: 1 day, Rs 2/unit. SupplierOffer Initech for Component X: capacity 100, MOQ 10, 3 days, Rs 62/unit. Mark Acme disrupted for 7 days in a scripted demo step (not in the base seed).
Example B (expiry): Fresh Milk at Warehouse A: batch with 500 packets expiring in 6 days, d(A) = 0; at Warehouse B: onHand 100 packets (a later batch), d(B) = 120/day (30 days of demand history); route A→B 1 day.
Rebalance demo: Steel Bracket surplus at North, shortage at South (as in the existing build).
Domino demo: CustomerOrders O1, O2 at Warehouse A and O3, O4 at Warehouse B for Assembled Unit with requiredBy between day 3 and day 10; ProductDependency Component X → Assembled Unit.
30 days of DemandHistory for the stocked products per warehouse; seed audit entries through recordAudit so the chain is valid.
A few open POs (one pending_approval, one approved, one partially_received) and a few alerts.

Provide npm run seed:scenarios which applies the scripted demo steps (disrupt Acme, run recovery analysis, run redistribution scan) and prints the expected results from the Example A and Example B tests.

PART 5: FRONTEND SPECIFICATION (React + TypeScript + Redux Toolkit)
5.1 Global behaviour
Routing: React Router with ProtectedRoute (redirects to /login when no token; shows /forbidden when the role is not allowed). Unknown paths show a NotFound page with a "Back to dashboard" button.
State: Redux Toolkit store with slices auth (token in localStorage, user, selected warehouse), realtime (socket status, last events, unread counts), notifications. Data fetching with RTK Query (or thunks) and cache invalidation on socket events.
Layout: left sidebar (brand, nav links filtered by role), top bar (warehouse selector for admin, notification bell with unread count and dropdown, user chip with role badge, live-connection dot green or grey, Logout button). Responsive: sidebar collapses to a hamburger menu on small screens.
Common components: DataTable (sortable columns, empty state, row actions), Pager, StatCard, Badge (tone by status), Modal, ConfirmDialog, Toast, FormField (label, hint, error), ExplainPanel (shows formulas with numbers), RebalanceList, QrScanner.
Every form: validates required fields and numbers before submit, disables the submit button while saving ("Saving..."), shows server errors in a red banner and success in a green banner, resets on success.
Every list: loading skeleton, empty-state message, error banner with Retry button.
Realtime: on stock:update refresh stock tables and dashboard KPIs; on alert:new show a toast and bump the bell; on po:*, transfer:update, recovery:update, redistribution:update refresh the relevant lists; on notification:new add to the dropdown.
Accessibility: labels on inputs, keyboard focus order, aria-live for toasts, sufficient contrast.
5.2 Navigation by role
Link	admin	manager	staff	supplier
Dashboard	yes	yes	yes	yes (own POs only)
Products	yes	yes	yes (read)	no
Warehouses	yes	yes	yes (read)	no
Stock	yes	yes	yes	no
Scan	yes	yes	yes	no
Suppliers	yes	yes	no	own record and offers
Purchase Orders	yes	yes	yes (receive)	own POs
Transfers	yes	yes	yes	no
Alerts	yes	yes	yes	no
Insights	yes	yes	no	no
Recovery	yes	yes	no	no
Redistribution	yes	yes	no	no
Simulator	yes	yes	no	no
Customer Orders	yes	yes	no	no
Cycle Counts	yes	yes	yes (create, submit)	no
Reports	yes	yes	no	scorecard only
Audit Log	yes	yes	no	no
Users	yes	no	no	no
Profile	yes	yes	yes	yes
5.3 Pages, with every control

Login (/login): fields Email, Password; Sign in button; link to Register; shows the seeded demo accounts in a hint box; error banner for invalid credentials. Register (/register): fields Name, Email, Password, Confirm password; Create account button; link to Login. Dashboard (/): KPI StatCards (Products, Warehouses, Suppliers, Open alerts, Pending POs, Low-stock lines, Total units, Stock value in rupees); warehouse filter; Recharts bar chart "Top products by stock value"; PO funnel chart; "Recent alerts" list with links; "Pending approvals" list (admin: POs, plans, transfers with Approve quick links); live update indicator. Supplier role sees only a PO list (own) with Confirm and Dispatch buttons. Products (/products): search box; table (SKU, Name, Category, Unit, Cost, Price, Supplier, Demand, Lead-time source, View QR, Edit); Add product button toggles a form (SKU, Name, Description, Category, Unit, Unit cost, Unit price, Primary supplier select, Avg daily demand, Demand std dev, Service-level z, Order cost, Holding cost, Lead-time override, Perishable checkbox, Shelf life days, Min shelf life days, Image upload); Save; QR modal with the QR image, SKU, Download PNG, Print label and Close; Edit reuses the form. Warehouses (/warehouses): table (Code, Name, City, Zones, Manager, Active); Add warehouse form (Code, Name, Address, City, Zones and bins editor with Add zone, Remove zone, Manager select); Edit and Activate/Deactivate; a Google Map panel showing all warehouses as markers (mock map fallback when no key) and, in the warehouse form, a Locate on map button that geocodes the address. Stock (/stock): warehouse and product filters; table of stock lines (Product, Warehouse, Bin, Batch, Expiry, Qty, Reorder point, expiry badge coloured by days left); tab buttons Receive, Dispatch, Transfer, Batches: Receive form (Product, Warehouse, Quantity, Bin, Batch no., Expiry date) with Receive stock; Dispatch form (Product, Warehouse, Quantity, optional Bin, optional Batch with the hint "leave blank for FEFO") with Dispatch stock, and after success a message listing the FEFO allocations; Transfer form (Product, From, To, Quantity, Batch, Notes, Mode radio Instant or Tracked) with Transfer stock (admin and manager only); Export CSV button. Scan (/scan): live camera view (html5-qrcode) with start/stop, camera-denied fallback text, manual SKU input with Resolve button; after resolve show the product card, stock per warehouse table, an action panel (Action select Dispatch (FEFO) or Receive, Warehouse, Quantity, Batch, Expiry for receive) with Dispatch or Receive button, and Should this be reordered? Why? button that opens the ExplainPanel for the selected warehouse. Suppliers (/suppliers): table (Name, Contact, Promised lead time, Learned lead time, Std dev, Samples, On-time, Late, Score, Status badge, Actions); Add supplier form (Name, Contact, Email, Phone, Address, Promised lead time); Edit; Declare disruption (modal: expected days, reason) and Clear disruption; Offers drawer per supplier with a table (Product, Capacity, MOQ, Lead time, Unit cost, Valid until) and Add offer, Edit, Delete; Run recovery shortcut when disrupted. Purchase Orders (/purchase-orders): status filter chips; table (PO no., Supplier, Warehouse, Status badge, Lines, Total, Auto badge, Source, Expected date, Actions); row actions Why? (opens the stored F1 explanation per line), Approve, Reject (asks for a reason) for admin on pending_approval; Confirm and Dispatch (supplier, with forms); Receive all and Receive... (modal with per-line quantity, batch, expiry; allows partial; Log discrepancy checkbox if less than ordered); Cancel; Pay (only when payments are enabled). Top buttons: New PO (form with supplier, warehouse, expected date, notes, line items with Add line, Remove line, Create PO), Auto-draft from reorder points with a warehouse select, which shows a result panel: drafted POs, "Avoided by transfer" list with an Execute transfer button per row, and "Skipped" list with reasons. Transfers (/transfers): status filters; table (Product, From, To, Qty, Mode, Status, Source, Dates, Actions); actions Approve, Reject (admin), Dispatch (source side), Receive (destination side), Cancel; status timeline in a detail drawer. Alerts (/alerts): type and warehouse filters, open/resolved toggle; list with severity badges; Resolve button; Run expiry sweep button; links to the related PO, plan or product. Insights (/insights): warehouse selector; table (Product, Class AX..CZ with tooltip policy hint, Annual value, Demand CV, On-hand, On-order, Reorder point, Safety stock, EOQ, Lead time with source badge, Days of cover, Status, Current z, Apply recommended z button, Why? expander showing the ExplainPanel); Rebalance before you buy panel listing suggestions with Execute transfer per row; Expiry waste risk table (Product, Warehouse, Batch, Days left, Units, Projected waste, Value at risk) with a Propose redistribution button per row. Recovery (/recovery): top form: Product select, Target warehouse select, Horizon days (defaults from the disrupted supplier), Required units (optional), Exclude supplier select, Analyze button; results: shortage summary card (on-hand, inbound, demand, minimum stock, required units) and up to 3 option cards (rank badge, label, steps with quantities, source, lead time, cost, covered units, shortage left, ETA, constraint checks with tick or cross, explanation lines) each with Propose this plan; below, a Plans table (Plan no., Product, Target, Status, Shortage left, Cost, Created by) with Open. Plan detail (/recovery/:id): header with status badge; selected option; steps table with live status of each transfer and PO; timeline; buttons Approve and Reject (admin, with reason), Cancel, and links to the created transfers and PO. Redistribution (/redistribution): Scan all batches button; candidates table (Product, Batch, Source, Qty, Days left, Projected waste, Analyze); analysis panel for a batch: shelf life left, own-sales estimate, surplus, margin input (Min shelf life days), destination table (Warehouse, Lead days, Demand/day, Existing stock, Selling window, Capacity, Recommended qty), residual units with advice, explanation lines, Propose plan button; Plans table with Open, Approve (admin), Reject, Cancel; plan detail shows linked tracked transfers and their status. Simulator (/simulator): scenario form (Name, Type select, Supplier or component select, Start day, Duration days, Horizon days, Backorders checkbox, Strategies checkboxes, Include sensitivity sweep checkbox), Run simulation button, Save scenario; results: dependency graph view (supplier → products → warehouse positions → orders, affected nodes highlighted, built with SVG or Recharts), KPI cards (shortage units, late orders, lost revenue, service level) for baseline, strategy comparison table with before and after deltas, a daily inventory chart per selected position (Recharts line chart with stock-out day marker), the affected orders table (Order, Customer, Due, Status, Days late, Unfilled), the sweep matrix (heat table), and Create recovery plan from this strategy button. A history list of past runs with Open. Customer Orders (/orders): table and New order form (Order no., Customer, Warehouse, Required by, Priority, Lines with Product and Quantity, Add line), Edit, Cancel; Product dependencies tab to add and remove component → finished links. Cycle Counts (/counts): list; New count (choose warehouse); count sheet with System qty and an editable Counted qty and Reason per line; Save, Submit, Reconcile (manager and admin) with a variance summary; variance rows highlighted. Reports (/reports): buttons Stock CSV, PO CSV, Supplier CSV, Expiry CSV, Stock PDF, PO PDF, Supplier scorecard PDF (supplier select). Audit Log (/audit): filters (Entity type, Action, Actor), paged table (Seq, Time, Actor, Action, Entity, Before/After expander, short hash), Previous and Next buttons, Verify integrity button showing a green banner ("Chain intact: N entries checked, head hash ...") or a red banner ("Broken at entry #N: reason"), Export CSV. Users (/users, admin): table (Name, Email, Role, Scope, Active, Last login, Actions); Add user form (Name, Email, Password, Role, Supplier or Warehouse select); Activate/Deactivate; Reset password; Change role. Profile (/profile): name, phone, notification preferences (In-app, Email, SMS checkboxes), Save, change-password form with Update password. Forbidden and NotFound pages, each with a button back to the dashboard.

5.4 Visual style

Clean professional look: maroon #8c1d2f primary buttons, navy #26365b sidebar, warm light background #f7f5f1, white cards with 1 px border and 10 px radius, status badges (green success, amber warning, red danger, blue info, grey default), class chips for ABC (A maroon, B navy, C grey). Sans-serif UI font. Tables are compact with sticky headers. No heavy animation.

PART 6: INFRASTRUCTURE AND DELIVERY
docker-compose.yml: services mongo (MongoDB 7 as a single-node replica set with a healthcheck and rs.initiate, so transactions work), backend (node:20, installs, seeds with --if-empty, runs dev), frontend (node:20, Vite with --host 0.0.0.0). docker compose up must give a working, seeded app at http://localhost:5173.
Dockerfiles for backend and frontend (multi-stage production builds).
GitHub Actions (ci.yml): on push and pull request: install, lint, type-check, run backend unit tests, run integration tests (mongodb-memory-server), build frontend, upload coverage.
Vercel: vercel.json with SPA rewrites; env VITE_API_URL, VITE_SOCKET_URL, VITE_GOOGLE_MAPS_KEY.
AWS: README section with exact steps for EC2 (Node LTS, PM2, Nginx reverse proxy with HTTPS via Let's Encrypt, security group rules), MongoDB Atlas connection string and IP allow-list, S3 bucket for documents (the storage adapter has an S3 driver and a Cloudinary driver), environment variables.
Postman: export a collection with every endpoint and example bodies; k6 script loadtest/api.js (50 to 200 virtual users on login, stock list, dispatch) with thresholds p95 < 500 ms and errors < 1% (targets, not claims).
README: overview, architecture diagram (text), quick start (Docker and manual), seeded accounts, demo walkthrough, API summary, algorithm formulas, known limits, implemented-versus-needs-credentials table.
PART 7: TEST PLAN (Jest + Supertest)

Unit (no database):

Reorder: safety stock with and without lead-time variance; ROP; EOQ edge cases (D = 0, H ≤ 0 throws); order quantity as a multiple of EOQ; position-based trigger; lead-time precedence; supplier statistics (nominal, blended, std, shrinkage); applyLeadTimeSample.
FEFO ordering and shortage error; expiry-waste projection; planRebalance (the 61-unit example, no donors, multiple needy).
ABC-XYZ thresholds, z recommendations, days of cover.
Hash chain: valid chain; edited entry detected with reason; deleted entry (sequence gap); reordered entries; genesis handling.
Demand estimation fallback.
Recovery engine Example A (exact numbers in 3.7), plus: no shortage returns needed:false; infeasible lead time excluded; MOQ respected; donor never goes below minimum.
Redistribution engine Example B (exact numbers in 3.9), plus: window ≤ 0 not eligible; own-sales offset; multiple destinations; residual advice.
Simulation engine: conservation of stock (never negative), delayed receipts shift to window end, baseline vs strategy ordering, orders late/at-risk classification, sweep matrix shape.
JWT sign/verify/expiry; RBAC guard allows and denies correctly.

Integration (Supertest with an in-memory replica set):

Auth (register, login, me, bad credentials, inactive user); RBAC on every protected route (one allowed role and one denied role each).
Stock: receive, dispatch with FEFO allocations, insufficient stock 400, instant transfer carries batch and expiry, tracked transfer full lifecycle, transactions roll back on failure, DemandHistory incremented.
PO: manual create, auto-draft (second run creates nothing; transfer avoided case; disrupted supplier skipped), approve (admin only), supplier confirm and dispatch (own POs only), partial then full receive, lead-time sample recorded and score updated, explanation stored on lines.
Alerts: created once, auto-resolved, expiry sweep.
Audit: entries written for mutations; /audit/verify valid; after tampering a document directly in the database /audit/verify returns the first broken sequence.
Recovery: analyze, propose, approve creates transfers and PO, progress to completed, reject path, failed when a step is cancelled.
Redistribution: scan, propose, approve, transfers complete and batch expiry carried to the destination.
Simulation: run returns baseline and strategies; saved and retrievable.
Cycle count: submit and reconcile creates adjustments and audit entries.
Notifications: in-app created; email and SMS mock drivers called per preferences.
Target: at least 80% coverage on engines, services and controllers.

Frontend: component tests (React Testing Library) for login, protected routing, ExplainPanel, DataTable empty state, one form validation; optional Playwright smoke test of login → receive stock → dispatch → verify audit.

PART 8: ACCEPTANCE CHECKLIST (the build is done when all are true)
docker compose up starts MongoDB, API and frontend; the database is seeded; login works for all five accounts.
Every page in 5.3 exists with every listed button wired to a real endpoint, with loading, empty and error states.
Role restrictions in 2.2 hold on the API (tests) and in the UI (hidden or disabled controls and /forbidden).
Receive, dispatch (FEFO), transfer (instant and tracked), cycle count and reconciliation all update stock correctly, live, in transactions.
Auto-draft creates glass-box POs, never double-orders, and prefers transfers over purchases when surplus exists.
Receiving a PO updates the learned lead time and the Globex products show a longer lead time and higher reorder point than their promise implies.
Audit log verifies as intact; editing a record directly in MongoDB makes Verify integrity report the first broken entry.
Recovery Example A returns the 200 + 100 plan with 0 shortage; approving it creates transfers and a PO that can be dispatched, received and completed.
Expiry Example B returns a transfer of 380 packets and a residual of 120; approving it moves the batch with its expiry date intact.
The simulator shows a graph, baseline versus strategy comparison, daily chart, late orders and the sensitivity matrix, and can create a recovery plan.
Email, SMS, Cloudinary and Maps run with mock drivers and switch to real drivers when keys are provided.
npm test passes in backend and frontend; CI workflow is green; coverage is at least 80% on core modules.
README is accurate and states what is verified and what needs credentials or deployment.
PART 9: PHASE PROMPTS (paste one at a time)

Before each phase, add this line: "Follow PART 0 and the referenced sections of this specification. Write complete code and tests. Stop when the 'Done when' condition is true and summarise what you built and any assumptions."

Phase 1: Project scaffold and database

Create the repository layout (0.4), backend and frontend TypeScript projects, ESLint and Prettier, docker-compose.yml with the MongoDB replica set, .env.example files, the config and DB connection, error handler and API error utilities, and all Mongoose models in PART 1 with indexes and validation, including the Counter helper. Done when: docker compose up mongo works, the backend starts, GET /api/health responds, and a model smoke test creates and reads one document per collection.

Phase 2: Authentication, RBAC, audit chain, notifications core

Implement 2.1, 2.2 (auth routes, requireAuth, requireRole, warehouse scoping), the hash-chained audit service (3.4) with recordAudit using the Counter, GET /audit, /audit/verify, /audit/export.csv, users admin endpoints, and the notification service with the email and SMS adapters (real and mock drivers). Done when: unit tests for JWT, RBAC and the hash chain pass; integration tests prove login, role denial and tamper detection.

Phase 3: Core inventory

Implement warehouses, suppliers, products (QR, image upload through the storage adapter), stock levels, receive, dispatch with FEFO (3.2), instant and tracked transfers with approval, in-transit and receive steps, DemandHistory updates on dispatch, stock policies, transfer routes (with the Maps adapter), cycle counts and reconciliation, discrepancies, Socket.io events (2.4). Done when: the stock, transfer and cycle-count integration tests pass, including transaction rollback and batch/expiry carried across a transfer.

Phase 4: Reorder engine, procurement and alerts

Implement the reorder engine (3.1), planning service, auto-draft (3.3), PO lifecycle with supplier confirm and dispatch, receive with lead-time learning and supplier scoring, optional payments adapter, alert service and rules (2.5), expiry sweep, notifications for PO events. Done when: unit tests for 3.1 and integration tests for auto-draft (no double ordering, transfer avoided, disrupted supplier skipped), receive, lead-time learning and alerts pass.

Phase 5: Analytics, dashboard, reports

Implement ABC-XYZ and days of cover (3.2), /analytics/insights and rebalance endpoints, dashboard endpoints, CSV and PDF reports. Done when: the Insights payload matches 2.3 and the tests for classification, expiry waste and rebalance (including the 61-unit example) pass.

Phase 6: Recovery engine (M5)

Implement supplier disruption endpoints, supplier offers, minimum-stock and transferable-stock logic (3.6), the recovery engine (3.7), recovery plan endpoints, the approval execution that creates tracked transfers and a PO in a transaction, progress tracking and timeline. Done when: the Example A unit test returns the 200 + 100 plan, and the integration test runs propose → approve → dispatch → receive → completed.

Phase 7: Expiry-aware redistribution (M7)

Implement demand estimation (3.5), the redistribution engine (3.9), scan, analyze, plan endpoints and approval execution through tracked transfers. Done when: the Example B unit test returns 380 and a residual of 120, and the integration test moves a batch with its expiry date intact.

Phase 8: Domino Effect Predictor (M6)

Implement customer orders, product dependencies, graph building, the inventory-flow simulation, strategy comparison, sensitivity sweep, saved scenarios and runs, and "create recovery plan from run". Done when: simulation unit tests pass (no negative stock, delayed receipts, ordering of strategies) and an integration test runs a scenario end to end.

Phase 9: Seed data and scenario scripts

Implement seed.ts and seed:scenarios exactly as PART 4, with a valid audit chain. Done when: after npm run seed, all five logins work and the scripted scenarios print the Example A and Example B results.

Phase 10: Frontend foundation

Implement the Vite + TypeScript app, store, API client, auth flow, socket provider, layout with role-based navigation, notification bell, common components (5.1), Login, Register, Dashboard, Profile, Forbidden, NotFound. Done when: you can sign in as each role, see the correct navigation, receive live toasts, and log out.

Phase 11: Frontend modules

Implement every remaining page and control in 5.3: Products, Warehouses (with map), Stock, Scan, Suppliers (offers, disruption), Purchase Orders, Transfers, Alerts, Insights, Recovery (and plan detail), Redistribution, Simulator (graph, comparison, daily chart, sweep), Customer Orders, Cycle Counts, Reports, Audit Log, Users. Done when: every button listed in 5.3 works against the API, with loading, empty and error states, and the component tests pass.

Phase 12: Hardening, documentation and delivery

Complete the test plan (PART 7) and reach the coverage target, write the Postman collection and k6 script, GitHub Actions workflow, Vercel and AWS deployment notes, and the README (including the implemented-versus-needs-credentials table). Walk through the acceptance checklist (PART 8) and report each item as passed or not, with evidence. Done when: every item in PART 8 is reported with evidence.

PART 10: IF THE TOOL STALLS OR DRIFTS (reusable prompts)
"Re-read PART 0.3 (hard rules) and PART <n> of the specification, list which requirements are still missing from the code, and implement them."
"Run the full test suite, fix every failure at the root cause (do not weaken tests), and show the passing output."
"Audit the frontend: list every button in PART 5.3 and show, for each, the component, handler and API call. Implement any that are missing."
"Search the repository for TODO, FIXME, placeholder text, hard-coded demo data in non-seed code, and stubs; replace them with real implementations."
"Verify RBAC: for every route in PART 2.3 show the guard and add a test for one allowed and one denied role."
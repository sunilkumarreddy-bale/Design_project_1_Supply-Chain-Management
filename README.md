# Smart Inventory and Supply Chain Management System

A multi-warehouse inventory and procurement platform for retailers, warehouses and distribution centres.
Every stock movement is recorded once, audited in a tamper-evident hash chain and pushed live to every
signed-in user. Replenishment uses a deterministic, explainable reorder engine (reorder point, safety
stock, EOQ). Staff scan QR codes with any browser camera. The system **proposes**; an authorised person
**approves**.

| ID | Feature | Where |
|----|---------|-------|
| F1 | Glass-box reorder: every drafted PO line stores inputs, formulas with real numbers and the quantity | `engines/reorder.ts` `explainReorder`, PO page "Why?" |
| F2 | Inventory-position reordering (on-hand + on-order), whole multiples of EOQ, no double ordering | `services/purchaseOrders.ts` `autoDraft` |
| F3 | Supplier lead-time learning with shrinkage toward the promise; late suppliers raise safety stock | `engines/reorder.ts` `supplierLeadTimeStats`, PO receive |
| F4 | Rebalance before you buy: move surplus from another warehouse before raising a PO | `engines/inventoryLogic.ts` `planRebalance` |
| F5 | FEFO picking and expiry-waste projection | `allocateFEFO`, `projectExpiryWaste` |
| F6 | Tamper-evident audit log: SHA-256 chain, verification finds the first broken entry | `engines/hashChain.ts`, `middleware/audit.ts` |
| M5 | Self-Healing Recovery Engine: compare transfers and alternative suppliers, rank feasible plans | `engines/recoveryEngine.ts`, `/recovery` |
| M6 | Domino Effect Predictor: dependency graph, day-by-day flow, strategy comparison, sensitivity sweep | `engines/simulationEngine.ts`, `/simulator` |
| M7 | Expiry-aware redistribution: move only what a destination can sell before expiry | `engines/redistributionEngine.ts`, `/redistribution` |
| DNA | **Stock DNA**: a tamper-evident life record per lot, from birth at receipt to death by sale, expiry, damage, recall or return | `engines/dnaEngine.ts`, `services/stockService.ts`, `/dna` |

Also: ABC-XYZ classification with service-level recommendation, days of cover, scan-to-act, cycle counts and
reconciliation, discrepancies with evidence upload, supplier portal (confirm and dispatch), in-app / email /
SMS notifications, CSV and PDF reports, warehouse map.

## Architecture

```
 Browser (React 18 + TS, Vite, Redux Toolkit / RTK Query, Recharts, html5-qrcode)
   │  REST /api (Axios, JWT bearer)          │  Socket.io (JWT in handshake)
   ▼                                         ▼
 Express API (TypeScript) ── helmet, cors, rate limit, morgan, zod validation, RBAC + warehouse scope
   │ controllers ─► services (planning, alerts, inventory, transfers, purchaseOrders, recovery,
   │                redistribution, simulation, notifications, reports, routes, planProgress)
   │                    │                                  │
   │                    ▼                                  ▼
   │              engines/ (pure, no DB, 100% deterministic) integrations/ adapters (real + mock driver)
   │              reorder · inventoryLogic · analytics ·     email (SendGrid/SMTP/console) · sms (Twilio/gateway/console)
   │              hashChain · recoveryEngine ·               storage (Cloudinary/S3/local) · maps (Google/mock)
   │              redistributionEngine · simulationEngine    payments (Razorpay/Stripe/mock, feature flag)
   ▼
 MongoDB 7 replica set (Mongoose; multi-document stock changes in transactions; Counter for PO/audit sequences)
```

Repository layout follows the specification (section 0.4): `backend/` (API, engines, tests), `frontend/`
(SPA), `docker-compose.yml`, `.github/workflows/ci.yml`, `postman/`, `loadtest/`.

## Quick start

### Docker (recommended)

```bash
docker compose up
```

* MongoDB 7 starts as a single-node replica set (the healthcheck runs `rs.initiate`), so transactions work.
* The API installs dependencies, seeds the database **only if it is empty** (`npm run seed -- --if-empty`)
  and starts on http://localhost:4000.
* Vite serves the app on **http://localhost:5173** and proxies `/api`, `/uploads` and `/socket.io` to the API.

No API keys are needed; every external service falls back to its mock driver.

### Manual (Node 20+, MongoDB replica set)

```bash
# MongoDB: any replica set works, e.g. a single local node
mongod --replSet rs0 --dbpath ./data --port 27017 &
mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"

cd backend && cp .env.example .env && npm ci
npm run seed            # wipes and seeds the demo data
npm run dev             # http://localhost:4000

cd ../frontend && cp .env.example .env && npm ci
npm run dev             # http://localhost:5173
```

### Seeded accounts (password `Password123!`)

| Email | Role | Scope |
|-------|------|-------|
| admin@example.com | admin | all warehouses |
| manager@example.com | warehouse_manager | WH-NORTH (Warehouse A) |
| staff@example.com | staff | WH-NORTH (Warehouse A) |
| supplier@example.com | supplier | Acme Components |
| supplier2@example.com | supplier | Initech Supplies |

The seed creates three warehouses (Bengaluru, Chennai, Kolkata), three suppliers (Globex with six real late
deliveries: 12, 14, 11, 15, 13, 12 days against a 10-day promise), eight products, 30 days of demand history,
stock and policies for the worked examples, transfer routes, alternative supplier offers, four customer orders
for the Domino demo, open POs (pending approval, approved, partially received), derived alerts and a valid audit
chain.

### Scripted demo scenarios

```bash
cd backend && npm run seed:scenarios          # re-seeds, then runs the scripted steps
npm run seed:scenarios -- --keep-data         # run against the current database instead
```

It declares Acme disrupted for 7 days, runs the recovery analysis for Component X at Warehouse A, scans
batches for redistribution and runs the Domino simulation, then prints a PASS/FAIL line per expected number.
(It re-seeds by default because the examples depend on "today": demand windows and shelf life move daily.)
Output from this environment:

```
required = ceil(30 x 7) + 100 - (10 + 0) = 300
#1 Transfers first, then cheapest supplier(s): shortage left 0, cost Rs 6,600, ETA 3 day(s)
    Transfer 200 units from Warehouse B (stock 435 - minimum 200 - 5/day x 7 days = 200 available, 1 day, Rs 2/unit)
    Buy 100 units from Initech Supplies (capacity 100, MOQ 10, 3 days, Rs 62/unit)
#2 Transfers only: shortage left 100, cost Rs 400, ETA 1 day(s)
#3 Supplier only: Initech Supplies: shortage left 200, cost Rs 6,200, ETA 3 day(s)
Warehouse B: selling window = 6 - 1 (transfer) - 1 (margin) = 4 days; capacity = 120/day x 4 - 100 existing = 380; move 380 units
Allocated 380 of 500 surplus units; residual 120 stays at Warehouse A: mark down the price to sell it before expiry
[PASS] x 12 ... All checks passed
```

## Demo walkthrough

1. **Staff** (staff@example.com): *Stock → Receive* a batch; *Dispatch* 35 Li-ion packs without a batch and see the
   FEFO allocations (earliest expiry leaves first). *Scan*: type `SKU-BAT-004` (or scan the QR from *Products →
   View QR*), press **Should this be reordered? Why?**. *Cycle Counts → New count*, enter counts, **Submit**.
2. **Manager** (manager@example.com): reconcile the count (variances over 5% raise an alert). *Purchase Orders →
   Auto-draft from reorder points*: drafted POs, "avoided by transfer" suggestions with **Execute transfer**,
   skipped products. Run it again: nothing is double-ordered. *Insights*: ABC-XYZ, learned lead time for Globex
   (11.9 d vs 10 d promised), **Apply recommended z**, rebalance and expiry-risk panels.
3. *Suppliers → Acme → Declare disruption* (7 days) → **Run recovery** → choose Component X → **Analyze** →
   the 200 + 100 plan ranks first → **Propose this plan**.
4. *Redistribution → Scan all batches → Analyze* the milk batch MLK-A-001 → 380 to Warehouse B, 120 residual →
   **Propose plan**.
5. **Admin** (admin@example.com): approve both plans (*Dashboard → Pending approvals* or the plan pages). Tracked
   transfers and the Initech PO are created. *Transfers*: **Dispatch**, then **Receive**; receive the PO; the recovery
   plan moves to *completed*, the milk arrives at Warehouse B with its original expiry date.
6. *Simulator*: Acme stops 5 days with the sweep on → dependency graph, baseline vs strategies, daily chart with
   stock-out marker, affected orders, sensitivity heat table, **Create recovery plan from this strategy**.
7. *Audit Log → Verify integrity* → "Chain intact". Edit any document in `auditlogs` with Compass/mongosh and verify
   again → "Broken at entry #N: Entry contents do not match its stored hash".
8. **Supplier** (supplier@example.com): dashboard lists Acme's open POs with **Confirm** and **Dispatch**; *Reports →
   Supplier scorecard PDF* (own scorecard only).

## Algorithms (all in `backend/src/engines`, pure and unit-tested)

**Reorder (F1/F2/F3)**

```
safetyStock  = z * sqrt(L * σd² + d² * σL²)          (= z σd √L when σL = 0)
reorderPoint = ceil(d * L + safetyStock)
EOQ          = ceil(sqrt(2 D S / H)),  D = annualDemandOverride ?? 365 d;  0 when D = 0;  H must be > 0
position     = onHand + onOrder;   reorder when d > 0 and position <= ROP
orderQty     = smallest k * EOQ (k >= 1) with position + k * EOQ > ROP
lead time    = product override > supplier statistics > 7-day default
supplier     : n = 0 → mean = promise, σ = 0 ("nominal");
               else mean = (3 * promise + Σdays) / (3 + n), σ = sample std of observed days ("blended")
```

Per-warehouse demand d, σd = mean and sample standard deviation over the **30 full days before today** (missing
days count as 0); fewer than 7 days with rows → product defaults.

**FEFO / waste / rebalance (F4/F5)**: earliest expiry first, undated last, ties by oldest; waste = units not sold
before expiry at d per day in FEFO order; rebalance keeps `ceil(1.5 × ROP)` at donors and fills the neediest
warehouse (deficit = ROP + 1 − position) from the largest surplus.

**ABC-XYZ**: A while the item *starts* before 80% of cumulative annual value, B before 95%, else C;
X CV ≤ 0.25, Y ≤ 0.5, else Z (zero demand = Z); recommended z: A 2.05, B 1.65, C 1.28.

**Hash chain (F6)**: `hash = sha256(prevHash + "|" + canonical JSON of {seq, action, entityType, entityId, actor,
warehouse, before, after, metadata, createdAt})`, genesis prevHash = 64 zeros. Verification reports sequence gaps,
broken links and modified records. *Deleting the newest entries cannot be detected from the chain alone: keep the
head hash shown by Verify integrity and compare it later.*

**Recovery (M5)**: `required = max(0, ceil(d H) + minStock − (onHand + inbound within H))`;
`transferable = max(0, onHand − minStock − ceil(d H))`; candidates: transfers only, each supplier alone,
transfers then cheapest suppliers, cheapest overall, fastest; de-duplicated; ranked by shortage left, cost, ETA;
top three returned with constraint checks and explanation lines.

**Redistribution (M7)**: `shelfLeft = floor(days to expiry)`, `ownSales = floor(dA × max(0, shelfLeft − m))`,
`window = shelfLeft − lead − m`, `capacity = floor(dB × window) − onHand(B) − onOrder(B)` (capped by max stock),
allocate highest capacity first; residual advice markdown / donate / dispose / none.

**Domino (M6)**: BFS from the disrupted supplier or component over supplies → component_of → stocked_at →
ordered_by edges (alternative offers are drawn but not followed). Day-by-day flow per position; receipts from a
stopped supplier inside the window move to the day after it; unserved finished-product demand is assembled from
components at the same warehouse (`componentDemand = finishedDemand × quantityPer`). Orders are filled by due date
and priority and classed on time / at risk (cover after the order < 1 day) / late. Strategies re-run the flow with
recovery-engine actions; the sweep covers disruption length {3, 5, 7, 10} × safety-stock multiplier {0.5, 1, 1.5}.

## Stock DNA

The audit log records what users did. Stock DNA records what happened to the goods. Specification:
[docs/Stock_DNA_Spec.md](docs/Stock_DNA_Spec.md). Behaviour changes: [docs/CHANGELOG_100.md](docs/CHANGELOG_100.md).

* **Lot** (`stocklots`): one received batch of one product.
  * It gets a code `DNA-<SKU>-<YYMMDD>-<n>` and a birth record: purchase receipt, opening balance or customer return.
  * Its counters always satisfy `born + added = on hand + in transit + sold + consumed + expired + damaged + shrinkage + recalled + returned + written off`.
  * Its stock slices are the `StockLevel` rows that carry its id.
* **Genes** (`dnaevents`): about 20 event types (born, put away, QC hold/release/reject, transfer out/in, reserve,
  FEFO pick, sale, consume, count adjust, damage, expiry warning, expire, recall flag/clear, return to supplier,
  write-off, decision note, death).
  * Each gene is SHA-256 chained per lot. The scope "dna" is hashed in, so a gene can never pass as an audit entry.
  * Each gene is anchored in the global audit chain inside the same transaction.
  * `POST /api/dna/lots/:id/verify` checks both and names the first broken event.
* **One choke point**: only `services/stockService.ts` writes stock quantities; a static test enforces it. Every
  change validates the life-state transition, then updates slices, header, gene and audit anchor atomically.
  When the last unit leaves, the lot is sealed with a death gene: cause, lifespan, shelf life used and value lost.
  Dead lots accept no more genes; a customer return becomes a child lot linked in `dnalinks`.
* **Blocking**: FEFO, transfers and redistribution skip lots that are expired, quarantined or recalled. A recall
  blocks dispatch at once.
* **Screens**:
  * *Stock DNA* list (filters, CSV, scan label);
  * lot page (header with QR, life bars, counters, lifeline, journey, slices, genealogy, integrity badge,
    requests);
  * recall trace;
  * printable label.
  DNA buttons also appear on Stock, Scan, PO receive, Dashboard, Insights, Redistribution, Recovery and
  Customer Orders (Reserve / Ship).
* **Jobs and commands**:
  * daily expiry job (also `POST /api/dna/jobs/expiry`);
  * `npm run dna:backfill`: gives existing stock a backfilled lot, born from the PO when the batch is a received
    PO; idempotent;
  * `npm run seed:dna`: adds the six illustrative scenarios to an existing database;
  * `POST /api/dna/reconcile`: genes vs header vs slices.

## API summary

All routes are under `/api`, return JSON, validate bodies with zod and answer errors as
`{ "error": { "message", "code", "details?" } }`. Every mutating route writes a hash-chained audit entry.
The full list with example bodies is in `postman/smart-inventory-scm.postman_collection.json` (157 requests;
regenerate with `node postman/generate.mjs`, which also writes the Stock DNA collection `docs/postman/stock-dna.json`). Main groups: `auth`, `users`, `warehouses`, `suppliers`,
`supplier-offers`, `products`, `stock`, `transfers`, `stock-counts`, `discrepancies`, `stock-policies`,
`transfer-routes`, `purchase-orders`, `alerts`, `dashboard`, `analytics`, `audit`, `recovery`, `redistribution`,
`customer-orders`, `product-dependencies`, `simulation`, `reports`, `notifications`, `maps`, `dna`, `config`, `health`.

Socket.io events: `stock:update`, `alert:new|update|resolved`, `po:created|approved|rejected|confirmed|dispatched|received|cancelled|paid`,
`transfer:update`, `recovery:update`, `redistribution:update`, `simulation:done`, `supplier:update`,
`count:update`, `dna:event` (to `all` and `wh:<id>`), `dna:death`, `dna:recall`, and `notification:new` to the user's own room.

## Testing

| Suite | Command | Result in this environment |
|-------|---------|----------------------------|
| Backend unit (engines, JWT, RBAC, error handler, adapters, validation) | `cd backend && npm run test:unit` | passing |
| Backend integration (Supertest + in-memory replica set) | `npm run test:integration` | passing |
| Backend total | `npm test` | **26 suites, 357 tests passing** (including Stock DNA unit, static and integration tests) |
| Frontend (Vitest + Testing Library: login, protected routing, ExplainPanel, DataTable, form validation, Stock DNA lifeline and bars) | `cd frontend && npm test` | **23 tests passing** |
| Browser workflow (Playwright, 21 steps across staff, manager, admin, including the DNA milk story and recall trace) | `cd frontend && npm run e2e` (stack running, freshly seeded) | passing, 0 console errors, 0 failed API calls |
| Lint / types | `npm run lint && npm run typecheck` (both apps) | clean |

Backend coverage (Jest, `npm run test:coverage`), statements / branches / functions / lines:

| Area | Stmts | Branch | Funcs | Lines |
|------|-------|--------|-------|-------|
| engines | 97.2% | 84.6% | 99.6% | 98.5% |
| services | 90.8% | 69.1% | 91.8% | 94.0% |
| controllers | 87.8% | 58.9% | 90.4% | 93.6% |
| middleware | 96.4% | 91.1% | 100% | 98.2% |

Statement and line coverage are above 80% on engines, services and controllers; **branch coverage on services and
controllers is below 80%** (mostly error paths and optional filters).

Integration tests use `mongodb-memory-server` replica sets. In CI the binary is downloaded (MongoDB 7.0.14); in
an offline environment set `MONGOMS_SYSTEM_BINARY` to a local `mongod`.

**Load tests** (k6, `loadtest/api.js` and `loadtest/dna.js`). Measured on a 4-vCPU sandbox against the compiled API;
full details are in [docs/LOAD_RESULTS.md](docs/LOAD_RESULTS.md).
* Main and Stock DNA reads at 50 VUs: p95 193 ms, 0% errors, 212 req/s.
* Mixed reads and stock writes at 30 VUs: p95 828 ms, 0% errors. This **misses** the 500 ms target; the tail comes
  from bcrypt logins at start-up and from the per-process write queue.
* The full 50 → 200 VU profile has not been run.

## Status: implemented and tested vs needs credentials or deployment

| Item | Status |
|------|--------|
| All API endpoints in section 2.3, RBAC + warehouse scoping, transactions, audit chain, alerts, notifications (in-app) | Implemented and tested (unit + integration) |
| Engines F1–F6, M5, M6, M7 including spec Examples A and B | Implemented and tested |
| Every page and control in section 5.3, live Socket.io updates, role navigation, /forbidden, 404 | Implemented; component tests + Playwright workflow + page smoke across 4 roles |
| Seed and scripted scenarios | Implemented and tested (integration test + run against a real replica set) |
| Stock DNA (data layer, API, screens, six seeded scenarios, backfill, expiry job, recall trace, certificate) | Implemented and tested (unit, static, integration, component, browser) |
| `docker compose up` (replica set init, seed if empty, API, Vite) | Verified in this sandbox with images from a registry mirror; dependency install inside containers was replaced by host `node_modules` because the sandbox blocks registry access from containers |
| Production Dockerfiles (`backend/Dockerfile`, `frontend/Dockerfile`) | Written; **not built here** (needs registry access during `npm ci`) |
| GitHub Actions CI | Runs on GitHub; green on `main` |
| Email via SendGrid / SMTP, SMS via Twilio / HTTP gateway | Real drivers implemented and unit-tested with mocked HTTP; **need credentials** (`SENDGRID_API_KEY` or `SMTP_*`, `TWILIO_*` or `SMS_GATEWAY_*`). Console drivers are used without keys |
| Cloudinary (images, attachments), S3 (documents) | Real drivers implemented, selection tested; **need `CLOUDINARY_URL` / `AWS_S3_BUCKET`**; without them files go to `backend/uploads` and are served at `/uploads` |
| Google Maps (geocoding, distance, web map) | Real driver implemented and tested with mocked HTTP; **needs `GOOGLE_MAPS_API_KEY` / `VITE_GOOGLE_MAPS_KEY`**; deterministic mock geocoder and a schematic map otherwise |
| Razorpay / Stripe payments | Behind `ENABLE_PAYMENTS=true`; mock driver tested end to end; real drivers **need keys** |
| AWS EC2, MongoDB Atlas, Vercel | Steps below; **not deployed** |
| Real camera scanning | Implemented with html5-qrcode; needs HTTPS (or localhost) and a camera, **not exercised in headless tests** (manual SKU entry is tested) |

## Deployment

**Azure**: Bicep template + one-click GitHub Actions workflow (App Service for the API, Static Web Apps for the
SPA, MongoDB Atlas on Azure). See [docs/DEPLOY_AZURE.md](docs/DEPLOY_AZURE.md). The template compiles and lints with
Bicep 0.30; the workflow has not been run against a subscription yet.


### API on AWS EC2 (Ubuntu 22.04/24.04)

1. **Security group**: allow 22 from your IP, 80 and 443 from anywhere; do not open 4000.
2. Install Node LTS, PM2, Nginx, Certbot:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs nginx
   sudo npm i -g pm2 && sudo snap install --classic certbot
   ```
3. Build and configure:
   ```bash
   git clone <repo> && cd <repo>/backend && npm ci && npm run build && npm prune --omit=dev
   cp .env.example .env   # set the variables below
   pm2 start dist/server.js --name scm-api && pm2 save && pm2 startup
   ```
4. **MongoDB Atlas**: create an M10+ (or M0 for trials) cluster, a database user, and add the EC2 public IP (or
   VPC peering) to the IP access list. Use the SRV string:
   `MONGODB_URI=mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/smart_inventory?retryWrites=true&w=majority`
   (Atlas clusters are replica sets, so transactions work).
5. **Nginx** reverse proxy with WebSocket upgrade, then `sudo certbot --nginx -d api.example.com`:
   ```nginx
   server {
     server_name api.example.com;
     client_max_body_size 6m;
     location / {
       proxy_pass http://127.0.0.1:4000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
6. **S3** for documents: create a private bucket in the same region, attach an instance role with
   `s3:PutObject` on `arn:aws:s3:::BUCKET/*`, set `AWS_S3_BUCKET` and `AWS_REGION` (the SDK uses the instance role;
   no keys in `.env`). Serve objects through signed URLs or CloudFront if they must be readable by browsers.
7. Required production variables: `NODE_ENV=production`, `PORT=4000`, `MONGODB_URI`, `JWT_SECRET` (long random),
   `JWT_EXPIRES_IN=8h`, `CLIENT_ORIGIN=https://app.example.com`, `PUBLIC_BASE_URL=https://api.example.com`,
   `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, plus any integration keys from `backend/.env.example`.
   Seed once if wanted: `node dist/seed/seed.js --if-empty`.

### Frontend on Vercel

Import the repository, set **Root Directory** = `frontend` (framework Vite; `vercel.json` adds the SPA rewrite and
asset caching) and set environment variables `VITE_API_URL=https://api.example.com/api`,
`VITE_SOCKET_URL=https://api.example.com`, optionally `VITE_GOOGLE_MAPS_KEY`. Add the Vercel domain to
`CLIENT_ORIGIN` on the API (comma-separated for several origins).

## Design notes, assumptions and known limits

* **Spec example text**: section 3.1 shows `Safety stock = 1.65 x sqrt(11.9 x 6^2 + 40^2 x 2.1^2) = 138.4`; the formula
  with those inputs evaluates to 142.7. The engine follows the formula; the unit test documents this.
* **Tracked products**: auto-draft and per-warehouse insights consider only products tracked at the warehouse (a
  stock line, a stock policy or demand history). Without this, the product-level fallback demand would make every
  warehouse reorder every product.
* **Rebalance** uses each warehouse's own reorder point (the engine still accepts a single shared ROP, as in the
  61-unit example).
* **Audit writes** run inside a transaction that increments the single `Counter("audit")` document. Stock changes
  write their Stock DNA anchors inside the stock transaction itself. MongoDB therefore serialises writers, even
  across several API instances, so `prevHash` links stay correct.
  * Within one process, these writes are also queued (`serialWrite`) to avoid write-conflict retry storms.
  * The cost is that stock writes run one at a time per process (see docs/LOAD_RESULTS.md).
  * Other entries (for example `po.create`) are still written right after their own transaction commits, so a
    crash between the two can lose that entry.
* **Auto-draft** is not locked across concurrent requests; two simultaneous runs for the same warehouse could both
  draft. A second run after the first completes is a no-op (tested).
* **Simulation** treats assembly as instantaneous at the warehouse that holds the components; orders are evaluated
  after the daily flow (a post-pass), so large orders do not reduce the daily stock line shown in the chart.
* `supplier_delay` scenarios shift every later receipt by the duration; `supplier_stop` and `component_stop` move
  receipts inside the window to the day after it.
* Estimated transfer routes (no stored route) cost Rs 1 per unit per 100 km, minimum Rs 1, and take
  `ceil(km / 400)` days (minimum 1).
* Supplier performance score = share of deliveries received by the expected date (or within the promised lead time
  when no date was set), 0–100.
* Frontend tests use **Vitest** (Vite's native runner) with React Testing Library; backend tests use Jest, Supertest
  and mongodb-memory-server as specified. Additional libraries: `multer` (uploads), `qrcode` (QR PNGs),
  `@aws-sdk/client-s3` (S3 driver), `playwright` (dev-only e2e script).
* PDFs use the built-in Helvetica font, which has no ₹ glyph, so PDF amounts are written as "Rs"; the UI uses ₹.

## Acceptance checklist (PART 8)

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | `docker compose up` starts MongoDB, API, frontend; seeded; five logins work | Passed (with the sandbox caveat above) | Compose stack healthy, seed log, login via the Vite proxy; `seed.test.ts` logs in all five accounts |
| 2 | Every page in 5.3 with its controls wired, loading / empty / error states | Passed | Page smoke across admin/manager/staff/supplier (0 console errors, 0 failed calls); `npm run e2e` 14-step workflow; DataTable/QueryState states in component tests |
| 3 | Role restrictions on API and UI | Passed | `rbac.test.ts` (one allowed + one denied role for 100 routes, 401 without token); `ProtectedRoute.test.tsx`; smoke shows /forbidden redirects |
| 4 | Receive, FEFO dispatch, instant and tracked transfer, cycle count, reconciliation in transactions, live | Passed | `stock.test.ts` (incl. rollback), `counts.test.ts`, e2e FEFO allocations, socket "Live" indicator |
| 5 | Glass-box auto-draft, no double ordering, transfers preferred | Passed | `purchaseOrders.test.ts` auto-draft suite; e2e "Why?" modal |
| 6 | Receiving updates learned lead time; Globex shows longer lead time and higher ROP | Passed | `purchaseOrders.test.ts` lead-time sample; `modules.test.ts` and `seed.test.ts` insights (11.89 d vs 10 d, ROP > 200) |
| 7 | Audit verifies; a direct DB edit is reported at the first broken entry | Passed | `audit.test.ts`; on the Docker stack: edit of entry #12 → `{"valid":false,"brokenAtSeq":12,...}` |
| 8 | Recovery Example A: 200 + 100 plan, 0 shortage; approve → transfers and PO → completed | Passed | `recoveryEngine.test.ts`, `recovery.test.ts`, scenario script, e2e |
| 9 | Expiry Example B: 380 transferred, 120 residual; batch keeps its expiry | Passed | `redistributionEngine.test.ts`, `redistribution.test.ts`, scenario script |
| 10 | Simulator: graph, comparison, daily chart, late orders, sensitivity matrix, plan creation | Passed | `simulationEngine.test.ts`, `simulation.test.ts` (late order at baseline, combined ≤ baseline, no negative stock), e2e screenshot |
| 11 | Email, SMS, Cloudinary, Maps on mock drivers; real drivers with keys | Passed for mocks; real drivers verified only against mocked HTTP | `integrations.test.ts`, `alerts.test.ts` notifications |
| 12 | `npm test` passes in backend and frontend; CI green; ≥80% coverage on core modules | Tests pass; **CI not yet run on GitHub**; statement/line coverage ≥ 80%, branch coverage below 80% for services and controllers | Numbers above |
| 13 | README separates verified from needs-credentials | Done | This file |

## Stock DNA acceptance checklist (Part C.14)

| # | Item | Result | Evidence |
|---|------|--------|----------|
| AC-DNA-1 | Every lot has a unique DNA code and a born gene | Passed | `dna.test.ts` (PO receipt), unique index |
| AC-DNA-2 | No quantity change without a matching gene | Passed | `dnaStockWrites.test.ts`; `/dna/reconcile` returns no drift after every DNA test and after the seed |
| AC-DNA-3 | A lot dies exactly once and then rejects genes | Passed | `dna.test.ts` life-to-death; engine transition tests |
| AC-DNA-4 | Verify detects edited, deleted or reordered genes | Passed | `dnaEngine.test.ts`; `dna.test.ts` tamper test |
| AC-DNA-5 | Every gene is anchored in the audit chain | Passed | Anchor check in the tests; the seed test verifies every lot |
| AC-DNA-6 | FEFO never draws from expired, quarantined or recalled lots | Passed | Engine FEFO test; expiry, recall and return tests |
| AC-DNA-7 | Recall trace shows warehouses, orders and the quantity still alive | Passed | `dna.test.ts`, `seed.test.ts`, e2e |
| AC-DNA-8 | Lot page: birth to death, links, QR, life bars, integrity badge | Passed | `StockDna.test.tsx`, e2e screenshot of the milk lot |
| AC-DNA-9 | PDF certificate for alive and dead lots | Passed | Integration test (alive lot), e2e download (dead milk lot) |
| AC-DNA-10 | Suppliers see only their own lots and no customer references | Passed | `dna.test.ts` roles test |
| AC-DNA-11 | Seed creates the six scenarios; the milk lot shows its full story | Passed | `seed.test.ts`, e2e |
| AC-DNA-12 | No old Product DNA code in parallel | Passed | None existed (docs/GAP_REPORT.md) |

Demo for the final review: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

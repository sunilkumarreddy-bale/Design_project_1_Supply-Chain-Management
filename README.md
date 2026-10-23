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

## API summary

All routes are under `/api`, return JSON, validate bodies with zod and answer errors as
`{ "error": { "message", "code", "details?" } }`. Every mutating route writes a hash-chained audit entry.
The full list with example bodies is in `postman/smart-inventory-scm.postman_collection.json` (128 requests;
regenerate with `node postman/generate.mjs`). Main groups: `auth`, `users`, `warehouses`, `suppliers`,
`supplier-offers`, `products`, `stock`, `transfers`, `stock-counts`, `discrepancies`, `stock-policies`,
`transfer-routes`, `purchase-orders`, `alerts`, `dashboard`, `analytics`, `audit`, `recovery`, `redistribution`,
`customer-orders`, `product-dependencies`, `simulation`, `reports`, `notifications`, `maps`, `config`, `health`.

Socket.io events: `stock:update`, `alert:new|update|resolved`, `po:created|approved|rejected|confirmed|dispatched|received|cancelled|paid`,
`transfer:update`, `recovery:update`, `redistribution:update`, `simulation:done`, `supplier:update`,
`count:update`, and `notification:new` to the user's own room.

## Testing

| Suite | Command | Result in this environment |
|-------|---------|----------------------------|
| Backend unit (engines, JWT, RBAC, error handler, adapters, validation) | `cd backend && npm run test:unit` | passing |
| Backend integration (Supertest + in-memory replica set) | `npm run test:integration` | passing |
| Backend total | `npm test` | **23 suites, 293 tests passing** |
| Frontend (Vitest + Testing Library: login, protected routing, ExplainPanel, DataTable, form validation) | `cd frontend && npm test` | **19 tests passing** |
| Browser workflow (Playwright, 14 steps across staff, manager, admin) | `cd frontend && npm run e2e` (stack running, freshly seeded) | passing, 0 console errors, 0 failed API calls |
| Lint / types | `npm run lint && npm run typecheck` (both apps) | clean |

Backend coverage (Jest, `npm run test:coverage`), statements / branches / functions / lines:

| Area | Stmts | Branch | Funcs | Lines |
|------|-------|--------|-------|-------|
| engines | 98.1% | 85.7% | 100% | 98.9% |
| services | 91.7% | 69.3% | 90.6% | 95.7% |
| controllers | 89.8% | 58.9% | 94.1% | 96.1% |
| middleware | 95.7% | 91.0% | 97.0% | 98.2% |

Statement and line coverage are above 80% on engines, services and controllers; **branch coverage on services and
controllers is below 80%** (mostly error paths and optional filters).

Integration tests use `mongodb-memory-server` replica sets. In CI the binary is downloaded (MongoDB 7.0.14); in
an offline environment set `MONGOMS_SYSTEM_BINARY` to a local `mongod`.

**Load test** (`loadtest/api.js`, k6, 50 → 200 VUs, thresholds p95 < 500 ms and errors < 1%): the full profile has
**not** been run against a production-like deployment. A 30-second smoke run with 20 VUs against the dev-mode
Docker stack in this sandbox (`tsx watch`, 4 vCPU) gave 732 requests, 0% failures, median 10 ms, but p95 1.03 s,
crossing the threshold; the tail comes from the initial burst of simultaneous bcrypt logins. Run it against the
compiled production build before drawing conclusions.

## Status: implemented and tested vs needs credentials or deployment

| Item | Status |
|------|--------|
| All API endpoints in section 2.3, RBAC + warehouse scoping, transactions, audit chain, alerts, notifications (in-app) | Implemented and tested (unit + integration) |
| Engines F1–F6, M5, M6, M7 including spec Examples A and B | Implemented and tested |
| Every page and control in section 5.3, live Socket.io updates, role navigation, /forbidden, 404 | Implemented; component tests + Playwright workflow + page smoke across 4 roles |
| Seed and scripted scenarios | Implemented and tested (integration test + run against a real replica set) |
| `docker compose up` (replica set init, seed if empty, API, Vite) | Verified in this sandbox with images from a registry mirror; dependency install inside containers was replaced by host `node_modules` because the sandbox blocks registry access from containers |
| Production Dockerfiles (`backend/Dockerfile`, `frontend/Dockerfile`) | Written; **not built here** (needs registry access during `npm ci`) |
| GitHub Actions CI | Written; **not yet run on GitHub** (this session cannot push to the repository) |
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
* **Audit writes** happen right after the business transaction commits and are serialised per process; a crash
  between the two could lose an entry, and several API instances writing at the same instant could interleave
  `prevHash` reads. Running one writer instance (or a queue) avoids that.
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

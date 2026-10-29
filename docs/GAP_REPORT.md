# Gap report (Phase 0 audit)

Audited commit: `7b0763d` (main, including the Azure workflow edits made on GitHub), on branch `finish-100-and-dna`.
Date: 2026-10-29. No source file was changed during this audit.

## 1. What the repository is

| Item | Finding |
|---|---|
| Language | **TypeScript**, not JavaScript. 236 `.ts`/`.tsx` files, 2 `.js` config files. Backend: Express + Mongoose in TS (CommonJS output via `tsc`, run in dev with `tsx`). Frontend: React + Vite in TSX (ES modules). |
| Backend layout | `backend/src/{config,middleware,models (23),routes,controllers,services,engines,integrations,sockets,seed,utils}` |
| Frontend layout | `frontend/src/{api,app,features,components,pages (24),hooks,utils,types}` |
| Infra | `docker-compose.yml` (mongo:7 single-node replica set with `rs.initiate` healthcheck, backend, frontend), two Dockerfiles, `.github/workflows/ci.yml`, `deploy-azure.yml`, `main_smart-inventory-api.yml` (added on GitHub), `infra/azure/main.bicep`, Postman collection (128 requests), k6 script |

**Conflict with the completion prompt (needs a decision):** Part A.1 says "JavaScript only, no `.ts` files, no `tsconfig.json`" and also "do not convert the project to any other language". This project is already fully TypeScript. Both rules cannot hold at once. See section 6.

## 2. Test results (measured during this audit)

| Command | Result |
|---|---|
| `cd backend && MONGOMS_SYSTEM_BINARY=/opt/mongo/bin/mongod npx jest --runInBand` | 23 suites, **293 passed, 0 failed, 0 skipped** (61.9 s). Integration tests ran on mongodb-memory-server as a replica set with a local MongoDB 7 binary. |
| `cd backend && npx jest --coverage` | Lines 96.2 %, statements 92.2 %, functions 93.9 %, branches 71.8 %. By folder (lines): engines 98.9 %, services 95.7 %, controllers 96.1 %, middleware 98.2 %, utils 76.7 %. |
| `cd frontend && npx vitest run` | 6 files, **19 passed, 0 failed** |
| `npm run lint` and `tsc --noEmit` (both packages) | clean |
| GitHub Actions `CI` on main | **success** (last runs 2026-10-23) |
| GitHub Actions Azure deploy workflows | **failing** (Azure login / credentials, outside the codebase; tracked separately) |

## 3. Live endpoint check

The API ran against a local single-node replica set (`mongod --replSet rs0`), seeded with `npm run seed`, and was called with curl as admin.

- 200: `/api/health`, `auth/me`, `products`, `warehouses`, `stock`, `suppliers`, `purchase-orders`, `transfers`, `alerts`, `dashboard/overview`, `analytics/insights`, `analytics/rebalance`, `recovery/plans`, `redistribution/plans`, `simulation/graph`, `simulation/runs`, `customer-orders`, `stock-counts`, `audit`, `audit/verify`, `reports/stock.csv`, `reports/stock.pdf`, `notifications`
- 401: `GET /api/stock` without a token
- 400: `POST /api/stock/receive` with an invalid body
- `docker compose config -q`: valid. `docker compose up` was verified end to end in an earlier session (commit `084ba8e`). It was **not re-run** in this audit.

## 4. Master Part 8 acceptance checklist

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | docker compose up, seeded, five logins work | Done | `docker-compose.yml`; `backend/src/seed/seed.ts --if-empty`; `tests/integration/seed.test.ts`, `auth.test.ts` (compose run verified earlier, not re-run today) |
| 2 | Every page in 5.3 with wired buttons and loading/empty/error states | Done | 24 pages in `frontend/src/pages`; `components/QueryState.tsx`, `EmptyState.tsx`, `Banner.tsx`; Playwright flows `frontend/e2e/flows.mjs` |
| 3 | Role restrictions in API and UI | Done | `middleware/rbac.ts`; `tests/integration/rbac.test.ts` (100 routes, allowed and denied); `components/ProtectedRoute.tsx`, `pages/Forbidden.tsx`, `test/ProtectedRoute.test.tsx` |
| 4 | Receive, FEFO dispatch, instant and tracked transfer, count and reconcile, live, in transactions | Done | `services/inventory.ts`, `services/transfers.ts`, `controllers/stockCounts.ts` (all use `withTransaction`); `tests/integration/stock.test.ts` (rollback test), `counts.test.ts`; socket `stock:update` |
| 5 | Auto-draft: glass-box, never double-orders, prefers transfers | Done | `services/purchaseOrders.ts`, `engines/reorder.ts`; `tests/integration/purchaseOrders.test.ts` |
| 6 | Learned lead time; Globex shows longer lead time and higher ROP | Done | `services/suppliers.ts`, `engines/reorder.ts`; `tests/integration/seed.test.ts`, `modules.test.ts` |
| 7 | Audit verifies; a direct DB edit is located | Done | `middleware/audit.ts`, `engines/hashChain.ts`; `tests/integration/audit.test.ts`, `tests/unit/hashChain.test.ts` |
| 8 | Recovery Example A: 200 + 100, 0 shortage, executable | Done | `engines/recoveryEngine.ts`, `services/recovery.ts`; `tests/integration/recovery.test.ts:47` |
| 9 | Redistribution Example B: 380 moved, 120 residual, expiry kept | Done | `engines/redistributionEngine.ts`; `tests/integration/redistribution.test.ts:23` |
| 10 | Simulator: graph, baseline vs strategy, daily chart, late orders, sweep, create plan | Done | `engines/simulationEngine.ts`, `pages/Simulator.tsx`, `components/DependencyGraph.tsx`; `tests/integration/simulation.test.ts` |
| 11 | Email, SMS, Cloudinary, Maps: mock drivers, real when keys exist | Done (mock tested; real drivers need keys) | `integrations/*`; `tests/unit/integrations.test.ts` |
| 12 | npm test passes, CI green, coverage at least 80 % on core | Done | Section 2 |
| 13 | README accurate, separates verified from needs credentials | Done (to update for DNA and Azure) | `README.md:232`, `README.md:306` |

**Menu screens:** Dashboard, Products, Warehouses, Stock, Scan, Suppliers, Purchase Orders, Transfers, Alerts, Insights, Recovery (plus plan detail), Redistribution, Simulator, Customer Orders, Cycle Counts, Reports, Audit Log, Users, Profile, Login, Register, Forbidden, NotFound are all **Done**: page exists, it calls real endpoints, and it is covered by RBAC/integration tests and the Playwright flow.

## 5. Specific risks (Part B.1 task 5)

| Question | Answer | Evidence |
|---|---|---|
| Transactions for multi-document stock changes? | **Yes** | `config/db.ts` `withTransaction`, used in `services/inventory.ts`, `transfers.ts`, `purchaseOrders.ts`, `recovery.ts`, `redistribution.ts`, `controllers/stockCounts.ts`; rollback test in `stock.test.ts` |
| zod validation on every write route? | **Yes** (72 of 74 write routes; the other 2 take no body or params: `POST /redistribution/scan`, `POST /notifications/read-all`) | `middleware/validate.ts`, `routes/*.ts`; `tests/unit/validate.test.ts` |
| Socket.io authenticated with the JWT and rooms scoped by warehouse? | **Yes** | `sockets/index.ts:14-29` (handshake token required; rooms `all`, `user:<id>`, `wh:<id>`, `supplier:<id>`) |
| Any controller changing StockLevel quantity directly? | **Yes, one** | `controllers/stockCounts.ts:156-160` sets `live.quantity` and saves (inside a transaction). Otherwise all quantity writes are in `services/inventory.ts`. Seed writes directly (`seed/seedDatabase.ts:126`). `services/alerts.ts:112` writes only `reorderPoint`. |
| Transfer statuses and approval? | **Yes** | `models/Transfer.ts` statuses `pending_approval, approved, in_transit, completed, rejected, cancelled` (spec says `received`; same meaning, not renamed); mode `instant` (admin/manager, moves at once per Master spec) or `tracked`; `services/transfers.ts` |
| Cycle counts, supplier portal, customer orders, CSV/PDF reports? | **Yes, all** | `controllers/stockCounts.ts`, `routes/purchaseOrders.ts:15-16` (supplier confirm/dispatch), `controllers/customerOrders.ts`, `controllers/reports.ts` |
| Email, SMS, Cloudinary, Maps behind adapters with mocks? | **Yes** (also S3 storage and Razorpay/Stripe payments) | `integrations/{email,sms,storage,maps,payments}` |
| JWT only in localStorage? | **Yes** (reported, not changed) | `frontend/src/features/auth/authSlice.ts:9-18` |
| Existing "Product DNA" code? | **None found** | `grep -ri dna` over `backend/src` and `frontend/src` matches nothing related. There are no DNA collections, checkpoint detection or genealogy code, so nothing needs migrating (AC-DNA-12 is satisfied by building only the new design). |
| Audit entries in the same transaction as the stock change? | **No** | `middleware/audit.ts` appends after commit through a per-process serial queue. Stock DNA (C.6 / C.7) needs audit anchors written inside the transaction, so the audit helper must accept a session. |

## 6. Completion estimate

Counting rule: Done = 1, Partial = 0.5, Missing = 0.

- **Original product (Master Part 8, 13 items):** 13 Done, 0 Partial, 0 Missing, so **100 %**.
- **Combined scope including Stock DNA (13 + 12 AC-DNA items):** 13 Done, 0 Partial, 12 Missing = 13 / 25, so **52 %**. Every AC-DNA item is Missing because no DNA code exists.

The "about 50 %" in the completion prompt matches only when Stock DNA counts as scope. The original product itself is complete and tested.

## 7. What to build, in order

1. **Decide the language question first** (TypeScript as it is, or a full conversion to JavaScript). Everything below is written assuming the existing language is kept.
2. Phase 1 (small): give `recordAudit` an optional session so audit entries join the transaction; move the stock-count reconciliation write (`controllers/stockCounts.ts:156`) behind the stock service; add the static "no direct StockLevel quantity writes" test. Docker replica set, zod and socket auth are already Done.
3. Phases 2 and 3: nothing Partial or Missing found. Only re-verify.
4. Phase 4: `stocklots`, `dnaevents`, `dnalinks` models; `engines/dnaEngine` (genes, transitions, computed values, trace, reconcile, scoped hash chain); full stock service (C.7) with every caller moved onto it; audit anchoring; expiry job; `dna:backfill`; unit tests 1-7 and 20.
5. Phase 5: `/api/dna` routes, recall trace, certificate PDF, stats, reconcile, sockets, notifications; integration tests 8-19; `docs/postman/stock-dna.json`.
6. Phase 6: Stock DNA list, lot detail (eight blocks), recall trace, label page; Scan, Stock, PO receive and Dashboard entry points.
7. Phase 7: DNA codes and `decision_note` genes in redistribution, recovery and simulator; lot status in FEFO, expiry alerts and waste projection; the six seed scenarios.
8. Phase 8: k6 numbers measured on DNA endpoints, CI, `docs/DEMO_SCRIPT.md`, `docs/CHANGELOG_100.md`, README update, regenerated progress report.

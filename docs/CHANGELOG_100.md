# Changelog: finishing to 100% and Stock DNA (branch `finish-100-and-dna`)

## Decisions

- **Language:** the completion prompt asked for JavaScript only. The repository was already fully TypeScript
  (236 files), and converting it would break the prompt's own rule "do not convert the project to any other
  language". All new code is TypeScript, in the same style as the existing code. JSDoc-style comments describe
  the new modules.
- **Old "Product DNA":** none existed in this repository (Phase 0, `docs/GAP_REPORT.md`), so nothing was migrated
  or archived. There is exactly one DNA system: `stocklots`, `dnaevents`, `dnalinks` (AC-DNA-12).

## Changes to existing behaviour (all additive to response shapes)

| Area | Change | Why |
|------|--------|-----|
| `recordAudit` | Accepts an optional session (joins the caller's transaction). Without one, it writes in its own transaction. Audit writes and stock transactions are queued one at a time per process (`serialWrite`) | Spec C.6/C.7: anchors commit atomically with the stock change. The queue removed write-conflict retry storms (docs/LOAD_RESULTS.md) |
| Stock quantity writes | Only `services/stockService.ts` writes `StockLevel.quantity`. Receive, dispatch, instant and tracked transfers, PO receipt, cycle-count reconciliation and seeding were moved onto it. A static test enforces this | Spec C.7, AC-DNA-2 |
| Count reconciliation | Was a direct `live.quantity = ...` in `controllers/stockCounts.ts`; now `postCountAdjustment` (a count_adjust gene) | Gap report finding |
| `StockLevel` | New optional `lot` field and `{ lot: 1 }` index | Slices belong to lots |
| `Transfer.allocations[]` | New optional `lot` | transfer_in knows which lot arrives |
| `POST /stock/receive` | Response adds `dnaCode` and `lotCreated` | PO/receive dialogs show the DNA code |
| `POST /stock/dispatch` | Each allocation adds `lot` and `dnaCode` | FEFO by lot |
| `POST /purchase-orders/:id/receive` | Response adds `dnaLots`; each receipt gets a `GRN-YYYY-000001` number | C.11 PO receive shows DNA codes |
| FEFO (dispatch and transfers) | Skips lots that are expired, quarantined, recalled or past their date. An explicit blocked batch returns 409 naming the lot | AC-DNA-6 |
| Redistribution | Refuses a batch whose lot is not sellable (409). Scan skips such lots. Analysis returns `lot` and adds a "shelf life left according to its DNA record" line. Plan detail returns `dnaLots` / `dnaCodes` | Phase 7 |
| Recovery plan detail | Returns `dnaLots` | Phase 7 |
| Insights expiry risk | Rows add `dnaCode`, `lot`, `lotStatus`. Expired lots count as waste in full; quarantined and recalled lots are left out | Phase 7 |
| Customer orders | New `POST /customer-orders/:id/reserve` and `POST /customer-orders/:id/ship` (FEFO, genes against the order) | Spec C.5 reserve and dispatch_sale for orders |
| Seed | Opening balances go through the stock service. Six DNA scenarios were added (illustrative). Customer orders 4 → 10 (`seed.test.ts` updated) | C.13 |
| Scheduler | Also runs the DNA expiry job | C.10 |

## Extensions beyond the Stock DNA spec (documented, tested)

- Gene `receive_more`: more of an alive lot's batch received after birth (counted in `qtyAdded`). A lot is
  identified by product + batch number while alive; stock received without a batch joins that product's open
  unbatched lot.
- Transition `active → quarantine` for a QC hold on a lot that was already put away (C.9 has a hold endpoint but
  C.4 only listed hold at birth).
- Routes `POST /dna/lots/:id/damage`, `/consume`, `/put-away`, `/accept-return`, and
  `/requests/:requestId/approve|reject`. The spec's service functions needed an entry point, and "manager
  requests, admin approves" needed somewhere to record the request.
- `manufactureDate` is derived from `expiryDate − product.shelfLifeDays` when it is not supplied, so "shelf life
  used" can be measured.
- `valueLost` at death counts all waste in the lot's life (expired, damaged, shrinkage, recalled, written off),
  at the unit cost at birth. A clean sell-out therefore loses ₹0.

## New commands

`npm run dna:backfill` (idempotent), `npm run seed:dna`, and `node postman/generate.mjs` (also writes
`docs/postman/stock-dna.json`).

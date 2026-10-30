# Progress

Regenerated on 2026-10-30 after Phase 8 on branch `finish-100-and-dna`. Counting rule: Done = 1, Partial = 0.5,
Missing = 0. An item counts as Done only when its tests ran and passed in this environment.

| Scope | Done | Partial | Missing | Complete |
|---|---|---|---|---|
| Original product (Master Part 8) | 13 | 0 | 0 | 100 % |
| Stock DNA (AC-DNA-1 to 12) | 12 | 0 | 0 | 100 % |
| **Combined** | **25** | **0** | **0** | **100 %** |

Tests:
- backend: 26 suites, 357 passed;
- frontend: 23 passed;
- browser workflow (`npm run e2e`): 21 steps passed with 0 console errors;
- lint and type-check: clean.

Coverage, lines: engines 98.5 %, services 94.0 %, controllers 93.6 %. Branch coverage on services (69 %) and
controllers (59 %) is below 80 %.

## Original product (Master Part 8)

- [x] docker compose up, seeded, five logins
- [x] every page in 5.3 wired with loading, empty and error states
- [x] role restrictions in API and UI
- [x] receive, FEFO dispatch, transfers, counts, live and in transactions
- [x] glass-box auto-draft, no double ordering, transfers preferred
- [x] learned supplier lead time (Globex)
- [x] audit chain verifies and detects tampering
- [x] Recovery Example A (200 + 100)
- [x] Redistribution Example B (380 / 120)
- [x] simulator
- [x] adapters with mock drivers (real drivers need keys)
- [x] tests pass, CI green, coverage at least 80 % (lines)
- [x] honest README

## Stock DNA (Part C.14)

| Item | Status | Evidence |
|---|---|---|
| AC-DNA-1 unique DNA code and born gene | Done | `dna.test.ts` test 8 |
| AC-DNA-2 no quantity change without a gene | Done | `dnaStockWrites.test.ts`; reconcile returns no drift in every DNA test and after the seed |
| AC-DNA-3 a lot dies once, sealed | Done | `dna.test.ts` test 9; engine tests |
| AC-DNA-4 verify finds edited, deleted or reordered genes | Done | `dnaEngine.test.ts`; `dna.test.ts` test 16 |
| AC-DNA-5 every gene anchored in the audit chain | Done | test 8 anchor; seed test verifies every lot with `anchoredOk` |
| AC-DNA-6 FEFO skips expired, quarantined and recalled lots | Done | engine FEFO test; tests 11, 12, 13 |
| AC-DNA-7 recall trace | Done | test 12; seed test; e2e |
| AC-DNA-8 lot page (birth to death, links, QR, bars, badge) | Done | `StockDna.test.tsx`; e2e screenshot |
| AC-DNA-9 PDF certificate for alive and dead lots | Done | integration test (alive); e2e (dead milk lot) |
| AC-DNA-10 supplier scoping, no customer references | Done | test 18 |
| AC-DNA-11 six seed scenarios, milk story in the UI | Done | `seed.test.ts`; e2e |
| AC-DNA-12 no parallel old DNA code | Done | none existed (GAP_REPORT) |

## Needs credentials or deployment (not counted above)

- Real email, SMS, Cloudinary, S3, Maps and payment drivers: need keys.
- Azure deployment: the workflow is still failing on GitHub because of the `AZURE_CREDENTIALS` secret.
- AWS: guide only.
- The k6 mixed write profile misses the 500 ms p95 target (828 ms measured); see `docs/LOAD_RESULTS.md`.

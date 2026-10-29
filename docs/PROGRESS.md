# Progress

Measured on 2026-10-29 at commit `7b0763d` (Phase 0 audit). Counting rule: Done = 1, Partial = 0.5, Missing = 0.

| Scope | Done | Partial | Missing | Complete |
|---|---|---|---|---|
| Original product (Master Part 8) | 13 | 0 | 0 | 100 % |
| Stock DNA (AC-DNA-1 to 12) | 0 | 0 | 12 | 0 % |
| **Combined** | **13** | **0** | **12** | **52 %** |

Tests: backend 293 passed, 0 failed; frontend 19 passed, 0 failed; backend line coverage 96.2 %; CI green.

## Original product (Master Part 8)

- [x] Done: docker compose up, seeded, five logins
- [x] Done: every page in 5.3 wired with loading, empty and error states
- [x] Done: role restrictions in API and UI
- [x] Done: receive, FEFO dispatch, transfers, counts, live and in transactions
- [x] Done: glass-box auto-draft, no double ordering, transfers preferred
- [x] Done: learned supplier lead time (Globex)
- [x] Done: audit chain verifies and detects tampering
- [x] Done: Recovery Example A (200 + 100)
- [x] Done: Redistribution Example B (380 / 120)
- [x] Done: simulator (graph, comparison, chart, late orders, sweep, plan)
- [x] Done: adapters with mock drivers (real drivers need keys)
- [x] Done: tests pass, CI green, coverage at least 80 %
- [x] Done: honest README (to be updated for DNA)

## Stock DNA (Part C.14)

- [ ] Missing: AC-DNA-1 unique DNA code and born gene for every lot
- [ ] Missing: AC-DNA-2 no quantity change without a gene
- [ ] Missing: AC-DNA-3 a lot dies exactly once, sealed
- [ ] Missing: AC-DNA-4 verify finds edited, deleted or reordered genes
- [ ] Missing: AC-DNA-5 every gene anchored in the audit chain
- [ ] Missing: AC-DNA-6 FEFO skips expired, quarantined and recalled lots
- [ ] Missing: AC-DNA-7 recall trace
- [ ] Missing: AC-DNA-8 lot detail page
- [ ] Missing: AC-DNA-9 PDF life certificate
- [ ] Missing: AC-DNA-10 supplier scoping
- [ ] Missing: AC-DNA-11 six seed scenarios incl. the milk lot
- [ ] Missing: AC-DNA-12 no parallel old DNA code (none exists; becomes Done once the new design ships)

## Known gaps outside the checklists

- `controllers/stockCounts.ts:156` writes StockLevel quantity directly (in a transaction). To move behind the stock service in Phase 1.
- Audit entries are written after commit, not inside the transaction. Needed for DNA anchoring.
- JWT is stored in localStorage (reported, not changed).
- The Azure deploy workflows on GitHub are failing on credentials (outside the code).

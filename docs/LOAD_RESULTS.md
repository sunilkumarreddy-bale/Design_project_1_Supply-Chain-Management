# Load test results (measured)

Measured on 2026-10-30 in the Claude Code cloud sandbox. These are the only performance numbers this project
claims, and they describe this machine only.

**Machine:** 4 vCPU Intel Xeon @ 2.10 GHz, 15 GB RAM, Linux. MongoDB 7.0.45 single-node replica set on the same
machine. API: compiled build (`node dist/server.js`, `NODE_ENV=production`), one process,
`RATE_LIMIT_MAX=10000000`, scheduler off. k6 v0.54.0 on the same machine (it competes for the same 4 CPUs).
Data: the seeded demo database (17 lots, about 70 DNA events at the start, growing during the write test).

## 1. Main and Stock DNA reads: `loadtest/dna.js`

50 VUs (15 s ramp, 60 s hold, 10 s ramp-down). Each iteration reads `/stock`, `/products`, `/dna/lots`,
`/dna/lots/:id` and `/dna/lots/:id/timeline`, then sleeps 0.5 s.

| Run | Requests | Throughput | Failed | p50 | p90 | p95 | max |
|-----|----------|------------|--------|-----|-----|-----|-----|
| A (fresh seed) | 18,137 | 212 req/s | 0% | 98 ms | 169 ms | **193 ms** | 319 ms |
| A, `GET /dna/lots` only | | | | 97 ms | 143 ms | 156 ms | 238 ms |
| A, `GET /dna/lots/:id/timeline` only | | | | 112 ms | 165 ms | 179 ms | 264 ms |
| B (after the write test) | 14,457 | 169 req/s | 0% | 148 ms | 252 ms | **289 ms** | 537 ms |

Both runs met the targets (p95 < 500 ms, errors < 1%).

## 2. Mixed reads and stock writes: `loadtest/api.js`

`k6 run --vus 30 --duration 45s loadtest/api.js`. Each VU logs in once (bcrypt), then loops: stock list; on every
5th iteration it does a FEFO dispatch of 1 unit and receives it back. Every dispatch and receipt writes DNA genes
and their audit anchors in one transaction.

| Version | Requests | Throughput | Failed | p50 | p90 | p95 | max |
|---------|----------|------------|--------|-----|-----|-----|-----|
| Before the write queue | 382 | 7.2 req/s | 0% | 119 ms | 11.37 s | **16.72 s** | 39.46 s |
| After the write queue (shipped) | 1,659 | 35.8 req/s | 0% | 8 ms | 146 ms | **828 ms** | 3.56 s |

**Finding:** every stock transaction anchors its genes in the single audit chain, so all writers update one
counter document. When they overlapped, MongoDB aborted them with write conflicts and the driver kept retrying
them, which was the 16.7 s tail. Stock and audit writes are now queued one at a time per API process
(`serialWrite` in `backend/src/middleware/audit.ts`).

The p95 of 828 ms still **misses** the 500 ms target. The tail comes from the 30 simultaneous bcrypt logins at
start-up and from writes waiting in the queue. The full 50 → 200 VU profile has not been run.

## How to reproduce

```bash
# API with a high rate limit, against a seeded database
cd backend && npm run build && RATE_LIMIT_MAX=10000000 SCHEDULER_INTERVAL_MINUTES=0 NODE_ENV=production node dist/server.js
# in another shell
k6 run -e VUS=50 loadtest/dna.js
k6 run --vus 30 --duration 45s loadtest/api.js   # writes: use a disposable database
```

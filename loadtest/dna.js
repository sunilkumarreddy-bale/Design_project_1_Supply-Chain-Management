/**
 * k6 read-load test of the main lists and the Stock DNA list, detail and timeline endpoints.
 *   k6 run -e BASE_URL=http://localhost:4000/api loadtest/dna.js
 * Read-only, so it can run against any seeded database. Raise RATE_LIMIT_MAX on the API first.
 * The thresholds are targets; docs/LOAD_RESULTS.md records what was actually measured, and on what machine.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api';
const VUS = Number(__ENV.VUS || 50);

export const options = {
  scenarios: {
    reads: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: VUS },
        { duration: '60s', target: VUS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:dna_lots}': ['p(95)<500'],
    'http_req_duration{name:dna_timeline}': ['p(95)<500'],
  },
};

const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

export function setup() {
  const login = http.post(`${BASE}/auth/login`, JSON.stringify({ email: 'admin@example.com', password: 'Password123!' }), { headers: { 'Content-Type': 'application/json' } });
  const token = login.json('token');
  const lots = http.get(`${BASE}/dna/lots?alive=true&limit=50`, auth(token)).json('items');
  return { token, lotIds: lots.map((l) => l._id) };
}

export default function (data) {
  const h = auth(data.token);
  const id = data.lotIds[Math.floor(Math.random() * data.lotIds.length)];
  const res = [
    http.get(`${BASE}/stock?limit=100`, { ...h, tags: { name: 'stock' } }),
    http.get(`${BASE}/products`, { ...h, tags: { name: 'products' } }),
    http.get(`${BASE}/dna/lots?limit=50`, { ...h, tags: { name: 'dna_lots' } }),
    http.get(`${BASE}/dna/lots/${id}`, { ...h, tags: { name: 'dna_lot' } }),
    http.get(`${BASE}/dna/lots/${id}/timeline`, { ...h, tags: { name: 'dna_timeline' } }),
  ];
  for (const r of res) check(r, { '200': (x) => x.status === 200 });
  sleep(0.5);
}

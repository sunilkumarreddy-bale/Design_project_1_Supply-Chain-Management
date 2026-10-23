/**
 * k6 load test: login, stock list and dispatch, ramping 50 -> 200 virtual users.
 *   k6 run -e BASE_URL=http://localhost:4000/api loadtest/api.js
 * The thresholds are targets, not measured claims. Run against a disposable, freshly seeded database:
 * the test dispatches and re-receives stock. Raise RATE_LIMIT_MAX on the API first (every VU logs in once
 * and the default limiter would throttle the run).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:4000/api';
const USERS = ['admin@example.com', 'manager@example.com', 'staff@example.com'];

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 200 },
        { duration: '1m', target: 200 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const json = (token) => ({ headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

export function setup() {
  const login = http.post(`${BASE}/auth/login`, JSON.stringify({ email: 'staff@example.com', password: 'Password123!' }), json());
  const token = login.json('token');
  const products = http.get(`${BASE}/products?q=SKU-BOX-003`, json(token)).json('items');
  const me = http.get(`${BASE}/auth/me`, json(token)).json();
  return { product: products[0]._id, warehouse: me.warehouse._id };
}

let token = null;

export default function (data) {
  if (!token) {
    const email = USERS[__VU % USERS.length];
    const r = http.post(`${BASE}/auth/login`, JSON.stringify({ email, password: 'Password123!' }), json());
    check(r, { 'login 200': (x) => x.status === 200 });
    token = r.json('token');
  }
  const list = http.get(`${BASE}/stock?warehouse=${data.warehouse}&limit=100`, json(token));
  check(list, { 'stock list 200': (x) => x.status === 200 });

  // every 5th iteration moves one unit out and back in, so stock stays level across the run
  if (__ITER % 5 === 0) {
    const d = http.post(`${BASE}/stock/dispatch`, JSON.stringify({ product: data.product, warehouse: data.warehouse, quantity: 1 }), json(token));
    check(d, { 'dispatch 200': (x) => x.status === 200 });
    const r = http.post(`${BASE}/stock/receive`, JSON.stringify({ product: data.product, warehouse: data.warehouse, quantity: 1, bin: 'B2' }), json(token));
    check(r, { 'receive 201': (x) => x.status === 201 });
  }
  sleep(1);
}

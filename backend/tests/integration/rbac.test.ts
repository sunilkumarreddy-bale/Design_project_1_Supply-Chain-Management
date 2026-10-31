/**
 * RBAC on every protected route (PART 2.2 / 2.3): one allowed role must get past the guard (anything but
 * 401/403; 400/404/409 are fine because the ids and bodies here are placeholders) and one denied role must get 403.
 */
import { api, auth, clearDb, makeWorld, startDb, stopDb, World } from './helpers';

type Role = 'admin' | 'manager' | 'staff' | 'supplier';
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

const X = '0123456789abcdef01234567';
const routes: [Method, string, Role, Role][] = [
  ['get', '/api/dna/recall-trace?batchNo=X', 'manager', 'staff'],
  ['post', '/api/dna/reconcile', 'admin', 'manager'],
  ['post', '/api/dna/jobs/expiry', 'admin', 'manager'],
  ['get', `/api/dna/lots/${X}/certificate.pdf`, 'manager', 'staff'],
  ['post', `/api/dna/lots/${X}/verify`, 'manager', 'staff'],
  ['post', `/api/dna/lots/${X}/hold`, 'manager', 'staff'],
  ['post', `/api/dna/lots/${X}/release`, 'manager', 'supplier'],
  ['post', `/api/dna/lots/${X}/reject`, 'admin', 'staff'],
  ['post', `/api/dna/lots/${X}/recall`, 'admin', 'manager'],
  ['post', `/api/dna/lots/${X}/recall/clear`, 'admin', 'staff'],
  ['post', `/api/dna/lots/${X}/dispose`, 'manager', 'staff'],
  ['post', `/api/dna/lots/${X}/return-to-supplier`, 'manager', 'supplier'],
  ['post', `/api/dna/lots/${X}/requests/${X}/approve`, 'admin', 'manager'],
  ['post', `/api/dna/lots/${X}/requests/${X}/reject`, 'admin', 'manager'],
  ['post', `/api/dna/lots/${X}/damage`, 'manager', 'staff'],
  ['post', `/api/dna/lots/${X}/consume`, 'admin', 'staff'],
  ['post', `/api/dna/lots/${X}/put-away`, 'staff', 'supplier'],
  ['post', `/api/dna/lots/${X}/accept-return`, 'manager', 'staff'],
  ['post', `/api/customer-orders/${X}/reserve`, 'manager', 'staff'],
  ['post', `/api/customer-orders/${X}/ship`, 'admin', 'staff'],
  ['get', '/api/users', 'admin', 'manager'],
  ['post', '/api/users', 'admin', 'manager'],
  ['patch', `/api/users/${X}`, 'admin', 'staff'],
  ['post', `/api/users/${X}/reset-password`, 'admin', 'manager'],
  ['post', '/api/warehouses', 'admin', 'manager'],
  ['patch', `/api/warehouses/${X}`, 'admin', 'staff'],
  ['post', '/api/suppliers', 'admin', 'manager'],
  ['patch', `/api/suppliers/${X}`, 'admin', 'manager'],
  ['post', `/api/suppliers/${X}/disruption`, 'manager', 'staff'],
  ['delete', `/api/suppliers/${X}/disruption`, 'manager', 'supplier'],
  ['post', '/api/supplier-offers', 'supplier', 'staff'],
  ['patch', `/api/supplier-offers/${X}`, 'manager', 'staff'],
  ['delete', `/api/supplier-offers/${X}`, 'admin', 'staff'],
  ['post', '/api/products', 'manager', 'staff'],
  ['patch', `/api/products/${X}`, 'manager', 'supplier'],
  ['post', `/api/products/${X}/image`, 'admin', 'staff'],
  ['get', `/api/products/${X}/explain`, 'staff', 'supplier'],
  ['post', '/api/stock/receive', 'staff', 'supplier'],
  ['post', '/api/stock/dispatch', 'staff', 'supplier'],
  ['post', '/api/stock/transfer', 'manager', 'staff'],
  ['get', '/api/stock/export.csv', 'staff', 'supplier'],
  ['post', `/api/transfers/${X}/approve`, 'admin', 'manager'],
  ['post', `/api/transfers/${X}/reject`, 'admin', 'manager'],
  ['post', `/api/transfers/${X}/dispatch`, 'staff', 'supplier'],
  ['post', `/api/transfers/${X}/receive`, 'staff', 'supplier'],
  ['post', `/api/transfers/${X}/cancel`, 'manager', 'staff'],
  ['post', '/api/stock-counts', 'staff', 'supplier'],
  ['get', '/api/stock-counts', 'staff', 'supplier'],
  ['patch', `/api/stock-counts/${X}`, 'staff', 'supplier'],
  ['post', `/api/stock-counts/${X}/submit`, 'staff', 'supplier'],
  ['post', `/api/stock-counts/${X}/reconcile`, 'manager', 'staff'],
  ['get', '/api/discrepancies', 'staff', 'supplier'],
  ['post', '/api/discrepancies', 'staff', 'supplier'],
  ['patch', `/api/discrepancies/${X}`, 'manager', 'staff'],
  ['post', `/api/discrepancies/${X}/evidence`, 'staff', 'supplier'],
  ['get', '/api/stock-policies', 'manager', 'staff'],
  ['put', '/api/stock-policies', 'manager', 'staff'],
  ['get', '/api/transfer-routes', 'manager', 'staff'],
  ['put', '/api/transfer-routes', 'admin', 'staff'],
  ['post', '/api/transfer-routes/estimate', 'manager', 'supplier'],
  ['post', '/api/purchase-orders', 'manager', 'staff'],
  ['post', '/api/purchase-orders/auto-draft', 'manager', 'staff'],
  ['post', `/api/purchase-orders/${X}/approve`, 'admin', 'manager'],
  ['post', `/api/purchase-orders/${X}/reject`, 'admin', 'manager'],
  ['post', `/api/purchase-orders/${X}/confirm`, 'supplier', 'admin'],
  ['post', `/api/purchase-orders/${X}/dispatch`, 'supplier', 'manager'],
  ['post', `/api/purchase-orders/${X}/receive`, 'staff', 'supplier'],
  ['post', `/api/purchase-orders/${X}/cancel`, 'admin', 'manager'],
  ['post', `/api/purchase-orders/${X}/pay`, 'admin', 'manager'],
  ['get', '/api/alerts', 'staff', 'supplier'],
  ['post', `/api/alerts/${X}/resolve`, 'manager', 'staff'],
  ['post', '/api/alerts/sweep-expiry', 'manager', 'staff'],
  ['get', '/api/dashboard/overview', 'staff', 'supplier'],
  ['get', '/api/dashboard/stock-by-value', 'staff', 'supplier'],
  ['get', '/api/dashboard/po-funnel', 'staff', 'supplier'],
  ['get', '/api/dashboard/pending', 'manager', 'staff'],
  ['get', '/api/analytics/insights', 'manager', 'staff'],
  ['get', '/api/analytics/rebalance', 'admin', 'staff'],
  ['post', '/api/analytics/rebalance/execute', 'manager', 'staff'],
  ['get', '/api/audit', 'manager', 'staff'],
  ['get', '/api/audit/verify', 'admin', 'supplier'],
  ['get', '/api/audit/export.csv', 'manager', 'staff'],
  ['post', '/api/recovery/analyze', 'admin', 'staff'],
  ['post', '/api/recovery/plans', 'manager', 'staff'],
  ['get', '/api/recovery/plans', 'manager', 'supplier'],
  ['get', `/api/recovery/plans/${X}`, 'manager', 'staff'],
  ['post', `/api/recovery/plans/${X}/approve`, 'admin', 'manager'],
  ['post', `/api/recovery/plans/${X}/reject`, 'admin', 'manager'],
  ['post', `/api/recovery/plans/${X}/cancel`, 'manager', 'staff'],
  ['post', '/api/redistribution/scan', 'manager', 'staff'],
  ['post', '/api/redistribution/analyze', 'manager', 'staff'],
  ['post', '/api/redistribution/plans', 'manager', 'supplier'],
  ['get', '/api/redistribution/plans', 'admin', 'staff'],
  ['get', `/api/redistribution/plans/${X}`, 'manager', 'staff'],
  ['post', `/api/redistribution/plans/${X}/approve`, 'admin', 'manager'],
  ['post', `/api/redistribution/plans/${X}/reject`, 'admin', 'manager'],
  ['post', `/api/redistribution/plans/${X}/cancel`, 'manager', 'staff'],
  ['get', '/api/customer-orders', 'manager', 'staff'],
  ['post', '/api/customer-orders', 'manager', 'staff'],
  ['patch', `/api/customer-orders/${X}`, 'admin', 'staff'],
  ['delete', `/api/customer-orders/${X}`, 'admin', 'supplier'],
  ['get', '/api/product-dependencies', 'manager', 'staff'],
  ['post', '/api/product-dependencies', 'manager', 'staff'],
  ['delete', `/api/product-dependencies/${X}`, 'admin', 'staff'],
  ['get', '/api/simulation/graph', 'manager', 'staff'],
  ['post', '/api/simulation/scenarios', 'manager', 'staff'],
  ['get', '/api/simulation/scenarios', 'admin', 'supplier'],
  ['post', '/api/simulation/run', 'manager', 'staff'],
  ['get', '/api/simulation/runs', 'manager', 'staff'],
  ['get', `/api/simulation/runs/${X}`, 'manager', 'staff'],
  ['post', `/api/simulation/runs/${X}/create-recovery-plan`, 'manager', 'staff'],
  ['get', '/api/reports/stock.csv', 'manager', 'staff'],
  ['get', '/api/reports/purchase-orders.csv', 'admin', 'supplier'],
  ['get', '/api/reports/suppliers.csv', 'manager', 'staff'],
  ['get', '/api/reports/expiry.csv', 'manager', 'staff'],
  ['get', '/api/reports/stock.pdf', 'manager', 'supplier'],
  ['get', '/api/reports/purchase-orders.pdf', 'admin', 'staff'],
  ['get', '/api/reports/supplier-scorecard.pdf', 'supplier', 'staff'],
  ['post', '/api/maps/geocode', 'manager', 'staff'],
  ['post', '/api/maps/distance', 'manager', 'supplier'],
];

let w: World;
let tokens: Record<Role, string>;
beforeAll(async () => {
  await startDb();
  w = await makeWorld();
  tokens = { admin: w.admin.token, manager: w.manager.token, staff: w.staff.token, supplier: w.supplier.token };
});
afterAll(async () => {
  await clearDb();
  await stopDb();
});

describe('RBAC guard on every protected route', () => {
  it.each(routes)('%s %s allows %s and denies %s', async (method, path, allowed, denied) => {
    const ok = await api()[method](path).set(auth(tokens[allowed])).send({});
    expect([401, 403]).not.toContain(ok.status);
    const no = await api()[method](path).set(auth(tokens[denied])).send({});
    expect(no.status).toBe(403);
  });

  it('every protected route requires a token', async () => {
    for (const [method, path] of routes) {
      const r = await api()[method](path).send({});
      expect(r.status).toBe(401);
    }
  });

  it('allows reads for every signed-in role on shared lists', async () => {
    for (const path of ['/api/warehouses', '/api/products', '/api/stock', '/api/suppliers', '/api/purchase-orders', '/api/notifications', '/api/config', '/api/dna/lots', '/api/dna/stats']) {
      for (const role of ['admin', 'manager', 'staff', 'supplier'] as Role[]) {
        expect((await api().get(path).set(auth(tokens[role]))).status).toBe(200);
      }
    }
  });
});

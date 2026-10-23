/**
 * Generates the Postman collection (every endpoint, example bodies).
 * node postman/generate.mjs  ->  postman/smart-inventory-scm.postman_collection.json
 * Variables: baseUrl, token (set by the Login request), plus ids you paste from responses.
 */
import fs from 'fs';

const id = (name) => `{{${name}}}`;
const folders = {
  Auth: [
    ['POST', '/auth/login', { email: 'admin@example.com', password: 'Password123!' }, 'Login (saves token)'],
    ['POST', '/auth/register', { name: 'New Staff', email: 'new.staff@example.com', password: 'Password123!' }],
    ['GET', '/auth/me'],
    ['PATCH', '/auth/me', { name: 'Asha Admin', phone: '+919800000001', notify: { inApp: true, email: true, sms: false } }],
    ['POST', '/auth/change-password', { currentPassword: 'Password123!', newPassword: 'Password123!' }],
    ['GET', '/health'],
    ['GET', '/config'],
  ],
  Users: [
    ['GET', '/users?role=staff'],
    ['POST', '/users', { name: 'Ravi Staff', email: 'ravi@example.com', password: 'Password123!', role: 'staff', warehouse: id('warehouseId') }],
    ['PATCH', `/users/${id('userId')}`, { role: 'warehouse_manager', warehouse: id('warehouseId'), isActive: true }],
    ['POST', `/users/${id('userId')}/reset-password`, { newPassword: 'Password123!' }],
  ],
  Warehouses: [
    ['GET', '/warehouses'],
    ['GET', `/warehouses/${id('warehouseId')}`],
    ['POST', '/warehouses', { code: 'WH-WEST', name: 'Warehouse D', address: 'MIDC Andheri', city: 'Mumbai', zones: [{ code: 'A', name: 'General', bins: ['A1', 'A2'] }] }],
    ['PATCH', `/warehouses/${id('warehouseId')}`, { name: 'Warehouse A', address: 'Peenya Industrial Area', city: 'Bengaluru' }],
  ],
  Suppliers: [
    ['GET', '/suppliers'],
    ['GET', `/suppliers/${id('supplierId')}`],
    ['POST', '/suppliers', { name: 'Umbrella Corp', contactName: 'Neha', email: 'sales@umbrella.example.com', leadTimeDays: 6 }],
    ['PATCH', `/suppliers/${id('supplierId')}`, { leadTimeDays: 5, status: 'active' }],
    ['POST', `/suppliers/${id('supplierId')}/disruption`, { expectedDays: 7, reason: 'Plant fire' }],
    ['DELETE', `/suppliers/${id('supplierId')}/disruption`],
    ['GET', `/supplier-offers?product=${id('productId')}`],
    ['POST', '/supplier-offers', { supplier: id('supplierId'), product: id('productId'), capacityUnits: 100, minOrderQty: 10, leadTimeDays: 3, unitCost: 62 }],
    ['PATCH', `/supplier-offers/${id('offerId')}`, { unitCost: 60 }],
    ['DELETE', `/supplier-offers/${id('offerId')}`],
  ],
  Products: [
    ['GET', '/products?q=cable'],
    ['GET', `/products/${id('productId')}`],
    ['POST', '/products', { sku: 'SKU-NEW-100', name: 'Hex Bolt', category: 'Hardware', unit: 'pcs', unitCost: 3, unitPrice: 6, primarySupplier: id('supplierId'), avgDailyDemand: 40, demandStdDev: 5 }],
    ['PATCH', `/products/${id('productId')}`, { serviceLevelZ: 2.05 }],
    ['POST', `/products/${id('productId')}/image`, 'FORMDATA:image'],
    ['GET', `/products/${id('productId')}/qr`],
    ['POST', '/products/scan', { payload: 'SKU-BAT-004' }],
    ['GET', `/products/${id('productId')}/explain?warehouse=${id('warehouseId')}`],
  ],
  Stock: [
    ['GET', `/stock?warehouse=${id('warehouseId')}`],
    ['GET', '/stock/summary'],
    ['GET', '/stock/export.csv'],
    ['POST', '/stock/receive', { product: id('productId'), warehouse: id('warehouseId'), quantity: 50, bin: 'A1', batchNo: 'B-2026-11', expiryDate: '2027-06-30' }],
    ['POST', '/stock/dispatch', { product: id('productId'), warehouse: id('warehouseId'), quantity: 5 }],
    ['POST', '/stock/transfer', { product: id('productId'), fromWarehouse: id('warehouseId'), toWarehouse: id('otherWarehouseId'), quantity: 10, mode: 'instant' }],
    ['POST', '/stock/transfer', { product: id('productId'), fromWarehouse: id('warehouseId'), toWarehouse: id('otherWarehouseId'), quantity: 10, mode: 'tracked', notes: 'tracked' }, 'Tracked transfer request'],
    ['GET', '/stock/transfers?status=pending_approval'],
  ],
  Transfers: [
    ['GET', `/transfers/${id('transferId')}`],
    ['POST', `/transfers/${id('transferId')}/approve`],
    ['POST', `/transfers/${id('transferId')}/reject`, { reason: 'Not needed' }],
    ['POST', `/transfers/${id('transferId')}/dispatch`],
    ['POST', `/transfers/${id('transferId')}/receive`, {}],
    ['POST', `/transfers/${id('transferId')}/cancel`],
  ],
  'Cycle counts & discrepancies': [
    ['POST', '/stock-counts', { warehouse: id('warehouseId') }],
    ['GET', '/stock-counts'],
    ['GET', `/stock-counts/${id('countId')}`],
    ['PATCH', `/stock-counts/${id('countId')}`, { lines: [{ _id: id('countLineId'), countedQty: 97, reason: 'damaged' }] }],
    ['POST', `/stock-counts/${id('countId')}/submit`],
    ['POST', `/stock-counts/${id('countId')}/reconcile`],
    ['GET', '/discrepancies?status=open'],
    ['POST', '/discrepancies', { type: 'damage', warehouse: id('warehouseId'), product: id('productId'), expectedQty: 10, actualQty: 8, notes: 'crushed carton' }],
    ['PATCH', `/discrepancies/${id('discrepancyId')}`, { status: 'resolved', resolution: 'Written off' }],
    ['POST', `/discrepancies/${id('discrepancyId')}/evidence`, 'FORMDATA:file'],
  ],
  'Policies & routes': [
    ['GET', '/stock-policies'],
    ['PUT', '/stock-policies', { product: id('productId'), warehouse: id('warehouseId'), minStock: 100, maxStock: 1000 }],
    ['GET', '/transfer-routes'],
    ['PUT', '/transfer-routes', { fromWarehouse: id('otherWarehouseId'), toWarehouse: id('warehouseId'), leadTimeDays: 1, costPerUnit: 2 }],
    ['POST', '/transfer-routes/estimate', { fromWarehouse: id('warehouseId'), toWarehouse: id('otherWarehouseId'), save: true }],
  ],
  'Purchase orders': [
    ['GET', '/purchase-orders?status=pending_approval'],
    ['GET', `/purchase-orders/${id('poId')}`],
    ['POST', '/purchase-orders', { supplier: id('supplierId'), warehouse: id('warehouseId'), items: [{ product: id('productId'), quantityOrdered: 100 }], expectedDeliveryDate: '2026-12-01', notes: 'manual' }],
    ['POST', '/purchase-orders/auto-draft', { warehouse: id('warehouseId') }],
    ['POST', `/purchase-orders/${id('poId')}/submit`],
    ['POST', `/purchase-orders/${id('poId')}/approve`],
    ['POST', `/purchase-orders/${id('poId')}/reject`, { reason: 'Too expensive' }],
    ['POST', `/purchase-orders/${id('poId')}/confirm`, { confirmedQty: 100, confirmedDate: '2026-11-30' }, 'Confirm (supplier token)'],
    ['POST', `/purchase-orders/${id('poId')}/dispatch`, { carrier: 'BlueDart', trackingNo: 'BD123456', eta: '2026-11-30' }, 'Dispatch (supplier token)'],
    ['POST', `/purchase-orders/${id('poId')}/receive`, { receivedItems: [{ product: id('productId'), quantityReceived: 100, batchNo: 'R-1' }], logDiscrepancy: true }],
    ['POST', `/purchase-orders/${id('poId')}/cancel`],
    ['POST', `/purchase-orders/${id('poId')}/pay`],
  ],
  'Alerts & dashboard': [
    ['GET', '/alerts?resolved=false'],
    ['POST', `/alerts/${id('alertId')}/resolve`],
    ['POST', '/alerts/sweep-expiry', {}],
    ['GET', '/dashboard/overview'],
    ['GET', '/dashboard/stock-by-value'],
    ['GET', '/dashboard/po-funnel'],
    ['GET', '/dashboard/pending'],
  ],
  Analytics: [
    ['GET', `/analytics/insights?warehouse=${id('warehouseId')}`],
    ['GET', '/analytics/rebalance'],
    ['POST', '/analytics/rebalance/execute', { product: id('productId'), from: id('warehouseId'), to: id('otherWarehouseId'), quantity: 61 }],
  ],
  Audit: [
    ['GET', '/audit?page=1&limit=25'],
    ['GET', '/audit/verify'],
    ['GET', '/audit/export.csv'],
  ],
  'Recovery (M5)': [
    ['POST', '/recovery/analyze', { product: id('productId'), warehouse: id('warehouseId') }],
    ['POST', '/recovery/plans', { analysisInput: { product: id('productId'), warehouse: id('warehouseId') }, selectedOptionId: 'transfers_then_supplier' }],
    ['GET', '/recovery/plans'],
    ['GET', `/recovery/plans/${id('recoveryPlanId')}`],
    ['POST', `/recovery/plans/${id('recoveryPlanId')}/approve`],
    ['POST', `/recovery/plans/${id('recoveryPlanId')}/reject`, { reason: 'Use stock from East instead' }],
    ['POST', `/recovery/plans/${id('recoveryPlanId')}/cancel`],
  ],
  'Redistribution (M7)': [
    ['POST', '/redistribution/scan'],
    ['POST', '/redistribution/analyze', { stockLevelId: id('stockLevelId'), minShelfLifeDays: 1 }],
    ['POST', '/redistribution/plans', { stockLevelId: id('stockLevelId'), minShelfLifeDays: 1 }],
    ['GET', '/redistribution/plans'],
    ['GET', `/redistribution/plans/${id('redistributionPlanId')}`],
    ['POST', `/redistribution/plans/${id('redistributionPlanId')}/approve`],
    ['POST', `/redistribution/plans/${id('redistributionPlanId')}/reject`, { reason: 'Will mark down instead' }],
    ['POST', `/redistribution/plans/${id('redistributionPlanId')}/cancel`],
  ],
  'Simulator (M6)': [
    ['GET', '/customer-orders'],
    ['POST', '/customer-orders', { customerName: 'Alpha Retail', warehouse: id('warehouseId'), requiredBy: '2026-11-05', priority: 'high', items: [{ product: id('productId'), quantity: 20 }] }],
    ['PATCH', `/customer-orders/${id('orderId')}`, { status: 'cancelled' }],
    ['DELETE', `/customer-orders/${id('orderId')}`],
    ['GET', '/product-dependencies'],
    ['POST', '/product-dependencies', { componentProduct: id('productId'), finishedProduct: id('finishedProductId'), quantityPer: 1 }],
    ['DELETE', `/product-dependencies/${id('dependencyId')}`],
    ['GET', `/simulation/graph?supplier=${id('supplierId')}`],
    ['POST', '/simulation/scenarios', { name: 'Acme stops 5 days', type: 'supplier_stop', supplier: id('supplierId'), startDay: 0, durationDays: 5, horizonDays: 30, backorders: false }],
    ['GET', '/simulation/scenarios'],
    ['POST', '/simulation/run', { scenario: { type: 'supplier_stop', supplier: id('supplierId'), durationDays: 5, horizonDays: 30 }, sweep: true }],
    ['GET', '/simulation/runs'],
    ['GET', `/simulation/runs/${id('runId')}`],
    ['POST', `/simulation/runs/${id('runId')}/create-recovery-plan`, { strategy: 'combined', positionKey: `${id('warehouseId')}:${id('productId')}` }],
  ],
  Reports: [
    ['GET', '/reports/stock.csv'],
    ['GET', '/reports/purchase-orders.csv'],
    ['GET', '/reports/suppliers.csv'],
    ['GET', '/reports/expiry.csv'],
    ['GET', '/reports/stock.pdf'],
    ['GET', '/reports/purchase-orders.pdf'],
    ['GET', `/reports/supplier-scorecard.pdf?supplier=${id('supplierId')}`],
  ],
  'Notifications & maps': [
    ['GET', '/notifications'],
    ['POST', `/notifications/${id('notificationId')}/read`],
    ['POST', '/notifications/read-all'],
    ['POST', '/maps/geocode', { address: 'Peenya Industrial Area, Bengaluru' }],
    ['POST', '/maps/distance', { origin: { lat: 12.97, lng: 77.59 }, destination: { lat: 13.08, lng: 80.27 } }],
  ],
};

const item = ([method, path, body, name]) => {
  const [p, query] = path.split('?');
  const req = {
    method,
    header: [{ key: 'Content-Type', value: 'application/json' }],
    url: {
      raw: `{{baseUrl}}${path}`,
      host: ['{{baseUrl}}'],
      path: p.split('/').filter(Boolean),
      ...(query ? { query: query.split('&').map((kv) => ({ key: kv.split('=')[0], value: kv.split('=')[1] })) } : {}),
    },
  };
  if (typeof body === 'string' && body.startsWith('FORMDATA:')) {
    req.header = [];
    req.body = { mode: 'formdata', formdata: [{ key: body.slice(9), type: 'file', src: '' }] };
  } else if (body !== undefined) {
    req.body = { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } };
  }
  const out = { name: name ?? `${method} ${p}`, request: req };
  if (path === '/auth/login') {
    out.event = [{ listen: 'test', script: { type: 'text/javascript', exec: ["const b = pm.response.json();", "if (b.token) pm.collectionVariables.set('token', b.token);"] } }];
    out.request.auth = { type: 'noauth' };
  }
  return out;
};

const vars = ['warehouseId', 'otherWarehouseId', 'supplierId', 'productId', 'finishedProductId', 'userId', 'offerId', 'transferId', 'countId', 'countLineId', 'discrepancyId', 'poId', 'alertId', 'recoveryPlanId', 'stockLevelId', 'redistributionPlanId', 'orderId', 'dependencyId', 'runId', 'notificationId'];
const collection = {
  info: { name: 'Smart Inventory SCM API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json', description: 'All endpoints under /api. Run "Login" first; it stores the JWT in {{token}}.' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [{ key: 'baseUrl', value: 'http://localhost:4000/api' }, { key: 'token', value: '' }, ...vars.map((k) => ({ key: k, value: '' }))],
  item: Object.entries(folders).map(([name, reqs]) => ({ name, item: reqs.map(item) })),
};
fs.writeFileSync(new URL('./smart-inventory-scm.postman_collection.json', import.meta.url), JSON.stringify(collection, null, 2) + '\n');
console.log(`Wrote ${Object.values(folders).flat().length} requests`);

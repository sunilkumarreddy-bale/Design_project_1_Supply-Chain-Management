import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler as h } from '../utils/asyncHandler';
import { getConfig } from '../controllers/config';
import auth from './auth';
import users from './users';
import warehouses from './warehouses';
import { offers, suppliers } from './suppliers';
import products from './products';
import stock from './stock';
import transfers from './transfers';
import { discrepancies, stockCounts, stockPolicies, transferRoutes } from './operations';
import purchaseOrders from './purchaseOrders';
import { alertsRouter, analyticsRouter, auditRouter, dashboardRouter } from './insights';
import dnaRouter from './dna';
import {
  customerOrders,
  mapsRouter,
  notifications,
  productDependencies,
  recovery,
  redistribution,
  reports,
  simulation,
} from './modules';

const api = Router();
api.get('/health', (_req, res) => res.json({ ok: true, service: 'smart-inventory-scm-api', time: new Date().toISOString() }));
api.use('/auth', auth);

// everything below requires a signed-in user
api.use(requireAuth);
api.get('/config', h(getConfig));
api.use('/users', users);
api.use('/warehouses', warehouses);
api.use('/suppliers', suppliers);
api.use('/supplier-offers', offers);
api.use('/products', products);
api.use('/stock', stock);
api.use('/transfers', transfers);
api.use('/stock-counts', stockCounts);
api.use('/discrepancies', discrepancies);
api.use('/stock-policies', stockPolicies);
api.use('/transfer-routes', transferRoutes);
api.use('/purchase-orders', purchaseOrders);
api.use('/alerts', alertsRouter);
api.use('/dashboard', dashboardRouter);
api.use('/analytics', analyticsRouter);
api.use('/audit', auditRouter);
api.use('/recovery', recovery);
api.use('/redistribution', redistribution);
api.use('/customer-orders', customerOrders);
api.use('/product-dependencies', productDependencies);
api.use('/simulation', simulation);
api.use('/reports', reports);
api.use('/notifications', notifications);
api.use('/maps', mapsRouter);
api.use('/dna', dnaRouter);

export default api;

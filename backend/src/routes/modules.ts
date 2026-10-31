import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler';
import { ALL_ROLES, MANAGERS, requireRole } from '../middleware/rbac';
import { idParam, validate } from '../middleware/validate';
import * as rec from '../controllers/recovery';
import * as red from '../controllers/redistribution';
import * as co from '../controllers/customerOrders';
import * as sim from '../controllers/simulation';
import * as rep from '../controllers/reports';
import * as notif from '../controllers/notifications';
import * as maps from '../controllers/maps';

export const recovery = Router();
recovery.use(requireRole(...MANAGERS));
recovery.post('/analyze', validate({ body: rec.analysisInputSchema }), h(rec.analyzeRecovery));
recovery.get('/plans', validate({ query: rec.listPlansQuery }), h(rec.listPlans));
recovery.post('/plans', validate({ body: rec.proposeSchema }), h(rec.proposePlan));
recovery.get('/plans/:id', validate(idParam), h(rec.getPlan));
recovery.post('/plans/:id/approve', requireRole('admin'), validate(idParam), h(rec.approvePlan));
recovery.post('/plans/:id/reject', requireRole('admin'), validate({ ...idParam, body: rec.rejectSchema }), h(rec.rejectPlan));
recovery.post('/plans/:id/cancel', validate(idParam), h(rec.cancelPlan));

export const redistribution = Router();
redistribution.use(requireRole(...MANAGERS));
redistribution.post('/scan', h(red.scan));
redistribution.post('/analyze', validate({ body: red.analyzeSchema }), h(red.analyze));
redistribution.get('/plans', validate({ query: red.listPlansQuery }), h(red.listPlans));
redistribution.post('/plans', validate({ body: red.analyzeSchema }), h(red.proposePlan));
redistribution.get('/plans/:id', validate(idParam), h(red.getPlan));
redistribution.post('/plans/:id/approve', requireRole('admin'), validate(idParam), h(red.approvePlan));
redistribution.post('/plans/:id/reject', requireRole('admin'), validate({ ...idParam, body: red.rejectSchema }), h(red.rejectPlan));
redistribution.post('/plans/:id/cancel', validate(idParam), h(red.cancelPlan));

export const customerOrders = Router();
customerOrders.use(requireRole(...MANAGERS));
customerOrders.get('/', validate({ query: co.listOrdersQuery }), h(co.listOrders));
customerOrders.post('/', validate({ body: co.createOrderSchema }), h(co.createOrder));
customerOrders.patch('/:id', validate({ ...idParam, body: co.updateOrderSchema }), h(co.updateOrder));
customerOrders.delete('/:id', validate(idParam), h(co.deleteOrder));
customerOrders.post('/:id/reserve', validate(idParam), h(co.reserveOrder));
customerOrders.post('/:id/ship', validate({ ...idParam, body: co.shipSchema }), h(co.shipOrder));

export const productDependencies = Router();
productDependencies.use(requireRole(...MANAGERS));
productDependencies.get('/', h(co.listDependencies));
productDependencies.post('/', validate({ body: co.createDependencySchema }), h(co.createDependency));
productDependencies.delete('/:id', validate(idParam), h(co.deleteDependency));

export const simulation = Router();
simulation.use(requireRole(...MANAGERS));
simulation.get('/graph', validate({ query: sim.graphQuery }), h(sim.graph));
simulation.get('/scenarios', h(sim.listScenarios));
simulation.post('/scenarios', validate({ body: sim.scenarioSchema }), h(sim.createScenario));
simulation.post('/run', validate({ body: sim.runSchema }), h(sim.run));
simulation.get('/runs', validate({ query: sim.listRunsQuery }), h(sim.listRuns));
simulation.get('/runs/:id', validate(idParam), h(sim.getRun));
simulation.post('/runs/:id/create-recovery-plan', validate({ ...idParam, body: sim.fromRunSchema }), h(sim.createRecoveryPlanFromRun));

export const reports = Router();
const managers = requireRole(...MANAGERS);
reports.get('/stock.csv', managers, validate({ query: rep.reportQuery }), h(rep.stockCsv));
reports.get('/purchase-orders.csv', managers, validate({ query: rep.reportQuery }), h(rep.purchaseOrdersCsv));
reports.get('/suppliers.csv', managers, h(rep.suppliersCsv));
reports.get('/expiry.csv', managers, validate({ query: rep.reportQuery }), h(rep.expiryCsv));
reports.get('/stock.pdf', managers, validate({ query: rep.reportQuery }), h(rep.stockPdf));
reports.get('/purchase-orders.pdf', managers, validate({ query: rep.reportQuery }), h(rep.purchaseOrdersPdf));
reports.get('/supplier-scorecard.pdf', requireRole('admin', 'warehouse_manager', 'supplier'), validate({ query: rep.reportQuery }), h(rep.supplierScorecardPdf));

export const notifications = Router();
notifications.use(requireRole(...ALL_ROLES));
notifications.get('/', validate({ query: notif.listNotificationsQuery }), h(notif.listNotifications));
notifications.post('/read-all', h(notif.markAllRead));
notifications.post('/:id/read', validate(idParam), h(notif.markRead));

export const mapsRouter = Router();
mapsRouter.use(requireRole(...MANAGERS));
mapsRouter.post('/geocode', validate({ body: maps.geocodeSchema }), h(maps.geocode));
mapsRouter.post('/distance', validate({ body: maps.distanceSchema }), h(maps.distance));

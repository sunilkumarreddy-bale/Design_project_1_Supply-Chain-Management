import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler';
import { INTERNAL_ROLES, MANAGERS, requireRole } from '../middleware/rbac';
import { idParam, validate } from '../middleware/validate';
import * as alerts from '../controllers/alerts';
import * as dash from '../controllers/dashboard';
import * as an from '../controllers/analytics';
import * as audit from '../controllers/audit';

export const alertsRouter = Router();
alertsRouter.use(requireRole(...INTERNAL_ROLES));
alertsRouter.get('/', validate({ query: alerts.listAlertsQuery }), h(alerts.listAlerts));
alertsRouter.post('/sweep-expiry', requireRole(...MANAGERS), validate({ body: alerts.sweepSchema }), h(alerts.runExpirySweep));
alertsRouter.post('/:id/resolve', requireRole(...MANAGERS), validate(idParam), h(alerts.resolveAlert));

export const dashboardRouter = Router();
dashboardRouter.use(requireRole(...INTERNAL_ROLES));
dashboardRouter.get('/overview', validate({ query: dash.dashboardQuery }), h(dash.overview));
dashboardRouter.get('/stock-by-value', validate({ query: dash.dashboardQuery }), h(dash.stockByValue));
dashboardRouter.get('/po-funnel', validate({ query: dash.dashboardQuery }), h(dash.poFunnel));
dashboardRouter.get('/pending', requireRole(...MANAGERS), h(dash.pendingApprovals));

export const analyticsRouter = Router();
analyticsRouter.use(requireRole(...MANAGERS));
analyticsRouter.get('/insights', validate({ query: an.insightsQuery }), h(an.insights));
analyticsRouter.get('/rebalance', validate({ query: an.rebalanceQuery }), h(an.rebalance));
analyticsRouter.post('/rebalance/execute', validate({ body: an.executeRebalanceSchema }), h(an.executeRebalance));

export const auditRouter = Router();
auditRouter.use(requireRole(...MANAGERS));
auditRouter.get('/', validate({ query: audit.listAuditQuery }), h(audit.listAudit));
auditRouter.get('/verify', h(audit.verifyAudit));
auditRouter.get('/export.csv', validate({ query: audit.listAuditQuery }), h(audit.exportAuditCsv));

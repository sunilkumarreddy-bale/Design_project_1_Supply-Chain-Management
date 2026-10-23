import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler';
import { INTERNAL_ROLES, MANAGERS, requireRole } from '../middleware/rbac';
import { idParam, validate } from '../middleware/validate';
import * as counts from '../controllers/stockCounts';
import * as disc from '../controllers/discrepancies';
import * as pr from '../controllers/policiesRoutes';
import { upload } from './_shared';

export const stockCounts = Router();
stockCounts.use(requireRole(...INTERNAL_ROLES));
stockCounts.get('/', validate({ query: counts.listCountsQuery }), h(counts.listCounts));
stockCounts.post('/', validate({ body: counts.createCountSchema }), h(counts.createCount));
stockCounts.get('/:id', validate(idParam), h(counts.getCount));
stockCounts.patch('/:id', validate({ ...idParam, body: counts.updateCountSchema }), h(counts.updateCount));
stockCounts.post('/:id/submit', validate(idParam), h(counts.submitCount));
stockCounts.post('/:id/reconcile', requireRole(...MANAGERS), validate(idParam), h(counts.reconcileCount));

export const discrepancies = Router();
discrepancies.use(requireRole(...INTERNAL_ROLES));
discrepancies.get('/', validate({ query: disc.listDiscrepanciesQuery }), h(disc.listDiscrepancies));
discrepancies.post('/', validate({ body: disc.createDiscrepancySchema }), h(disc.createDiscrepancy));
discrepancies.patch('/:id', requireRole(...MANAGERS), validate({ ...idParam, body: disc.updateDiscrepancySchema }), h(disc.updateDiscrepancy));
discrepancies.post('/:id/evidence', validate(idParam), upload.single('file'), h(disc.uploadEvidence));

export const stockPolicies = Router();
stockPolicies.use(requireRole(...MANAGERS));
stockPolicies.get('/', validate({ query: pr.listPoliciesQuery }), h(pr.listPolicies));
stockPolicies.put('/', validate({ body: pr.putPolicySchema }), h(pr.putPolicy));

export const transferRoutes = Router();
transferRoutes.use(requireRole(...MANAGERS));
transferRoutes.get('/', h(pr.listRoutes));
transferRoutes.put('/', validate({ body: pr.putRouteSchema }), h(pr.putRoute));
transferRoutes.post('/estimate', validate({ body: pr.estimateRouteSchema }), h(pr.estimateRoute));

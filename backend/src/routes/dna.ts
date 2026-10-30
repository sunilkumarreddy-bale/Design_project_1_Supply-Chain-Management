import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler';
import { ALL_ROLES, INTERNAL_ROLES, MANAGERS, requireRole } from '../middleware/rbac';
import { idParam, validate } from '../middleware/validate';
import * as c from '../controllers/dna';

/** Stock DNA (docs/Stock_DNA_Spec.md C.9). Every route already sits behind requireAuth in routes/index.ts. */
const r = Router();
const admin = requireRole('admin');
const managers = requireRole(...MANAGERS);

r.get('/lots', requireRole(...ALL_ROLES), validate({ query: c.listLotsQuery }), h(c.listLots));
r.get('/lookup', requireRole(...ALL_ROLES), validate({ query: c.lookupQuery }), h(c.lookup));
r.get('/stats', requireRole(...ALL_ROLES), h(c.stats));
r.get('/recall-trace', managers, validate({ query: c.recallTraceQuery }), h(c.recallTrace));
r.post('/reconcile', admin, h(c.reconcile));
r.post('/jobs/expiry', admin, h(c.runExpiryJob));

r.get('/lots/:id', requireRole(...ALL_ROLES), validate(idParam), h(c.getLot));
r.get('/lots/:id/timeline', requireRole(...ALL_ROLES), validate(idParam), h(c.timeline));
r.get('/lots/:id/genealogy', requireRole(...ALL_ROLES), validate(idParam), h(c.genealogy));
r.get('/lots/:id/journey', requireRole(...ALL_ROLES), validate(idParam), h(c.journey));
r.get('/lots/:id/certificate.pdf', managers, validate(idParam), h(c.certificate));
r.post('/lots/:id/verify', managers, validate(idParam), h(c.verify));

r.post('/lots/:id/hold', managers, validate({ ...idParam, body: c.reasonSchema }), h(c.hold));
r.post('/lots/:id/release', managers, validate({ ...idParam, body: c.reasonSchema }), h(c.release));
r.post('/lots/:id/reject', managers, validate({ ...idParam, body: c.reasonSchema }), h(c.reject));
r.post('/lots/:id/recall', admin, validate({ ...idParam, body: c.reasonSchema }), h(c.recall));
r.post('/lots/:id/recall/clear', admin, validate({ ...idParam, body: c.reasonSchema }), h(c.clearRecall));
r.post('/lots/:id/dispose', managers, validate({ ...idParam, body: c.disposeSchema }), h(c.dispose));
r.post('/lots/:id/return-to-supplier', managers, validate({ ...idParam, body: c.returnSchema }), h(c.returnToSupplier));
r.post('/lots/:id/requests/:requestId/approve', admin, validate({ params: c.requestParams, body: c.decideSchema }), h(c.approveRequest));
r.post('/lots/:id/requests/:requestId/reject', admin, validate({ params: c.requestParams, body: c.decideSchema }), h(c.rejectRequest));
r.post('/lots/:id/damage', managers, validate({ ...idParam, body: c.damageSchema }), h(c.damage));
r.post('/lots/:id/consume', managers, validate({ ...idParam, body: c.consumeSchema }), h(c.consume));
r.post('/lots/:id/put-away', requireRole(...INTERNAL_ROLES), validate({ ...idParam, body: c.putAwaySchema }), h(c.putAway));
r.post('/lots/:id/accept-return', managers, validate({ ...idParam, body: c.acceptReturnSchema }), h(c.acceptReturn));

export default r;

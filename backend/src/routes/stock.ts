import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler';
import { INTERNAL_ROLES, MANAGERS, requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import * as c from '../controllers/stock';

const r = Router();
r.get('/', validate({ query: c.listStockQuery }), h(c.listStock));
r.get('/summary', validate({ query: c.summaryQuery }), h(c.stockSummary));
r.get('/transfers', validate({ query: c.listTransfersQuery }), h(c.listTransfers));
r.get('/export.csv', requireRole(...INTERNAL_ROLES), validate({ query: c.summaryQuery }), h(c.exportStockCsv));
r.post('/receive', requireRole(...INTERNAL_ROLES), validate({ body: c.receiveSchema }), h(c.receive));
r.post('/dispatch', requireRole(...INTERNAL_ROLES), validate({ body: c.dispatchSchema }), h(c.dispatch));
r.post('/transfer', requireRole(...MANAGERS), validate({ body: c.transferSchema }), h(c.transfer));
export default r;

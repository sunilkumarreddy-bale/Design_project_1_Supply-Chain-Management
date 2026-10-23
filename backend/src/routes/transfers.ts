import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler';
import { INTERNAL_ROLES, MANAGERS, requireRole } from '../middleware/rbac';
import { idParam, validate } from '../middleware/validate';
import * as c from '../controllers/transfers';
import { listTransfers, listTransfersQuery } from '../controllers/stock';

const r = Router();
r.get('/', validate({ query: listTransfersQuery }), h(listTransfers));
r.get('/:id', validate(idParam), h(c.getTransfer));
r.post('/:id/approve', requireRole('admin'), validate(idParam), h(c.approve));
r.post('/:id/reject', requireRole('admin'), validate({ ...idParam, body: c.reasonSchema }), h(c.reject));
r.post('/:id/dispatch', requireRole(...INTERNAL_ROLES), validate(idParam), h(c.dispatch));
r.post('/:id/receive', requireRole(...INTERNAL_ROLES), validate({ ...idParam, body: c.receiveTransferSchema }), h(c.receive));
r.post('/:id/cancel', requireRole(...MANAGERS), validate(idParam), h(c.cancel));
export default r;

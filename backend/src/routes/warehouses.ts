import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler';
import { MANAGERS, requireRole } from '../middleware/rbac';
import { idParam, validate } from '../middleware/validate';
import * as c from '../controllers/warehouses';

const r = Router();
r.get('/', h(c.listWarehouses));
r.get('/:id', validate(idParam), h(c.getWarehouse));
r.post('/', requireRole('admin'), validate({ body: c.createWarehouseSchema }), h(c.createWarehouse));
r.patch('/:id', requireRole(...MANAGERS), validate({ ...idParam, body: c.updateWarehouseSchema }), h(c.updateWarehouse));
export default r;

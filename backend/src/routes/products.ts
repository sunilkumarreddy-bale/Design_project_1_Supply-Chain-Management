import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler';
import { INTERNAL_ROLES, MANAGERS, requireRole } from '../middleware/rbac';
import { idParam, validate } from '../middleware/validate';
import * as c from '../controllers/products';
import { upload } from './_shared';

const r = Router();
r.get('/', validate({ query: c.listProductsQuery }), h(c.listProducts));
r.post('/scan', validate({ body: c.scanSchema }), h(c.scanProduct));
r.get('/:id', validate(idParam), h(c.getProduct));
r.get('/:id/qr', validate(idParam), h(c.productQr));
r.get('/:id/explain', requireRole(...INTERNAL_ROLES), validate({ ...idParam, query: c.explainQuery }), h(c.explainProduct));
r.post('/', requireRole(...MANAGERS), validate({ body: c.createProductSchema }), h(c.createProduct));
r.patch('/:id', requireRole(...MANAGERS), validate({ ...idParam, body: c.updateProductSchema }), h(c.updateProduct));
r.post('/:id/image', requireRole(...MANAGERS), validate(idParam), upload.single('image'), h(c.uploadProductImage));
export default r;

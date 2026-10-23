import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler';
import { requireRole } from '../middleware/rbac';
import { idParam, validate } from '../middleware/validate';
import * as c from '../controllers/users';

const r = Router();
r.use(requireRole('admin'));
r.get('/', validate({ query: c.listUsersQuery }), h(c.listUsers));
r.post('/', validate({ body: c.createUserSchema }), h(c.createUser));
r.patch('/:id', validate({ ...idParam, body: c.updateUserSchema }), h(c.updateUser));
r.post('/:id/reset-password', validate({ ...idParam, body: c.resetPasswordSchema }), h(c.resetPassword));
export default r;

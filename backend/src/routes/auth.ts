import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as c from '../controllers/auth';
import { authLimiter } from './_shared';

const r = Router();
r.post('/register', authLimiter, validate({ body: c.registerSchema }), h(c.register));
r.post('/login', authLimiter, validate({ body: c.loginSchema }), h(c.login));
r.get('/me', requireAuth, h(c.me));
r.patch('/me', requireAuth, validate({ body: c.updateMeSchema }), h(c.updateMe));
r.post('/change-password', requireAuth, validate({ body: c.changePasswordSchema }), h(c.changePassword));
export default r;

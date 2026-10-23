import { Router } from 'express';
import { asyncHandler as h } from '../utils/asyncHandler';
import { MANAGERS, requireRole } from '../middleware/rbac';
import { idParam, validate } from '../middleware/validate';
import * as c from '../controllers/suppliers';

export const suppliers = Router();
suppliers.get('/', h(c.listSuppliers));
suppliers.get('/:id', validate(idParam), h(c.getSupplier));
suppliers.post('/', requireRole('admin', 'supplier'), validate({ body: c.createSupplierSchema }), h(c.createSupplier));
suppliers.patch('/:id', requireRole('admin'), validate({ ...idParam, body: c.updateSupplierSchema }), h(c.updateSupplier));
suppliers.post('/:id/disruption', requireRole(...MANAGERS), validate({ ...idParam, body: c.disruptionSchema }), h(c.declareDisruption));
suppliers.delete('/:id/disruption', requireRole(...MANAGERS), validate(idParam), h(c.clearDisruption));

export const offers = Router();
const offerWriters = requireRole('admin', 'warehouse_manager', 'supplier');
offers.get('/', validate({ query: c.listOffersQuery }), h(c.listOffers));
offers.post('/', offerWriters, validate({ body: c.createOfferSchema }), h(c.createOffer));
offers.patch('/:id', offerWriters, validate({ ...idParam, body: c.updateOfferSchema }), h(c.updateOffer));
offers.delete('/:id', offerWriters, validate(idParam), h(c.deleteOffer));

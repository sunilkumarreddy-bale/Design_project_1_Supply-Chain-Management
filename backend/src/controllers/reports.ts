import { Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from '../utils/apiError';
import { currentUser } from '../middleware/auth';
import { objectId } from '../middleware/validate';
import * as reports from '../services/reports';
import { sendFile, today } from './helpers';

export const reportQuery = z.object({
  warehouse: objectId.optional(),
  status: z.string().regex(/^[a-z_,]+$/).optional(),
  supplier: objectId.optional(),
});

const CSV = 'text/csv; charset=utf-8';
const PDF = 'application/pdf';

function poFilter(q: z.infer<typeof reportQuery>) {
  const f: Record<string, unknown> = {};
  if (q.warehouse) f.warehouse = q.warehouse;
  if (q.status) f.status = q.status.includes(',') ? { $in: q.status.split(',') } : q.status;
  if (q.supplier) f.supplier = q.supplier;
  return f;
}

export async function stockCsv(req: Request, res: Response) {
  sendFile(res, await reports.stockCsv((req.query as z.infer<typeof reportQuery>).warehouse), `stock-${today()}.csv`, CSV);
}
export async function purchaseOrdersCsv(req: Request, res: Response) {
  sendFile(res, await reports.purchaseOrdersCsv(poFilter(req.query as z.infer<typeof reportQuery>)), `purchase-orders-${today()}.csv`, CSV);
}
export async function suppliersCsv(_req: Request, res: Response) {
  sendFile(res, await reports.suppliersCsv(), `suppliers-${today()}.csv`, CSV);
}
export async function expiryCsv(req: Request, res: Response) {
  sendFile(res, await reports.expiryCsv((req.query as z.infer<typeof reportQuery>).warehouse), `expiry-${today()}.csv`, CSV);
}
export async function stockPdf(req: Request, res: Response) {
  sendFile(res, await reports.stockPdf((req.query as z.infer<typeof reportQuery>).warehouse), `stock-${today()}.pdf`, PDF);
}
export async function purchaseOrdersPdf(req: Request, res: Response) {
  sendFile(res, await reports.purchaseOrdersPdf(poFilter(req.query as z.infer<typeof reportQuery>)), `purchase-orders-${today()}.pdf`, PDF);
}

/** Suppliers may only download their own scorecard. */
export async function supplierScorecardPdf(req: Request, res: Response) {
  const user = currentUser(req);
  let supplier = (req.query as z.infer<typeof reportQuery>).supplier ?? null;
  if (user.role === 'supplier') {
    if (supplier && supplier !== user.supplier) throw ApiError.forbidden('Suppliers can only download their own scorecard');
    supplier = user.supplier;
  }
  sendFile(res, await reports.supplierScorecardPdf(supplier), `supplier-scorecard-${today()}.pdf`, PDF);
}

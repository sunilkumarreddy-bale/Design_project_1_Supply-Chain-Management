import { Request, Response } from 'express';
import { z } from 'zod';
import { Transfer } from '../models';
import { ApiError } from '../utils/apiError';
import { currentUser } from '../middleware/auth';
import { approveTransfer, cancelTransfer, dispatchTransfer, receiveTransfer, rejectTransfer } from '../services/transfers';

export const reasonSchema = z.object({ reason: z.string().trim().min(1, 'is required').max(500) });
export const receiveTransferSchema = z.object({ bin: z.string().trim().max(60).optional().nullable() });

export async function getTransfer(req: Request, res: Response) {
  const t = await Transfer.findById(req.params.id)
    .populate('product', 'sku name unit')
    .populate('fromWarehouse', 'code name')
    .populate('toWarehouse', 'code name')
    .populate('initiatedBy', 'name')
    .populate('approvedBy', 'name')
    .populate('receivedBy', 'name')
    .lean();
  if (!t) throw ApiError.notFound('Transfer not found');
  res.json(t);
}

export async function approve(req: Request, res: Response) {
  res.json(await approveTransfer(req.params.id, currentUser(req)));
}

export async function reject(req: Request, res: Response) {
  res.json(await rejectTransfer(req.params.id, (req.body as z.infer<typeof reasonSchema>).reason, currentUser(req)));
}

export async function dispatch(req: Request, res: Response) {
  res.json(await dispatchTransfer(req.params.id, currentUser(req)));
}

export async function receive(req: Request, res: Response) {
  res.json(await receiveTransfer(req.params.id, currentUser(req), (req.body as z.infer<typeof receiveTransferSchema>).bin));
}

export async function cancel(req: Request, res: Response) {
  res.json(await cancelTransfer(req.params.id, currentUser(req)));
}

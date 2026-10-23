import { Request, Response } from 'express';
import { z } from 'zod';
import { getMapsDriver, leadDaysFromKm } from '../integrations/maps';

const point = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });
export const geocodeSchema = z.object({ address: z.string().trim().min(2, 'is required').max(300) });
export const distanceSchema = z.object({ origin: point, destination: point });

export async function geocode(req: Request, res: Response) {
  const r = await getMapsDriver().geocode((req.body as z.infer<typeof geocodeSchema>).address);
  res.json(r);
}

export async function distance(req: Request, res: Response) {
  const b = req.body as z.infer<typeof distanceSchema>;
  const r = await getMapsDriver().distance(b.origin, b.destination);
  res.json({ ...r, transferLeadDays: leadDaysFromKm(r.distanceKm) });
}

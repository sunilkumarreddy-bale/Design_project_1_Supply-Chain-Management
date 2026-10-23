/** Transfer routes between warehouses: stored routes, or estimates from Maps distance at 400 km/day. */
import { TransferRoute, Warehouse } from '../models';
import { getMapsDriver, leadDaysFromKm } from '../integrations/maps';
import { idStr } from '../utils/ids';
import { ApiError } from '../utils/apiError';

/** Default transport cost for an estimated route: Rs 1 per unit per 100 km, at least Rs 1 per unit. */
export function defaultCostPerUnit(km: number): number {
  return Math.max(1, Math.round((km / 100) * 100) / 100);
}

export interface ResolvedRoute {
  fromWarehouse: string;
  toWarehouse: string;
  leadTimeDays: number;
  costPerUnit: number;
  distanceKm: number | null;
  estimated: boolean;
  stored: boolean;
}

export async function estimateBetween(fromId: unknown, toId: unknown) {
  const [from, to] = await Promise.all([Warehouse.findById(idStr(fromId)).lean(), Warehouse.findById(idStr(toId)).lean()]);
  if (!from || !to) throw ApiError.notFound('Warehouse not found');
  const maps = getMapsDriver();
  const loc = async (w: typeof from) => {
    if (w.location?.lat !== undefined && w.location?.lat !== null && w.location?.lng !== undefined && w.location?.lng !== null) {
      return { lat: w.location.lat, lng: w.location.lng };
    }
    const g = await maps.geocode([w.address, w.city].filter(Boolean).join(', ') || w.name);
    return { lat: g.lat, lng: g.lng };
  };
  const d = await maps.distance(await loc(from), await loc(to));
  return {
    distanceKm: d.distanceKm,
    leadTimeDays: leadDaysFromKm(d.distanceKm),
    costPerUnit: defaultCostPerUnit(d.distanceKm),
    driver: d.driver,
  };
}

/** The stored route, or an estimate (not saved) when none exists. Returns null if no estimate is possible. */
export async function resolveRoute(fromId: unknown, toId: unknown): Promise<ResolvedRoute | null> {
  const from = idStr(fromId)!;
  const to = idStr(toId)!;
  const stored = await TransferRoute.findOne({ fromWarehouse: from, toWarehouse: to }).lean();
  if (stored) {
    return {
      fromWarehouse: from,
      toWarehouse: to,
      leadTimeDays: stored.leadTimeDays,
      costPerUnit: stored.costPerUnit,
      distanceKm: stored.distanceKm ?? null,
      estimated: !!stored.estimated,
      stored: true,
    };
  }
  try {
    const e = await estimateBetween(from, to);
    return { fromWarehouse: from, toWarehouse: to, ...e, estimated: true, stored: false };
  } catch {
    return null;
  }
}

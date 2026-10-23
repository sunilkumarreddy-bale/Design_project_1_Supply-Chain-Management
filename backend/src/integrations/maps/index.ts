import { env } from '../../config/env';
import { googleMapsDriver } from './googleDriver';
import { mockMapsDriver } from './mockDriver';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeResult extends LatLng {
  formattedAddress: string;
  driver: string;
}

export interface DistanceResult {
  distanceKm: number;
  durationHours: number;
  driver: string;
}

export interface MapsDriver {
  name: string;
  geocode(address: string): Promise<GeocodeResult>;
  distance(origin: LatLng, destination: LatLng): Promise<DistanceResult>;
}

export function getMapsDriver(): MapsDriver {
  return env.googleMapsApiKey ? googleMapsDriver : mockMapsDriver;
}

/** Road distance / 400 km per day, rounded up to whole days, minimum 1 (3.3 transfer lead-time estimate). */
export const KM_PER_DAY = 400;
export function leadDaysFromKm(km: number): number {
  return Math.max(1, Math.ceil(km / KM_PER_DAY));
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

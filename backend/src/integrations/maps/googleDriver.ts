import { env } from '../../config/env';
import { httpJson } from '../http';
import type { MapsDriver } from './index';

interface GeocodeResponse {
  status: string;
  error_message?: string;
  results: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[];
}

interface DistanceResponse {
  status: string;
  error_message?: string;
  rows: { elements: { status: string; distance?: { value: number }; duration?: { value: number } }[] }[];
}

export const googleMapsDriver: MapsDriver = {
  name: 'google',
  async geocode(address) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${env.googleMapsApiKey}`;
    const r = await httpJson<GeocodeResponse>(url);
    if (r.status !== 'OK' || !r.results.length) throw new Error(`Geocoding failed: ${r.status} ${r.error_message ?? ''}`.trim());
    const top = r.results[0];
    return { ...top.geometry.location, formattedAddress: top.formatted_address, driver: 'google' };
  },
  async distance(origin, destination) {
    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}` +
      `&destinations=${destination.lat},${destination.lng}&key=${env.googleMapsApiKey}`;
    const r = await httpJson<DistanceResponse>(url);
    const el = r.rows?.[0]?.elements?.[0];
    if (r.status !== 'OK' || !el || el.status !== 'OK' || !el.distance) {
      throw new Error(`Distance lookup failed: ${r.status} ${el?.status ?? ''} ${r.error_message ?? ''}`.trim());
    }
    return {
      distanceKm: Math.round(el.distance.value / 100) / 10,
      durationHours: Math.round(((el.duration?.value ?? 0) / 3600) * 10) / 10,
      driver: 'google',
    };
  },
};

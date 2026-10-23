import { createHash } from 'crypto';
import { mockOutbox } from '../outbox';
import { haversineKm, MapsDriver } from './index';

/** Known city centres so the mock geocoder returns realistic coordinates for the demo data. */
const CITIES: Record<string, [number, number]> = {
  bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946],
  chennai: [13.0827, 80.2707],
  kolkata: [22.5726, 88.3639],
  mumbai: [19.076, 72.8777],
  delhi: [28.6139, 77.209],
  'new delhi': [28.6139, 77.209],
  hyderabad: [17.385, 78.4867],
  pune: [18.5204, 73.8567],
  ahmedabad: [23.0225, 72.5714],
  jaipur: [26.9124, 75.7873],
  kochi: [9.9312, 76.2673],
  lucknow: [26.8467, 80.9462],
};

/** Deterministic mock: known cities resolve to their centre, anything else to a stable point inside India. */
export const mockMapsDriver: MapsDriver = {
  name: 'mock',
  async geocode(address) {
    const lower = address.toLowerCase();
    const city = Object.keys(CITIES).find((c) => lower.includes(c));
    let lat: number;
    let lng: number;
    if (city) {
      [lat, lng] = CITIES[city];
    } else {
      const h = createHash('sha256').update(lower.trim()).digest();
      lat = 8 + (h.readUInt16BE(0) / 65535) * 20;
      lng = 70 + (h.readUInt16BE(2) / 65535) * 18;
    }
    const r = { lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4 };
    mockOutbox.push({ channel: 'maps', driver: 'mock', payload: { op: 'geocode', address, ...r } });
    return { ...r, formattedAddress: address, driver: 'mock' };
  },
  async distance(origin, destination) {
    const km = Math.round(haversineKm(origin, destination) * 1.25 * 10) / 10;
    mockOutbox.push({ channel: 'maps', driver: 'mock', payload: { op: 'distance', origin, destination, km } });
    return { distanceKm: km, durationHours: Math.round((km / 50) * 10) / 10, driver: 'mock' };
  },
};

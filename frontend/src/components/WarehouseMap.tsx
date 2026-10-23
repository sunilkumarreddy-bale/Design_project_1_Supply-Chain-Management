import { useEffect, useRef, useState } from 'react';
import type { Warehouse } from '../types';

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;

declare global {
  interface Window {
    google?: any;
    __sisMapsLoading?: Promise<void>;
  }
}

function loadGoogle(): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (window.__sisMapsLoading) return window.__sisMapsLoading;
  window.__sisMapsLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY!)}`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(s);
  });
  return window.__sisMapsLoading;
}

/** Schematic map of India used when no Google Maps key is configured. */
function SchematicMap({ warehouses }: { warehouses: Warehouse[] }) {
  const W = 600;
  const H = 320;
  const x = (lng: number) => ((lng - 68) / 30) * W;
  const y = (lat: number) => H - ((lat - 6) / 31) * H;
  const located = warehouses.filter((w) => w.location);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="map-box" role="img" aria-label="Warehouse locations (schematic)">
      <rect width={W} height={H} fill="#eef2f6" />
      {[10, 15, 20, 25, 30].map((lat) => (
        <g key={lat}>
          <line x1={0} x2={W} y1={y(lat)} y2={y(lat)} stroke="#d7dde6" />
          <text x={4} y={y(lat) - 2} fontSize={9} fill="#8b95a5">
            {lat}°N
          </text>
        </g>
      ))}
      {[70, 75, 80, 85, 90, 95].map((lng) => (
        <g key={lng}>
          <line y1={0} y2={H} x1={x(lng)} x2={x(lng)} stroke="#d7dde6" />
          <text x={x(lng) + 2} y={H - 4} fontSize={9} fill="#8b95a5">
            {lng}°E
          </text>
        </g>
      ))}
      {located.map((w) => (
        <g key={w._id} transform={`translate(${x(w.location!.lng)},${y(w.location!.lat)})`}>
          <circle r={7} fill={w.isActive ? '#8c1d2f' : '#9aa1ab'} stroke="#fff" strokeWidth={2} />
          <text x={10} y={4} fontSize={12} fontWeight={700} fill="#26365b">
            {w.code}
          </text>
          <text x={10} y={17} fontSize={10} fill="#646b78">
            {w.city}
          </text>
        </g>
      ))}
      {located.length === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fill="#646b78">
          No warehouse has a location yet
        </text>
      )}
    </svg>
  );
}

export default function WarehouseMap({ warehouses }: { warehouses: Warehouse[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!KEY || failed || !ref.current) return;
    let cancelled = false;
    loadGoogle()
      .then(() => {
        if (cancelled || !ref.current) return;
        const g = window.google;
        const located = warehouses.filter((w) => w.location);
        const map = new g.maps.Map(ref.current, { center: { lat: 20.5, lng: 79 }, zoom: 4.3, mapTypeControl: false, streetViewControl: false });
        const bounds = new g.maps.LatLngBounds();
        for (const w of located) {
          const pos = { lat: w.location!.lat, lng: w.location!.lng };
          const marker = new g.maps.Marker({ position: pos, map, title: `${w.code} · ${w.name}`, label: w.code.replace('WH-', '').slice(0, 1) });
          const info = new g.maps.InfoWindow({ content: `<strong>${w.code}</strong><br/>${w.name}<br/>${w.city}` });
          marker.addListener('click', () => info.open({ map, anchor: marker }));
          bounds.extend(pos);
        }
        if (located.length > 1) map.fitBounds(bounds);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [warehouses, failed]);

  if (!KEY || failed) {
    return (
      <>
        <SchematicMap warehouses={warehouses} />
        <p className="muted small">{failed ? 'Google Maps could not load; showing the schematic map.' : 'Set VITE_GOOGLE_MAPS_KEY to show Google Maps. Showing a schematic map.'}</p>
      </>
    );
  }
  return <div ref={ref} className="map-box" role="region" aria-label="Warehouse map" />;
}

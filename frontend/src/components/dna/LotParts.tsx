import { Link } from 'react-router-dom';
import Badge from '../Badge';
import type { LotStatus, StockLot } from '../../types';
import { humanize, pct } from '../../utils/format';

export const DEAD: LotStatus[] = ['depleted', 'expired_disposed', 'written_off', 'recalled_destroyed', 'returned_to_supplier'];
export const isDeadLot = (s: LotStatus) => DEAD.includes(s);

/** Status badge plus a red "Recalled" tag while the lot is alive and recalled. */
export function LotStatusBadge({ lot }: { lot: Pick<StockLot, 'status' | 'flags'> }) {
  return (
    <span className="badge-row">
      <Badge status={lot.status} title={isDeadLot(lot.status) ? 'Dead: the DNA is sealed' : 'Alive'} />
      {lot.flags?.recalled && !isDeadLot(lot.status) && <Badge status="recalled">Recalled</Badge>}
      {lot.flags?.backfilled && <Badge tone="default" title="True birth not recorded">Backfilled</Badge>}
    </span>
  );
}

export function DnaCodeLink({ id, code }: { id: string; code: string }) {
  return (
    <Link to={`/dna/${id}`} className="mono">
      {code}
    </Link>
  );
}

/** A horizontal bar with a label, a share used (0..1) and the text for what is left. */
export function LifeBar({ label, used, left, tone }: { label: string; used: number | null; left: string; tone?: 'time' | 'qty' }) {
  const v = used === null ? null : Math.min(1, Math.max(0, used));
  const warn = v !== null && v >= 0.85;
  return (
    <div className="life-bar">
      <div className="life-bar-head">
        <span>{label}</span>
        <strong>{v === null ? 'unknown' : pct(v, 0)}</strong>
      </div>
      <div
        className={`life-bar-track${tone === 'qty' ? ' life-bar-qty' : ''}${warn ? ' life-bar-warn' : ''}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v === null ? undefined : Math.round(v * 100)}
      >
        <div className="life-bar-fill" style={{ width: `${v === null ? 0 : v * 100}%` }} />
      </div>
      <div className="muted small">{left}</div>
    </div>
  );
}

/** Small inline bar for tables. */
export function MiniBar({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  const v = Math.min(1, Math.max(0, value));
  return (
    <span className="mini-bar" title={pct(v, 0)}>
      <span className={`mini-bar-fill${v >= 0.85 ? ' mini-bar-warn' : ''}`} style={{ width: `${v * 100}%` }} />
      <span className="sr-only">{pct(v, 0)}</span>
    </span>
  );
}

/** Where a gene's reference points to in the app. */
export function refPath(refType: string | null, refId: string | null): string | null {
  if (!refType || !refId) return null;
  switch (refType) {
    case 'purchase_order':
      return `/purchase-orders?highlight=${refId}`;
    case 'transfer':
      return `/transfers?highlight=${refId}`;
    case 'customer_order':
      return `/orders?highlight=${refId}`;
    case 'recovery_plan':
      return `/recovery/${refId}`;
    case 'redistribution_plan':
      return `/redistribution?plan=${refId}`;
    case 'stock_count':
      return `/counts?highlight=${refId}`;
    default:
      return null;
  }
}

export function RefLink({ refType, refId }: { refType: string | null; refId: string | null }) {
  const to = refPath(refType, refId);
  if (!refType) return null;
  if (!to) return <span className="muted small">{humanize(refType)}</span>;
  return (
    <Link to={to} className="small">
      {humanize(refType)} ›
    </Link>
  );
}

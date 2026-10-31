import type { ReactNode } from 'react';
import { humanize } from '../utils/format';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'default' | 'maroon' | 'navy';

const TONES: Record<string, Tone> = {
  completed: 'success',
  received: 'success',
  approved: 'success',
  active: 'success',
  ok: 'success',
  on_time: 'success',
  resolved: 'success',
  sent: 'success',
  reconciled: 'success',
  confirmed: 'success',
  fulfilled: 'success',
  history: 'success',
  pending_approval: 'warning',
  partially_received: 'warning',
  in_transit: 'info',
  proposed: 'warning',
  warning: 'warning',
  at_risk: 'warning',
  submitted: 'warning',
  draft: 'default',
  reorder: 'warning',
  blended: 'warning',
  disrupted: 'danger',
  rejected: 'danger',
  cancelled: 'default',
  failed: 'danger',
  critical: 'danger',
  late: 'danger',
  inactive: 'default',
  expired: 'danger',
  overstock: 'info',
  dispatched: 'info',
  in_progress: 'info',
  info: 'info',
  open: 'info',
  override: 'navy',
  nominal: 'default',
  fallback: 'default',
  default: 'default',
  no_demand: 'default',
  quarantine: 'warning',
  depleted: 'default',
  expired_disposed: 'danger',
  written_off: 'danger',
  recalled_destroyed: 'danger',
  returned_to_supplier: 'default',
  recalled: 'danger',
  pending: 'warning',
};

export function toneFor(status: string | null | undefined): Tone {
  return (status && TONES[status]) || 'default';
}

export default function Badge({ status, tone, children, title }: { status?: string | null; tone?: Tone; children?: ReactNode; title?: string }) {
  const t = tone ?? toneFor(status);
  return (
    <span className={`badge badge-${t}`} title={title}>
      {children ?? humanize(status ?? '')}
    </span>
  );
}

/** ABC class chip: A maroon, B navy, C grey. */
export function ClassChip({ value, title }: { value: string; title?: string }) {
  const abc = value.charAt(0);
  const tone: Tone = abc === 'A' ? 'maroon' : abc === 'B' ? 'navy' : 'default';
  return (
    <span className={`chip chip-${tone}`} title={title} tabIndex={title ? 0 : undefined}>
      {value}
    </span>
  );
}

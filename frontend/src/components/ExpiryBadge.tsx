import { daysUntil, date } from '../utils/format';
import Badge from './Badge';

/** Expiry date coloured by days left: red <= 3 (or expired), amber <= 14, green otherwise. */
export default function ExpiryBadge({ expiry }: { expiry: string | null }) {
  if (!expiry) return <span className="muted">—</span>;
  const d = daysUntil(expiry)!;
  const tone = d <= 3 ? 'danger' : d <= 14 ? 'warning' : 'success';
  return (
    <span className="nowrap">
      {date(expiry)}{' '}
      <Badge tone={tone} title={`${d} day(s) left`}>
        {d < 0 ? `expired ${-d}d ago` : `${d}d left`}
      </Badge>
    </span>
  );
}

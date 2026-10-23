import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export default function StatCard({
  label,
  value,
  hint,
  tone,
  to,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'warning' | 'danger' | 'success';
  to?: string;
  loading?: boolean;
}) {
  const body = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{loading ? <span className="skeleton-line" style={{ width: '60%' }} /> : value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </>
  );
  return to ? (
    <Link to={to} className={`card stat-card${tone ? ` stat-${tone}` : ''}`}>
      {body}
    </Link>
  ) : (
    <div className={`card stat-card${tone ? ` stat-${tone}` : ''}`}>{body}</div>
  );
}

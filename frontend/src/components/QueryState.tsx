import type { ReactNode } from 'react';
import { errorMessage } from '../api/client';
import Banner from './Banner';
import EmptyState from './EmptyState';

/** Standard loading skeleton / error banner with Retry / empty message around any fetched content. */
export default function QueryState({
  loading,
  error,
  onRetry,
  isEmpty,
  empty,
  children,
  lines = 3,
}: {
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isEmpty?: boolean;
  empty?: ReactNode;
  children?: ReactNode;
  lines?: number;
}) {
  if (loading) {
    return (
      <div className="skeleton-block" aria-busy="true" aria-label="Loading">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="skeleton-line" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <Banner tone="error" onRetry={onRetry}>
        {errorMessage(error)}
      </Banner>
    );
  }
  if (isEmpty) return <>{typeof empty === 'string' || !empty ? <EmptyState title={(empty as string) ?? 'Nothing to show'} /> : empty}</>;
  return <>{children}</>;
}

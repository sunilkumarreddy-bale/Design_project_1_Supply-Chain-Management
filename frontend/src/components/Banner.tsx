import type { ReactNode } from 'react';

export default function Banner({
  tone,
  children,
  onRetry,
  onClose,
}: {
  tone: 'error' | 'success' | 'info' | 'warning';
  children: ReactNode;
  onRetry?: () => void;
  onClose?: () => void;
}) {
  if (!children) return null;
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="banner-body">{children}</div>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry}>
          Retry
        </button>
      )}
      {onClose && (
        <button type="button" className="btn btn-sm btn-ghost" aria-label="Dismiss" onClick={onClose}>
          ✕
        </button>
      )}
    </div>
  );
}

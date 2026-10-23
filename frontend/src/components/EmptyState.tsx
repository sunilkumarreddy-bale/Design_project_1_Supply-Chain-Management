import type { ReactNode } from 'react';

export default function EmptyState({ title = 'Nothing here yet', children, icon = '○' }: { title?: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

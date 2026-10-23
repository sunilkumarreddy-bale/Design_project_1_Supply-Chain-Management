import { useExecuteRebalanceMutation } from '../api/insights';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import type { RebalanceSuggestion } from '../types';
import { number } from '../utils/format';
import EmptyState from './EmptyState';

/** F4 "rebalance before you buy" suggestions, each with an Execute transfer button. */
export default function RebalanceList({ items, loading }: { items: RebalanceSuggestion[] | undefined; loading?: boolean }) {
  const [execute] = useExecuteRebalanceMutation();
  const { busy, run } = useAction();
  const { canWrite } = useAuth();
  if (loading) return <div className="skeleton-line" />;
  if (!items?.length) return <EmptyState title="No rebalancing needed" icon="⇄">Every warehouse is above its reorder point or no other warehouse has surplus.</EmptyState>;
  return (
    <ul className="rebalance-list">
      {items.map((s) => {
        const key = `${s.product._id}-${s.from._id}-${s.to._id}`;
        const allowed = canWrite(s.from._id) || canWrite(s.to._id);
        const instant = canWrite(s.from._id);
        return (
          <li key={key} className="rebalance-item">
            <div>
              <strong>
                {s.product.sku} {s.product.name}
              </strong>
              <div>
                Move <strong>{number(s.quantity, 0)}</strong> from {s.from.name} → {s.to.name}
              </div>
              <div className="muted small">{s.explanation}</div>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!allowed || busy === key}
              title={allowed ? (instant ? 'Moves the stock now' : 'Requests a tracked transfer for approval') : 'You can only move stock into or out of your own warehouse'}
              onClick={() =>
                run(key, () => execute({ product: s.product._id, from: s.from._id, to: s.to._id, quantity: s.quantity }).unwrap(), (r) =>
                  r.mode === 'instant' ? `Moved ${s.quantity} ${s.product.sku} to ${s.to.name}` : 'Transfer requested; it needs admin approval',
                )
              }
            >
              {busy === key ? 'Saving...' : 'Execute transfer'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

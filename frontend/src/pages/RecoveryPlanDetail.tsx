import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useRecoveryActionMutation, useRecoveryPlanQuery } from '../api/modules';
import Badge from '../components/Badge';
import ConfirmDialog from '../components/ConfirmDialog';
import OptionCard from '../components/OptionCard';
import QueryState from '../components/QueryState';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import { dateTime, humanize, number } from '../utils/format';

export default function RecoveryPlanDetail() {
  const { id = '' } = useParams();
  const { is } = useAuth();
  const q = useRecoveryPlanQuery(id);
  const [act] = useRecoveryActionMutation();
  const { busy, run } = useAction();
  const [rejecting, setRejecting] = useState(false);
  const p = q.data;
  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/recovery" className="small">
            ← Recovery
          </Link>
          <h1>
            {p?.planNo ?? 'Recovery plan'} {p && <Badge status={p.status} />}
          </h1>
          {p && (
            <p>
              {p.product.sku} {p.product.name} for {p.targetWarehouse.name} · trigger {humanize(p.trigger.kind)}
              {p.trigger.supplier && typeof p.trigger.supplier === 'object' ? ` (${p.trigger.supplier.name})` : ''}
            </p>
          )}
        </div>
        {p?.status === 'proposed' && (
          <div className="btn-group">
            {is('admin') && (
              <>
                <button type="button" className="btn btn-primary" disabled={busy === 'approve'} onClick={() => run('approve', () => act({ id, action: 'approve' }).unwrap(), 'Plan approved: transfers and purchase orders created')}>
                  {busy === 'approve' ? 'Saving...' : 'Approve'}
                </button>
                <button type="button" className="btn" onClick={() => setRejecting(true)}>
                  Reject
                </button>
              </>
            )}
            <button type="button" className="btn" disabled={busy === 'cancel'} onClick={() => run('cancel', () => act({ id, action: 'cancel' }).unwrap(), 'Plan cancelled')}>
              {busy === 'cancel' ? 'Saving...' : 'Cancel'}
            </button>
          </div>
        )}
      </div>
      <QueryState loading={q.isLoading} error={q.error} onRetry={q.refetch} lines={6}>
        {p && (
          <div className="grid grid-2">
            <div>
              {p.selectedOption && <OptionCard option={p.selectedOption} />}
              <div className="card mt">
                <h2>Context when proposed</h2>
                <dl className="kv">
                  <dt>On-hand</dt>
                  <dd>{number(p.context.onHand, 0)}</dd>
                  <dt>Inbound in horizon</dt>
                  <dd>{number(p.context.inboundWithinHorizon, 0)}</dd>
                  <dt>Demand / day</dt>
                  <dd>{number(p.context.dailyDemand)}</dd>
                  <dt>Minimum stock</dt>
                  <dd>{number(p.context.minStock, 0)}</dd>
                  <dt>Horizon</dt>
                  <dd>{p.context.horizonDays} days</dd>
                  <dt>Required units</dt>
                  <dd>{number(p.context.requiredUnits, 0)}</dd>
                  <dt>As of</dt>
                  <dd>{dateTime(p.context.asOf)}</dd>
                </dl>
                {p.rejectedReason && <p className="error-text">Rejected: {p.rejectedReason}</p>}
              </div>
            </div>
            <div>
              <div className="card">
                <h2>Execution</h2>
                {!p.transfers?.length && !p.purchaseOrders?.length ? (
                  <p className="muted">Steps are created when an admin approves the plan.</p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>Detail</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {p.transfers?.map((t) => (
                        <tr key={t._id}>
                          <td>Transfer</td>
                          <td>
                            {t.quantity} from {t.fromWarehouse.name}
                          </td>
                          <td>
                            <Badge status={t.status} />
                          </td>
                          <td>
                            <Link to="/transfers">Open transfers</Link>
                          </td>
                        </tr>
                      ))}
                      {p.purchaseOrders?.map((po) => (
                        <tr key={po._id}>
                          <td>Purchase</td>
                          <td>
                            {po.poNumber} · {po.items.map((i) => i.quantityOrdered).join('+')} from {po.supplier.name}
                          </td>
                          <td>
                            <Badge status={po.status} />
                          </td>
                          <td>
                            <Link to={`/purchase-orders?focus=${po._id}`}>Open PO</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card mt">
                <h2>Timeline</h2>
                <ol className="timeline">
                  {p.timeline?.map((t, i) => (
                    <li key={i}>
                      <strong>{humanize(t.event)}</strong> <span className="muted small">{dateTime(t.at)}{t.by && typeof t.by === 'object' ? ` · ${t.by.name}` : ''}</span>
                      <div className="small">{t.detail}</div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        )}
      </QueryState>
      <ConfirmDialog open={rejecting} title="Reject recovery plan" requireReason confirmLabel="Reject" danger onConfirm={(reason) => act({ id, action: 'reject', reason }).unwrap()} onClose={() => setRejecting(false)} />
    </>
  );
}

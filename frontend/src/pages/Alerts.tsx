import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAlertsQuery, useResolveAlertMutation, useSweepExpiryMutation } from '../api/insights';
import { useAppSelector } from '../app/store';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import Pager from '../components/Pager';
import { WarehouseSelect } from '../components/Selects';
import { Chips } from '../components/Tabs';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import type { Alert, AlertType } from '../types';
import { dateTime, humanize } from '../utils/format';

const TYPES: AlertType[] = [
  'low_stock',
  'overstock',
  'expiry',
  'po_pending_approval',
  'po_overdue',
  'supplier_disruption',
  'recovery_proposed',
  'redistribution_proposed',
  'count_variance',
  'discrepancy',
];

function linkFor(a: Alert): { to: string; label: string } | null {
  if (a.type === 'recovery_proposed' && a.plan) return { to: `/recovery/${a.plan}`, label: 'Open plan' };
  if (a.type === 'redistribution_proposed' && a.plan) return { to: `/redistribution?plan=${a.plan}`, label: 'Open plan' };
  if (a.purchaseOrder) return { to: `/purchase-orders?focus=${a.purchaseOrder._id}`, label: a.purchaseOrder.poNumber };
  if (a.type === 'supplier_disruption' && a.supplier) return { to: `/recovery?supplier=${a.supplier._id}`, label: 'Run recovery' };
  if (a.type === 'expiry' && a.product) return { to: '/redistribution', label: 'Redistribute' };
  if (a.type === 'count_variance') return { to: '/counts', label: 'Cycle counts' };
  if (a.product) return { to: `/stock?product=${a.product._id}`, label: a.product.sku };
  return null;
}

export default function Alerts() {
  const { is } = useAuth();
  const selected = useAppSelector((s) => s.auth.selectedWarehouse);
  const [open, setOpen] = useState<'open' | 'resolved'>('open');
  const [type, setType] = useState('');
  const [warehouse, setWarehouse] = useState(selected);
  const [page, setPage] = useState(1);
  const list = useAlertsQuery({ resolved: open === 'open' ? 'false' : 'true', type: type || undefined, warehouse: warehouse || undefined, page, limit: 50 });
  const [resolve] = useResolveAlertMutation();
  const [sweep, sweepState] = useSweepExpiryMutation();
  const { busy, run } = useAction();
  const canResolve = is('admin', 'warehouse_manager');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Alerts</h1>
          <p>Raised automatically from stock, expiry, purchase orders, disruptions and plans. New alerts appear live.</p>
        </div>
        {canResolve && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={sweepState.isLoading}
            onClick={() => run('sweep', () => sweep({ warehouse: warehouse || undefined }).unwrap(), (r) => `Expiry sweep: ${r.expiry.created} new, ${r.expiry.updated} updated, ${r.expiry.resolved} resolved; ${r.overdue.overdue} overdue PO(s)`)}
          >
            {sweepState.isLoading ? 'Running...' : 'Run expiry sweep'}
          </button>
        )}
      </div>
      <div className="card">
        <div className="filters">
          <Chips label="Open or resolved" items={[{ id: 'open', label: 'Open' }, { id: 'resolved', label: 'Resolved' }]} value={open} onChange={(v) => { setOpen(v); setPage(1); }} />
          <div className="field">
            <label htmlFor="al-type">Type</label>
            <select id="al-type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="al-wh">Warehouse</label>
            <WarehouseSelect id="al-wh" placeholder="All warehouses" value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setPage(1); }} />
          </div>
        </div>
        <DataTable<Alert>
          rows={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(a) => a._id}
          empty={open === 'open' ? 'No open alerts' : 'No resolved alerts'}
          columns={[
            { key: 'sev', header: 'Severity', render: (a) => <Badge status={a.severity} />, sortValue: (a) => ({ critical: 0, warning: 1, info: 2 })[a.severity] },
            { key: 'type', header: 'Type', render: (a) => humanize(a.type), sortValue: (a) => a.type },
            { key: 'msg', header: 'Message', render: (a) => a.message },
            { key: 'wh', header: 'Warehouse', render: (a) => a.warehouse?.code ?? '—' },
            { key: 'at', header: open === 'open' ? 'Raised' : 'Resolved', render: (a) => dateTime(open === 'open' ? a.createdAt : a.resolvedAt), sortValue: (a) => a.createdAt },
            {
              key: 'link',
              header: 'Related',
              render: (a) => {
                const l = linkFor(a);
                return l ? <Link to={l.to}>{l.label}</Link> : '—';
              },
            },
            {
              key: 'a',
              header: '',
              render: (a) =>
                canResolve && !a.isResolved ? (
                  <button type="button" className="btn btn-sm" disabled={busy === a._id} onClick={() => run(a._id, () => resolve(a._id).unwrap(), 'Alert resolved')}>
                    {busy === a._id ? 'Saving...' : 'Resolve'}
                  </button>
                ) : a.resolvedBy ? (
                  <span className="muted small">by {a.resolvedBy.name}</span>
                ) : null,
            },
          ]}
        />
        {list.data && <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />}
      </div>
    </>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTransferActionMutation, useTransfersQuery } from '../api/inventory';
import Badge from '../components/Badge';
import ConfirmDialog from '../components/ConfirmDialog';
import DataTable from '../components/DataTable';
import Drawer from '../components/Drawer';
import Pager from '../components/Pager';
import { WarehouseSelect } from '../components/Selects';
import { Chips } from '../components/Tabs';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import type { Transfer } from '../types';
import { date, dateTime, humanize, number } from '../utils/format';

type F = 'all' | 'pending_approval' | 'approved' | 'in_transit' | 'completed' | 'rejected' | 'cancelled';
const FILTERS: { id: F; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending_approval', label: 'Pending approval' },
  { id: 'approved', label: 'Approved' },
  { id: 'in_transit', label: 'In transit' },
  { id: 'completed', label: 'Completed' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'cancelled', label: 'Cancelled' },
];

function TransferTimeline({ t }: { t: Transfer }) {
  const steps = [
    { at: t.createdAt, label: `Requested by ${t.initiatedBy?.name ?? 'system'}${t.mode === 'instant' ? ' (instant)' : ''}` },
    t.approvedAt && { at: t.approvedAt, label: `Approved by ${t.approvedBy?.name ?? '—'}` },
    t.dispatchedAt && { at: t.dispatchedAt, label: 'Dispatched from source' },
    t.receivedAt && { at: t.receivedAt, label: `Received by ${t.receivedBy?.name ?? '—'}` },
    t.status === 'rejected' && { at: null, label: `Rejected: ${t.rejectedReason}` },
    t.status === 'cancelled' && { at: null, label: 'Cancelled before dispatch' },
  ].filter(Boolean) as { at: string | null; label: string }[];
  return (
    <>
      <dl className="kv mb">
        <dt>Product</dt>
        <dd>
          {t.product.sku} {t.product.name}
        </dd>
        <dt>Route</dt>
        <dd>
          {t.fromWarehouse.name} → {t.toWarehouse.name}
        </dd>
        <dt>Quantity</dt>
        <dd>{t.quantity}</dd>
        <dt>Status</dt>
        <dd>
          <Badge status={t.status} />
        </dd>
        <dt>Source</dt>
        <dd>
          {humanize(t.source)}
          {t.plan && t.planModel === 'RecoveryPlan' && (
            <>
              {' '}
              · <Link to={`/recovery/${t.plan}`}>open plan</Link>
            </>
          )}
          {t.plan && t.planModel === 'RedistributionPlan' && (
            <>
              {' '}
              · <Link to={`/redistribution?plan=${t.plan}`}>open plan</Link>
            </>
          )}
        </dd>
        {t.notes && (
          <>
            <dt>Notes</dt>
            <dd>{t.notes}</dd>
          </>
        )}
      </dl>
      <h3>Timeline</h3>
      <ol className="timeline">
        {steps.map((s, i) => (
          <li key={i}>
            <strong>{s.label}</strong>
            <div className="muted small">{s.at ? dateTime(s.at) : ''}</div>
          </li>
        ))}
      </ol>
      {t.allocations.length > 0 && (
        <>
          <h3 className="mt">Batches moved (FEFO)</h3>
          <ul className="plain-list">
            {t.allocations.map((a, i) => (
              <li key={i}>
                {a.quantity} × batch {a.batchNo || '(none)'} from bin {a.bin || '—'}
                {a.expiryDate ? `, expires ${date(a.expiryDate)}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export default function Transfers() {
  const { is, canWrite } = useAuth();
  const [status, setStatus] = useState<F>('all');
  const [warehouse, setWarehouse] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Transfer | null>(null);
  const [rejecting, setRejecting] = useState<Transfer | null>(null);
  const list = useTransfersQuery({ status: status === 'all' ? undefined : status, warehouse: warehouse || undefined, page, limit: 50 });
  const [act] = useTransferActionMutation();
  const { busy, run } = useAction();
  const isAdmin = is('admin');
  const isManager = is('admin', 'warehouse_manager');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Transfers</h1>
          <p>Tracked transfers need approval, dispatch at the source and receipt at the destination.</p>
        </div>
        <Link to="/stock" className="btn">
          New transfer
        </Link>
      </div>
      <div className="card">
        <div className="filters">
          <Chips label="Status filter" items={FILTERS} value={status} onChange={(s) => { setStatus(s); setPage(1); }} />
          <div className="field">
            <label htmlFor="tr-wh">Warehouse</label>
            <WarehouseSelect id="tr-wh" placeholder="All warehouses" value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setPage(1); }} />
          </div>
        </div>
        <DataTable<Transfer>
          rows={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(t) => t._id}
          empty="No transfers for this filter"
          columns={[
            { key: 'p', header: 'Product', render: (t) => <strong>{t.product.sku}</strong>, sortValue: (t) => t.product.sku },
            { key: 'from', header: 'From', render: (t) => t.fromWarehouse.code },
            { key: 'to', header: 'To', render: (t) => t.toWarehouse.code },
            { key: 'qty', header: 'Qty', align: 'right', render: (t) => number(t.quantity, 0), sortValue: (t) => t.quantity },
            { key: 'mode', header: 'Mode', render: (t) => humanize(t.mode) },
            { key: 'status', header: 'Status', render: (t) => <Badge status={t.status} />, sortValue: (t) => t.status },
            { key: 'src', header: 'Source', render: (t) => humanize(t.source) },
            { key: 'dates', header: 'Dates', render: (t) => <span className="small">Created {date(t.createdAt)}{t.receivedAt ? ` · received ${date(t.receivedAt)}` : t.dispatchedAt ? ` · sent ${date(t.dispatchedAt)}` : ''}</span>, sortValue: (t) => t.createdAt },
            {
              key: 'a',
              header: 'Actions',
              render: (t) => (
                <div className="btn-group">
                  <button type="button" className="btn btn-sm" onClick={() => setDetail(t)}>
                    Details
                  </button>
                  {isAdmin && t.status === 'pending_approval' && (
                    <>
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy === t._id} onClick={() => run(t._id, () => act({ id: t._id, action: 'approve' }).unwrap(), 'Transfer approved')}>
                        Approve
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setRejecting(t)}>
                        Reject
                      </button>
                    </>
                  )}
                  {t.status === 'approved' && canWrite(t.fromWarehouse._id) && (
                    <button type="button" className="btn btn-sm btn-navy" disabled={busy === t._id} onClick={() => run(t._id, () => act({ id: t._id, action: 'dispatch' }).unwrap(), 'Transfer dispatched')}>
                      {busy === t._id ? 'Saving...' : 'Dispatch'}
                    </button>
                  )}
                  {t.status === 'in_transit' && canWrite(t.toWarehouse._id) && (
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy === t._id} onClick={() => run(t._id, () => act({ id: t._id, action: 'receive' }).unwrap(), 'Transfer received')}>
                      {busy === t._id ? 'Saving...' : 'Receive'}
                    </button>
                  )}
                  {isManager && ['pending_approval', 'approved'].includes(t.status) && (isAdmin || canWrite(t.fromWarehouse._id) || canWrite(t.toWarehouse._id)) && (
                    <button type="button" className="btn btn-sm" disabled={busy === `c-${t._id}`} onClick={() => run(`c-${t._id}`, () => act({ id: t._id, action: 'cancel' }).unwrap(), 'Transfer cancelled')}>
                      Cancel
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
        {list.data && <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />}
      </div>
      <Drawer open={!!detail} title="Transfer details" onClose={() => setDetail(null)}>
        {detail && <TransferTimeline t={list.data?.items.find((x) => x._id === detail._id) ?? detail} />}
      </Drawer>
      <ConfirmDialog
        open={!!rejecting}
        title="Reject transfer"
        requireReason
        confirmLabel="Reject"
        danger
        onConfirm={(reason) => act({ id: rejecting!._id, action: 'reject', reason }).unwrap()}
        onClose={() => setRejecting(null)}
      />
    </>
  );
}

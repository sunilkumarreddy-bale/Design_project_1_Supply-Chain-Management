import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useLazyRecallTraceQuery, useLotFlagMutation } from '../api/dna';
import Banner from '../components/Banner';
import ConfirmDialog from '../components/ConfirmDialog';
import DataTable from '../components/DataTable';
import QueryState from '../components/QueryState';
import { ProductSelect, SupplierSelect } from '../components/Selects';
import StatCard from '../components/StatCard';
import { DnaCodeLink, isDeadLot, LotStatusBadge } from '../components/dna/LotParts';
import { useAuth } from '../hooks/useAuth';
import type { RecallTrace as Trace } from '../types';
import { date, humanize, number } from '../utils/format';

type LotRow = Trace['lots'][number];

function traceCsv(t: Trace): string {
  const rows = [['DNA code', 'Batch', 'Product', 'Status', 'Recalled', 'Born', 'Warehouses reached', 'Orders', 'Dispatched to orders', 'Still alive']];
  for (const l of t.lots) {
    rows.push([
      l.lot.dnaCode,
      l.lot.batchNo,
      l.lot.product?.sku ?? '',
      l.lot.status,
      l.lot.flags.recalled ? 'yes' : 'no',
      String(l.lot.qtyBorn),
      l.forward.warehousesReached.map((w) => `${w.warehouse.code}:${w.qtyReceived}`).join(' '),
      l.forward.orders.map((o) => `${o.orderNo ?? o.refId}:${o.qty}`).join(' '),
      String(l.forward.qtyDispatchedToOrders),
      String(l.forward.qtyStillAlive),
    ]);
  }
  return rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n');
}

export default function RecallTrace() {
  const { is } = useAuth();
  const [supplier, setSupplier] = useState('');
  const [product, setProduct] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [trigger, trace] = useLazyRecallTraceQuery();
  const [flag] = useLotFlagMutation();
  const t = trace.data;

  const runTrace = () => {
    if (!supplier && !product && !batchNo.trim()) return setError('Choose a supplier, a product or a batch number');
    setError('');
    trigger({ supplier: supplier || undefined, product: product || undefined, batchNo: batchNo.trim() || undefined });
  };

  const flagAll = async (reason: string) => {
    const targets = (t?.lots ?? []).filter((l) => !isDeadLot(l.lot.status) && !l.lot.flags.recalled);
    for (const l of targets) await flag({ id: l.lot._id, action: 'recall', reason }).unwrap();
    runTrace();
  };

  const exportCsv = () => {
    if (!t) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([traceCsv(t)], { type: 'text/csv;charset=utf-8' }));
    a.download = `recall-trace-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <p className="small">
            <Link to="/dna">← Stock DNA</Link>
          </p>
          <h1>Recall trace</h1>
          <p>Find every lot of a supplier, product or batch, every warehouse it reached, every customer order it shipped on, and what is still alive.</p>
        </div>
      </div>
      <div className="card">
        <form
          className="filters"
          onSubmit={(e) => {
            e.preventDefault();
            runTrace();
          }}
        >
          <div className="field">
            <label htmlFor="rt-sup">Supplier</label>
            <SupplierSelect id="rt-sup" placeholder="Any supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rt-prod">Product</label>
            <ProductSelect id="rt-prod" placeholder="Any product" value={product} onChange={(e) => setProduct(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="rt-batch">Batch number</label>
            <input id="rt-batch" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="e.g. BOX-RC-01" />
          </div>
          <button type="submit" className="btn btn-primary" disabled={trace.isFetching}>
            {trace.isFetching ? 'Tracing...' : 'Run trace'}
          </button>
        </form>
        {error && <Banner tone="error">{error}</Banner>}
      </div>

      <QueryState loading={trace.isFetching} error={trace.error} onRetry={runTrace} isEmpty={!!t && t.matched === 0} empty="No lots match this trace">
        {t && t.matched > 0 && (
          <>
            <div className="stats">
              <StatCard label="Lots matched" value={number(t.matched, 0)} />
              <StatCard label="Warehouses reached" value={number(t.summary.warehousesReached.length, 0)} />
              <StatCard label="Shipped to customer orders" value={number(t.summary.qtyDispatchedToOrders, 0)} hint={`${t.summary.orders.length} order(s)`} />
              <StatCard label="Still alive" value={number(t.summary.qtyStillAlive, 0)} tone={t.summary.qtyStillAlive ? 'danger' : 'success'} />
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Matching lots</h2>
                <div className="btn-group">
                  <button type="button" className="btn" onClick={exportCsv}>
                    Export CSV
                  </button>
                  {is('admin') && (
                    <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
                      Flag recall on all matching lots
                    </button>
                  )}
                </div>
              </div>
              <DataTable<LotRow>
                rows={t.lots}
                rowKey={(l) => l.lot._id}
                columns={[
                  { key: 'c', header: 'DNA code', render: (l) => <DnaCodeLink id={l.lot._id} code={l.lot.dnaCode} /> },
                  { key: 'b', header: 'Batch', render: (l) => l.lot.batchNo || '—' },
                  { key: 'p', header: 'Product', render: (l) => l.lot.product?.sku ?? '—' },
                  { key: 's', header: 'Status', render: (l) => <LotStatusBadge lot={l.lot} /> },
                  {
                    key: 'back',
                    header: 'Came from',
                    render: (l) => (
                      <span className="small">
                        {l.backward.supplier?.name ?? 'unknown supplier'} · {humanize(l.backward.birthType)} {date(l.backward.receivedAt)} at {l.backward.receivingWarehouse?.code ?? '—'}
                        {l.backward.grnNo ? ` · ${l.backward.grnNo}` : ''}
                      </span>
                    ),
                  },
                  { key: 'wh', header: 'Warehouses reached', render: (l) => l.forward.warehousesReached.map((w) => `${w.warehouse.code} ${w.qtyReceived}`).join(', ') || '—' },
                  {
                    key: 'o',
                    header: 'Orders',
                    render: (l) =>
                      l.forward.orders.length
                        ? l.forward.orders.map((o) => (
                            <Link key={o.refId} to={`/orders?highlight=${o.refId}`} className="small">
                              {o.orderNo ?? o.refId} × {o.qty}{' '}
                            </Link>
                          ))
                        : '—',
                  },
                  { key: 'alive', header: 'Still alive', align: 'right', render: (l) => number(l.forward.qtyStillAlive, 0) },
                  {
                    key: 'kids',
                    header: 'Child lots',
                    render: (l) => {
                      const kids = l.forward.lots.filter((x) => x.depth > 0);
                      return kids.length ? kids.map((x) => <DnaCodeLink key={x.lot} id={x.lot} code={x.dnaCode} />) : '—';
                    },
                  },
                ]}
              />
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Where it went</h2>
              </div>
              <DataTable
                rows={t.summary.warehousesReached}
                rowKey={(w) => w.warehouse._id}
                columns={[
                  { key: 'w', header: 'Warehouse', render: (w) => `${w.warehouse.code} ${w.warehouse.name}` },
                  { key: 'q', header: 'Quantity received', align: 'right', render: (w) => number(w.qtyReceived, 0) },
                ]}
              />
            </div>
          </>
        )}
      </QueryState>

      <ConfirmDialog
        open={confirm}
        title="Flag a recall on every alive matching lot"
        message="Dispatch and transfers are blocked at once for these lots. Managers and admins are notified."
        confirmLabel="Flag recall"
        danger
        requireReason
        onClose={() => setConfirm(false)}
        onConfirm={async (reason) => {
          try {
            await flagAll(reason);
          } catch (e) {
            throw new Error(errorMessage(e));
          }
        }}
      />
    </>
  );
}

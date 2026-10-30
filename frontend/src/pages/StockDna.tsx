import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useDnaStatsQuery, useLookupLotMutation, useLotsQuery, useReconcileDnaMutation, useRunExpiryJobMutation } from '../api/dna';
import Banner from '../components/Banner';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import Pager from '../components/Pager';
import QrScanner from '../components/QrScanner';
import { ProductSelect, SupplierSelect, WarehouseSelect } from '../components/Selects';
import StatCard from '../components/StatCard';
import { Chips } from '../components/Tabs';
import { DnaCodeLink, LotStatusBadge, MiniBar } from '../components/dna/LotParts';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import type { LotListItem, ReconcileResult } from '../types';
import { date, dateTime, humanize, number, rupees } from '../utils/format';

type Life = 'alive' | 'dead' | 'all';
const LIFE: { id: Life; label: string }[] = [
  { id: 'alive', label: 'Alive' },
  { id: 'dead', label: 'Dead' },
  { id: 'all', label: 'All' },
];
const STATUSES = ['', 'quarantine', 'active', 'expired', 'depleted', 'expired_disposed', 'written_off', 'recalled_destroyed', 'returned_to_supplier'];

function toCsv(rows: LotListItem[]): string {
  const head = ['DNA code', 'SKU', 'Product', 'Batch', 'Supplier', 'Status', 'Recalled', 'On hand', 'In transit', 'Born', 'Life used', 'Expiry', 'Warehouses', 'Last event', 'Last event at'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((l) =>
    [
      l.dnaCode,
      l.product.sku,
      l.product.name,
      l.batchNo,
      l.supplier?.name ?? '',
      l.status,
      l.flags.recalled ? 'yes' : 'no',
      l.qtyOnHand,
      l.qtyInTransit,
      l.qtyBorn,
      l.lifeUsedPct === null ? '' : Math.round(l.lifeUsedPct * 100) + '%',
      l.expiryDate ? l.expiryDate.slice(0, 10) : '',
      l.locations.map((x) => `${x.warehouse.code}:${x.qty}`).join(' '),
      l.lastEventType ?? '',
      l.lastEventAt ?? '',
    ]
      .map(esc)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}

export default function StockDna() {
  const { is } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [life, setLife] = useState<Life>(params.get('alive') === 'false' ? 'dead' : 'alive');
  const [status, setStatus] = useState('');
  const [product, setProduct] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [supplier, setSupplier] = useState('');
  const [expiring, setExpiring] = useState('');
  const [recalled, setRecalled] = useState(params.get('recalled') === 'true');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanError, setScanError] = useState('');
  const [reconcile, setReconcile] = useState<ReconcileResult | null>(null);
  const args = {
    status: status || undefined,
    alive: status ? undefined : life === 'all' ? undefined : life === 'alive' ? ('true' as const) : ('false' as const),
    product: product || undefined,
    warehouse: warehouse || undefined,
    supplier: supplier || undefined,
    expiringInDays: expiring === '' ? undefined : Number(expiring),
    recalled: recalled ? ('true' as const) : undefined,
    q: q || undefined,
    page,
    limit: 50,
  };
  const list = useLotsQuery(args);
  const stats = useDnaStatsQuery();
  const [lookup] = useLookupLotMutation();
  const [runReconcile] = useReconcileDnaMutation();
  const [runExpiry] = useRunExpiryJobMutation();
  const { busy, run } = useAction();
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const exportCsv = () => {
    const blob = new Blob([toCsv(list.data?.items ?? [])], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stock-dna-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onScan = async (code: string) => {
    setScanError('');
    try {
      const r = await lookup({ code: code.trim() }).unwrap();
      setScanOpen(false);
      navigate(`/dna/${r._id}`);
    } catch (e) {
      setScanError(errorMessage(e, 'No lot matches that code'));
    }
  };

  const s = stats.data;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Stock DNA</h1>
          <p>Every lot&apos;s life from birth at receipt to death by sale, expiry, damage or recall. Each event is hash-chained and anchored in the audit log.</p>
        </div>
        <div className="btn-group">
          <button type="button" className="btn" onClick={() => setScanOpen(true)}>
            Scan label
          </button>
          {is('admin', 'warehouse_manager') && (
            <Link to="/dna/recall-trace" className="btn btn-navy">
              Run recall trace
            </Link>
          )}
          <button type="button" className="btn" onClick={exportCsv} disabled={!list.data?.items.length}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="stats">
        <StatCard label="Alive lots" value={number(s?.alive, 0)} loading={stats.isLoading} />
        <StatCard label="Dead lots" value={number(s?.dead, 0)} loading={stats.isLoading} />
        <StatCard label="Expiring in 7 days" value={number(s?.expiringSoon, 0)} tone={s?.expiringSoon ? 'warning' : undefined} loading={stats.isLoading} />
        <StatCard label="Recalled (alive)" value={number(s?.recalledAlive, 0)} tone={s?.recalledAlive ? 'danger' : undefined} loading={stats.isLoading} />
        <StatCard
          label="Average lifespan"
          value={s?.averageLifespanDays === null || s?.averageLifespanDays === undefined ? '—' : `${number(s.averageLifespanDays)} d`}
          hint={s?.averageLifeUsedAtDeath !== null && s?.averageLifeUsedAtDeath !== undefined ? `${Math.round(s.averageLifeUsedAtDeath * 100)}% of shelf life used at death` : undefined}
          loading={stats.isLoading}
        />
        <StatCard label="Value lost this month" value={rupees(s?.valueLostThisMonth.total ?? 0, true)} hint="expiry and damage" loading={stats.isLoading} />
      </div>

      <div className="card">
        <div className="filters">
          <Chips label="Alive or dead" items={LIFE} value={life} onChange={reset(setLife)} />
          <div className="field">
            <label htmlFor="dna-q">Search</label>
            <input id="dna-q" type="search" placeholder="DNA code or batch" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="dna-status">Status</label>
            <select id="dna-status" value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
              {STATUSES.map((x) => (
                <option key={x} value={x}>
                  {x ? humanize(x) : 'Any status'}
                </option>
              ))}
            </select>
          </div>
          {!is('supplier') && (
            <>
              <div className="field">
                <label htmlFor="dna-product">Product</label>
                <ProductSelect id="dna-product" placeholder="All products" value={product} onChange={(e) => reset(setProduct)(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="dna-wh">Warehouse</label>
                <WarehouseSelect id="dna-wh" placeholder="All warehouses" value={warehouse} onChange={(e) => reset(setWarehouse)(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="dna-sup">Supplier</label>
                <SupplierSelect id="dna-sup" placeholder="All suppliers" value={supplier} onChange={(e) => reset(setSupplier)(e.target.value)} />
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="dna-exp">Expiring in (days)</label>
            <input id="dna-exp" type="number" min={0} placeholder="any" value={expiring} onChange={(e) => reset(setExpiring)(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={recalled} onChange={(e) => reset(setRecalled)(e.target.checked)} /> Recalled only
          </label>
        </div>
        <DataTable<LotListItem>
          rows={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(l) => l._id}
          empty="No lots match these filters"
          rowClassName={(l) => (l.flags.recalled && l.qtyOnHand > 0 ? 'row-danger' : undefined)}
          columns={[
            { key: 'code', header: 'DNA code', render: (l) => <DnaCodeLink id={l._id} code={l.dnaCode} />, sortValue: (l) => l.dnaCode },
            { key: 'p', header: 'Product', render: (l) => <span title={l.product.name}>{l.product.sku}</span>, sortValue: (l) => l.product.sku },
            { key: 'batch', header: 'Batch', render: (l) => l.batchNo || '—' },
            { key: 'sup', header: 'Supplier', render: (l) => l.supplier?.name ?? '—' },
            { key: 'status', header: 'Status', render: (l) => <LotStatusBadge lot={l} />, sortValue: (l) => l.status },
            { key: 'oh', header: 'On hand', align: 'right', render: (l) => number(l.qtyOnHand, 0), sortValue: (l) => l.qtyOnHand },
            { key: 'born', header: 'Born', align: 'right', render: (l) => number(l.qtyBorn, 0), sortValue: (l) => l.qtyBorn },
            { key: 'life', header: 'Life used', render: (l) => <MiniBar value={l.lifeUsedPct} />, sortValue: (l) => l.lifeUsedPct ?? -1 },
            { key: 'exp', header: 'Expiry', render: (l) => date(l.expiryDate), sortValue: (l) => l.expiryDate ?? '' },
            { key: 'wh', header: 'Warehouse(s)', render: (l) => (l.locations.length ? l.locations.map((x) => `${x.warehouse.code} ${number(x.qty, 0)}`).join(', ') : '—') },
            {
              key: 'last',
              header: 'Last event',
              render: (l) => (
                <span className="small">
                  {humanize(l.lastEventType ?? '')}
                  <br />
                  <span className="muted">{dateTime(l.lastEventAt)}</span>
                </span>
              ),
              sortValue: (l) => l.lastEventAt ?? '',
            },
          ]}
        />
        <Pager page={page} limit={50} total={list.data?.total ?? 0} onPage={setPage} />
      </div>

      {is('admin') && (
        <div className="card">
          <div className="card-head">
            <h2>Integrity jobs</h2>
          </div>
          <p className="muted">Reconcile compares every lot&apos;s genes, header counters and stock slices. The expiry job writes expiry warnings and expire genes (it also runs on the server schedule).</p>
          <div className="btn-group">
            <button type="button" className="btn btn-primary" disabled={busy === 'rec'} onClick={() => run('rec', async () => setReconcile(await runReconcile().unwrap()))}>
              {busy === 'rec' ? 'Reconciling...' : 'Reconcile all lots'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy === 'exp'}
              onClick={() => run('exp', () => runExpiry().unwrap(), (r) => `Expiry job: ${r.checked} checked, ${r.expired} expired, ${r.warned} warned`)}
            >
              {busy === 'exp' ? 'Running...' : 'Run expiry job'}
            </button>
          </div>
          {reconcile && (
            <div className="mt">
              {reconcile.drift.length === 0 && reconcile.orphanSlices === 0 ? (
                <Banner tone="success">
                  All {reconcile.lotsChecked} lots reconcile: genes, headers and stock slices agree.
                </Banner>
              ) : (
                <Banner tone="error">
                  {reconcile.drift.length} lot(s) drifted, {reconcile.orphanSlices} stock slice(s) without a lot:{' '}
                  {reconcile.drift.map((d) => `${d.dnaCode} (genes ${d.genesOnHand} / header ${d.headerOnHand} / slices ${d.slicesOnHand})`).join('; ')}
                </Banner>
              )}
            </div>
          )}
        </div>
      )}

      <Modal open={scanOpen} title="Scan a DNA label" onClose={() => setScanOpen(false)}>
        <QrScanner onScan={onScan} />
        <ManualCode onSubmit={onScan} />
        {scanError && <Banner tone="error">{scanError}</Banner>}
      </Modal>
    </>
  );
}

function ManualCode({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <form
      className="row mt"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) onSubmit(code);
      }}
    >
      <div className="field grow">
        <label htmlFor="dna-manual">Or type the DNA code</label>
        <input id="dna-manual" value={code} placeholder="DNA-SKU-...-0001" onChange={(e) => setCode(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-primary" disabled={!code.trim()}>
        Open lot
      </button>
    </form>
  );
}

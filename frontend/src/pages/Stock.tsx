import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { downloadFile, errorMessage } from '../api/client';
import { useDispatchStockMutation, useReceiveStockMutation, useStockQuery, useTransferStockMutation, useWarehousesQuery } from '../api/inventory';
import { useAppDispatch, useAppSelector } from '../app/store';
import DataTable from '../components/DataTable';
import ExpiryBadge from '../components/ExpiryBadge';
import FormField, { FormStatus } from '../components/FormField';
import Pager from '../components/Pager';
import { ProductSelect, WarehouseSelect } from '../components/Selects';
import Tabs from '../components/Tabs';
import { addToast } from '../features/notifications/notificationsSlice';
import { useAuth } from '../hooks/useAuth';
import { useForm } from '../hooks/useForm';
import type { Allocation, StockLine } from '../types';
import { date, number } from '../utils/format';
import { collect, positive, required } from '../utils/validate';

function useBins(warehouseId: string) {
  const { data } = useWarehousesQuery();
  return useMemo(() => data?.items.find((w) => w._id === warehouseId)?.zones.flatMap((z) => z.bins) ?? [], [data, warehouseId]);
}

function BinSelect({ id, warehouse, value, onChange, optional }: { id: string; warehouse: string; value: string; onChange: (v: string) => void; optional?: string }) {
  const bins = useBins(warehouse);
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={!warehouse}>
      <option value="">{optional ?? (bins.length ? `Default (${bins[0]})` : 'No bins')}</option>
      {bins.map((b) => (
        <option key={b} value={b}>
          {b}
        </option>
      ))}
    </select>
  );
}

function ReceiveForm({ defaultWarehouse, defaultProduct }: { defaultWarehouse: string; defaultProduct: string }) {
  const [receive] = useReceiveStockMutation();
  const f = useForm({ product: defaultProduct, warehouse: defaultWarehouse, quantity: '', bin: '', batchNo: '', expiryDate: '' }, (v) =>
    collect({ product: required(v.product, 'Product'), warehouse: required(v.warehouse, 'Warehouse'), quantity: positive(v.quantity, 'Quantity') }),
  );
  const onSubmit = f.submit(async (v) => {
    const line = await receive({
      product: v.product,
      warehouse: v.warehouse,
      quantity: Number(v.quantity),
      bin: v.bin || undefined,
      batchNo: v.batchNo.trim() || undefined,
      expiryDate: v.expiryDate ? new Date(v.expiryDate).toISOString() : null,
    }).unwrap();
    f.setValues((p) => ({ ...p, quantity: '', batchNo: '', expiryDate: '' }));
    return `Received ${v.quantity} into bin ${line.bin || '—'}${line.batchNo ? `, batch ${line.batchNo}` : ''}; line now holds ${line.quantity}`;
  }, { keepValues: true });
  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <FormField label="Product" htmlFor="rc-product" error={f.errors.product} required>
          <ProductSelect id="rc-product" {...f.bind('product')} />
        </FormField>
        <FormField label="Warehouse" htmlFor="rc-wh" error={f.errors.warehouse} required>
          <WarehouseSelect id="rc-wh" {...f.bind('warehouse')} />
        </FormField>
        <FormField label="Quantity" htmlFor="rc-qty" error={f.errors.quantity} required>
          <input id="rc-qty" type="number" min={1} {...f.bind('quantity')} />
        </FormField>
        <FormField label="Bin" htmlFor="rc-bin">
          <BinSelect id="rc-bin" warehouse={f.values.warehouse} value={f.values.bin} onChange={(v) => f.set('bin', v)} />
        </FormField>
        <FormField label="Batch no." htmlFor="rc-batch">
          <input id="rc-batch" {...f.bind('batchNo')} />
        </FormField>
        <FormField label="Expiry date" htmlFor="rc-exp" hint="Required for perishable products">
          <input id="rc-exp" type="date" {...f.bind('expiryDate')} />
        </FormField>
      </div>
      <FormStatus error={f.serverError} success={f.success} />
      <button type="submit" className="btn btn-primary" disabled={f.saving}>
        {f.saving ? 'Saving...' : 'Receive stock'}
      </button>
    </form>
  );
}

function DispatchForm({ defaultWarehouse, defaultProduct }: { defaultWarehouse: string; defaultProduct: string }) {
  const [dispatchStock] = useDispatchStockMutation();
  const [allocations, setAllocations] = useState<Allocation[] | null>(null);
  const f = useForm({ product: defaultProduct, warehouse: defaultWarehouse, quantity: '', bin: '', batchNo: '' }, (v) =>
    collect({ product: required(v.product, 'Product'), warehouse: required(v.warehouse, 'Warehouse'), quantity: positive(v.quantity, 'Quantity') }),
  );
  const onSubmit = f.submit(async (v) => {
    setAllocations(null);
    const r = await dispatchStock({ product: v.product, warehouse: v.warehouse, quantity: Number(v.quantity), bin: v.bin || undefined, batchNo: v.batchNo.trim() || undefined }).unwrap();
    setAllocations(r.allocations);
    f.setValues((p) => ({ ...p, quantity: '' }));
    return `Dispatched ${v.quantity} units`;
  }, { keepValues: true });
  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <FormField label="Product" htmlFor="dp-product" error={f.errors.product} required>
          <ProductSelect id="dp-product" {...f.bind('product')} />
        </FormField>
        <FormField label="Warehouse" htmlFor="dp-wh" error={f.errors.warehouse} required>
          <WarehouseSelect id="dp-wh" {...f.bind('warehouse')} />
        </FormField>
        <FormField label="Quantity" htmlFor="dp-qty" error={f.errors.quantity} required>
          <input id="dp-qty" type="number" min={1} {...f.bind('quantity')} />
        </FormField>
        <FormField label="Bin (optional)" htmlFor="dp-bin">
          <BinSelect id="dp-bin" warehouse={f.values.warehouse} value={f.values.bin} onChange={(v) => f.set('bin', v)} optional="Any bin" />
        </FormField>
        <FormField label="Batch (optional)" htmlFor="dp-batch" hint="Leave blank for FEFO">
          <input id="dp-batch" {...f.bind('batchNo')} />
        </FormField>
      </div>
      <FormStatus error={f.serverError} success={f.success} />
      {allocations && (
        <div className="banner banner-info" role="status">
          <div className="banner-body">
            <strong>FEFO allocations:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {allocations.map((a, i) => (
                <li key={i}>
                  {a.quantity} from batch {a.batchNo || '(none)'} in bin {a.bin || '—'}
                  {a.expiryDate ? `, expires ${date(a.expiryDate)}` : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <button type="submit" className="btn btn-primary" disabled={f.saving}>
        {f.saving ? 'Saving...' : 'Dispatch stock'}
      </button>
    </form>
  );
}

function TransferForm({ defaultWarehouse, defaultProduct }: { defaultWarehouse: string; defaultProduct: string }) {
  const [transfer] = useTransferStockMutation();
  const f = useForm({ product: defaultProduct, fromWarehouse: defaultWarehouse, toWarehouse: '', quantity: '', batchNo: '', notes: '', mode: 'instant' as 'instant' | 'tracked' }, (v) =>
    collect({
      product: required(v.product, 'Product'),
      fromWarehouse: required(v.fromWarehouse, 'From'),
      toWarehouse: required(v.toWarehouse, 'To') ?? (v.toWarehouse === v.fromWarehouse ? 'Choose a different warehouse' : undefined),
      quantity: positive(v.quantity, 'Quantity'),
    }),
  );
  const onSubmit = f.submit(async (v) => {
    const t = await transfer({
      product: v.product,
      fromWarehouse: v.fromWarehouse,
      toWarehouse: v.toWarehouse,
      quantity: Number(v.quantity),
      batchNo: v.batchNo.trim() || undefined,
      notes: v.notes,
      mode: v.mode,
    }).unwrap();
    f.setValues((p) => ({ ...p, quantity: '', batchNo: '', notes: '' }));
    return t.mode === 'instant' ? `Moved ${t.quantity} units (${t.allocations.map((a) => a.batchNo || 'no batch').join(', ')})` : 'Tracked transfer requested; it needs admin approval';
  }, { keepValues: true });
  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <FormField label="Product" htmlFor="tf-product" error={f.errors.product} required>
          <ProductSelect id="tf-product" {...f.bind('product')} />
        </FormField>
        <FormField label="From" htmlFor="tf-from" error={f.errors.fromWarehouse} required>
          <WarehouseSelect id="tf-from" {...f.bind('fromWarehouse')} />
        </FormField>
        <FormField label="To" htmlFor="tf-to" error={f.errors.toWarehouse} required>
          <WarehouseSelect id="tf-to" {...f.bind('toWarehouse')} exclude={f.values.fromWarehouse} />
        </FormField>
        <FormField label="Quantity" htmlFor="tf-qty" error={f.errors.quantity} required>
          <input id="tf-qty" type="number" min={1} {...f.bind('quantity')} />
        </FormField>
        <FormField label="Batch" htmlFor="tf-batch" hint="Leave blank for FEFO">
          <input id="tf-batch" {...f.bind('batchNo')} />
        </FormField>
        <FormField label="Notes" htmlFor="tf-notes">
          <input id="tf-notes" {...f.bind('notes')} />
        </FormField>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 13 }}>Mode</legend>
        <div className="row gap-lg">
          <label className="check">
            <input type="radio" name="tf-mode" checked={f.values.mode === 'instant'} onChange={() => f.set('mode', 'instant')} /> Instant (move now)
          </label>
          <label className="check">
            <input type="radio" name="tf-mode" checked={f.values.mode === 'tracked'} onChange={() => f.set('mode', 'tracked')} /> Tracked (approve, dispatch, receive)
          </label>
        </div>
      </fieldset>
      <FormStatus error={f.serverError} success={f.success} />
      <button type="submit" className="btn btn-primary" disabled={f.saving}>
        {f.saving ? 'Saving...' : 'Transfer stock'}
      </button>
    </form>
  );
}

function BatchesPanel({ product, warehouse }: { product: string; warehouse: string }) {
  const q = useStockQuery({ product: product || undefined, warehouse: warehouse || undefined, limit: 500 }, { skip: !product });
  if (!product) return <p className="muted">Choose a product in the filter above to see its batches in FEFO order (the first row leaves first).</p>;
  const rows = [...(q.data?.items ?? [])].sort((a, b) => {
    if (a.warehouse._id !== b.warehouse._id) return a.warehouse.code.localeCompare(b.warehouse.code);
    if (!a.expiryDate) return 1;
    if (!b.expiryDate) return -1;
    return a.expiryDate.localeCompare(b.expiryDate);
  });
  return (
    <DataTable<StockLine>
      rows={rows}
      loading={q.isLoading}
      error={q.error}
      onRetry={q.refetch}
      rowKey={(l) => l._id}
      empty="No batches for this product"
      columns={[
        { key: 'w', header: 'Warehouse', render: (l) => l.warehouse.code },
        { key: 'batch', header: 'Batch', render: (l) => l.batchNo || '—' },
        { key: 'bin', header: 'Bin', render: (l) => l.bin || '—' },
        { key: 'exp', header: 'Expiry', render: (l) => <ExpiryBadge expiry={l.expiryDate} /> },
        { key: 'qty', header: 'Qty', align: 'right', render: (l) => number(l.quantity, 0) },
      ]}
    />
  );
}

type TabId = 'receive' | 'dispatch' | 'transfer' | 'batches';

export default function Stock() {
  const { is, ownWarehouse } = useAuth();
  const selectedWarehouse = useAppSelector((s) => s.auth.selectedWarehouse);
  const [params, setParams] = useSearchParams();
  const [warehouse, setWarehouse] = useState(params.get('warehouse') ?? selectedWarehouse ?? '');
  const product = params.get('product') ?? '';
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<TabId>('receive');
  const [exporting, setExporting] = useState(false);
  const dispatch = useAppDispatch();
  const q = useStockQuery({ warehouse: warehouse || undefined, product: product || undefined, page, limit: 100 });
  const tabs: { id: TabId; label: string }[] = [
    { id: 'receive', label: 'Receive' },
    { id: 'dispatch', label: 'Dispatch' },
    ...(is('admin', 'warehouse_manager') ? [{ id: 'transfer' as TabId, label: 'Transfer' }] : []),
    { id: 'batches', label: 'Batches' },
  ];
  const defaultWh = ownWarehouse ?? warehouse;

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile('/stock/export.csv', { warehouse: warehouse || undefined }, 'stock.csv');
    } catch (e) {
      dispatch(addToast(errorMessage(e), 'error'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Stock</h1>
          <p>Stock lines by bin and batch. Updates live as stock moves.</p>
        </div>
        <button type="button" className="btn" onClick={exportCsv} disabled={exporting}>
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>
      <div className="card">
        <Tabs label="Stock actions" tabs={tabs} value={tab} onChange={setTab} />
        {tab === 'receive' && <ReceiveForm defaultWarehouse={defaultWh} defaultProduct={product} />}
        {tab === 'dispatch' && <DispatchForm defaultWarehouse={defaultWh} defaultProduct={product} />}
        {tab === 'transfer' && <TransferForm defaultWarehouse={defaultWh} defaultProduct={product} />}
        {tab === 'batches' && <BatchesPanel product={product} warehouse={warehouse} />}
      </div>
      <div className="card">
        <div className="filters">
          <div className="field">
            <label htmlFor="st-wh">Warehouse</label>
            <WarehouseSelect
              id="st-wh"
              placeholder="All warehouses"
              value={warehouse}
              onChange={(e) => {
                setWarehouse(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="st-product">Product</label>
            <ProductSelect
              id="st-product"
              placeholder="All products"
              value={product}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('product', e.target.value);
                else next.delete('product');
                setParams(next, { replace: true });
                setPage(1);
              }}
            />
          </div>
        </div>
        <DataTable<StockLine>
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error}
          onRetry={q.refetch}
          rowKey={(l) => l._id}
          empty="No stock for this selection"
          rowClassName={(l) => (l.reorderPoint > 0 && l.quantity <= l.reorderPoint ? 'row-highlight' : undefined)}
          columns={[
            { key: 'product', header: 'Product', render: (l) => <><strong>{l.product.sku}</strong> {l.product.name}</>, sortValue: (l) => l.product.sku },
            { key: 'wh', header: 'Warehouse', render: (l) => l.warehouse.code, sortValue: (l) => l.warehouse.code },
            { key: 'bin', header: 'Bin', render: (l) => l.bin || '—', sortValue: (l) => l.bin },
            { key: 'batch', header: 'Batch', render: (l) => l.batchNo || '—', sortValue: (l) => l.batchNo },
            { key: 'exp', header: 'Expiry', render: (l) => <ExpiryBadge expiry={l.expiryDate} />, sortValue: (l) => l.expiryDate ?? '9999' },
            { key: 'qty', header: 'Qty', align: 'right', render: (l) => number(l.quantity, 0), sortValue: (l) => l.quantity },
            { key: 'rop', header: 'Reorder point', align: 'right', render: (l) => number(l.reorderPoint, 0), sortValue: (l) => l.reorderPoint },
            {
              key: 'dna',
              header: 'DNA',
              render: (l) =>
                l.lot ? (
                  <Link to={`/dna/${l.lot}`} className="btn btn-sm" aria-label={`Open the DNA of ${l.product.sku} batch ${l.batchNo || 'none'}`}>
                    DNA
                  </Link>
                ) : (
                  '—'
                ),
            },
          ]}
        />
        {q.data && <Pager page={page} limit={q.data.limit} total={q.data.total} onPage={setPage} />}
      </div>
    </>
  );
}

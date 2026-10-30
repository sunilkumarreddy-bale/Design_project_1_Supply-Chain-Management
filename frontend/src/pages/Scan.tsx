import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLookupLotMutation } from '../api/dna';
import { errorMessage } from '../api/client';
import { useDispatchStockMutation, useExplainQuery, useReceiveStockMutation, useScanProductMutation } from '../api/inventory';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import ExpiryBadge from '../components/ExpiryBadge';
import ExplainPanel from '../components/ExplainPanel';
import FormField, { FormStatus } from '../components/FormField';
import Modal from '../components/Modal';
import QrScanner from '../components/QrScanner';
import QueryState from '../components/QueryState';
import { WarehouseSelect } from '../components/Selects';
import { useAuth } from '../hooks/useAuth';
import { useForm } from '../hooks/useForm';
import type { Product, StockLine } from '../types';
import { date, number, rupees } from '../utils/format';
import { collect, positive, required } from '../utils/validate';

function ExplainModal({ product, warehouse, onClose }: { product: Product; warehouse: string; onClose: () => void }) {
  const q = useExplainQuery({ id: product._id, warehouse: warehouse || null });
  return (
    <Modal open wide title={`Should ${product.sku} be reordered?`} onClose={onClose}>
      <QueryState loading={q.isLoading} error={q.error} onRetry={q.refetch}>
        <ExplainPanel explanation={q.data?.explanation} title={warehouse ? 'At the selected warehouse' : 'Network-wide'} />
      </QueryState>
    </Modal>
  );
}

export default function Scan() {
  const { ownWarehouse } = useAuth();
  const [scan, scanState] = useScanProductMutation();
  const [lookupLot, lookupState] = useLookupLotMutation();
  const navigate = useNavigate();
  const [lotBatch, setLotBatch] = useState('');
  const [dispatchStock] = useDispatchStockMutation();
  const [receive] = useReceiveStockMutation();
  const [sku, setSku] = useState('');
  const [result, setResult] = useState<{ product: Product; lines: StockLine[] } | null>(null);
  const [scanError, setScanError] = useState('');
  const [explain, setExplain] = useState(false);
  const f = useForm({ action: 'dispatch' as 'dispatch' | 'receive', warehouse: ownWarehouse ?? '', quantity: '', batchNo: '', expiryDate: '' }, (v) =>
    collect({ warehouse: required(v.warehouse, 'Warehouse'), quantity: positive(v.quantity, 'Quantity') }),
  );

  const resolve = async (payload: string) => {
    const text = payload.trim();
    if (!text) {
      setScanError('Enter or scan a SKU');
      return;
    }
    setScanError('');
    if (/^DNA-/i.test(text)) {
      // a Stock DNA label: open the lot's life summary and actions
      try {
        const lot = await lookupLot({ code: text }).unwrap();
        navigate(`/dna/${lot._id}`);
      } catch (e) {
        setScanError(errorMessage(e));
      }
      return;
    }
    try {
      setResult(await scan(text).unwrap());
      setSku(text);
    } catch (e) {
      setResult(null);
      setScanError(errorMessage(e));
    }
  };

  const onAct = f.submit(async (v) => {
    if (!result) return;
    const p = result.product;
    if (v.action === 'dispatch') {
      const r = await dispatchStock({ product: p._id, warehouse: v.warehouse, quantity: Number(v.quantity), batchNo: v.batchNo.trim() || undefined }).unwrap();
      await resolve(p.sku);
      return `Dispatched ${v.quantity}: ${r.allocations.map((a) => `${a.quantity} from ${a.batchNo || 'no batch'}${a.expiryDate ? ` (exp ${date(a.expiryDate)})` : ''}`).join('; ')}`;
    }
    await receive({
      product: p._id,
      warehouse: v.warehouse,
      quantity: Number(v.quantity),
      batchNo: v.batchNo.trim() || undefined,
      expiryDate: v.expiryDate ? new Date(v.expiryDate).toISOString() : null,
    }).unwrap();
    await resolve(p.sku);
    return `Received ${v.quantity} ${p.sku}`;
  }, { keepValues: true });

  const byWarehouse = new Map<string, { code: string; name: string; qty: number; batches: number }>();
  for (const l of result?.lines ?? []) {
    const cur = byWarehouse.get(l.warehouse._id) ?? { code: l.warehouse.code, name: l.warehouse.name, qty: 0, batches: 0 };
    cur.qty += l.quantity;
    cur.batches += 1;
    byWarehouse.set(l.warehouse._id, cur);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Scan</h1>
          <p>Scan a product QR code with this device's camera, or type the SKU.</p>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="card">
          <QrScanner onScan={(t) => resolve(t)} />
          <form
            className="row gap mt"
            onSubmit={(e) => {
              e.preventDefault();
              resolve(sku);
            }}
          >
            <label htmlFor="scan-sku" className="sr-only">
              SKU
            </label>
            <input id="scan-sku" className="grow" placeholder="SKU (SKU-BAT-004) or DNA code (DNA-...)" value={sku} onChange={(e) => setSku(e.target.value)} style={{ width: 'auto' }} />
            <button type="submit" className="btn btn-primary" disabled={scanState.isLoading}>
              {scanState.isLoading || lookupState.isLoading ? 'Resolving...' : 'Resolve'}
            </button>
          </form>
          {scanError && (
            <div className="banner banner-error" role="alert">
              <div className="banner-body">{scanError}</div>
            </div>
          )}
        </div>
        <div className="card">
          {!result ? (
            <p className="muted">Scan or resolve a product to see its stock and act on it.</p>
          ) : (
            <>
              <div className="row gap spread">
                <div className="row gap">
                  {result.product.imageUrl && <img src={result.product.imageUrl} alt="" width={56} height={56} style={{ objectFit: 'cover', borderRadius: 8 }} />}
                  <div>
                    <h2 style={{ margin: 0 }}>{result.product.name}</h2>
                    <div className="mono">{result.product.sku}</div>
                    <div className="muted small">
                      {result.product.category} · {rupees(result.product.unitCost)} cost · {result.product.primarySupplier?.name ?? 'no supplier'}
                      {result.product.isPerishable && (
                        <>
                          {' '}
                          <Badge tone="info">Perishable</Badge>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <button type="button" className="btn btn-navy" onClick={() => setExplain(true)}>
                  Should this be reordered? Why?
                </button>
              </div>
              <h3 className="mt">Stock per warehouse</h3>
              <DataTable
                rows={[...byWarehouse.entries()].map(([id, v]) => ({ id, ...v }))}
                rowKey={(r) => r.id}
                empty="No stock anywhere"
                dense
                columns={[
                  { key: 'code', header: 'Warehouse', render: (r) => `${r.code} · ${r.name}` },
                  { key: 'qty', header: 'On hand', align: 'right', render: (r) => number(r.qty, 0) },
                  { key: 'batches', header: 'Batches', align: 'right' },
                ]}
              />
              <DataTable<StockLine>
                rows={result.lines}
                rowKey={(l) => l._id}
                empty=""
                dense
                columns={[
                  { key: 'w', header: 'Warehouse', render: (l) => l.warehouse.code },
                  { key: 'batch', header: 'Batch', render: (l) => l.batchNo || '—' },
                  { key: 'bin', header: 'Bin', render: (l) => l.bin || '—' },
                  { key: 'exp', header: 'Expiry', render: (l) => <ExpiryBadge expiry={l.expiryDate} /> },
                  { key: 'qty', header: 'Qty', align: 'right', render: (l) => number(l.quantity, 0) },
                  { key: 'dna', header: 'DNA', render: (l) => (l.lot ? <Link to={`/dna/${l.lot}`}>Open lot</Link> : '—') },
                ]}
              />
              <form
                className="row gap mt"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setScanError('');
                  try {
                    const lot = await lookupLot({ sku: result.product.sku, batchNo: lotBatch.trim() }).unwrap();
                    navigate(`/dna/${lot._id}`);
                  } catch (err) {
                    setScanError(errorMessage(err));
                  }
                }}
              >
                <label htmlFor="scan-lot-batch" className="sr-only">
                  Batch number
                </label>
                <input id="scan-lot-batch" className="grow" placeholder="Batch number (blank = unbatched)" value={lotBatch} onChange={(e) => setLotBatch(e.target.value)} style={{ width: 'auto' }} />
                <button type="submit" className="btn" disabled={lookupState.isLoading}>
                  Open lot DNA
                </button>
              </form>
              <form onSubmit={onAct} noValidate className="mt">
                <h3>Act on this product</h3>
                <div className="form-grid">
                  <FormField label="Action" htmlFor="sc-action">
                    <select id="sc-action" {...f.bind('action')}>
                      <option value="dispatch">Dispatch (FEFO)</option>
                      <option value="receive">Receive</option>
                    </select>
                  </FormField>
                  <FormField label="Warehouse" htmlFor="sc-wh" error={f.errors.warehouse} required>
                    <WarehouseSelect id="sc-wh" {...f.bind('warehouse')} />
                  </FormField>
                  <FormField label="Quantity" htmlFor="sc-qty" error={f.errors.quantity} required>
                    <input id="sc-qty" type="number" min={1} {...f.bind('quantity')} />
                  </FormField>
                  <FormField label="Batch" htmlFor="sc-batch" hint={f.values.action === 'dispatch' ? 'Blank = FEFO' : undefined}>
                    <input id="sc-batch" {...f.bind('batchNo')} />
                  </FormField>
                  {f.values.action === 'receive' && (
                    <FormField label="Expiry" htmlFor="sc-exp" hint={result.product.isPerishable ? 'Required (perishable)' : undefined}>
                      <input id="sc-exp" type="date" {...f.bind('expiryDate')} />
                    </FormField>
                  )}
                </div>
                <FormStatus error={f.serverError} success={f.success} />
                <button type="submit" className="btn btn-primary" disabled={f.saving}>
                  {f.saving ? 'Saving...' : f.values.action === 'dispatch' ? 'Dispatch' : 'Receive'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
      {explain && result && <ExplainModal product={result.product} warehouse={f.values.warehouse} onClose={() => setExplain(false)} />}
    </>
  );
}

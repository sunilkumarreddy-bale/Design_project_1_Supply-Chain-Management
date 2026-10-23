import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useConfigQuery } from '../api/admin';
import { useExecuteRebalanceMutation } from '../api/insights';
import { useAutoDraftMutation, useCreatePOMutation, usePoActionMutation, usePurchaseOrdersQuery, useReceivePOMutation } from '../api/procurement';
import Badge from '../components/Badge';
import ConfirmDialog from '../components/ConfirmDialog';
import DataTable from '../components/DataTable';
import ExplainPanel from '../components/ExplainPanel';
import FormField, { FormStatus } from '../components/FormField';
import Modal from '../components/Modal';
import Pager from '../components/Pager';
import { ProductSelect, SupplierSelect, WarehouseSelect } from '../components/Selects';
import { Chips } from '../components/Tabs';
import SupplierPOActions from '../components/po/SupplierPOActions';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import { useForm } from '../hooks/useForm';
import type { AutoDraftResult, PurchaseOrder } from '../types';
import { date, humanize, number, rupees } from '../utils/format';
import { collect, nonNegative, positive, required } from '../utils/validate';

type StatusFilter = 'all' | 'pending_approval' | 'approved' | 'confirmed' | 'dispatched' | 'partially_received' | 'received' | 'draft' | 'rejected' | 'cancelled';
const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending_approval', label: 'Pending approval' },
  { id: 'approved', label: 'Approved' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'dispatched', label: 'Dispatched' },
  { id: 'partially_received', label: 'Partially received' },
  { id: 'received', label: 'Received' },
  { id: 'draft', label: 'Draft' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'cancelled', label: 'Cancelled' },
];
const RECEIVABLE = ['approved', 'confirmed', 'dispatched', 'partially_received'];

function WhyModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  return (
    <Modal open wide title={`Why ${po.poNumber}?`} onClose={onClose}>
      {po.items.map((i) => (
        <div key={i._id} className="mb">
          <h3>
            {i.product.sku} {i.product.name}: {number(i.quantityOrdered, 0)} units
          </h3>
          {i.reorderExplanation ? (
            <ExplainPanel explanation={i.reorderExplanation} title="Reorder derivation (stored when the line was drafted)" />
          ) : (
            <p className="muted">This line was entered {po.source === 'recovery_plan' ? 'by a recovery plan' : 'manually'}, so there is no reorder derivation.</p>
          )}
        </div>
      ))}
    </Modal>
  );
}

function ReceiveModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const [receive] = useReceivePOMutation();
  const outstanding = po.items.map((i) => ({ item: i, left: i.quantityOrdered - i.quantityReceived })).filter((x) => x.left > 0);
  const [lines, setLines] = useState(() => outstanding.map((x) => ({ product: x.item.product._id, qty: String(x.left), batchNo: '', expiryDate: '' })));
  const [logDiscrepancy, setLogDiscrepancy] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const f = useForm({ notes: '' });
  const short = lines.some((l, idx) => Number(l.qty) < outstanding[idx].left);
  const onSubmit = f.submit(async (v) => {
    const errs: Record<number, string> = {};
    lines.forEach((l, idx) => {
      const n = Number(l.qty);
      if (l.qty === '' || !Number.isFinite(n) || n < 0) errs[idx] = 'Enter 0 or more';
      else if (n > outstanding[idx].left) errs[idx] = `At most ${outstanding[idx].left}`;
      else if (n > 0 && outstanding[idx].item.product.isPerishable && !l.expiryDate) errs[idx] = 'Expiry date required (perishable)';
    });
    setErrors(errs);
    if (Object.keys(errs).length) throw new Error('Fix the highlighted lines');
    if (lines.every((l) => Number(l.qty) === 0)) throw new Error('Enter a quantity for at least one line');
    const r = await receive({
      id: po._id,
      receivedItems: lines.map((l) => ({ product: l.product, quantityReceived: Number(l.qty), batchNo: l.batchNo.trim() || undefined, expiryDate: l.expiryDate ? new Date(l.expiryDate).toISOString() : null })),
      logDiscrepancy: short && logDiscrepancy,
      notes: v.notes || undefined,
    }).unwrap();
    setTimeout(onClose, 900);
    return `${po.poNumber} is now ${humanize(r.purchaseOrder.status).toLowerCase()}${r.leadTimeSample ? `; lead time ${r.leadTimeSample.days} day(s) recorded (${r.leadTimeSample.onTime ? 'on time' : 'late'})` : ''}${r.discrepancies.length ? `; ${r.discrepancies.length} discrepancy logged` : ''}`;
  }, { keepValues: true });
  return (
    <Modal open wide title={`Receive ${po.poNumber}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ textAlign: 'right' }}>Outstanding</th>
                <th>Receive now</th>
                <th>Batch</th>
                <th>Expiry</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.map((x, idx) => (
                <tr key={x.item._id} className={errors[idx] ? 'row-danger' : undefined}>
                  <td>
                    {x.item.product.sku} {x.item.product.isPerishable && <Badge tone="info">Perishable</Badge>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{x.left}</td>
                  <td>
                    <label className="sr-only" htmlFor={`rcv-q-${idx}`}>
                      Quantity for {x.item.product.sku}
                    </label>
                    <input id={`rcv-q-${idx}`} className="inline-input" type="number" min={0} max={x.left} value={lines[idx].qty} onChange={(e) => setLines(lines.map((l, j) => (j === idx ? { ...l, qty: e.target.value } : l)))} />
                    {errors[idx] && <div className="error-text">{errors[idx]}</div>}
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`rcv-b-${idx}`}>
                      Batch
                    </label>
                    <input id={`rcv-b-${idx}`} placeholder={po.poNumber} value={lines[idx].batchNo} onChange={(e) => setLines(lines.map((l, j) => (j === idx ? { ...l, batchNo: e.target.value } : l)))} />
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`rcv-e-${idx}`}>
                      Expiry
                    </label>
                    <input id={`rcv-e-${idx}`} type="date" value={lines[idx].expiryDate} onChange={(e) => setLines(lines.map((l, j) => (j === idx ? { ...l, expiryDate: e.target.value } : l)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {short && (
          <label className="check mt">
            <input type="checkbox" checked={logDiscrepancy} onChange={(e) => setLogDiscrepancy(e.target.checked)} /> Log discrepancy for lines received short
          </label>
        )}
        <FormField label="Notes" htmlFor="rcv-notes">
          <input id="rcv-notes" {...f.bind('notes')} />
        </FormField>
        <FormStatus error={f.serverError} success={f.success} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={f.saving}>
            {f.saving ? 'Saving...' : 'Receive'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface LineDraft {
  product: string;
  quantityOrdered: string;
  unitCost: string;
}

function NewPOForm({ onDone }: { onDone: () => void }) {
  const { ownWarehouse } = useAuth();
  const [create] = useCreatePOMutation();
  const [lines, setLines] = useState<LineDraft[]>([{ product: '', quantityOrdered: '', unitCost: '' }]);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const f = useForm({ supplier: '', warehouse: ownWarehouse ?? '', expectedDeliveryDate: '', notes: '', draft: false }, (v) =>
    collect({ supplier: required(v.supplier, 'Supplier'), warehouse: required(v.warehouse, 'Warehouse') }),
  );
  const onSubmit = f.submit(async (v) => {
    const errs: Record<number, string> = {};
    lines.forEach((l, i) => {
      const e = required(l.product, 'Product') ?? positive(l.quantityOrdered, 'Quantity') ?? nonNegative(l.unitCost, 'Unit cost', true);
      if (e) errs[i] = e;
    });
    if (new Set(lines.map((l) => l.product)).size !== lines.length) errs[lines.length - 1] = 'Each product only once';
    setLineErrors(errs);
    if (Object.keys(errs).length) throw new Error('Fix the highlighted lines');
    const po = await create({
      supplier: v.supplier,
      warehouse: v.warehouse,
      expectedDeliveryDate: v.expectedDeliveryDate ? new Date(v.expectedDeliveryDate).toISOString() : null,
      notes: v.notes,
      draft: v.draft,
      items: lines.map((l) => ({ product: l.product, quantityOrdered: Number(l.quantityOrdered), unitCost: l.unitCost === '' ? null : Number(l.unitCost) })),
    }).unwrap();
    setLines([{ product: '', quantityOrdered: '', unitCost: '' }]);
    return `${po.poNumber} created (${humanize(po.status).toLowerCase()})`;
  });
  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2>New purchase order</h2>
      <div className="form-grid">
        <FormField label="Supplier" htmlFor="po-supplier" error={f.errors.supplier} required>
          <SupplierSelect id="po-supplier" {...f.bind('supplier')} />
        </FormField>
        <FormField label="Warehouse" htmlFor="po-wh" error={f.errors.warehouse} required>
          <WarehouseSelect id="po-wh" {...f.bind('warehouse')} disabled={!!ownWarehouse} />
        </FormField>
        <FormField label="Expected date" htmlFor="po-date">
          <input id="po-date" type="date" {...f.bind('expectedDeliveryDate')} />
        </FormField>
        <FormField label="Notes" htmlFor="po-notes">
          <input id="po-notes" {...f.bind('notes')} />
        </FormField>
      </div>
      <h3>Lines</h3>
      {lines.map((l, i) => (
        <div key={i}>
          <div className="line-row">
            <FormField label="Product" htmlFor={`po-l-p-${i}`}>
              <ProductSelect id={`po-l-p-${i}`} value={l.product} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, product: e.target.value } : x)))} />
            </FormField>
            <FormField label="Quantity" htmlFor={`po-l-q-${i}`}>
              <input id={`po-l-q-${i}`} type="number" min={1} value={l.quantityOrdered} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantityOrdered: e.target.value } : x)))} />
            </FormField>
            <FormField label="Unit cost (₹)" htmlFor={`po-l-c-${i}`} hint="Blank = product cost">
              <input id={`po-l-c-${i}`} type="number" step="0.01" value={l.unitCost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} />
            </FormField>
            <button type="button" className="btn btn-sm" style={{ marginBottom: 12 }} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              Remove line
            </button>
          </div>
          {lineErrors[i] && <div className="error-text mb">{lineErrors[i]}</div>}
        </div>
      ))}
      <button type="button" className="btn btn-sm mb" onClick={() => setLines([...lines, { product: '', quantityOrdered: '', unitCost: '' }])}>
        Add line
      </button>
      <label className="check">
        <input type="checkbox" checked={f.values.draft} onChange={(e) => f.set('draft', e.target.checked)} /> Save as draft (submit for approval later)
      </label>
      <FormStatus error={f.serverError} success={f.success} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={f.saving}>
          {f.saving ? 'Saving...' : 'Create PO'}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Close
        </button>
      </div>
    </form>
  );
}

function AutoDraftPanel({ onDone }: { onDone: () => void }) {
  const { ownWarehouse } = useAuth();
  const [autoDraft] = useAutoDraftMutation();
  const [execute] = useExecuteRebalanceMutation();
  const { busy, run } = useAction();
  const [result, setResult] = useState<AutoDraftResult | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const f = useForm({ warehouse: ownWarehouse ?? '' }, (v) => collect({ warehouse: required(v.warehouse, 'Warehouse') }));
  const onSubmit = f.submit(async (v) => {
    const r = await autoDraft({ warehouse: v.warehouse }).unwrap();
    setResult(r);
    setDone(new Set());
    return r.created.length ? `Drafted ${r.created.length} purchase order(s) for ${r.warehouse.name}` : `No purchase needed at ${r.warehouse.name} right now`;
  }, { keepValues: true });
  return (
    <div className="card">
      <form onSubmit={onSubmit} noValidate className="row gap" style={{ alignItems: 'flex-end' }}>
        <FormField label="Auto-draft from reorder points for" htmlFor="ad-wh" error={f.errors.warehouse} className="grow">
          <WarehouseSelect id="ad-wh" {...f.bind('warehouse')} disabled={!!ownWarehouse} />
        </FormField>
        <button type="submit" className="btn btn-primary" style={{ marginBottom: 12 }} disabled={f.saving}>
          {f.saving ? 'Drafting...' : 'Auto-draft'}
        </button>
        <button type="button" className="btn" style={{ marginBottom: 12 }} onClick={onDone}>
          Close
        </button>
      </form>
      <FormStatus error={f.serverError} success={f.success} />
      {result && (
        <div className="grid grid-3 mt">
          <div>
            <h3>Drafted POs ({result.created.length})</h3>
            {result.created.length === 0 && <p className="muted">Nothing to buy: positions are above their reorder points, or transfers cover them.</p>}
            <ul className="plain-list">
              {result.created.map((p) => (
                <li key={p._id}>
                  <strong>{p.poNumber}</strong> · {p.items.length} line(s) · {rupees(p.items.reduce((s, i) => s + i.quantityOrdered * i.unitCost, 0))}
                  <div className="muted small">{p.items.map((i) => `${i.quantityOrdered} × ${typeof i.product === 'string' ? '' : i.product.sku ?? ''}`).join(', ')}</div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Avoided by transfer ({result.avoidedByTransfer.length})</h3>
            {result.avoidedByTransfer.length === 0 && <p className="muted">No surplus elsewhere to use.</p>}
            <ul className="plain-list">
              {result.avoidedByTransfer.map((a) =>
                a.transfers.map((t) => {
                  const key = `${a.product._id}-${t.from._id}`;
                  return (
                    <li key={key}>
                      <strong>{a.product.sku}</strong>: move {t.quantity} from {t.from.name}
                      <div className="muted small">{a.explanation}</div>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary mt"
                        disabled={busy === key || done.has(key)}
                        onClick={() =>
                          run(key, async () => {
                            const r = await execute({ product: a.product._id, from: t.from._id, to: t.to._id, quantity: t.quantity }).unwrap();
                            setDone((s) => new Set(s).add(key));
                            return r;
                          }, (r) => (r.mode === 'instant' ? `Moved ${t.quantity} ${a.product.sku}` : 'Transfer requested for approval'))
                        }
                      >
                        {done.has(key) ? 'Done' : busy === key ? 'Saving...' : 'Execute transfer'}
                      </button>
                    </li>
                  );
                }),
              )}
            </ul>
          </div>
          <div>
            <h3>Skipped ({result.skipped.length})</h3>
            <ul className="plain-list">
              {result.skipped.map((s) => (
                <li key={s.product._id}>
                  <strong>{s.product.sku}</strong>: {s.reason}
                  {s.suggestion && (
                    <div className="small">
                      {s.suggestion}.{' '}
                      <Link to={`/recovery?product=${s.product._id}&warehouse=${result.warehouse._id}`}>Run recovery</Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PurchaseOrders() {
  const { is } = useAuth();
  const [params] = useSearchParams();
  const focus = params.get('focus');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<'new' | 'auto' | null>(null);
  const [why, setWhy] = useState<PurchaseOrder | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [rejecting, setRejecting] = useState<PurchaseOrder | null>(null);
  const [cancelling, setCancelling] = useState<PurchaseOrder | null>(null);
  const list = usePurchaseOrdersQuery({ status: status === 'all' ? undefined : status, page, limit: 30 });
  const config = useConfigQuery();
  const [action] = usePoActionMutation();
  const [receive] = useReceivePOMutation();
  const { busy, run } = useAction();
  const isAdmin = is('admin');
  const canCreate = is('admin', 'warehouse_manager');
  const canReceive = is('admin', 'warehouse_manager', 'staff');
  const isSupplier = is('supplier');

  const receiveAll = (po: PurchaseOrder) =>
    run(
      `ra-${po._id}`,
      () =>
        receive({
          id: po._id,
          receivedItems: po.items
            .filter((i) => i.quantityOrdered > i.quantityReceived)
            .map((i) => ({ product: i.product._id, quantityReceived: i.quantityOrdered - i.quantityReceived })),
        }).unwrap(),
      (r) => `${po.poNumber} received${r.leadTimeSample ? `; lead time ${r.leadTimeSample.days} d recorded` : ''}`,
    );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Purchase orders</h1>
          <p>{isSupplier ? 'Orders placed with you. Confirm, then dispatch.' : 'Manual and auto-drafted orders, with the reasoning behind every drafted line.'}</p>
        </div>
        {canCreate && (
          <div className="btn-group">
            <button type="button" className="btn btn-primary" onClick={() => setPanel(panel === 'new' ? null : 'new')}>
              New PO
            </button>
            <button type="button" className="btn btn-navy" onClick={() => setPanel(panel === 'auto' ? null : 'auto')}>
              Auto-draft from reorder points
            </button>
          </div>
        )}
      </div>
      {panel === 'new' && <NewPOForm onDone={() => setPanel(null)} />}
      {panel === 'auto' && <AutoDraftPanel onDone={() => setPanel(null)} />}
      <div className="card">
        <div className="mb">
          <Chips
            label="Status filter"
            items={FILTERS}
            value={status}
            onChange={(s) => {
              setStatus(s);
              setPage(1);
            }}
          />
        </div>
        <DataTable<PurchaseOrder>
          rows={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(p) => p._id}
          empty="No purchase orders for this filter"
          rowClassName={(p) => (p._id === focus ? 'row-highlight' : undefined)}
          columns={[
            { key: 'po', header: 'PO no.', render: (p) => <strong>{p.poNumber}</strong>, sortValue: (p) => p.poNumber },
            { key: 'supplier', header: 'Supplier', render: (p) => p.supplier.name, sortValue: (p) => p.supplier.name },
            { key: 'wh', header: 'Warehouse', render: (p) => p.warehouse.code, sortValue: (p) => p.warehouse.code },
            { key: 'status', header: 'Status', render: (p) => <Badge status={p.status} />, sortValue: (p) => p.status },
            {
              key: 'lines',
              header: 'Lines',
              render: (p) => (
                <span className="small">
                  {p.items.map((i) => `${i.product.sku} ${i.quantityReceived ? `${i.quantityReceived}/` : ''}${i.quantityOrdered}`).join(', ')}
                </span>
              ),
            },
            { key: 'total', header: 'Total', align: 'right', render: (p) => rupees(p.totalCost), sortValue: (p) => p.totalCost },
            { key: 'auto', header: 'Auto', render: (p) => (p.autoGenerated ? <Badge tone="navy">Auto</Badge> : '') },
            { key: 'source', header: 'Source', render: (p) => (p.recoveryPlan ? <Link to={`/recovery/${p.recoveryPlan._id}`}>{p.recoveryPlan.planNo}</Link> : humanize(p.source)) },
            { key: 'exp', header: 'Expected', render: (p) => date(p.expectedDeliveryDate), sortValue: (p) => p.expectedDeliveryDate ?? '' },
            {
              key: 'actions',
              header: 'Actions',
              render: (p) => (
                <div className="btn-group">
                  {!isSupplier && (
                    <button type="button" className="btn btn-sm" onClick={() => setWhy(p)}>
                      Why?
                    </button>
                  )}
                  {canCreate && p.status === 'draft' && (
                    <button type="button" className="btn btn-sm" disabled={busy === p._id} onClick={() => run(p._id, () => action({ id: p._id, action: 'submit' }).unwrap(), `${p.poNumber} submitted`)}>
                      Submit
                    </button>
                  )}
                  {isAdmin && p.status === 'pending_approval' && (
                    <>
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy === p._id} onClick={() => run(p._id, () => action({ id: p._id, action: 'approve' }).unwrap(), `${p.poNumber} approved`)}>
                        {busy === p._id ? 'Saving...' : 'Approve'}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setRejecting(p)}>
                        Reject
                      </button>
                    </>
                  )}
                  {isSupplier && <SupplierPOActions po={p} />}
                  {canReceive && RECEIVABLE.includes(p.status) && (
                    <>
                      <button type="button" className="btn btn-sm btn-navy" disabled={busy === `ra-${p._id}`} onClick={() => receiveAll(p)}>
                        {busy === `ra-${p._id}` ? 'Saving...' : 'Receive all'}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setReceiving(p)}>
                        Receive...
                      </button>
                    </>
                  )}
                  {isAdmin && ['draft', 'pending_approval', 'approved', 'confirmed', 'dispatched'].includes(p.status) && (
                    <button type="button" className="btn btn-sm" onClick={() => setCancelling(p)}>
                      Cancel
                    </button>
                  )}
                  {isAdmin && config.data?.paymentsEnabled && p.payment.status === 'none' && RECEIVABLE.concat('received').includes(p.status) && (
                    <button type="button" className="btn btn-sm" disabled={busy === `pay-${p._id}`} onClick={() => run(`pay-${p._id}`, () => action({ id: p._id, action: 'pay' }).unwrap(), (r) => `Payment created: ${r.payment.reference}`)}>
                      Pay
                    </button>
                  )}
                  {p.payment.status !== 'none' && <Badge tone="info">{`Payment ${p.payment.status}`}</Badge>}
                </div>
              ),
            },
          ]}
        />
        {list.data && <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />}
      </div>
      {why && <WhyModal po={why} onClose={() => setWhy(null)} />}
      {receiving && <ReceiveModal po={receiving} onClose={() => setReceiving(null)} />}
      <ConfirmDialog
        open={!!rejecting}
        title={`Reject ${rejecting?.poNumber ?? ''}`}
        requireReason
        confirmLabel="Reject"
        danger
        onConfirm={(reason) => action({ id: rejecting!._id, action: 'reject', reason }).unwrap()}
        onClose={() => setRejecting(null)}
      />
      <ConfirmDialog
        open={!!cancelling}
        title={`Cancel ${cancelling?.poNumber ?? ''}`}
        message="The supplier will no longer deliver this order. This cannot be undone."
        confirmLabel="Cancel PO"
        danger
        onConfirm={() => action({ id: cancelling!._id, action: 'cancel' }).unwrap()}
        onClose={() => setCancelling(null)}
      />
    </>
  );
}

import { useEffect, useState } from 'react';
import { useCreateDependencyMutation, useCreateOrderMutation, useCustomerOrdersQuery, useDeleteDependencyMutation, useDependenciesQuery, useUpdateOrderMutation } from '../api/modules';
import Badge from '../components/Badge';
import ConfirmDialog from '../components/ConfirmDialog';
import DataTable from '../components/DataTable';
import FormField, { FormStatus } from '../components/FormField';
import Pager from '../components/Pager';
import { ProductSelect, WarehouseSelect } from '../components/Selects';
import Tabs from '../components/Tabs';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import { useForm } from '../hooks/useForm';
import type { CustomerOrder, ProductDependency } from '../types';
import { date, inputDate, number } from '../utils/format';
import { collect, positive, required } from '../utils/validate';

interface Line {
  product: string;
  quantity: string;
}

function OrderForm({ order, onDone }: { order: CustomerOrder | null; onDone: () => void }) {
  const { ownWarehouse } = useAuth();
  const [create] = useCreateOrderMutation();
  const [update] = useUpdateOrderMutation();
  const [lines, setLines] = useState<Line[]>([{ product: '', quantity: '' }]);
  const [lineError, setLineError] = useState('');
  const f = useForm({ orderNo: '', customerName: '', warehouse: ownWarehouse ?? '', requiredBy: '', priority: 'normal' }, (v) =>
    collect({ customerName: required(v.customerName, 'Customer'), warehouse: required(v.warehouse, 'Warehouse'), requiredBy: required(v.requiredBy, 'Required by') }),
  );
  const { reset } = f;
  useEffect(() => {
    if (order) {
      reset({ orderNo: order.orderNo, customerName: order.customerName, warehouse: order.warehouse._id, requiredBy: inputDate(order.requiredBy), priority: order.priority });
      setLines(order.items.map((i) => ({ product: i.product._id, quantity: String(i.quantity) })));
    } else {
      reset({ orderNo: '', customerName: '', warehouse: ownWarehouse ?? '', requiredBy: '', priority: 'normal' });
      setLines([{ product: '', quantity: '' }]);
    }
  }, [order, reset, ownWarehouse]);
  const onSubmit = f.submit(async (v) => {
    const bad = lines.find((l) => required(l.product) || positive(l.quantity));
    if (bad) {
      setLineError('Every line needs a product and a quantity greater than 0');
      throw new Error('Fix the order lines');
    }
    if (new Set(lines.map((l) => l.product)).size !== lines.length) {
      setLineError('Each product can appear only once');
      throw new Error('Fix the order lines');
    }
    setLineError('');
    const items = lines.map((l) => ({ product: l.product, quantity: Number(l.quantity) }));
    if (order) {
      await update({ id: order._id, data: { customerName: v.customerName.trim(), requiredBy: new Date(v.requiredBy).toISOString(), priority: v.priority, items } }).unwrap();
      onDone();
      return `${order.orderNo} updated`;
    }
    const o = await create({ orderNo: v.orderNo.trim(), customerName: v.customerName.trim(), warehouse: v.warehouse, requiredBy: new Date(v.requiredBy).toISOString(), priority: v.priority, items }).unwrap();
    setLines([{ product: '', quantity: '' }]);
    return `Order ${o.orderNo} created`;
  }, { keepValues: !!order });
  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2>{order ? `Edit ${order.orderNo}` : 'New order'}</h2>
      <div className="form-grid">
        <FormField label="Order no." htmlFor="co-no" hint="Blank = generated">
          <input id="co-no" {...f.bind('orderNo')} disabled={!!order} />
        </FormField>
        <FormField label="Customer" htmlFor="co-cust" error={f.errors.customerName} required>
          <input id="co-cust" {...f.bind('customerName')} />
        </FormField>
        <FormField label="Warehouse" htmlFor="co-wh" error={f.errors.warehouse} required>
          <WarehouseSelect id="co-wh" {...f.bind('warehouse')} disabled={!!order || !!ownWarehouse} />
        </FormField>
        <FormField label="Required by" htmlFor="co-date" error={f.errors.requiredBy} required>
          <input id="co-date" type="date" {...f.bind('requiredBy')} />
        </FormField>
        <FormField label="Priority" htmlFor="co-prio">
          <select id="co-prio" {...f.bind('priority')}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </FormField>
      </div>
      <h3>Lines</h3>
      {lines.map((l, i) => (
        <div key={i} className="line-row" style={{ gridTemplateColumns: '2fr 1fr auto' }}>
          <FormField label="Product" htmlFor={`co-p-${i}`}>
            <ProductSelect id={`co-p-${i}`} value={l.product} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, product: e.target.value } : x)))} />
          </FormField>
          <FormField label="Quantity" htmlFor={`co-q-${i}`}>
            <input id={`co-q-${i}`} type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
          </FormField>
          <button type="button" className="btn btn-sm" style={{ marginBottom: 12 }} disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
            Remove line
          </button>
        </div>
      ))}
      {lineError && <div className="error-text mb">{lineError}</div>}
      <button type="button" className="btn btn-sm mb" onClick={() => setLines([...lines, { product: '', quantity: '' }])}>
        Add line
      </button>
      <FormStatus error={f.serverError} success={f.success} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={f.saving}>
          {f.saving ? 'Saving...' : order ? 'Save' : 'Create order'}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Close
        </button>
      </div>
    </form>
  );
}

function Dependencies() {
  const deps = useDependenciesQuery();
  const [create] = useCreateDependencyMutation();
  const [del] = useDeleteDependencyMutation();
  const [deleting, setDeleting] = useState<ProductDependency | null>(null);
  const f = useForm({ componentProduct: '', finishedProduct: '', quantityPer: '1' }, (v) =>
    collect({
      componentProduct: required(v.componentProduct, 'Component'),
      finishedProduct: required(v.finishedProduct, 'Finished product') ?? (v.finishedProduct === v.componentProduct ? 'Must differ from the component' : undefined),
      quantityPer: positive(v.quantityPer, 'Quantity per'),
    }),
  );
  const onSubmit = f.submit(async (v) => {
    await create({ componentProduct: v.componentProduct, finishedProduct: v.finishedProduct, quantityPer: Number(v.quantityPer) }).unwrap();
    return 'Dependency added';
  });
  return (
    <div className="card">
      <p className="muted">Bill-of-materials links used by the simulator: when a component stops, the finished product and its orders are affected.</p>
      <form onSubmit={onSubmit} noValidate className="form-grid">
        <FormField label="Component" htmlFor="dep-c" error={f.errors.componentProduct} required>
          <ProductSelect id="dep-c" {...f.bind('componentProduct')} />
        </FormField>
        <FormField label="Finished product" htmlFor="dep-f" error={f.errors.finishedProduct} required>
          <ProductSelect id="dep-f" {...f.bind('finishedProduct')} />
        </FormField>
        <FormField label="Quantity per finished unit" htmlFor="dep-q" error={f.errors.quantityPer} required>
          <input id="dep-q" type="number" step="0.01" {...f.bind('quantityPer')} />
        </FormField>
        <div className="form-actions" style={{ alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary" disabled={f.saving}>
            {f.saving ? 'Saving...' : 'Add link'}
          </button>
        </div>
      </form>
      <FormStatus error={f.serverError} success={f.success} />
      <DataTable<ProductDependency>
        rows={deps.data?.items}
        loading={deps.isLoading}
        error={deps.error}
        onRetry={deps.refetch}
        rowKey={(d) => d._id}
        empty="No dependencies"
        columns={[
          { key: 'c', header: 'Component', render: (d) => `${d.componentProduct.sku} ${d.componentProduct.name}` },
          { key: 'arrow', header: '', render: () => '→' },
          { key: 'f', header: 'Finished product', render: (d) => `${d.finishedProduct.sku} ${d.finishedProduct.name}` },
          { key: 'q', header: 'Qty per', align: 'right', render: (d) => number(d.quantityPer) },
          {
            key: 'a',
            header: '',
            render: (d) => (
              <button type="button" className="btn btn-sm" onClick={() => setDeleting(d)}>
                Remove
              </button>
            ),
          },
        ]}
      />
      <ConfirmDialog open={!!deleting} title="Remove dependency" message="The simulator will no longer link these products." confirmLabel="Remove" danger onConfirm={() => del(deleting!._id).unwrap()} onClose={() => setDeleting(null)} />
    </div>
  );
}

export default function CustomerOrders() {
  const [tab, setTab] = useState<'orders' | 'deps'>('orders');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CustomerOrder | 'new' | null>(null);
  const [cancelling, setCancelling] = useState<CustomerOrder | null>(null);
  const list = useCustomerOrdersQuery({ status: status || undefined, page });
  const [update] = useUpdateOrderMutation();
  const { busy, run } = useAction();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Customer orders</h1>
          <p>Downstream orders and product dependencies that the Domino simulator traces disruptions to.</p>
        </div>
        {tab === 'orders' && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
            {editing === 'new' ? 'Close form' : 'New order'}
          </button>
        )}
      </div>
      <Tabs label="Customer order sections" tabs={[{ id: 'orders', label: 'Orders' }, { id: 'deps', label: 'Product dependencies' }]} value={tab} onChange={setTab} />
      {tab === 'deps' ? (
        <Dependencies />
      ) : (
        <>
          {editing && <OrderForm order={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
          <div className="card">
            <div className="filters">
              <div className="field">
                <label htmlFor="co-status">Status</label>
                <select id="co-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                  <option value="">All</option>
                  <option value="open">Open</option>
                  <option value="fulfilled">Fulfilled</option>
                  <option value="late">Late</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <DataTable<CustomerOrder>
              rows={list.data?.items}
              loading={list.isLoading}
              error={list.error}
              onRetry={list.refetch}
              rowKey={(o) => o._id}
              empty="No customer orders"
              columns={[
                { key: 'no', header: 'Order no.', render: (o) => <strong>{o.orderNo}</strong>, sortValue: (o) => o.orderNo },
                { key: 'c', header: 'Customer', render: (o) => o.customerName, sortValue: (o) => o.customerName },
                { key: 'w', header: 'Warehouse', render: (o) => o.warehouse.code },
                { key: 'l', header: 'Lines', render: (o) => o.items.map((i) => `${i.product.sku} × ${i.quantity}`).join(', ') },
                { key: 'd', header: 'Required by', render: (o) => date(o.requiredBy), sortValue: (o) => o.requiredBy },
                { key: 'p', header: 'Priority', render: (o) => <Badge tone={o.priority === 'high' ? 'danger' : o.priority === 'low' ? 'default' : 'info'}>{o.priority}</Badge> },
                { key: 's', header: 'Status', render: (o) => <Badge status={o.status} /> },
                {
                  key: 'a',
                  header: '',
                  render: (o) => (
                    <div className="btn-group">
                      {o.status === 'open' && (
                        <>
                          <button type="button" className="btn btn-sm" onClick={() => setEditing(o)}>
                            Edit
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => setCancelling(o)}>
                            Cancel
                          </button>
                        </>
                      )}
                      {o.status === 'open' && (
                        <button type="button" className="btn btn-sm" disabled={busy === o._id} onClick={() => run(o._id, () => update({ id: o._id, data: { status: 'fulfilled' } }).unwrap(), `${o.orderNo} marked fulfilled`)}>
                          Mark fulfilled
                        </button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
            {list.data && <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />}
          </div>
        </>
      )}
      <ConfirmDialog
        open={!!cancelling}
        title={`Cancel ${cancelling?.orderNo ?? ''}`}
        message="Cancelled orders are ignored by the simulator."
        confirmLabel="Cancel order"
        danger
        onConfirm={() => update({ id: cancelling!._id, data: { status: 'cancelled' } }).unwrap()}
        onClose={() => setCancelling(null)}
      />
    </>
  );
}

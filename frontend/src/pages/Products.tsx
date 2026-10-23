import { useEffect, useState } from 'react';
import { ProductInput, useCreateProductMutation, useProductQrQuery, useProductsQuery, useUpdateProductMutation, useUploadProductImageMutation } from '../api/inventory';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import FormField, { FormStatus } from '../components/FormField';
import Modal from '../components/Modal';
import Pager from '../components/Pager';
import QueryState from '../components/QueryState';
import { SupplierSelect } from '../components/Selects';
import { useForm } from '../hooks/useForm';
import { useAuth } from '../hooks/useAuth';
import type { Product } from '../types';
import { number, rupees } from '../utils/format';
import { collect, nonNegative, optNum, positive, required } from '../utils/validate';

const EMPTY = {
  sku: '',
  name: '',
  description: '',
  category: 'General',
  unit: 'pcs',
  unitCost: '',
  unitPrice: '',
  primarySupplier: '',
  avgDailyDemand: '1',
  demandStdDev: '0',
  serviceLevelZ: '1.65',
  orderCost: '20',
  holdingCostPerUnitYear: '2',
  leadTimeDaysOverride: '',
  isPerishable: false,
  shelfLifeDays: '',
  minShelfLifeDays: '1',
};
type FormValues = typeof EMPTY;

function toForm(p: Product): FormValues {
  const s = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
  return {
    sku: p.sku,
    name: p.name,
    description: p.description,
    category: p.category,
    unit: p.unit,
    unitCost: s(p.unitCost),
    unitPrice: s(p.unitPrice),
    primarySupplier: p.primarySupplier?._id ?? '',
    avgDailyDemand: s(p.avgDailyDemand),
    demandStdDev: s(p.demandStdDev),
    serviceLevelZ: s(p.serviceLevelZ),
    orderCost: s(p.orderCost),
    holdingCostPerUnitYear: s(p.holdingCostPerUnitYear),
    leadTimeDaysOverride: s(p.leadTimeDaysOverride),
    isPerishable: p.isPerishable,
    shelfLifeDays: s(p.shelfLifeDays),
    minShelfLifeDays: s(p.minShelfLifeDays),
  };
}

function validate(v: FormValues) {
  return collect<FormValues>({
    sku: required(v.sku, 'SKU'),
    name: required(v.name, 'Name'),
    unitCost: nonNegative(v.unitCost, 'Unit cost'),
    unitPrice: nonNegative(v.unitPrice, 'Unit price'),
    avgDailyDemand: nonNegative(v.avgDailyDemand, 'Average daily demand'),
    demandStdDev: nonNegative(v.demandStdDev, 'Demand std dev'),
    serviceLevelZ: nonNegative(v.serviceLevelZ, 'Service-level z'),
    orderCost: nonNegative(v.orderCost, 'Order cost'),
    holdingCostPerUnitYear: positive(v.holdingCostPerUnitYear, 'Holding cost'),
    leadTimeDaysOverride: nonNegative(v.leadTimeDaysOverride, 'Lead-time override', true),
    shelfLifeDays: v.isPerishable ? positive(v.shelfLifeDays, 'Shelf life') : nonNegative(v.shelfLifeDays, 'Shelf life', true),
    minShelfLifeDays: nonNegative(v.minShelfLifeDays, 'Min shelf life'),
  });
}

function ProductForm({ product, onDone }: { product: Product | null; onDone: () => void }) {
  const [create] = useCreateProductMutation();
  const [update] = useUpdateProductMutation();
  const [upload] = useUploadProductImageMutation();
  const [file, setFile] = useState<File | null>(null);
  const f = useForm<FormValues>(product ? toForm(product) : EMPTY, validate);
  const { reset } = f;
  useEffect(() => reset(product ? toForm(product) : EMPTY), [product, reset]);

  const onSubmit = f.submit(async (v) => {
    const data: ProductInput = {
      sku: v.sku.trim(),
      name: v.name.trim(),
      description: v.description,
      category: v.category.trim() || 'General',
      unit: v.unit.trim() || 'pcs',
      unitCost: Number(v.unitCost),
      unitPrice: Number(v.unitPrice),
      primarySupplier: v.primarySupplier || null,
      avgDailyDemand: Number(v.avgDailyDemand),
      demandStdDev: Number(v.demandStdDev),
      serviceLevelZ: Number(v.serviceLevelZ),
      orderCost: Number(v.orderCost),
      holdingCostPerUnitYear: Number(v.holdingCostPerUnitYear),
      leadTimeDaysOverride: optNum(v.leadTimeDaysOverride),
      isPerishable: v.isPerishable,
      shelfLifeDays: optNum(v.shelfLifeDays),
      minShelfLifeDays: Number(v.minShelfLifeDays),
    };
    const saved = product ? await update({ id: product._id, data }).unwrap() : await create(data).unwrap();
    if (file) await upload({ id: saved._id, file }).unwrap();
    setFile(null);
    if (product) onDone();
    return product ? `${saved.sku} updated` : `${saved.sku} created`;
  }, { keepValues: !!product });

  const field = (key: keyof FormValues, label: string, opts: { type?: string; hint?: string; req?: boolean; step?: string } = {}) => (
    <FormField label={label} htmlFor={`pf-${key}`} error={f.errors[key]} hint={opts.hint} required={opts.req}>
      <input id={`pf-${key}`} type={opts.type ?? 'text'} step={opts.step} {...f.bind(key)} />
    </FormField>
  );

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <div className="card-head">
        <h2>{product ? `Edit ${product.sku}` : 'Add product'}</h2>
      </div>
      <div className="form-grid">
        {field('sku', 'SKU', { req: true, hint: 'Also the QR payload' })}
        {field('name', 'Name', { req: true })}
        {field('category', 'Category')}
        {field('unit', 'Unit')}
        {field('unitCost', 'Unit cost (₹)', { type: 'number', step: '0.01', req: true })}
        {field('unitPrice', 'Unit price (₹)', { type: 'number', step: '0.01', req: true })}
        <FormField label="Primary supplier" htmlFor="pf-supplier">
          <SupplierSelect id="pf-supplier" placeholder="None" {...f.bind('primarySupplier')} />
        </FormField>
        {field('avgDailyDemand', 'Avg daily demand', { type: 'number', step: '0.01', hint: 'Used until 7 days of history exist' })}
        {field('demandStdDev', 'Demand std dev (σ)', { type: 'number', step: '0.01' })}
        {field('serviceLevelZ', 'Service-level z', { type: 'number', step: '0.01', hint: '1.65 ≈ 95%' })}
        {field('orderCost', 'Order cost S (₹)', { type: 'number', step: '0.01' })}
        {field('holdingCostPerUnitYear', 'Holding cost H (₹/unit/yr)', { type: 'number', step: '0.01' })}
        {field('leadTimeDaysOverride', 'Lead-time override (days)', { type: 'number', step: '0.1', hint: 'Blank = learn from supplier' })}
        {field('shelfLifeDays', 'Shelf life (days)', { type: 'number', req: f.values.isPerishable })}
        {field('minShelfLifeDays', 'Min shelf life at sale (days)', { type: 'number' })}
        <FormField label="Image" htmlFor="pf-image" hint={product?.imageUrl ? 'Uploading replaces the current image' : 'PNG or JPG, up to 5 MB'}>
          <input id="pf-image" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </FormField>
      </div>
      <FormField label="Description" htmlFor="pf-description">
        <textarea id="pf-description" rows={2} {...f.bind('description')} />
      </FormField>
      <label className="check">
        <input type="checkbox" checked={f.values.isPerishable} onChange={(e) => f.set('isPerishable', e.target.checked)} /> Perishable (requires expiry dates on receipt)
      </label>
      <FormStatus error={f.serverError} success={f.success} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={f.saving}>
          {f.saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Close
        </button>
      </div>
    </form>
  );
}

function QrModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const q = useProductQrQuery(product._id);
  const download = () => {
    if (!q.data) return;
    const a = document.createElement('a');
    a.href = q.data.dataUrl;
    a.download = `${product.sku}-qr.png`;
    a.click();
  };
  const print = () => {
    if (!q.data) return;
    const w = window.open('', '_blank', 'width=420,height=520');
    if (!w) return;
    w.document.write(
      `<html><head><title>${product.sku}</title></head><body style="font-family:sans-serif;text-align:center;padding:20px">` +
        `<img src="${q.data.dataUrl}" style="width:240px"/><h2 style="margin:6px 0">${product.sku}</h2><div>${product.name.replace(/</g, '&lt;')}</div>` +
        `<script>window.onload=function(){window.print();}</script></body></html>`,
    );
    w.document.close();
  };
  return (
    <Modal
      open
      title={`QR label: ${product.sku}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" disabled={!q.data} onClick={download}>
            Download PNG
          </button>
          <button type="button" className="btn btn-navy" disabled={!q.data} onClick={print}>
            Print label
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <QueryState loading={q.isLoading} error={q.error} onRetry={q.refetch}>
        <div style={{ textAlign: 'center' }}>
          <img src={q.data?.dataUrl} alt={`QR code for ${product.sku}`} style={{ width: 240, height: 240 }} />
          <div className="mono">{q.data?.payload}</div>
          <strong>{product.sku}</strong>
          <div className="muted">{product.name}</div>
        </div>
      </QueryState>
    </Modal>
  );
}

const SOURCE_LABEL: Record<string, string> = { override: 'Override', blended: 'Learned', nominal: 'Promised', default: 'Default' };

export default function Products() {
  const { is } = useAuth();
  const canEdit = is('admin', 'warehouse_manager');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [qr, setQr] = useState<Product | null>(null);
  const list = useProductsQuery({ q: search || undefined, page, limit: 50 });

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p>Catalogue, reorder parameters and QR labels.</p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
            {editing === 'new' ? 'Close form' : 'Add product'}
          </button>
        )}
      </div>
      {editing && <ProductForm product={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      <div className="card">
        <div className="filters">
          <div className="field grow">
            <label htmlFor="prod-search">Search</label>
            <input id="prod-search" type="search" placeholder="Name, SKU or category" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <DataTable<Product>
          rows={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(p) => p._id}
          empty={search ? `No products match "${search}"` : 'No products yet'}
          columns={[
            { key: 'sku', header: 'SKU', render: (p) => <strong>{p.sku}</strong>, sortValue: (p) => p.sku },
            { key: 'name', header: 'Name', render: (p) => <>{p.name} {p.isPerishable && <Badge tone="info">Perishable</Badge>}</>, sortValue: (p) => p.name },
            { key: 'category', header: 'Category', sortValue: (p) => p.category },
            { key: 'unit', header: 'Unit' },
            { key: 'cost', header: 'Cost', align: 'right', render: (p) => rupees(p.unitCost), sortValue: (p) => p.unitCost },
            { key: 'price', header: 'Price', align: 'right', render: (p) => rupees(p.unitPrice), sortValue: (p) => p.unitPrice },
            { key: 'supplier', header: 'Supplier', render: (p) => (p.primarySupplier ? <>{p.primarySupplier.name} {p.primarySupplier.status === 'disrupted' && <Badge status="disrupted" />}</> : '—') },
            { key: 'demand', header: 'Demand/day', align: 'right', render: (p) => number(p.avgDailyDemand), sortValue: (p) => p.avgDailyDemand },
            { key: 'onhand', header: 'On hand', align: 'right', render: (p) => number(p.totalOnHand ?? 0, 0), sortValue: (p) => p.totalOnHand ?? 0 },
            {
              key: 'lt',
              header: 'Lead time',
              render: (p) => (
                <span className="nowrap">
                  {number(p.leadTime.days, 1)} d <Badge status={p.leadTime.source}>{SOURCE_LABEL[p.leadTime.source]}</Badge>
                </span>
              ),
              sortValue: (p) => p.leadTime.days,
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (p) => (
                <div className="btn-group">
                  <button type="button" className="btn btn-sm" onClick={() => setQr(p)}>
                    View QR
                  </button>
                  {canEdit && (
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
        {list.data && <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />}
      </div>
      {qr && <QrModal product={qr} onClose={() => setQr(null)} />}
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  OfferInput,
  useClearDisruptionMutation,
  useCreateOfferMutation,
  useCreateSupplierMutation,
  useDeclareDisruptionMutation,
  useDeleteOfferMutation,
  useOffersQuery,
  useSuppliersQuery,
  useUpdateOfferMutation,
  useUpdateSupplierMutation,
} from '../api/procurement';
import Badge from '../components/Badge';
import ConfirmDialog from '../components/ConfirmDialog';
import DataTable from '../components/DataTable';
import Drawer from '../components/Drawer';
import FormField, { FormStatus } from '../components/FormField';
import Modal from '../components/Modal';
import { ProductSelect } from '../components/Selects';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import { useForm } from '../hooks/useForm';
import type { Supplier, SupplierOffer } from '../types';
import { date, inputDate, number, rupees } from '../utils/format';
import { collect, nonNegative, positive, required } from '../utils/validate';

const EMPTY = { name: '', contactName: '', email: '', phone: '', address: '', leadTimeDays: '7' };

function SupplierForm({ supplier, onDone }: { supplier: Supplier | null; onDone: () => void }) {
  const [create] = useCreateSupplierMutation();
  const [update] = useUpdateSupplierMutation();
  const f = useForm(EMPTY, (v) =>
    collect({
      name: required(v.name, 'Name'),
      email: v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) ? 'Enter a valid email' : undefined,
      leadTimeDays: nonNegative(v.leadTimeDays, 'Promised lead time'),
    }),
  );
  const { reset } = f;
  useEffect(() => {
    reset(
      supplier
        ? { name: supplier.name, contactName: supplier.contactName, email: supplier.email, phone: supplier.phone, address: supplier.address, leadTimeDays: String(supplier.leadTimeDays) }
        : EMPTY,
    );
  }, [supplier, reset]);
  const onSubmit = f.submit(async (v) => {
    const data = { ...v, name: v.name.trim(), leadTimeDays: Number(v.leadTimeDays) };
    if (supplier) {
      await update({ id: supplier._id, data }).unwrap();
      onDone();
      return `${data.name} updated`;
    }
    await create(data).unwrap();
    return `${data.name} added`;
  }, { keepValues: !!supplier });
  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2>{supplier ? `Edit ${supplier.name}` : 'Add supplier'}</h2>
      <div className="form-grid">
        <FormField label="Name" htmlFor="sf-name" error={f.errors.name} required>
          <input id="sf-name" {...f.bind('name')} />
        </FormField>
        <FormField label="Contact" htmlFor="sf-contact">
          <input id="sf-contact" {...f.bind('contactName')} />
        </FormField>
        <FormField label="Email" htmlFor="sf-email" error={f.errors.email}>
          <input id="sf-email" type="email" {...f.bind('email')} />
        </FormField>
        <FormField label="Phone" htmlFor="sf-phone" hint="E.164 for SMS, e.g. +919800000000">
          <input id="sf-phone" type="tel" {...f.bind('phone')} />
        </FormField>
        <FormField label="Address" htmlFor="sf-address">
          <input id="sf-address" {...f.bind('address')} />
        </FormField>
        <FormField label="Promised lead time (days)" htmlFor="sf-lead" error={f.errors.leadTimeDays} required>
          <input id="sf-lead" type="number" step="0.5" {...f.bind('leadTimeDays')} />
        </FormField>
      </div>
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

function DisruptionModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [declare] = useDeclareDisruptionMutation();
  const f = useForm({ expectedDays: '7', reason: '' }, (v) => collect({ expectedDays: positive(v.expectedDays, 'Expected days') }));
  const onSubmit = f.submit(async (v) => {
    await declare({ id: supplier._id, expectedDays: Math.round(Number(v.expectedDays)), reason: v.reason.trim() }).unwrap();
    return `${supplier.name} marked as disrupted. Admins and managers have been notified.`;
  }, { keepValues: true });
  return (
    <Modal open title={`Declare disruption: ${supplier.name}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <FormField label="Expected days" htmlFor="dis-days" error={f.errors.expectedDays} required>
          <input id="dis-days" type="number" min={1} {...f.bind('expectedDays')} />
        </FormField>
        <FormField label="Reason" htmlFor="dis-reason">
          <textarea id="dis-reason" rows={2} {...f.bind('reason')} />
        </FormField>
        <FormStatus error={f.serverError} success={f.success} />
        <div className="form-actions">
          {!f.success ? (
            <button type="submit" className="btn btn-danger" disabled={f.saving}>
              {f.saving ? 'Saving...' : 'Declare disruption'}
            </button>
          ) : (
            <Link to={`/recovery?supplier=${supplier._id}`} className="btn btn-primary">
              Run recovery
            </Link>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

const OFFER_EMPTY = { product: '', capacityUnits: '', minOrderQty: '1', leadTimeDays: '', unitCost: '', validUntil: '' };

function OffersDrawer({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const offers = useOffersQuery({ supplier: supplier._id });
  const [create] = useCreateOfferMutation();
  const [update] = useUpdateOfferMutation();
  const [del] = useDeleteOfferMutation();
  const [editing, setEditing] = useState<SupplierOffer | null>(null);
  const [deleting, setDeleting] = useState<SupplierOffer | null>(null);
  const f = useForm(OFFER_EMPTY, (v) =>
    collect({
      product: editing ? undefined : required(v.product, 'Product'),
      capacityUnits: nonNegative(v.capacityUnits, 'Capacity'),
      minOrderQty: nonNegative(v.minOrderQty, 'MOQ') ?? (Number(v.minOrderQty) > Number(v.capacityUnits) ? 'MOQ cannot exceed capacity' : undefined),
      leadTimeDays: nonNegative(v.leadTimeDays, 'Lead time'),
      unitCost: nonNegative(v.unitCost, 'Unit cost'),
    }),
  );
  const startEdit = (o: SupplierOffer) => {
    setEditing(o);
    f.setValues({
      product: o.product._id,
      capacityUnits: String(o.capacityUnits),
      minOrderQty: String(o.minOrderQty),
      leadTimeDays: String(o.leadTimeDays),
      unitCost: String(o.unitCost),
      validUntil: inputDate(o.validUntil),
    });
  };
  const onSubmit = f.submit(async (v) => {
    const data: OfferInput = {
      capacityUnits: Number(v.capacityUnits),
      minOrderQty: Number(v.minOrderQty),
      leadTimeDays: Number(v.leadTimeDays),
      unitCost: Number(v.unitCost),
      validUntil: v.validUntil ? new Date(v.validUntil).toISOString() : null,
    };
    if (editing) {
      await update({ id: editing._id, data }).unwrap();
      setEditing(null);
      return 'Offer updated';
    }
    await create({ ...data, supplier: supplier._id, product: v.product }).unwrap();
    return 'Offer added';
  });
  return (
    <Drawer open title={`Offers: ${supplier.name}`} onClose={onClose}>
      <p className="muted small">Alternative sourcing offers used by the recovery engine and the simulator.</p>
      <DataTable<SupplierOffer>
        rows={offers.data?.items}
        loading={offers.isLoading}
        error={offers.error}
        onRetry={offers.refetch}
        rowKey={(o) => o._id}
        empty="No offers yet"
        dense
        columns={[
          { key: 'p', header: 'Product', render: (o) => o.product.sku },
          { key: 'cap', header: 'Capacity', align: 'right', render: (o) => number(o.capacityUnits, 0) },
          { key: 'moq', header: 'MOQ', align: 'right', render: (o) => number(o.minOrderQty, 0) },
          { key: 'lead', header: 'Lead time', align: 'right', render: (o) => `${number(o.leadTimeDays, 1)} d` },
          { key: 'cost', header: 'Unit cost', align: 'right', render: (o) => rupees(o.unitCost) },
          { key: 'valid', header: 'Valid until', render: (o) => date(o.validUntil) },
          {
            key: 'a',
            header: '',
            render: (o) => (
              <div className="btn-group">
                <button type="button" className="btn btn-sm" onClick={() => startEdit(o)}>
                  Edit
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setDeleting(o)}>
                  Delete
                </button>
              </div>
            ),
          },
        ]}
      />
      <form onSubmit={onSubmit} noValidate className="mt">
        <h3>{editing ? `Edit offer for ${editing.product.sku}` : 'Add offer'}</h3>
        <div className="form-grid">
          <FormField label="Product" htmlFor="of-product" error={f.errors.product} required>
            <ProductSelect id="of-product" {...f.bind('product')} disabled={!!editing} />
          </FormField>
          <FormField label="Capacity (units)" htmlFor="of-cap" error={f.errors.capacityUnits} required>
            <input id="of-cap" type="number" {...f.bind('capacityUnits')} />
          </FormField>
          <FormField label="MOQ" htmlFor="of-moq" error={f.errors.minOrderQty} required>
            <input id="of-moq" type="number" {...f.bind('minOrderQty')} />
          </FormField>
          <FormField label="Lead time (days)" htmlFor="of-lead" error={f.errors.leadTimeDays} required>
            <input id="of-lead" type="number" step="0.5" {...f.bind('leadTimeDays')} />
          </FormField>
          <FormField label="Unit cost (₹)" htmlFor="of-cost" error={f.errors.unitCost} required>
            <input id="of-cost" type="number" step="0.01" {...f.bind('unitCost')} />
          </FormField>
          <FormField label="Valid until" htmlFor="of-valid">
            <input id="of-valid" type="date" {...f.bind('validUntil')} />
          </FormField>
        </div>
        <FormStatus error={f.serverError} success={f.success} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={f.saving}>
            {f.saving ? 'Saving...' : editing ? 'Save offer' : 'Add offer'}
          </button>
          {editing && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditing(null);
                f.reset(OFFER_EMPTY);
              }}
            >
              Cancel edit
            </button>
          )}
        </div>
      </form>
      <ConfirmDialog
        open={!!deleting}
        title="Delete offer"
        message={deleting ? `Delete the ${deleting.product.sku} offer from ${supplier.name}?` : ''}
        confirmLabel="Delete"
        danger
        onConfirm={() => del(deleting!._id).unwrap()}
        onClose={() => setDeleting(null)}
      />
    </Drawer>
  );
}

export default function Suppliers() {
  const { is, user } = useAuth();
  const list = useSuppliersQuery();
  const [clear] = useClearDisruptionMutation();
  const [update] = useUpdateSupplierMutation();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [disrupting, setDisrupting] = useState<Supplier | null>(null);
  const [offersFor, setOffersFor] = useState<Supplier | null>(null);
  const isAdmin = is('admin');
  const canDisrupt = is('admin', 'warehouse_manager');
  const isSupplier = is('supplier');
  const canAdd = isAdmin || (isSupplier && !user?.supplier);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Suppliers</h1>
          <p>{isSupplier ? 'Your supplier record and the offers you make available.' : 'Promised vs learned lead times, reliability and alternative offers.'}</p>
        </div>
        {canAdd && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
            {editing === 'new' ? 'Close form' : isSupplier ? 'Register my company' : 'Add supplier'}
          </button>
        )}
      </div>
      {editing && <SupplierForm supplier={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      <div className="card">
        <DataTable<Supplier>
          rows={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(s) => s._id}
          empty={isSupplier ? 'Your account is not linked to a supplier record yet' : 'No suppliers yet'}
          columns={[
            { key: 'name', header: 'Name', render: (s) => <strong>{s.name}</strong>, sortValue: (s) => s.name },
            { key: 'contact', header: 'Contact', render: (s) => <>{s.contactName}<div className="muted small">{s.email}</div></> },
            { key: 'promised', header: 'Promised', align: 'right', render: (s) => `${number(s.leadTimeDays, 1)} d`, sortValue: (s) => s.leadTimeDays },
            {
              key: 'learned',
              header: 'Learned',
              align: 'right',
              render: (s) => (
                <span className={s.leadTime.mean > s.leadTimeDays ? 'nowrap' : 'nowrap'} title="(3 x promised + sum of observed) / (3 + deliveries)">
                  {number(s.leadTime.mean, 2)} d {s.leadTime.mean > s.leadTimeDays + 0.01 && <Badge tone="warning">slower</Badge>}
                </span>
              ),
              sortValue: (s) => s.leadTime.mean,
            },
            { key: 'std', header: 'Std dev', align: 'right', render: (s) => number(s.leadTime.std, 2) },
            { key: 'samples', header: 'Samples', align: 'right', render: (s) => s.leadTime.samples },
            { key: 'ontime', header: 'On-time', align: 'right', render: (s) => s.onTimeDeliveries },
            { key: 'late', header: 'Late', align: 'right', render: (s) => s.lateDeliveries },
            {
              key: 'score',
              header: 'Score',
              align: 'right',
              render: (s) => <Badge tone={s.performanceScore >= 90 ? 'success' : s.performanceScore >= 60 ? 'warning' : 'danger'}>{number(s.performanceScore, 1)}</Badge>,
              sortValue: (s) => s.performanceScore,
            },
            {
              key: 'status',
              header: 'Status',
              render: (s) => (
                <>
                  <Badge status={s.status} />
                  {s.disruption && <div className="muted small">{s.disruption.expectedDays} d · {s.disruption.reason || 'no reason'}</div>}
                </>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              render: (s) => (
                <div className="btn-group">
                  {isAdmin && (
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(s)}>
                      Edit
                    </button>
                  )}
                  <button type="button" className="btn btn-sm" onClick={() => setOffersFor(s)}>
                    Offers
                  </button>
                  {canDisrupt && s.status !== 'disrupted' && (
                    <button type="button" className="btn btn-sm" onClick={() => setDisrupting(s)}>
                      Declare disruption
                    </button>
                  )}
                  {canDisrupt && s.status === 'disrupted' && (
                    <>
                      <Link to={`/recovery?supplier=${s._id}`} className="btn btn-sm btn-primary">
                        Run recovery
                      </Link>
                      <button type="button" className="btn btn-sm" disabled={busy === s._id} onClick={() => run(s._id, () => clear(s._id).unwrap(), `${s.name} disruption cleared`)}>
                        {busy === s._id ? 'Saving...' : 'Clear disruption'}
                      </button>
                    </>
                  )}
                  {isAdmin && s.status !== 'disrupted' && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy === `st-${s._id}`}
                      onClick={() =>
                        run(`st-${s._id}`, () => update({ id: s._id, data: { status: s.status === 'inactive' ? 'active' : 'inactive' } }).unwrap(), `${s.name} ${s.status === 'inactive' ? 'activated' : 'deactivated'}`)
                      }
                    >
                      {s.status === 'inactive' ? 'Activate' : 'Deactivate'}
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>
      {disrupting && <DisruptionModal supplier={disrupting} onClose={() => setDisrupting(null)} />}
      {offersFor && <OffersDrawer supplier={offersFor} onClose={() => setOffersFor(null)} />}
    </>
  );
}

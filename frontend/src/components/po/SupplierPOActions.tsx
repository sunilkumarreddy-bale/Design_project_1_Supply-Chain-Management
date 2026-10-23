import { useState } from 'react';
import { useConfirmPOMutation, useDispatchPOMutation } from '../../api/procurement';
import { useForm } from '../../hooks/useForm';
import type { PurchaseOrder } from '../../types';
import { inputDate } from '../../utils/format';
import { collect, nonNegative, required } from '../../utils/validate';
import FormField, { FormStatus } from '../FormField';
import Modal from '../Modal';

function ConfirmModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const [confirm] = useConfirmPOMutation();
  const ordered = po.items.reduce((s, i) => s + i.quantityOrdered, 0);
  const f = useForm({ confirmedQty: String(ordered), confirmedDate: inputDate(po.expectedDeliveryDate) }, (v) =>
    collect({ confirmedQty: nonNegative(v.confirmedQty, 'Confirmed quantity'), confirmedDate: required(v.confirmedDate, 'Delivery date') }),
  );
  const onSubmit = f.submit(async (v) => {
    await confirm({ id: po._id, confirmedQty: Number(v.confirmedQty), confirmedDate: new Date(v.confirmedDate).toISOString() }).unwrap();
    setTimeout(onClose, 600);
    return `${po.poNumber} confirmed`;
  }, { keepValues: true });
  return (
    <Modal open title={`Confirm ${po.poNumber}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <p className="muted">Ordered: {ordered} units across {po.items.length} line(s).</p>
        <FormField label="Confirmed quantity" htmlFor="c-qty" error={f.errors.confirmedQty} required>
          <input id="c-qty" type="number" min={0} {...f.bind('confirmedQty')} />
        </FormField>
        <FormField label="Delivery date" htmlFor="c-date" error={f.errors.confirmedDate} required>
          <input id="c-date" type="date" {...f.bind('confirmedDate')} />
        </FormField>
        <FormStatus error={f.serverError} success={f.success} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={f.saving}>
            {f.saving ? 'Saving...' : 'Confirm order'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DispatchModal({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const [dispatch] = useDispatchPOMutation();
  const f = useForm({ carrier: '', trackingNo: '', eta: inputDate(po.expectedDeliveryDate) }, (v) => collect({ carrier: required(v.carrier, 'Carrier') }));
  const onSubmit = f.submit(async (v) => {
    await dispatch({ id: po._id, carrier: v.carrier.trim(), trackingNo: v.trackingNo.trim(), eta: v.eta ? new Date(v.eta).toISOString() : null }).unwrap();
    setTimeout(onClose, 600);
    return `${po.poNumber} dispatched`;
  }, { keepValues: true });
  return (
    <Modal open title={`Dispatch ${po.poNumber}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <FormField label="Carrier" htmlFor="d-carrier" error={f.errors.carrier} required>
          <input id="d-carrier" {...f.bind('carrier')} />
        </FormField>
        <FormField label="Tracking number" htmlFor="d-track">
          <input id="d-track" {...f.bind('trackingNo')} />
        </FormField>
        <FormField label="ETA" htmlFor="d-eta">
          <input id="d-eta" type="date" {...f.bind('eta')} />
        </FormField>
        <FormStatus error={f.serverError} success={f.success} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={f.saving}>
            {f.saving ? 'Saving...' : 'Mark dispatched'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Supplier portal buttons: Confirm (approved POs) and Dispatch (approved or confirmed POs). */
export default function SupplierPOActions({ po }: { po: PurchaseOrder }) {
  const [open, setOpen] = useState<'confirm' | 'dispatch' | null>(null);
  return (
    <>
      <div className="btn-group">
        {po.status === 'approved' && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen('confirm')}>
            Confirm
          </button>
        )}
        {(po.status === 'approved' || po.status === 'confirmed') && (
          <button type="button" className="btn btn-sm btn-navy" onClick={() => setOpen('dispatch')}>
            Dispatch
          </button>
        )}
      </div>
      {open === 'confirm' && <ConfirmModal po={po} onClose={() => setOpen(null)} />}
      {open === 'dispatch' && <DispatchModal po={po} onClose={() => setOpen(null)} />}
    </>
  );
}

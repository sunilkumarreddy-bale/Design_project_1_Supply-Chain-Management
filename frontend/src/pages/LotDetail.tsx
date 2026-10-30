import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { downloadFile, errorMessage } from '../api/client';
import {
  useAcceptReturnMutation,
  useDamageLotMutation,
  useDecideRequestMutation,
  useDisposeLotMutation,
  useGenealogyQuery,
  useLotFlagMutation,
  useLotQuery,
  useReturnLotMutation,
  useTimelineQuery,
  useVerifyLotMutation,
} from '../api/dna';
import Banner from '../components/Banner';
import ConfirmDialog from '../components/ConfirmDialog';
import DataTable from '../components/DataTable';
import FormField, { FormStatus } from '../components/FormField';
import Modal from '../components/Modal';
import QueryState from '../components/QueryState';
import { WarehouseSelect } from '../components/Selects';
import GenealogyTree from '../components/dna/GenealogyTree';
import JourneyStrip from '../components/dna/JourneyStrip';
import Lifeline from '../components/dna/Lifeline';
import { isDeadLot, LifeBar, LotStatusBadge, RefLink } from '../components/dna/LotParts';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import type { DisposalCause, LotDetail as Lot, LotRequest, LotVerifyResult, UserRef, WarehouseRef } from '../types';
import { date, dateTime, humanize, number, pct, rupees, shortHash } from '../utils/format';

type Flag = 'hold' | 'release' | 'recall' | 'recall/clear' | 'reject';
const FLAG_TEXT: Record<Flag, { title: string; label: string; danger?: boolean }> = {
  hold: { title: 'Put the lot on QC hold', label: 'Hold' },
  release: { title: 'Release the lot from QC', label: 'Release' },
  reject: { title: 'Reject at QC (asks an admin to approve disposal)', label: 'Reject', danger: true },
  recall: { title: 'Flag a recall: dispatch is blocked at once', label: 'Flag recall', danger: true },
  'recall/clear': { title: 'Clear the recall', label: 'Clear recall' },
};
type QtyAction = 'dispose' | 'return' | 'damage' | 'accept-return';
const CAUSES: DisposalCause[] = ['expired', 'damaged', 'recalled', 'rejected_at_qc', 'written_off'];

function Counters({ lot }: { lot: Lot }) {
  const out = lot.qtyOutByCause;
  const items: [string, number][] = [
    ['Born', lot.qtyBorn],
    ['Added later', lot.qtyAdded],
    ['On hand', lot.qtyOnHand],
    ['In transit', lot.qtyInTransit],
    ['Reserved', lot.qtyReserved],
    ['Sold', out.sold],
    ['Consumed', out.consumed],
    ['Expired', out.expired],
    ['Damaged', out.damaged],
    ['Shrinkage', out.shrinkage],
    ['Recalled', out.recalled],
    ['Returned', out.returnedToSupplier],
    ['Written off', out.writtenOff],
  ];
  return (
    <>
      <div className="counters">
        {items.map(([k, v]) => (
          <div className="counter" key={k}>
            <div className="stat-label">{k}</div>
            <strong>{number(v, 0)}</strong>
          </div>
        ))}
      </div>
      <p className={`mt small ${lot.invariantOk ? 'integrity-ok' : 'integrity-bad'}`}>
        {lot.invariantOk ? '✓' : '✗'} born + added = on hand + in transit + all quantities out
        {lot.invariantOk ? ' (and the stock slices add up to on hand)' : ': the counters do not balance, run reconcile'}
      </p>
    </>
  );
}

function IntegrityBadge({ lot, result }: { lot: Lot; result: LotVerifyResult | null }) {
  const ok = result ? result.ok : lot.lastVerify?.ok;
  const at = result ? result.checkedAt : lot.lastVerify?.at;
  const broken = result ? result.firstBrokenSeq : lot.lastVerify?.firstBrokenSeq;
  if (ok === null || ok === undefined) return <span className="muted">Not verified yet</span>;
  return (
    <span>
      <span className={ok ? 'integrity-ok' : 'integrity-bad'}>{ok ? 'Verified' : broken ? `Broken at event ${broken}` : 'Anchor check failed'}</span>{' '}
      <span className="muted small">checked {dateTime(at)}</span>
    </span>
  );
}

function QtyForm({ lot, action, onClose }: { lot: Lot; action: QtyAction; onClose: () => void }) {
  const { is, ownWarehouse } = useAuth();
  const holding = [...new Map(lot.slices.map((s) => [s.warehouse._id, s.warehouse])).values()];
  const [warehouse, setWarehouse] = useState(ownWarehouse ?? holding[0]?._id ?? '');
  const [quantity, setQuantity] = useState('');
  const [cause, setCause] = useState<DisposalCause>(lot.status === 'expired' ? 'expired' : lot.flags.recalled ? 'recalled' : lot.flags.qcRejected ? 'rejected_at_qc' : 'damaged');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [order, setOrder] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dispose] = useDisposeLotMutation();
  const [ret] = useReturnLotMutation();
  const [damage] = useDamageLotMutation();
  const [accept] = useAcceptReturnMutation();
  const max = action === 'accept-return' ? lot.qtyOutByCause.sold : lot.slices.filter((s) => s.warehouse._id === warehouse).reduce((t, s) => t + s.quantity, 0);
  const title =
    action === 'dispose'
      ? is('admin')
        ? 'Dispose (write off)'
        : 'Request disposal'
      : action === 'return'
        ? is('admin')
          ? 'Return to supplier'
          : 'Request return to supplier'
        : action === 'damage'
          ? 'Record damage or loss'
          : 'Accept a customer return (creates a child lot)';

  const submit = async () => {
    const q = Number(quantity);
    if (!warehouse) return setError('Choose a warehouse');
    if (!(q > 0) || !Number.isInteger(q)) return setError('Quantity must be a whole number greater than 0');
    if (max && q > max) return setError(`At most ${max} here`);
    if (reason.trim().length < 3) return setError('Give a reason (at least 3 characters)');
    setError('');
    setSaving(true);
    try {
      const ev = evidence
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      if (action === 'dispose') await dispose({ id: lot._id, warehouse, quantity: q, cause, reason, evidence: ev }).unwrap();
      if (action === 'return') await ret({ id: lot._id, warehouse, quantity: q, reason }).unwrap();
      if (action === 'damage') await damage({ id: lot._id, warehouse, quantity: q, reason }).unwrap();
      if (action === 'accept-return') await accept({ id: lot._id, warehouse, quantity: q, reason, customerOrder: order || undefined }).unwrap();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={`btn ${action === 'accept-return' ? 'btn-primary' : 'btn-danger'}`} disabled={saving} onClick={submit}>
            {saving ? 'Saving...' : title}
          </button>
        </>
      }
    >
      <FormField label="Warehouse" htmlFor="qa-wh" required hint={action === 'accept-return' ? 'Where the returned goods arrive' : 'Warehouses holding this lot'}>
        {action === 'accept-return' ? (
          <WarehouseSelect id="qa-wh" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} />
        ) : (
          <select id="qa-wh" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
            <option value="">Select warehouse</option>
            {holding.map((w: WarehouseRef) => (
              <option key={w._id} value={w._id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField label="Quantity" htmlFor="qa-qty" required hint={max ? `Up to ${max}` : undefined}>
        <input id="qa-qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </FormField>
      {action === 'dispose' && (
        <FormField label="Cause" htmlFor="qa-cause" required>
          <select id="qa-cause" value={cause} onChange={(e) => setCause(e.target.value as DisposalCause)}>
            {CAUSES.map((c) => (
              <option key={c} value={c}>
                {humanize(c)}
              </option>
            ))}
          </select>
        </FormField>
      )}
      {action === 'accept-return' && (
        <FormField label="Customer order id" htmlFor="qa-order" hint="Optional: the order the goods came back from">
          <input id="qa-order" value={order} onChange={(e) => setOrder(e.target.value.trim())} />
        </FormField>
      )}
      <FormField label="Reason" htmlFor="qa-reason" required>
        <textarea id="qa-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </FormField>
      {action === 'dispose' && (
        <FormField label="Evidence links" htmlFor="qa-ev" hint="Optional photo or document URLs, separated by spaces">
          <input id="qa-ev" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        </FormField>
      )}
      {!is('admin') && (action === 'dispose' || action === 'return') && <Banner tone="info">An admin must approve this request before stock leaves.</Banner>}
      <FormStatus error={error} />
    </Modal>
  );
}

function Requests({ lot }: { lot: Lot }) {
  const { is } = useAuth();
  const [decide] = useDecideRequestMutation();
  const { busy, run } = useAction();
  const reqs = lot.requests ?? [];
  if (!reqs.length) return null;
  const name = (u: UserRef | string | null | undefined) => (u && typeof u === 'object' ? u.name : '—');
  return (
    <div className="card">
      <div className="card-head">
        <h2>Disposal and return requests</h2>
      </div>
      <DataTable<LotRequest>
        rows={reqs}
        rowKey={(r) => r._id}
        columns={[
          { key: 'k', header: 'Request', render: (r) => `${humanize(r.kind)}${r.cause ? ` (${humanize(r.cause)})` : ''}` },
          { key: 'q', header: 'Qty', align: 'right', render: (r) => number(r.qty, 0) },
          { key: 'why', header: 'Reason', render: (r) => r.reason },
          { key: 'by', header: 'Requested', render: (r) => `${name(r.requestedBy)}, ${dateTime(r.requestedAt)}` },
          { key: 's', header: 'Status', render: (r) => <span className={`badge badge-${r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'warning'}`}>{humanize(r.status)}</span> },
          {
            key: 'a',
            header: '',
            render: (r) =>
              r.status === 'pending' && is('admin') ? (
                <div className="btn-group">
                  <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => run(`a${r._id}`, () => decide({ id: lot._id, requestId: r._id, decision: 'approve' }).unwrap(), 'Request approved')}>
                    Approve
                  </button>
                  <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => run(`r${r._id}`, () => decide({ id: lot._id, requestId: r._id, decision: 'reject' }).unwrap(), 'Request rejected')}>
                    Reject
                  </button>
                </div>
              ) : (
                <span className="muted small">{r.decidedAt ? `${name(r.decidedBy)}, ${dateTime(r.decidedAt)}` : ''}</span>
              ),
          },
        ]}
      />
    </div>
  );
}

export default function LotDetail() {
  const { id = '' } = useParams();
  const { is } = useAuth();
  const lotQ = useLotQuery(id);
  const timeline = useTimelineQuery(id);
  const genealogy = useGenealogyQuery(id);
  const [verify] = useVerifyLotMutation();
  const [flag] = useLotFlagMutation();
  const [verified, setVerified] = useState<LotVerifyResult | null>(null);
  const [flagging, setFlagging] = useState<Flag | null>(null);
  const [qtyAction, setQtyAction] = useState<QtyAction | null>(null);
  const { busy, run } = useAction();
  const lot = lotQ.data;
  const managers = is('admin', 'warehouse_manager');

  return (
    <QueryState loading={lotQ.isLoading} error={lotQ.error} onRetry={lotQ.refetch} lines={6}>
      {lot && (
        <>
          <div className="page-head">
            <div>
              <p className="small">
                <Link to="/dna">← Stock DNA</Link>
              </p>
              <h1 className="mono">{lot.dnaCode}</h1>
              <p>
                {lot.product.sku} {lot.product.name} · batch {lot.batchNo || '—'} · {lot.supplier?.name ?? 'no supplier recorded'}
              </p>
            </div>
            <LotStatusBadge lot={lot} />
          </div>

          <div className="card lot-head">
            <div>
              <dl className="kv mb">
                <dt>Born</dt>
                <dd>
                  {dateTime(lot.birth.at)} as {humanize(lot.birth.type)} at{' '}
                  {typeof lot.birth.warehouse === 'object' ? `${lot.birth.warehouse.code} ${lot.birth.warehouse.name}` : '—'} ({number(lot.qtyBorn, 0)} at {rupees(lot.birth.unitCost)})
                  {lot.birth.grnNo ? ` · ${lot.birth.grnNo}` : ''} <RefLink refType={lot.birth.refType} refId={lot.birth.refId} />
                  {lot.birth.backfilled && <div className="muted small">Backfilled from existing stock; true birth not recorded</div>}
                </dd>
                <dt>Expiry</dt>
                <dd>{lot.expiryDate ? `${date(lot.expiryDate)} (shelf life ${lot.shelfLifeDays ?? '—'} days)` : 'Does not expire'}</dd>
                {lot.parentLots.length > 0 && (
                  <>
                    <dt>Parent lot</dt>
                    <dd>
                      {lot.parentLots.map((p) => (
                        <Link key={p} to={`/dna/${p}`}>
                          open parent
                        </Link>
                      ))}
                    </dd>
                  </>
                )}
                {lot.death && (
                  <>
                    <dt>Died</dt>
                    <dd>
                      {dateTime(lot.death.at)}: {humanize(lot.death.cause)} after {number(lot.death.lifespanDays)} days, value lost {rupees(lot.death.valueLost)}
                    </dd>
                  </>
                )}
                <dt>Integrity</dt>
                <dd>
                  <IntegrityBadge lot={lot} result={verified} />
                  <div className="muted small">
                    {lot.eventCount} events · head hash {shortHash(lot.headHash, 16)}
                  </div>
                </dd>
              </dl>
              {verified && !verified.ok && <Banner tone="error">{verified.reason}</Banner>}
              <div className="btn-group no-print">
                <Link to={`/dna/${lot._id}/label`} className="btn">
                  Print label
                </Link>
                {managers && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy === 'cert'}
                      onClick={() => run('cert', () => downloadFile(`/dna/lots/${lot._id}/certificate.pdf`, undefined, `${lot.dnaCode}-certificate.pdf`), 'Certificate downloaded')}
                    >
                      {busy === 'cert' ? 'Preparing...' : 'Download certificate'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-navy"
                      disabled={busy === 'verify'}
                      onClick={() =>
                        run(
                          'verify',
                          async () => {
                            const r = await verify(lot._id).unwrap();
                            setVerified(r);
                            return r;
                          },
                          (r) => (r.ok ? `Verified: ${r.eventsChecked} events, anchors intact` : `Integrity check failed${r.firstBrokenSeq ? ` at event ${r.firstBrokenSeq}` : ''}`),
                        )
                      }
                    >
                      {busy === 'verify' ? 'Verifying...' : 'Verify integrity'}
                    </button>
                  </>
                )}
                {managers && !isDeadLot(lot.status) && (
                  <>
                    {lot.status === 'active' && (
                      <button type="button" className="btn" onClick={() => setFlagging('hold')}>
                        Hold
                      </button>
                    )}
                    {lot.status === 'quarantine' && !lot.flags.qcRejected && (
                      <>
                        <button type="button" className="btn" onClick={() => setFlagging('release')}>
                          Release
                        </button>
                        <button type="button" className="btn btn-danger" onClick={() => setFlagging('reject')}>
                          Reject
                        </button>
                      </>
                    )}
                    {is('admin') && !lot.flags.recalled && (
                      <button type="button" className="btn btn-danger" onClick={() => setFlagging('recall')}>
                        Recall
                      </button>
                    )}
                    {is('admin') && lot.flags.recalled && (
                      <button type="button" className="btn" onClick={() => setFlagging('recall/clear')}>
                        Clear recall
                      </button>
                    )}
                    {lot.qtyOnHand > 0 && (
                      <>
                        <button type="button" className="btn btn-danger" onClick={() => setQtyAction('dispose')}>
                          Dispose
                        </button>
                        <button type="button" className="btn" onClick={() => setQtyAction('return')}>
                          Return to supplier
                        </button>
                        <button type="button" className="btn" onClick={() => setQtyAction('damage')}>
                          Record damage
                        </button>
                      </>
                    )}
                  </>
                )}
                {managers && lot.qtyOutByCause.sold > 0 && (
                  <button type="button" className="btn" onClick={() => setQtyAction('accept-return')}>
                    Accept customer return
                  </button>
                )}
              </div>
            </div>
            <div className="lot-qr" aria-label={`QR code for ${lot.dnaCode}`}>
              <QRCodeSVG value={lot.dnaCode} size={132} />
            </div>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <div className="card-head">
                <h2>Life</h2>
              </div>
              <LifeBar
                label="Shelf life used"
                used={lot.death?.lifeUsedPct ?? lot.metrics.lifeUsedPct}
                left={
                  lot.metrics.remainingShelfDays === null
                    ? 'No expiry date'
                    : lot.metrics.remainingShelfDays >= 0
                      ? `${number(lot.metrics.remainingShelfDays)} days of shelf life left`
                      : `Expired ${number(-lot.metrics.remainingShelfDays)} days ago`
                }
              />
              <LifeBar label="Stock used up" tone="qty" used={lot.metrics.depletionPct} left={`${number(lot.qtyOnHand, 0)} of ${number(lot.qtyBorn + lot.qtyAdded, 0)} units left${lot.qtyInTransit ? `, ${number(lot.qtyInTransit, 0)} in transit` : ''}`} />
              <dl className="kv">
                <dt>Age</dt>
                <dd>{number(lot.metrics.ageDays)} days</dd>
                <dt>Hops</dt>
                <dd>{lot.metrics.hops}</dd>
                <dt>Holding cost</dt>
                <dd title={lot.metrics.holdingCostNote}>{rupees(lot.metrics.holdingCostAccrued)} (estimated)</dd>
                <dt>Life used at death</dt>
                <dd>{lot.death ? pct(lot.death.lifeUsedPct) : '—'}</dd>
              </dl>
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Counters</h2>
              </div>
              <Counters lot={lot} />
            </div>
          </div>

          <Requests lot={lot} />

          <div className="card">
            <div className="card-head">
              <h2>Lifeline</h2>
              <span className="muted small">born → {lot.death ? 'death' : 'now'}</span>
            </div>
            <QueryState loading={timeline.isLoading} error={timeline.error} onRetry={timeline.refetch} isEmpty={!timeline.data?.items.length} empty="No events">
              {timeline.data && <Lifeline genes={timeline.data.items} lot={lot} />}
            </QueryState>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <div className="card-head">
                <h2>Journey</h2>
              </div>
              <JourneyStrip stops={lot.metrics.journey} />
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Where it is now</h2>
              </div>
              <DataTable
                rows={lot.slices}
                rowKey={(s) => s._id}
                empty={isDeadLot(lot.status) ? 'Nothing left: the lot is dead' : 'Nothing on hand (in transit only)'}
                columns={[
                  { key: 'w', header: 'Warehouse', render: (s) => `${s.warehouse.code} ${s.warehouse.name}` },
                  { key: 'b', header: 'Bin', render: (s) => s.bin || '—' },
                  { key: 'q', header: 'Quantity', align: 'right', render: (s) => number(s.quantity, 0) },
                ]}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Genealogy</h2>
            </div>
            <QueryState loading={genealogy.isLoading} error={genealogy.error} onRetry={genealogy.refetch}>
              {genealogy.data && <GenealogyTree data={genealogy.data} />}
            </QueryState>
          </div>

          {flagging && (
            <ConfirmDialog
              open
              title={FLAG_TEXT[flagging].title}
              confirmLabel={FLAG_TEXT[flagging].label}
              danger={FLAG_TEXT[flagging].danger}
              requireReason
              onClose={() => setFlagging(null)}
              onConfirm={(reason) => flag({ id: lot._id, action: flagging, reason }).unwrap()}
            />
          )}
          {qtyAction && <QtyForm lot={lot} action={qtyAction} onClose={() => setQtyAction(null)} />}
        </>
      )}
    </QueryState>
  );
}

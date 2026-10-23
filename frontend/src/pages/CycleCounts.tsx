import { useEffect, useState } from 'react';
import { useCountActionMutation, useCountQuery, useCountsQuery, useCreateCountMutation, useUpdateCountMutation } from '../api/inventory';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import FormField, { FormStatus } from '../components/FormField';
import Pager from '../components/Pager';
import QueryState from '../components/QueryState';
import { WarehouseSelect } from '../components/Selects';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import { useForm } from '../hooks/useForm';
import type { StockCount } from '../types';
import { dateTime, number } from '../utils/format';
import { collect, required } from '../utils/validate';

function CountSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { is } = useAuth();
  const q = useCountQuery(id);
  const [save, saveState] = useUpdateCountMutation();
  const [act] = useCountActionMutation();
  const { busy, run } = useAction();
  const [draft, setDraft] = useState<Record<string, { counted: string; reason: string }>>({});
  const c = q.data;
  useEffect(() => {
    if (c) setDraft(Object.fromEntries(c.lines.map((l) => [l._id, { counted: l.countedQty === null ? '' : String(l.countedQty), reason: l.reason }])));
  }, [c]);
  const editable = c?.status === 'open';
  const invalid = Object.entries(draft).filter(([, d]) => d.counted !== '' && (!Number.isFinite(Number(d.counted)) || Number(d.counted) < 0));
  const doSave = () =>
    run('save', async () => {
      if (invalid.length) throw new Error('Counted quantities must be 0 or more');
      return save({ id, lines: Object.entries(draft).map(([_id, d]) => ({ _id, countedQty: d.counted === '' ? null : Number(d.counted), reason: d.reason })) }).unwrap();
    }, 'Counts saved');
  const variances = c?.lines.filter((l) => (l.variance ?? 0) !== 0) ?? [];
  return (
    <div className="card">
      <QueryState loading={q.isLoading} error={q.error} onRetry={q.refetch} lines={5}>
        {c && (
          <>
            <div className="card-head">
              <h2>
                {c.countNo} · {c.warehouse.name} <Badge status={c.status} />
              </h2>
              <div className="btn-group">
                {editable && (
                  <>
                    <button type="button" className="btn" onClick={doSave} disabled={saveState.isLoading || busy === 'save'}>
                      {busy === 'save' ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-navy"
                      disabled={busy === 'submit'}
                      onClick={() =>
                        run('submit', async () => {
                          await save({ id, lines: Object.entries(draft).map(([_id, d]) => ({ _id, countedQty: d.counted === '' ? null : Number(d.counted), reason: d.reason })) }).unwrap();
                          return act({ id, action: 'submit' }).unwrap();
                        }, 'Count submitted; variances computed')
                      }
                    >
                      {busy === 'submit' ? 'Saving...' : 'Submit'}
                    </button>
                  </>
                )}
                {c.status === 'submitted' && is('admin', 'warehouse_manager') && (
                  <button type="button" className="btn btn-primary" disabled={busy === 'rec'} onClick={() => run('rec', () => act({ id, action: 'reconcile' }).unwrap(), 'Reconciled: stock adjusted and audited')}>
                    {busy === 'rec' ? 'Saving...' : 'Reconcile'}
                  </button>
                )}
                <button type="button" className="btn" onClick={onClose}>
                  Close
                </button>
              </div>
            </div>
            {c.status !== 'open' && (
              <div className={`banner ${variances.length ? 'banner-warning' : 'banner-success'}`}>
                <div className="banner-body">
                  {variances.length
                    ? `${variances.length} line(s) with variance; net ${variances.reduce((s, l) => s + (l.variance ?? 0), 0)} units.${c.status === 'submitted' ? ' Reconcile to adjust stock (variances over 5% raise an alert).' : ''}`
                    : 'No variances: system and counted quantities match.'}
                </div>
              </div>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Bin</th>
                    <th>Batch</th>
                    <th style={{ textAlign: 'right' }}>System qty</th>
                    <th>Counted qty</th>
                    <th style={{ textAlign: 'right' }}>Variance</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {c.lines.map((l) => {
                    const d = draft[l._id] ?? { counted: '', reason: '' };
                    const live = d.counted === '' ? null : Number(d.counted) - l.systemQty;
                    const variance = editable ? live : l.variance;
                    return (
                      <tr key={l._id} className={variance ? 'row-highlight' : undefined}>
                        <td>
                          <strong>{l.product.sku}</strong> {l.product.name}
                        </td>
                        <td>{l.bin || '—'}</td>
                        <td>{l.batchNo || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{number(l.systemQty, 0)}</td>
                        <td>
                          {editable ? (
                            <>
                              <label className="sr-only" htmlFor={`cq-${l._id}`}>
                                Counted quantity for {l.product.sku}
                              </label>
                              <input id={`cq-${l._id}`} className="inline-input" type="number" min={0} value={d.counted} onChange={(e) => setDraft({ ...draft, [l._id]: { ...d, counted: e.target.value } })} />
                            </>
                          ) : (
                            number(l.countedQty, 0)
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }} className={variance ? 'error-text' : ''}>
                          {variance === null || variance === undefined ? '—' : variance > 0 ? `+${variance}` : variance}
                        </td>
                        <td>
                          {editable ? (
                            <>
                              <label className="sr-only" htmlFor={`cr-${l._id}`}>
                                Reason
                              </label>
                              <input id={`cr-${l._id}`} value={d.reason} onChange={(e) => setDraft({ ...draft, [l._id]: { ...d, reason: e.target.value } })} placeholder={variance ? 'e.g. damaged' : ''} />
                            </>
                          ) : (
                            l.reason || '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}

export default function CycleCounts() {
  const { ownWarehouse } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const list = useCountsQuery({ page });
  const [create] = useCreateCountMutation();
  const f = useForm({ warehouse: ownWarehouse ?? '' }, (v) => collect({ warehouse: required(v.warehouse, 'Warehouse') }));
  const onCreate = f.submit(async (v) => {
    const c = await create({ warehouse: v.warehouse }).unwrap();
    setOpen(c._id);
    return `${c.countNo} created with ${c.lines.length} line(s)`;
  }, { keepValues: true });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cycle counts</h1>
          <p>Count stock, compare with the system, and reconcile variances as audited adjustments.</p>
        </div>
      </div>
      <form className="card row gap" onSubmit={onCreate} noValidate style={{ alignItems: 'flex-end' }}>
        <FormField label="New count for warehouse" htmlFor="cc-wh" error={f.errors.warehouse} className="grow">
          <WarehouseSelect id="cc-wh" {...f.bind('warehouse')} disabled={!!ownWarehouse} />
        </FormField>
        <button type="submit" className="btn btn-primary" style={{ marginBottom: 12 }} disabled={f.saving}>
          {f.saving ? 'Saving...' : 'New count'}
        </button>
        <div style={{ flexBasis: '100%' }}>
          <FormStatus error={f.serverError} success={f.success} />
        </div>
      </form>
      {open && <CountSheet id={open} onClose={() => setOpen(null)} />}
      <div className="card">
        <DataTable<StockCount>
          rows={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(c) => c._id}
          empty="No cycle counts yet"
          columns={[
            { key: 'no', header: 'Count no.', render: (c) => <strong>{c.countNo}</strong> },
            { key: 'w', header: 'Warehouse', render: (c) => c.warehouse.code },
            { key: 's', header: 'Status', render: (c) => <Badge status={c.status} /> },
            { key: 'l', header: 'Lines', align: 'right', render: (c) => `${c.countedLines ?? 0}/${c.lineCount ?? 0} counted` },
            { key: 'v', header: 'Variances', align: 'right', render: (c) => c.varianceLines ?? 0 },
            { key: 'by', header: 'Created', render: (c) => <>{dateTime(c.createdAt)}<div className="muted small">{c.createdBy?.name}</div></> },
            {
              key: 'o',
              header: '',
              render: (c) => (
                <button type="button" className="btn btn-sm" onClick={() => setOpen(c._id)}>
                  Open
                </button>
              ),
            },
          ]}
        />
        {list.data && <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />}
      </div>
    </>
  );
}

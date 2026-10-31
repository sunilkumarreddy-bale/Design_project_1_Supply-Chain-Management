import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useAnalyzeBatchMutation,
  useProposeRedistributionMutation,
  useRedistributionActionMutation,
  useRedistributionPlanQuery,
  useRedistributionPlansQuery,
  useScanRedistributionMutation,
} from '../api/modules';
import Badge from '../components/Badge';
import ConfirmDialog from '../components/ConfirmDialog';
import DataTable from '../components/DataTable';
import Drawer from '../components/Drawer';
import FormField, { FormStatus } from '../components/FormField';
import Pager from '../components/Pager';
import QueryState from '../components/QueryState';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import { useForm } from '../hooks/useForm';
import type { BatchAnalysis, RedistributionPlan } from '../types';
import { DnaCodeLink } from '../components/dna/LotParts';
import { date, dateTime, humanize, number, rupees } from '../utils/format';
import { collect, nonNegative } from '../utils/validate';

const ADVICE: Record<string, string> = {
  none: 'Nothing left at risk',
  markdown: 'Mark down the price to sell before expiry',
  donate: 'Donate: too close to expiry to sell at full price',
  dispose: 'Dispose: the batch has expired',
};

function AnalysisPanel({ initial, onProposed }: { initial: BatchAnalysis; onProposed: (id: string) => void }) {
  const [analyze] = useAnalyzeBatchMutation();
  const [propose] = useProposeRedistributionMutation();
  const [a, setA] = useState(initial);
  const { busy, run } = useAction();
  const f = useForm({ margin: String(initial.result.minShelfLifeDays) }, (v) => collect({ margin: nonNegative(v.margin, 'Min shelf life') }));
  const reanalyze = f.submit(async (v) => {
    setA(await analyze({ stockLevelId: a.stockLevelId, minShelfLifeDays: Number(v.margin) }).unwrap());
    return 'Updated';
  }, { keepValues: true });
  const r = a.result;
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          {a.product.sku} batch {a.batchNo || '(none)'} at {a.source.name}
          {a.lot && (
            <>
              {' '}
              · <DnaCodeLink id={a.lot.lot} code={a.lot.dnaCode} />
            </>
          )}
        </h2>
        <Badge tone={r.residualUnits > 0 ? 'warning' : 'success'}>{ADVICE[r.residualAdvice]}</Badge>
      </div>
      <div className="stats">
        <div className="card stat-card">
          <div className="stat-label">Units in batch</div>
          <div className="stat-value">{number(a.quantity, 0)}</div>
          <div className="stat-hint">expires {date(a.expiryDate)}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Shelf life left</div>
          <div className="stat-value">{r.shelfLifeDaysLeft} d</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Own sales estimate</div>
          <div className="stat-value">{number(r.sourceOwnSalesUnits, 0)}</div>
          <div className="stat-hint">{number(r.sourceDailyDemand)}/day at source</div>
        </div>
        <div className="card stat-card stat-warning">
          <div className="stat-label">Surplus</div>
          <div className="stat-value">{number(r.surplusUnits, 0)}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Residual</div>
          <div className="stat-value">{number(r.residualUnits, 0)}</div>
          <div className="stat-hint">{humanize(r.residualAdvice)}</div>
        </div>
      </div>
      <form className="row gap" onSubmit={reanalyze} noValidate style={{ alignItems: 'flex-end' }}>
        <FormField label="Min shelf life days (margin)" htmlFor="rd-margin" error={f.errors.margin}>
          <input id="rd-margin" type="number" min={0} {...f.bind('margin')} style={{ width: 140 }} />
        </FormField>
        <button type="submit" className="btn" style={{ marginBottom: 12 }} disabled={f.saving}>
          {f.saving ? 'Analyzing...' : 'Re-analyze'}
        </button>
      </form>
      <FormStatus error={f.serverError} />
      <DataTable
        rows={r.destinations}
        rowKey={(d) => d.warehouseId}
        empty="No destination warehouse has demand for this product"
        dense
        columns={[
          { key: 'w', header: 'Warehouse', render: (d) => d.warehouseName },
          { key: 'lead', header: 'Lead days', align: 'right', render: (d) => number(d.transferLeadDays, 1) },
          { key: 'dem', header: 'Demand/day', align: 'right', render: (d) => number(d.destDailyDemand) },
          { key: 'ex', header: 'Existing stock', align: 'right', render: (d) => number(d.destExistingUnits + d.destOnOrder, 0) },
          { key: 'win', header: 'Selling window', align: 'right', render: (d) => `${number(d.sellWindowDays, 1)} d` },
          { key: 'cap', header: 'Capacity', align: 'right', render: (d) => number(d.capacityUnits, 0) },
          { key: 'rec', header: 'Recommended qty', align: 'right', render: (d) => <strong>{number(r.lines.find((l) => l.toWarehouse === d.warehouseId)?.quantity ?? 0, 0)}</strong> },
          { key: 'why', header: 'Note', render: (d) => (d.eligible ? <Badge status="ok">Eligible</Badge> : <span className="muted small">{d.reason}</span>) },
        ]}
      />
      <h3 className="mt">Explanation</h3>
      <ul className="explain-steps">
        {r.explanation.map((e, i) => (
          <li key={i}>
            <code>{e}</code>
          </li>
        ))}
      </ul>
      <p className="muted small">Transport cost {rupees(r.transportCost)} for {number(r.allocatedUnits, 0)} unit(s).</p>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!r.lines.length || busy === 'propose'}
        onClick={async () => {
          const plan = await run('propose', () => propose({ stockLevelId: a.stockLevelId, minShelfLifeDays: Number(f.values.margin) }).unwrap(), (p) => `Plan ${p.planNo} proposed`);
          if (plan) onProposed(plan._id);
        }}
      >
        {busy === 'propose' ? 'Saving...' : 'Propose plan'}
      </button>
    </div>
  );
}

function PlanDetail({ id }: { id: string }) {
  const q = useRedistributionPlanQuery(id);
  const p = q.data;
  return (
    <QueryState loading={q.isLoading} error={q.error} onRetry={q.refetch} lines={5}>
      {p && (
        <>
          <dl className="kv mb">
            <dt>Status</dt>
            <dd>
              <Badge status={p.status} />
            </dd>
            <dt>Batch</dt>
            <dd>
              {p.product.sku} {p.batchNo} at {p.sourceWarehouse.name}
              {p.dnaLots?.map((l) => (
                <div key={l._id} className="small">
                  DNA <DnaCodeLink id={l._id} code={l.dnaCode} /> ({l.status.replace(/_/g, ' ')})
                </div>
              ))}
            </dd>
            <dt>Expiry</dt>
            <dd>
              {date(p.expiryDate)} ({p.shelfLifeDaysLeft} d left when proposed)
            </dd>
            <dt>Residual</dt>
            <dd>
              {p.residualUnits} ({humanize(p.residualAdvice)})
            </dd>
          </dl>
          <h3>Transfers</h3>
          {!p.transfers?.length ? (
            <p className="muted">Tracked transfers are created when an admin approves the plan.</p>
          ) : (
            <ul className="plain-list">
              {p.transfers.map((t) => (
                <li key={t._id}>
                  {t.quantity} × batch {t.batchNo} → {t.toWarehouse.name} <Badge status={t.status} />
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt">Lines</h3>
          <ul className="plain-list">
            {p.lines.map((l, i) => (
              <li key={i}>
                {l.quantity} to {typeof l.toWarehouse === 'object' ? l.toWarehouse.name : l.toWarehouseName} (window {l.sellWindowDays} d, capacity {l.capacityUnits})
              </li>
            ))}
          </ul>
          <h3 className="mt">Timeline</h3>
          <ol className="timeline">
            {p.timeline?.map((t, i) => (
              <li key={i}>
                <strong>{humanize(t.event)}</strong> <span className="muted small">{dateTime(t.at)}</span>
                <div className="small">{t.detail}</div>
              </li>
            ))}
          </ol>
        </>
      )}
    </QueryState>
  );
}

export default function Redistribution() {
  const { is } = useAuth();
  const [params, setParams] = useSearchParams();
  const openPlan = params.get('plan');
  const [scan, scanState] = useScanRedistributionMutation();
  const [analyze] = useAnalyzeBatchMutation();
  const [candidates, setCandidates] = useState<BatchAnalysis[] | null>(null);
  const [scanError, setScanError] = useState<unknown>(null);
  const [selected, setSelected] = useState<BatchAnalysis | null>(null);
  const [page, setPage] = useState(1);
  const plans = useRedistributionPlansQuery({ page });
  const [act] = useRedistributionActionMutation();
  const { busy, run } = useAction();
  const [rejecting, setRejecting] = useState<RedistributionPlan | null>(null);

  const doScan = async () => {
    setScanError(null);
    try {
      const r = await scan().unwrap();
      setCandidates(r.items);
      setSelected(null);
    } catch (e) {
      setScanError(e);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Expiry-aware redistribution</h1>
          <p>Move only what each destination can sell before the batch expires, after transport time and its existing stock.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={doScan} disabled={scanState.isLoading}>
          {scanState.isLoading ? 'Scanning...' : 'Scan all batches'}
        </button>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Batches at risk</h2>
        </div>
        {candidates === null && !scanError && !scanState.isLoading ? (
          <p className="muted">Run a scan to find dated batches that are projected to expire unsold.</p>
        ) : (
          <DataTable<BatchAnalysis>
            rows={candidates ?? []}
            loading={scanState.isLoading}
            error={scanError}
            onRetry={doScan}
            rowKey={(c) => c.stockLevelId}
            empty="No batch is projected to expire unsold"
            columns={[
              { key: 'p', header: 'Product', render: (c) => <strong>{c.product.sku}</strong> },
              {
                key: 'b',
                header: 'Batch',
                render: (c) => (
                  <span>
                    {c.batchNo || '—'}
                    {c.lot && (
                      <>
                        <br />
                        <DnaCodeLink id={c.lot.lot} code={c.lot.dnaCode} />
                      </>
                    )}
                  </span>
                ),
              },
              { key: 's', header: 'Source', render: (c) => c.source.name },
              { key: 'q', header: 'Qty', align: 'right', render: (c) => number(c.quantity, 0) },
              { key: 'd', header: 'Days left', align: 'right', render: (c) => c.daysLeft, sortValue: (c) => c.daysLeft ?? 0 },
              { key: 'w', header: 'Projected waste', align: 'right', render: (c) => number(c.projectedWaste, 0), sortValue: (c) => c.projectedWaste ?? 0 },
              { key: 'm', header: 'Can move', align: 'right', render: (c) => number(c.result.allocatedUnits, 0) },
              {
                key: 'a',
                header: '',
                render: (c) => (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy === c.stockLevelId}
                    onClick={() => run(c.stockLevelId, async () => setSelected(await analyze({ stockLevelId: c.stockLevelId }).unwrap()))}
                  >
                    {busy === c.stockLevelId ? 'Analyzing...' : 'Analyze'}
                  </button>
                ),
              },
            ]}
          />
        )}
      </div>
      {selected && (
        <AnalysisPanel
          key={selected.stockLevelId + selected.asOf}
          initial={selected}
          onProposed={(id) => {
            setSelected(null);
            setParams({ plan: id });
          }}
        />
      )}
      <div className="card">
        <div className="card-head">
          <h2>Redistribution plans</h2>
        </div>
        <DataTable<RedistributionPlan>
          rows={plans.data?.items}
          loading={plans.isLoading}
          error={plans.error}
          onRetry={plans.refetch}
          rowKey={(p) => p._id}
          empty="No redistribution plans yet"
          rowClassName={(p) => (p._id === openPlan ? 'row-highlight' : undefined)}
          columns={[
            { key: 'no', header: 'Plan no.', render: (p) => <strong>{p.planNo}</strong> },
            { key: 'p', header: 'Product', render: (p) => `${p.product.sku} · ${p.batchNo}` },
            { key: 's', header: 'Source', render: (p) => p.sourceWarehouse.code },
            { key: 'u', header: 'Units moved', align: 'right', render: (p) => number(p.lines.reduce((s, l) => s + l.quantity, 0), 0) },
            { key: 'r', header: 'Residual', align: 'right', render: (p) => number(p.residualUnits, 0) },
            { key: 'st', header: 'Status', render: (p) => <Badge status={p.status} /> },
            { key: 'c', header: 'Created', render: (p) => <>{date(p.createdAt)}<div className="muted small">{p.createdBy?.name}</div></> },
            {
              key: 'a',
              header: 'Actions',
              render: (p) => (
                <div className="btn-group">
                  <button type="button" className="btn btn-sm" onClick={() => setParams({ plan: p._id })}>
                    Open
                  </button>
                  {p.status === 'proposed' && is('admin') && (
                    <>
                      <button type="button" className="btn btn-sm btn-primary" disabled={busy === p._id} onClick={() => run(p._id, () => act({ id: p._id, action: 'approve' }).unwrap(), `${p.planNo} approved; transfers created`)}>
                        {busy === p._id ? 'Saving...' : 'Approve'}
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setRejecting(p)}>
                        Reject
                      </button>
                    </>
                  )}
                  {p.status === 'proposed' && (
                    <button type="button" className="btn btn-sm" disabled={busy === `c-${p._id}`} onClick={() => run(`c-${p._id}`, () => act({ id: p._id, action: 'cancel' }).unwrap(), `${p.planNo} cancelled`)}>
                      Cancel
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
        {plans.data && <Pager page={page} limit={plans.data.limit} total={plans.data.total} onPage={setPage} />}
      </div>
      <Drawer open={!!openPlan} title="Redistribution plan" onClose={() => setParams({})}>
        {openPlan && <PlanDetail id={openPlan} />}
      </Drawer>
      <ConfirmDialog
        open={!!rejecting}
        title={`Reject ${rejecting?.planNo ?? ''}`}
        requireReason
        confirmLabel="Reject"
        danger
        onConfirm={(reason) => act({ id: rejecting!._id, action: 'reject', reason }).unwrap()}
        onClose={() => setRejecting(null)}
      />
    </>
  );
}

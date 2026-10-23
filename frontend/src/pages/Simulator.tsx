import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ScenarioInput, useCreateScenarioMutation, usePlanFromRunMutation, useRunQuery, useRunSimulationMutation, useRunsQuery, useScenariosQuery } from '../api/modules';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import DependencyGraph from '../components/DependencyGraph';
import FormField, { FormStatus } from '../components/FormField';
import Pager from '../components/Pager';
import QueryState from '../components/QueryState';
import { ProductSelect, SupplierSelect } from '../components/Selects';
import StatCard from '../components/StatCard';
import { useAction } from '../hooks/useAction';
import { useForm } from '../hooks/useForm';
import type { SimOrder, SimulationRun, StrategyName } from '../types';
import { dateTime, humanize, number, pct, rupees } from '../utils/format';
import { collect, positive, required, nonNegative } from '../utils/validate';

const STRATEGIES: { id: StrategyName; label: string }[] = [
  { id: 'transfers', label: 'Transfers' },
  { id: 'alternative_supplier', label: 'Alternative supplier' },
  { id: 'combined', label: 'Combined (recovery engine top plan)' },
];
const STRAT_LABEL: Record<StrategyName, string> = { none: 'No action (baseline)', transfers: 'Transfers', alternative_supplier: 'Alternative supplier', combined: 'Combined' };

const INITIAL = {
  name: '',
  type: 'supplier_stop' as ScenarioInput['type'],
  supplier: '',
  product: '',
  startDay: '0',
  durationDays: '5',
  horizonDays: '30',
  backorders: false,
  sweep: true,
  safetyStockMultiplier: '1',
};

function delta(n: number | undefined, invert = false, fmt: (x: number) => string = (x) => number(x, 0)) {
  if (n === undefined || n === 0) return <span className="muted">±0</span>;
  const good = invert ? n > 0 : n < 0;
  return <span className={good ? 'tick' : 'cross'}>{n > 0 ? '+' : '−'}{fmt(Math.abs(n))}</span>;
}

function RunResults({ run }: { run: SimulationRun }) {
  const navigate = useNavigate();
  const [planFromRun] = usePlanFromRunMutation();
  const { busy, run: act } = useAction();
  const positions = run.baseline.perPosition ?? [];
  const shortPositions = positions.filter((p) => p.unmetUnits > 0 || p.stockoutDay !== null);
  const [positionKey, setPositionKey] = useState(shortPositions[0]?.key ?? positions[0]?.key ?? '');
  const [chartStrategy, setChartStrategy] = useState<StrategyName>('combined');
  const [planStrategy, setPlanStrategy] = useState<StrategyName>('combined');
  const [heatStrategy, setHeatStrategy] = useState<StrategyName>('none');
  const [graphAll, setGraphAll] = useState(false);
  useEffect(() => setPositionKey(shortPositions[0]?.key ?? positions[0]?.key ?? ''), [run._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = run.baseline.metrics;
  const strat = run.strategies.find((s) => s.name === chartStrategy);
  const basePos = positions.find((p) => p.key === positionKey);
  const stratPos = strat?.perPosition?.find((p) => p.key === positionKey);
  const chartData = useMemo(
    () =>
      (basePos?.daily ?? []).map((d, i) => ({
        day: d.day,
        baseline: d.stock,
        strategy: stratPos?.daily[i]?.stock,
        unmet: d.unmet,
      })),
    [basePos, stratPos],
  );
  const componentKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const s of run.strategies) for (const a of s.actions ?? []) keys.add(a.toKey);
    return [...keys];
  }, [run]);
  const [planKey, setPlanKey] = useState(componentKeys[0] ?? '');
  useEffect(() => setPlanKey(componentKeys[0] ?? ''), [componentKeys]);

  const sweep = run.sweep;
  const maxShort = sweep ? Math.max(1, ...sweep.cells.map((c) => c.shortageUnits[heatStrategy] ?? 0)) : 1;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>
            {run.scenarioSnapshot.name || humanize(run.scenarioSnapshot.type)} · {run.scenarioSnapshot.durationDays} days
          </h2>
          <span className="muted small">
            Ran {dateTime(run.ranAt)} by {run.ranBy?.name ?? '—'} · horizon {run.parameters.horizonDays} d · safety stock × {run.parameters.safetyStockMultiplier} ·{' '}
            {run.parameters.backorders ? 'backorders' : 'lost sales'}
          </span>
        </div>
        <div className="row spread gap mb">
          <h3>Dependency graph</h3>
          <label className="check">
            <input type="checkbox" checked={graphAll} onChange={(e) => setGraphAll(e.target.checked)} /> Show unaffected nodes
          </label>
        </div>
        {run.graph && <DependencyGraph nodes={run.graph.nodes} edges={run.graph.edges} onlyAffected={!graphAll} />}
      </div>
      <div className="stats mt">
        <StatCard label="Shortage units (baseline)" value={number(base.shortageUnits, 0)} tone={base.shortageUnits > 0 ? 'danger' : 'success'} />
        <StatCard label="Late orders" value={base.lateOrders} tone={base.lateOrders ? 'danger' : 'success'} hint={`${base.atRiskOrders} at risk`} />
        <StatCard label="Lost revenue" value={rupees(base.lostRevenue, true)} tone={base.lostRevenue ? 'warning' : undefined} />
        <StatCard label="Service level" value={pct(base.serviceLevel)} />
        <StatCard label="Affected positions" value={base.affectedPositions} />
      </div>
      <div className="card">
        <h2>Strategy comparison</h2>
        <DataTable
          rows={run.strategies}
          rowKey={(s) => s.name}
          columns={[
            { key: 'n', header: 'Strategy', render: (s) => <strong>{STRAT_LABEL[s.name]}</strong> },
            { key: 'sh', header: 'Shortage units', align: 'right', render: (s) => <>{number(s.metrics.shortageUnits, 0)} {s.name !== 'none' && delta(s.deltas?.shortageUnits)}</> },
            { key: 'late', header: 'Late orders', align: 'right', render: (s) => <>{s.metrics.lateOrders} {s.name !== 'none' && delta(s.deltas?.lateOrders)}</> },
            { key: 'lost', header: 'Lost revenue', align: 'right', render: (s) => <>{rupees(s.metrics.lostRevenue, true)} {s.name !== 'none' && delta(s.deltas?.lostRevenue, false, (x) => rupees(x, true))}</> },
            { key: 'cost', header: 'Cost of actions', align: 'right', render: (s) => rupees(s.metrics.actionCost, true) },
            { key: 'eta', header: 'ETA', align: 'right', render: (s) => (s.metrics.etaDays === null ? '—' : `day ${s.metrics.etaDays}`) },
            { key: 'sl', header: 'Service level', align: 'right', render: (s) => <>{pct(s.metrics.serviceLevel)} {s.name !== 'none' && delta(s.deltas?.serviceLevel, true, (x) => pct(x))}</> },
            { key: 'act', header: 'Actions', render: (s) => <span className="small">{(s.actions ?? []).map((a) => a.label).join('; ') || '—'}</span> },
          ]}
        />
      </div>
      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-head">
            <h2>Daily inventory</h2>
          </div>
          <div className="form-grid">
            <FormField label="Position" htmlFor="sim-pos">
              <select id="sim-pos" value={positionKey} onChange={(e) => setPositionKey(e.target.value)}>
                {positions.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.sku} @ {p.warehouseName}
                    {p.stockoutDay !== null ? ` (stock-out day ${p.stockoutDay})` : ''}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Compare with" htmlFor="sim-strat">
              <select id="sim-strat" value={chartStrategy} onChange={(e) => setChartStrategy(e.target.value as StrategyName)}>
                {run.strategies
                  .filter((s) => s.name !== 'none')
                  .map((s) => (
                    <option key={s.name} value={s.name}>
                      {STRAT_LABEL[s.name]}
                    </option>
                  ))}
              </select>
            </FormField>
          </div>
          {basePos ? (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" fontSize={11} label={{ value: 'Day', position: 'insideBottomRight', offset: -4, fontSize: 11 }} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Legend />
                  {basePos.stockoutDay !== null && <ReferenceLine x={basePos.stockoutDay} stroke="#b42318" strokeDasharray="4 3" label={{ value: 'stock-out', fill: '#b42318', fontSize: 11 }} />}
                  <Line type="stepAfter" dataKey="baseline" name="Stock, no action" stroke="#8c1d2f" dot={false} strokeWidth={2} />
                  {stratPos && <Line type="stepAfter" dataKey="strategy" name={`Stock, ${STRAT_LABEL[chartStrategy]}`} stroke="#26365b" dot={false} strokeWidth={2} />}
                  <Line type="stepAfter" dataKey="unmet" name="Unmet demand (baseline)" stroke="#d99a15" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="muted">No affected positions.</p>
          )}
          {basePos && (
            <p className="muted small">
              Start {number(basePos.onHand, 0)} units, demand {number(basePos.dailyDemand)}/day
              {basePos.isAssembled ? ' (assembled from components)' : ''}
              {basePos.delayedReceipts.length ? ` · delayed receipts: ${basePos.delayedReceipts.map((r) => `${r.quantity} (${r.reference ?? 'PO'}) day ${r.fromDay} → ${r.toDay}`).join(', ')}` : ''}
            </p>
          )}
        </div>
        <div className="card">
          <h2>Affected orders (baseline)</h2>
          <DataTable<SimOrder>
            rows={run.baseline.orders}
            rowKey={(o) => o.orderId}
            empty="No customer orders depend on the affected products"
            dense
            rowClassName={(o) => (o.status === 'late' ? 'row-danger' : o.status === 'at_risk' ? 'row-highlight' : undefined)}
            columns={[
              { key: 'o', header: 'Order', render: (o) => <strong>{o.orderNo}</strong> },
              { key: 'c', header: 'Customer', render: (o) => o.customerName },
              { key: 'due', header: 'Due', render: (o) => `day ${o.dueDay}`, sortValue: (o) => o.dueDay },
              { key: 's', header: 'Status', render: (o) => <Badge status={o.status} /> },
              { key: 'late', header: 'Days late', align: 'right', render: (o) => o.daysLate || '—' },
              { key: 'u', header: 'Unfilled', align: 'right', render: (o) => number(o.unfilled, 0) },
            ]}
          />
        </div>
      </div>
      {sweep && (
        <div className="card mt">
          <div className="card-head">
            <h2>Sensitivity: shortage units by disruption length and safety stock</h2>
            <select aria-label="Strategy for the heat table" value={heatStrategy} onChange={(e) => setHeatStrategy(e.target.value as StrategyName)} style={{ width: 'auto' }}>
              {sweep.strategies.map((s) => (
                <option key={s} value={s}>
                  {STRAT_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="table-wrap">
            <table className="table heat">
              <thead>
                <tr>
                  <th>Disruption length</th>
                  {sweep.multipliers.map((m) => (
                    <th key={m}>Safety stock × {m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sweep.durations.map((d) => (
                  <tr key={d}>
                    <th scope="row">{d} days</th>
                    {sweep.multipliers.map((m) => {
                      const cell = sweep.cells.find((c) => c.durationDays === d && c.safetyStockMultiplier === m);
                      const v = cell?.shortageUnits[heatStrategy] ?? 0;
                      const alpha = 0.08 + (v / maxShort) * 0.6;
                      return (
                        <td key={m} style={{ background: `rgba(140, 29, 47, ${alpha})`, color: alpha > 0.45 ? '#fff' : undefined }} title={sweep.strategies.map((s) => `${STRAT_LABEL[s]}: ${cell?.shortageUnits[s]}`).join('\n')}>
                          {number(v, 0)}
                          <div className="small" style={{ fontWeight: 400 }}>
                            {cell?.lateOrders[heatStrategy] ?? 0} late
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="card mt">
        <h2>Create recovery plan from this strategy</h2>
        {componentKeys.length === 0 ? (
          <p className="muted">No strategy proposed actions in this run, so there is nothing to turn into a plan.</p>
        ) : (
          <div className="row gap" style={{ alignItems: 'flex-end' }}>
            <FormField label="Strategy" htmlFor="pl-strat">
              <select id="pl-strat" value={planStrategy} onChange={(e) => setPlanStrategy(e.target.value as StrategyName)}>
                {run.strategies
                  .filter((s) => s.name !== 'none')
                  .map((s) => (
                    <option key={s.name} value={s.name}>
                      {STRAT_LABEL[s.name]}
                    </option>
                  ))}
              </select>
            </FormField>
            <FormField label="Shortage position" htmlFor="pl-pos">
              <select id="pl-pos" value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
                {componentKeys.map((k) => {
                  const p = positions.find((x) => x.key === k);
                  return (
                    <option key={k} value={k}>
                      {p ? `${p.sku} @ ${p.warehouseName}` : k}
                    </option>
                  );
                })}
              </select>
            </FormField>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginBottom: 12 }}
              disabled={!planKey || busy === 'plan'}
              onClick={async () => {
                const plan = await act('plan', () => planFromRun({ id: run._id, strategy: planStrategy, positionKey: planKey }).unwrap(), (p) => `Plan ${p.planNo} proposed`);
                if (plan) navigate(`/recovery/${plan._id}`);
              }}
            >
              {busy === 'plan' ? 'Saving...' : 'Create recovery plan from this strategy'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default function Simulator() {
  const [runSim] = useRunSimulationMutation();
  const [saveScenario, saveState] = useCreateScenarioMutation();
  const scenarios = useScenariosQuery();
  const [page, setPage] = useState(1);
  const runs = useRunsQuery({ page });
  const [current, setCurrent] = useState<SimulationRun | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = useRunQuery(openId ?? '', { skip: !openId });
  const [strategies, setStrategies] = useState<StrategyName[]>(['transfers', 'alternative_supplier', 'combined']);
  const { run: act } = useAction();
  const f = useForm(INITIAL, (v) =>
    collect({
      supplier: v.type !== 'component_stop' ? required(v.supplier, 'Supplier') : undefined,
      product: v.type === 'component_stop' ? required(v.product, 'Component') : undefined,
      startDay: nonNegative(v.startDay, 'Start day'),
      durationDays: positive(v.durationDays, 'Duration'),
      horizonDays: positive(v.horizonDays, 'Horizon'),
      safetyStockMultiplier: nonNegative(v.safetyStockMultiplier, 'Multiplier'),
    }),
  );
  const toScenario = (v: typeof INITIAL): ScenarioInput => ({
    name: v.name.trim() || undefined,
    type: v.type,
    supplier: v.type === 'component_stop' ? null : v.supplier,
    product: v.type === 'component_stop' ? v.product : null,
    startDay: Number(v.startDay),
    durationDays: Number(v.durationDays),
    horizonDays: Number(v.horizonDays),
    backorders: v.backorders,
  });
  const onRun = f.submit(async (v) => {
    setOpenId(null);
    const r = await runSim({ scenario: toScenario(v), strategies: ['none', ...strategies], sweep: v.sweep, safetyStockMultiplier: Number(v.safetyStockMultiplier) }).unwrap();
    setCurrent(r);
    return `Simulation complete: ${r.baseline.metrics.lateOrders} late order(s) without action`;
  }, { keepValues: true });
  const onSave = () =>
    act('save', async () => {
      const errs = f.errors;
      if (Object.values(errs).some(Boolean)) throw new Error('Fix the form first');
      if (f.values.type !== 'component_stop' && !f.values.supplier) throw new Error('Choose a supplier');
      if (f.values.type === 'component_stop' && !f.values.product) throw new Error('Choose a component');
      return saveScenario(toScenario(f.values)).unwrap();
    }, (s) => `Scenario "${s.name}" saved`);
  const loadScenario = (id: string) => {
    const s = scenarios.data?.items.find((x) => x._id === id);
    if (!s) return;
    f.setValues({
      ...f.values,
      name: s.name,
      type: s.type,
      supplier: s.supplier?._id ?? '',
      product: s.product?._id ?? '',
      startDay: String(s.startDay),
      durationDays: String(s.durationDays),
      horizonDays: String(s.horizonDays),
      backorders: s.backorders,
    });
  };
  const shown = openId ? opened.data : current;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Domino effect simulator</h1>
          <p>Simulate a disruption through the dependency graph day by day and compare recovery strategies. Deterministic, no data is changed.</p>
        </div>
      </div>
      <form className="card" onSubmit={onRun} noValidate>
        <div className="form-grid">
          <FormField label="Saved scenario" htmlFor="sim-saved">
            <select id="sim-saved" defaultValue="" onChange={(e) => loadScenario(e.target.value)} disabled={scenarios.isLoading}>
              <option value="">{scenarios.data?.items.length ? 'Load a saved scenario' : 'No saved scenarios'}</option>
              {scenarios.data?.items.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Name" htmlFor="sim-name">
            <input id="sim-name" {...f.bind('name')} />
          </FormField>
          <FormField label="Type" htmlFor="sim-type">
            <select id="sim-type" {...f.bind('type')}>
              <option value="supplier_stop">Supplier stops</option>
              <option value="supplier_delay">Supplier delayed</option>
              <option value="component_stop">Component unavailable</option>
            </select>
          </FormField>
          {f.values.type === 'component_stop' ? (
            <FormField label="Component" htmlFor="sim-product" error={f.errors.product} required>
              <ProductSelect id="sim-product" {...f.bind('product')} />
            </FormField>
          ) : (
            <FormField label="Supplier" htmlFor="sim-supplier" error={f.errors.supplier} required>
              <SupplierSelect id="sim-supplier" {...f.bind('supplier')} />
            </FormField>
          )}
          <FormField label="Start day" htmlFor="sim-start" error={f.errors.startDay}>
            <input id="sim-start" type="number" min={0} {...f.bind('startDay')} />
          </FormField>
          <FormField label="Duration (days)" htmlFor="sim-dur" error={f.errors.durationDays} required>
            <input id="sim-dur" type="number" min={1} {...f.bind('durationDays')} />
          </FormField>
          <FormField label="Horizon (days)" htmlFor="sim-h" error={f.errors.horizonDays}>
            <input id="sim-h" type="number" min={1} max={180} {...f.bind('horizonDays')} />
          </FormField>
          <FormField label="Safety-stock multiplier" htmlFor="sim-mult" error={f.errors.safetyStockMultiplier} hint="Scales the minimum stock held at the start">
            <input id="sim-mult" type="number" step="0.1" min={0} {...f.bind('safetyStockMultiplier')} />
          </FormField>
        </div>
        <div className="row gap-lg">
          <label className="check">
            <input type="checkbox" checked={f.values.backorders} onChange={(e) => f.set('backorders', e.target.checked)} /> Backorders (unmet demand waits; otherwise lost)
          </label>
          <label className="check">
            <input type="checkbox" checked={f.values.sweep} onChange={(e) => f.set('sweep', e.target.checked)} /> Include sensitivity sweep
          </label>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0 }}>
          <legend style={{ fontWeight: 600, fontSize: 13 }}>Strategies to compare with the baseline</legend>
          <div className="row gap-lg">
            {STRATEGIES.map((s) => (
              <label key={s.id} className="check">
                <input
                  type="checkbox"
                  checked={strategies.includes(s.id)}
                  onChange={(e) => setStrategies(e.target.checked ? [...strategies, s.id] : strategies.filter((x) => x !== s.id))}
                />{' '}
                {s.label}
              </label>
            ))}
          </div>
        </fieldset>
        <FormStatus error={f.serverError} success={f.success} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={f.saving}>
            {f.saving ? 'Simulating...' : 'Run simulation'}
          </button>
          <button type="button" className="btn" onClick={onSave} disabled={saveState.isLoading}>
            {saveState.isLoading ? 'Saving...' : 'Save scenario'}
          </button>
        </div>
      </form>
      {openId && <QueryState loading={opened.isLoading || opened.isFetching} error={opened.error} onRetry={opened.refetch} lines={6} />}
      {shown && !(openId && opened.isFetching) && <RunResults run={shown} />}
      <div className="card mt">
        <div className="card-head">
          <h2>Past runs</h2>
        </div>
        <DataTable<SimulationRun>
          rows={runs.data?.items}
          loading={runs.isLoading}
          error={runs.error}
          onRetry={runs.refetch}
          rowKey={(r) => r._id}
          empty="No simulations have been run yet"
          columns={[
            { key: 'at', header: 'Ran', render: (r) => dateTime(r.ranAt), sortValue: (r) => r.ranAt },
            { key: 'n', header: 'Scenario', render: (r) => r.scenarioSnapshot?.name || humanize(r.scenarioSnapshot?.type) },
            { key: 'd', header: 'Duration', render: (r) => `${r.scenarioSnapshot?.durationDays} d` },
            { key: 'by', header: 'By', render: (r) => r.ranBy?.name ?? '—' },
            { key: 'sh', header: 'Baseline shortage', align: 'right', render: (r) => number(r.baseline?.metrics?.shortageUnits, 0) },
            { key: 'late', header: 'Late orders', align: 'right', render: (r) => r.baseline?.metrics?.lateOrders ?? '—' },
            {
              key: 'o',
              header: '',
              render: (r) => (
                <button type="button" className="btn btn-sm" onClick={() => setOpenId(r._id)}>
                  Open
                </button>
              ),
            },
          ]}
        />
        {runs.data && <Pager page={page} limit={runs.data.limit} total={runs.data.total} onPage={setPage} />}
      </div>
    </>
  );
}

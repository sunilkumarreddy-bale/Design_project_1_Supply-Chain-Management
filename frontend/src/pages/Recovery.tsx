import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAnalyzeRecoveryMutation, useProposeRecoveryMutation, useRecoveryPlansQuery } from '../api/modules';
import { useSuppliersQuery } from '../api/procurement';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import FormField, { FormStatus } from '../components/FormField';
import OptionCard from '../components/OptionCard';
import Pager from '../components/Pager';
import { ProductSelect, SupplierSelect, WarehouseSelect } from '../components/Selects';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import { useForm } from '../hooks/useForm';
import type { RecoveryAnalysis, RecoveryInput, RecoveryPlan } from '../types';
import { date, number, rupees } from '../utils/format';
import { collect, isBlank, positive, required } from '../utils/validate';

export default function Recovery() {
  const { ownWarehouse } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const suppliers = useSuppliersQuery();
  const supplierParam = params.get('supplier') ?? '';
  const disrupted = suppliers.data?.items.find((s) => s._id === supplierParam && s.status === 'disrupted');
  const [analyze] = useAnalyzeRecoveryMutation();
  const [propose] = useProposeRecoveryMutation();
  const { busy, run } = useAction();
  const [analysis, setAnalysis] = useState<{ input: RecoveryInput; result: RecoveryAnalysis } | null>(null);
  const [page, setPage] = useState(1);
  const plans = useRecoveryPlansQuery({ page });
  const f = useForm(
    {
      product: params.get('product') ?? '',
      warehouse: params.get('warehouse') ?? ownWarehouse ?? '',
      horizonDays: '',
      requiredUnits: '',
      excludeSupplier: supplierParam,
    },
    (v) =>
      collect({
        product: required(v.product, 'Product'),
        warehouse: required(v.warehouse, 'Target warehouse'),
        horizonDays: isBlank(v.horizonDays) ? undefined : positive(v.horizonDays, 'Horizon'),
        requiredUnits: isBlank(v.requiredUnits) ? undefined : positive(v.requiredUnits, 'Required units'),
      }),
  );
  const onAnalyze = f.submit(async (v) => {
    const input: RecoveryInput = {
      product: v.product,
      warehouse: v.warehouse,
      horizonDays: isBlank(v.horizonDays) ? null : Number(v.horizonDays),
      requiredUnits: isBlank(v.requiredUnits) ? null : Number(v.requiredUnits),
      excludeSupplier: v.excludeSupplier || null,
    };
    setAnalysis(null);
    const r = await analyze(input).unwrap();
    setAnalysis({ input, result: r });
    return r.result.message;
  }, { keepValues: true });
  const a = analysis?.result;
  const c = a?.result.context;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Self-healing recovery</h1>
          <p>When a supplier cannot deliver, compare transfers and alternative suppliers. Nothing happens until an admin approves a plan.</p>
        </div>
      </div>
      {disrupted && (
        <div className="banner banner-warning">
          <div className="banner-body">
            {disrupted.name} is disrupted for about {disrupted.disruption?.expectedDays} day(s). It is excluded as a source and the horizon defaults to its disruption length.
          </div>
        </div>
      )}
      <form className="card" onSubmit={onAnalyze} noValidate>
        <div className="form-grid">
          <FormField label="Product" htmlFor="rc-product" error={f.errors.product} required>
            <ProductSelect id="rc-product" {...f.bind('product')} />
          </FormField>
          <FormField label="Target warehouse" htmlFor="rc-wh" error={f.errors.warehouse} required>
            <WarehouseSelect id="rc-wh" {...f.bind('warehouse')} disabled={!!ownWarehouse} />
          </FormField>
          <FormField label="Horizon (days)" htmlFor="rc-h" error={f.errors.horizonDays} hint="Blank = disrupted supplier's days, else 7">
            <input id="rc-h" type="number" min={1} {...f.bind('horizonDays')} />
          </FormField>
          <FormField label="Required units" htmlFor="rc-req" error={f.errors.requiredUnits} hint="Blank = demand x horizon + minimum − (on-hand + inbound)">
            <input id="rc-req" type="number" min={1} {...f.bind('requiredUnits')} />
          </FormField>
          <FormField label="Exclude supplier" htmlFor="rc-ex" hint="Blank = primary supplier if disrupted">
            <SupplierSelect id="rc-ex" placeholder="Automatic" {...f.bind('excludeSupplier')} />
          </FormField>
        </div>
        <FormStatus error={f.serverError} />
        <button type="submit" className="btn btn-primary" disabled={f.saving}>
          {f.saving ? 'Analyzing...' : 'Analyze'}
        </button>
      </form>
      {a && c && (
        <>
          <div className="card">
            <div className="card-head">
              <h2>
                {a.product.sku} at {a.targetWarehouse.name}
              </h2>
              <Badge tone={a.result.needed ? (a.result.options[0]?.shortageLeft === 0 ? 'warning' : 'danger') : 'success'}>{a.result.message}</Badge>
            </div>
            <div className="stats">
              <div className="card stat-card">
                <div className="stat-label">On-hand</div>
                <div className="stat-value">{number(c.onHand, 0)}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">Inbound in horizon</div>
                <div className="stat-value">{number(c.inboundWithinHorizon, 0)}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">Demand / day</div>
                <div className="stat-value">{number(c.dailyDemand)}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">Minimum stock</div>
                <div className="stat-value">{number(c.minStock, 0)}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">Horizon</div>
                <div className="stat-value">{c.horizonDays} d</div>
                <div className="stat-hint">{a.horizonSource}</div>
              </div>
              <div className="card stat-card stat-danger">
                <div className="stat-label">Required units</div>
                <div className="stat-value">{number(c.requiredUnits, 0)}</div>
              </div>
            </div>
            <p className="mono">
              required = ceil({number(c.dailyDemand)} × {c.horizonDays}) + {c.minStock} − ({c.onHand} + {c.inboundWithinHorizon}) = {c.requiredUnits}
              {a.excludedSupplier ? ` · excluding ${a.excludedSupplier.name}` : ''}
            </p>
            {a.result.sources.some((s) => !s.feasible) && (
              <details>
                <summary>Sources not used ({a.result.sources.filter((s) => !s.feasible).length})</summary>
                <ul className="plain-list">
                  {a.result.sources
                    .filter((s) => !s.feasible)
                    .map((s) => (
                      <li key={`${s.kind}-${s.id}`} className="small">
                        {s.name}: {s.reason}
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>
          {a.result.options.length > 0 && (
            <div className="grid grid-3 mt">
              {a.result.options.map((o) => (
                <OptionCard
                  key={o.optionId}
                  option={o}
                  action={
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy === o.optionId}
                      onClick={async () => {
                        const plan = await run(o.optionId, () => propose({ analysisInput: analysis!.input, selectedOptionId: o.optionId }).unwrap(), (p) => `Plan ${p.planNo} proposed for approval`);
                        if (plan) navigate(`/recovery/${plan._id}`);
                      }}
                    >
                      {busy === o.optionId ? 'Saving...' : 'Propose this plan'}
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
      <div className="card mt">
        <div className="card-head">
          <h2>Recovery plans</h2>
        </div>
        <DataTable<RecoveryPlan>
          rows={plans.data?.items}
          loading={plans.isLoading}
          error={plans.error}
          onRetry={plans.refetch}
          rowKey={(p) => p._id}
          empty="No recovery plans yet"
          columns={[
            { key: 'no', header: 'Plan no.', render: (p) => <strong>{p.planNo}</strong>, sortValue: (p) => p.planNo },
            { key: 'p', header: 'Product', render: (p) => p.product.sku },
            { key: 't', header: 'Target', render: (p) => p.targetWarehouse.code },
            { key: 's', header: 'Status', render: (p) => <Badge status={p.status} />, sortValue: (p) => p.status },
            { key: 'short', header: 'Shortage left', align: 'right', render: (p) => number(p.selectedOption?.shortageLeft, 0) },
            { key: 'cost', header: 'Cost', align: 'right', render: (p) => rupees(p.selectedOption?.totalCost), sortValue: (p) => p.selectedOption?.totalCost ?? 0 },
            { key: 'by', header: 'Created by', render: (p) => <>{p.createdBy?.name ?? '—'}<div className="muted small">{date(p.createdAt)}</div></> },
            { key: 'o', header: '', render: (p) => <Link to={`/recovery/${p._id}`} className="btn btn-sm">Open</Link> },
          ]}
        />
        {plans.data && <Pager page={page} limit={plans.data.limit} total={plans.data.total} onPage={setPage} />}
      </div>
    </>
  );
}

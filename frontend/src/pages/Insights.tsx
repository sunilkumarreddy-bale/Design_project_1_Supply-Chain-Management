import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUpdateProductMutation } from '../api/inventory';
import { useInsightsQuery, useRebalanceQuery } from '../api/insights';
import { useProposeRedistributionMutation } from '../api/modules';
import { useAppSelector } from '../app/store';
import Badge, { ClassChip } from '../components/Badge';
import DataTable from '../components/DataTable';
import ExplainPanel from '../components/ExplainPanel';
import QueryState from '../components/QueryState';
import RebalanceList from '../components/RebalanceList';
import { WarehouseSelect } from '../components/Selects';
import { useAction } from '../hooks/useAction';
import type { ExpiryRiskRow, InsightRow } from '../types';
import { number, pct, rupees } from '../utils/format';

const SOURCE: Record<string, string> = { override: 'Override', blended: 'Learned', nominal: 'Promised', default: 'Default' };

export default function Insights() {
  const selected = useAppSelector((s) => s.auth.selectedWarehouse);
  const [warehouse, setWarehouse] = useState(selected);
  const q = useInsightsQuery({ warehouse: warehouse || undefined });
  const rebalance = useRebalanceQuery();
  const [updateProduct] = useUpdateProductMutation();
  const [propose] = useProposeRedistributionMutation();
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const [why, setWhy] = useState<InsightRow | null>(null);
  const whyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (why) whyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [why]);

  const reorderCount = q.data?.items.filter((i) => i.status === 'reorder').length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Insights</h1>
          <p>ABC-XYZ classes, reorder policy, learned lead times and days of cover{warehouse ? ' for the selected warehouse' : ' across the network'}.</p>
        </div>
        <div className="field" style={{ marginBottom: 0, minWidth: 240 }}>
          <label htmlFor="in-wh">Warehouse</label>
          <WarehouseSelect id="in-wh" placeholder="All warehouses (network)" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} />
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Products</h2>
          {q.data && <span className="muted small">{reorderCount} product(s) at or below the reorder point</span>}
        </div>
        <DataTable<InsightRow>
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error}
          onRetry={q.refetch}
          rowKey={(r) => r.product._id}
          empty="No products tracked here"
          rowClassName={(r) => (r.status === 'reorder' ? 'row-highlight' : undefined)}
          columns={[
            { key: 'p', header: 'Product', render: (r) => <><strong>{r.product.sku}</strong><div className="muted small">{r.product.name}</div></>, sortValue: (r) => r.product.sku },
            { key: 'class', header: 'Class', render: (r) => <ClassChip value={r.class} title={r.policyHint} />, sortValue: (r) => r.class },
            { key: 'value', header: 'Annual value', align: 'right', render: (r) => <>{rupees(r.annualValue, true)}<div className="muted small">{pct(r.valueShare)}</div></>, sortValue: (r) => r.annualValue },
            { key: 'cv', header: 'Demand CV', align: 'right', render: (r) => (r.demandCV === null ? '—' : number(r.demandCV)), sortValue: (r) => r.demandCV ?? 99 },
            { key: 'oh', header: 'On-hand', align: 'right', render: (r) => number(r.onHand, 0), sortValue: (r) => r.onHand },
            { key: 'oo', header: 'On-order', align: 'right', render: (r) => number(r.onOrder, 0), sortValue: (r) => r.onOrder },
            { key: 'rop', header: 'ROP', align: 'right', render: (r) => number(r.reorderPoint, 0), sortValue: (r) => r.reorderPoint },
            { key: 'ss', header: 'Safety stock', align: 'right', render: (r) => number(r.safetyStock, 1), sortValue: (r) => r.safetyStock },
            { key: 'eoq', header: 'EOQ', align: 'right', render: (r) => number(r.eoq, 0), sortValue: (r) => r.eoq },
            {
              key: 'lt',
              header: 'Lead time',
              render: (r) => (
                <span className="nowrap" title={r.promisedLeadTimeDays !== null ? `Promised ${r.promisedLeadTimeDays} d, ${r.leadTimeSamples} deliveries observed` : undefined}>
                  {number(r.leadTimeDays, 1)} d <Badge status={r.leadTimeSource}>{SOURCE[r.leadTimeSource]}</Badge>
                </span>
              ),
              sortValue: (r) => r.leadTimeDays,
            },
            { key: 'cover', header: 'Days of cover', align: 'right', render: (r) => (r.daysOfCover === null ? '—' : number(r.daysOfCover, 1)), sortValue: (r) => r.daysOfCover ?? 9999 },
            { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} />, sortValue: (r) => r.status },
            {
              key: 'z',
              header: 'Current z',
              render: (r) => (
                <div className="nowrap">
                  {number(r.currentZ)}
                  {Math.abs(r.currentZ - r.recommendedZ) > 0.001 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ marginLeft: 6 }}
                      title={`Class ${r.abc} recommends z = ${r.recommendedZ}`}
                      disabled={busy === r.product._id}
                      onClick={() => run(r.product._id, () => updateProduct({ id: r.product._id, data: { serviceLevelZ: r.recommendedZ } }).unwrap(), `${r.product.sku}: z set to ${r.recommendedZ}`)}
                    >
                      {busy === r.product._id ? 'Saving...' : `Apply recommended z (${r.recommendedZ})`}
                    </button>
                  )}
                </div>
              ),
            },
            {
              key: 'why',
              header: '',
              render: (r) => (
                <button type="button" className="btn btn-sm" aria-expanded={why?.product._id === r.product._id} onClick={() => setWhy(why?.product._id === r.product._id ? null : r)}>
                  Why?
                </button>
              ),
            },
          ]}
        />
      </div>
      {why && (
        <div className="card" ref={why ? whyRef : undefined}>
          <div className="card-head">
            <h2>
              {why.product.sku} · class {why.class}
            </h2>
            <button type="button" className="btn btn-sm" onClick={() => setWhy(null)}>
              Close
            </button>
          </div>
          <p className="muted">{why.policyHint}</p>
          <ExplainPanel explanation={why.explanation} />
        </div>
      )}
      <div className="grid grid-2 mt">
        <div className="card">
          <div className="card-head">
            <h2>Rebalance before you buy</h2>
          </div>
          <QueryState error={rebalance.error} onRetry={rebalance.refetch}>
            <RebalanceList items={rebalance.data?.items} loading={rebalance.isLoading} />
          </QueryState>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Expiry waste risk</h2>
          </div>
          <DataTable<ExpiryRiskRow>
            rows={q.data?.expiryRisk}
            loading={q.isLoading}
            rowKey={(r) => r.stockLevelId}
            empty="No dated batches at risk"
            dense
            columns={[
              { key: 'p', header: 'Product', render: (r) => r.product.sku },
              { key: 'w', header: 'Warehouse', render: (r) => r.warehouse.code },
              { key: 'b', header: 'Batch', render: (r) => r.batchNo || '—' },
              { key: 'd', header: 'Days left', align: 'right', render: (r) => r.daysLeft, sortValue: (r) => r.daysLeft },
              { key: 'u', header: 'Units', align: 'right', render: (r) => number(r.units, 0) },
              { key: 'waste', header: 'Projected waste', align: 'right', render: (r) => <span className={r.projectedWaste > 0 ? 'error-text' : ''}>{number(r.projectedWaste, 0)}</span>, sortValue: (r) => r.projectedWaste },
              { key: 'v', header: 'Value at risk', align: 'right', render: (r) => rupees(r.valueAtRisk), sortValue: (r) => r.valueAtRisk },
              {
                key: 'a',
                header: '',
                render: (r) =>
                  r.projectedWaste > 0 ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy === r.stockLevelId}
                      onClick={async () => {
                        const plan = await run(r.stockLevelId, () => propose({ stockLevelId: r.stockLevelId }).unwrap(), (p) => `Plan ${p.planNo} proposed`);
                        if (plan) navigate(`/redistribution?plan=${plan._id}`);
                      }}
                    >
                      {busy === r.stockLevelId ? 'Saving...' : 'Propose redistribution'}
                    </button>
                  ) : null,
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}

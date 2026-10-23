import { useMemo, useState } from 'react';
import { downloadFile, errorMessage } from '../api/client';
import { useUsersQuery } from '../api/admin';
import { useAuditQuery, useVerifyAuditMutation } from '../api/insights';
import Banner from '../components/Banner';
import DataTable from '../components/DataTable';
import { useAuth } from '../hooks/useAuth';
import type { AuditEntry, VerifyResult } from '../types';
import { dateTime, shortHash } from '../utils/format';

const ENTITY_TYPES = [
  'User',
  'Warehouse',
  'Supplier',
  'SupplierOffer',
  'Product',
  'StockLevel',
  'StockPolicy',
  'TransferRoute',
  'Transfer',
  'PurchaseOrder',
  'StockCount',
  'Discrepancy',
  'Alert',
  'RecoveryPlan',
  'RedistributionPlan',
  'CustomerOrder',
  'ProductDependency',
  'DisruptionScenario',
  'SimulationRun',
];

function Expander({ e }: { e: AuditEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Before / after'}
      </button>
      {open && (
        <div className="grid grid-2 mt" style={{ minWidth: 420 }}>
          <div>
            <div className="k">Before</div>
            <pre className="json">{JSON.stringify(e.before, null, 2)}</pre>
          </div>
          <div>
            <div className="k">After</div>
            <pre className="json">{JSON.stringify(e.after, null, 2)}</pre>
          </div>
          {e.metadata !== null && e.metadata !== undefined && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="k">Metadata</div>
              <pre className="json">{JSON.stringify(e.metadata, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function AuditLog() {
  const { is } = useAuth();
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const limit = 25;
  const q = useAuditQuery({ entityType: entityType || undefined, action: action.trim() || undefined, actor: actor || undefined, page, limit });
  const users = useUsersQuery({ limit: 500 }, { skip: !is('admin') });
  const [verify, verifyState] = useVerifyAuditMutation();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const actorOptions = useMemo(() => {
    if (users.data) return users.data.items.map((u) => ({ id: u._id, label: `${u.name} (${u.email})` }));
    const seen = new Map<string, string>();
    for (const e of q.data?.items ?? []) if (e.actor && e.actorInfo) seen.set(e.actor, `${e.actorInfo.name} (${e.actorInfo.email})`);
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [users.data, q.data]);

  const runVerify = async () => {
    setVerifyError('');
    setResult(null);
    try {
      setResult(await verify().unwrap());
    } catch (e) {
      setVerifyError(errorMessage(e));
    }
  };
  const exportCsv = async () => {
    setExporting(true);
    setExportError('');
    try {
      await downloadFile('/audit/export.csv', { entityType: entityType || undefined, action: action.trim() || undefined, actor: actor || undefined }, 'audit.csv');
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / limit)) : 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>Every change is appended to a SHA-256 hash chain. Verification finds the first entry that was edited, removed or reordered.</p>
        </div>
        <div className="btn-group">
          <button type="button" className="btn btn-primary" onClick={runVerify} disabled={verifyState.isLoading}>
            {verifyState.isLoading ? 'Verifying...' : 'Verify integrity'}
          </button>
          <button type="button" className="btn" onClick={exportCsv} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>
      {result?.valid === true && (
        <Banner tone="success">
          Chain intact: {result.checked} entries checked, head hash <code>{result.headHash ? shortHash(result.headHash, 16) : 'none'}</code> (#{result.headSeq ?? 0}).
          <div className="small">Deleting the newest entries cannot be detected from the chain alone: keep a copy of this head hash and compare it later.</div>
        </Banner>
      )}
      {result?.valid === false && (
        <Banner tone="error">
          Broken at entry #{result.brokenAtSeq}: {result.reason}. {result.checked} entries before it verified correctly.
        </Banner>
      )}
      {verifyError && <Banner tone="error">{verifyError}</Banner>}
      {exportError && <Banner tone="error">{exportError}</Banner>}
      <div className="card">
        <div className="filters">
          <div className="field">
            <label htmlFor="au-type">Entity type</label>
            <select id="au-type" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
              <option value="">All</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="au-action">Action (prefix)</label>
            <input id="au-action" placeholder="e.g. po. or stock.receive" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          </div>
          <div className="field">
            <label htmlFor="au-actor">Actor</label>
            <select id="au-actor" value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }}>
              <option value="">Anyone</option>
              {actorOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DataTable<AuditEntry>
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error}
          onRetry={q.refetch}
          rowKey={(e) => e._id}
          empty="No audit entries match"
          columns={[
            { key: 'seq', header: 'Seq', render: (e) => <strong>#{e.seq}</strong> },
            { key: 'time', header: 'Time', render: (e) => dateTime(e.createdAt) },
            { key: 'actor', header: 'Actor', render: (e) => e.actorInfo?.name ?? (e.actor ? e.actor.slice(-6) : 'system') },
            { key: 'action', header: 'Action', render: (e) => <code>{e.action}</code> },
            { key: 'entity', header: 'Entity', render: (e) => <>{e.entityType}<div className="mono muted">{e.entityId ? e.entityId.slice(-8) : ''}</div></> },
            { key: 'diff', header: 'Before / after', render: (e) => <Expander e={e} /> },
            { key: 'hash', header: 'Hash', render: (e) => <code title={e.hash}>{shortHash(e.hash)}</code> },
          ]}
        />
        <nav className="pager" aria-label="Pagination">
          <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="pager-info">
            Page {page} of {pages} · {q.data?.total ?? 0} entries
          </span>
          <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      </div>
    </>
  );
}

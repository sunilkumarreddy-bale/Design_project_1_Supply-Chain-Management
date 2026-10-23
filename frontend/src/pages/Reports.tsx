import { useState } from 'react';
import { downloadFile, errorMessage } from '../api/client';
import { useAppSelector } from '../app/store';
import Banner from '../components/Banner';
import { SupplierSelect, WarehouseSelect } from '../components/Selects';
import { useAuth } from '../hooks/useAuth';

interface ReportDef {
  id: string;
  label: string;
  path: string;
  description: string;
  scoped?: boolean;
}

const CSV: ReportDef[] = [
  { id: 'stock-csv', label: 'Stock CSV', path: '/reports/stock.csv', description: 'Every stock line with bin, batch, expiry and value', scoped: true },
  { id: 'po-csv', label: 'PO CSV', path: '/reports/purchase-orders.csv', description: 'All purchase orders with status and totals', scoped: true },
  { id: 'sup-csv', label: 'Supplier CSV', path: '/reports/suppliers.csv', description: 'Promised vs learned lead times and scores' },
  { id: 'exp-csv', label: 'Expiry CSV', path: '/reports/expiry.csv', description: 'Dated batches with projected waste and value at risk', scoped: true },
];
const PDF: ReportDef[] = [
  { id: 'stock-pdf', label: 'Stock PDF', path: '/reports/stock.pdf', description: 'Printable stock report', scoped: true },
  { id: 'po-pdf', label: 'PO PDF', path: '/reports/purchase-orders.pdf', description: 'Printable purchase order list', scoped: true },
];

export default function Reports() {
  const { is } = useAuth();
  const selected = useAppSelector((s) => s.auth.selectedWarehouse);
  const [warehouse, setWarehouse] = useState(selected);
  const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const isSupplier = is('supplier');

  const download = async (id: string, path: string, params: Record<string, unknown>) => {
    setBusy(id);
    setError('');
    setDone('');
    try {
      const name = await downloadFile(path, params);
      setDone(`Downloaded ${name}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const button = (r: ReportDef) => (
    <div key={r.id} className="rebalance-item">
      <div>
        <strong>{r.label}</strong>
        <div className="muted small">{r.description}</div>
      </div>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => download(r.id, r.path, r.scoped ? { warehouse: warehouse || undefined } : {})}>
        {busy === r.id ? 'Preparing...' : r.label}
      </button>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>CSV exports for analysis and PDF reports for printing. Amounts are in INR.</p>
        </div>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {done && <Banner tone="success">{done}</Banner>}
      {!isSupplier && (
        <div className="card">
          <div className="filters">
            <div className="field">
              <label htmlFor="rep-wh">Warehouse (for stock, PO and expiry reports)</label>
              <WarehouseSelect id="rep-wh" placeholder="All warehouses" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-2">
            <div>
              <h2>CSV</h2>
              {CSV.map(button)}
            </div>
            <div>
              <h2>PDF</h2>
              {PDF.map(button)}
            </div>
          </div>
        </div>
      )}
      <div className="card">
        <h2>Supplier scorecard PDF</h2>
        <div className="row gap" style={{ alignItems: 'flex-end' }}>
          {!isSupplier && (
            <div className="field grow">
              <label htmlFor="rep-sup">Supplier</label>
              <SupplierSelect id="rep-sup" placeholder="All suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginBottom: 12 }}
            disabled={busy === 'scorecard'}
            onClick={() => download('scorecard', '/reports/supplier-scorecard.pdf', isSupplier ? {} : { supplier: supplier || undefined })}
          >
            {busy === 'scorecard' ? 'Preparing...' : 'Supplier scorecard PDF'}
          </button>
        </div>
        {isSupplier && <p className="muted small">Your own delivery performance and purchase orders.</p>}
      </div>
    </>
  );
}

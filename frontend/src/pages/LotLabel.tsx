import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useLotQuery } from '../api/dna';
import QueryState from '../components/QueryState';
import { date } from '../utils/format';

/** Print-friendly lot label: DNA QR, DNA code, product, batch, expiry and receiving date. */
export default function LotLabel() {
  const { id = '' } = useParams();
  const lot = useLotQuery(id);
  const [size, setSize] = useState<'small' | 'large'>('large');
  const l = lot.data;
  return (
    <QueryState loading={lot.isLoading} error={lot.error} onRetry={lot.refetch}>
      {l && (
        <>
          <div className="page-head no-print">
            <div>
              <p className="small">
                <Link to={`/dna/${l._id}`}>← {l.dnaCode}</Link>
              </p>
              <h1>Lot label</h1>
            </div>
            <div className="btn-group">
              <div className="field">
                <label htmlFor="label-size">Size</label>
                <select id="label-size" value={size} onChange={(e) => setSize(e.target.value as 'small' | 'large')}>
                  <option value="small">Small (50 × 25 mm)</option>
                  <option value="large">Large (100 × 50 mm)</option>
                </select>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => window.print()}>
                Print
              </button>
            </div>
          </div>
          <div className={`label-sheet label-${size}`}>
            <QRCodeSVG value={l.dnaCode} size={size === 'small' ? 72 : 140} />
            <div>
              <div className="mono">
                <strong>{l.dnaCode}</strong>
              </div>
              <div>{l.product.name}</div>
              <div>Batch {l.batchNo || '—'}</div>
              <div>Expiry {l.expiryDate ? date(l.expiryDate) : 'none'}</div>
              <div>Received {date(l.birth.at)}</div>
            </div>
          </div>
        </>
      )}
    </QueryState>
  );
}

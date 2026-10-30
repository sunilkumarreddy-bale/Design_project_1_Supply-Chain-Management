import type { Gene, StockLot } from '../../types';
import { dateTime, humanize, number } from '../../utils/format';
import { RefLink } from './LotParts';

const ICON: Record<string, string> = {
  born: '✦',
  receive_more: '＋',
  put_away: '▣',
  qc_hold: '⏸',
  qc_release: '▶',
  qc_reject: '✗',
  transfer_out: '↗',
  transfer_in: '↘',
  reserve: '◔',
  release_reserve: '◌',
  pick_fefo: '⇣',
  dispatch_sale: '⇢',
  consume: '⚙',
  count_adjust: '±',
  damage: '⚠',
  expiry_warning: '⏳',
  expire: '⌛',
  recall_flag: '⚑',
  recall_clear: '⚐',
  return_to_supplier: '↩',
  write_off: '🗑',
  decision_note: '✎',
  death: '✝',
};

function where(g: Gene): string {
  if (g.type === 'transfer_out' || g.type === 'transfer_in') return `${g.fromWarehouse?.code ?? '?'} → ${g.toWarehouse?.code ?? '?'}`;
  return [g.warehouse?.code, g.bin ? `bin ${g.bin}` : ''].filter(Boolean).join(' · ');
}

function qty(g: Gene): string {
  if (g.qtyDelta) return `${g.qtyDelta > 0 ? '+' : ''}${number(g.qtyDelta, 0)}`;
  if (g.qtyMoved) return `${number(g.qtyMoved, 0)} moved`;
  return '';
}

/** The lot's life from Born (top) to Death or "Still alive" (bottom). */
export default function Lifeline({ genes, lot }: { genes: Gene[]; lot: Pick<StockLot, 'status' | 'death'> }) {
  return (
    <ol className="lifeline" aria-label="Lifeline">
      {genes.map((g) => (
        <li key={g._id} className={`gene gene-${g.type}${g.type === 'born' ? ' gene-birth' : ''}${g.type === 'death' ? ' gene-death' : ''}`}>
          <span className="gene-icon" aria-hidden>
            {ICON[g.type] ?? '•'}
          </span>
          <div className="gene-body">
            <div className="gene-head">
              <strong>
                #{g.seq} {humanize(g.type)}
              </strong>
              <span className="muted small">{dateTime(g.at)}</span>
              {g.daysSincePrevious !== null && <span className="muted small">+{number(g.daysSincePrevious)} d</span>}
            </div>
            <div className="gene-meta small">
              {where(g) && <span>{where(g)}</span>}
              {qty(g) && <span className={g.qtyDelta < 0 ? 'neg' : g.qtyDelta > 0 ? 'pos' : ''}>{qty(g)}</span>}
              <span className="muted">
                on hand {number(g.qtyAfter.onHand, 0)}
                {g.qtyAfter.inTransit ? `, in transit ${number(g.qtyAfter.inTransit, 0)}` : ''}
              </span>
              <span className="muted">by {g.actor?.name ?? 'system'}</span>
              <RefLink refType={g.refType} refId={g.refId} />
            </div>
            {g.explanation && <div className="gene-why">{g.explanation}</div>}
            {g.evidence?.length > 0 && (
              <div className="small">
                Evidence:{' '}
                {g.evidence.map((e, i) => (
                  <a key={e} href={e} target="_blank" rel="noreferrer">
                    file {i + 1}
                  </a>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
      {!lot.death && (
        <li className="gene gene-alive">
          <span className="gene-icon" aria-hidden>
            ♥
          </span>
          <div className="gene-body">
            <strong>Still alive</strong> <span className="muted small">({humanize(lot.status)})</span>
          </div>
        </li>
      )}
    </ol>
  );
}

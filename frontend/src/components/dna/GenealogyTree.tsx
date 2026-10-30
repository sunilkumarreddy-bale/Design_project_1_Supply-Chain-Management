import { useNavigate } from 'react-router-dom';
import type { Genealogy } from '../../types';
import { humanize } from '../../utils/format';

const W = 170;
const H = 46;
const GAP_X = 24;
const GAP_Y = 46;

/** Parents above, this lot in the middle, children below (plain SVG). */
export default function GenealogyTree({ data }: { data: Genealogy }) {
  const navigate = useNavigate();
  const rows = [
    data.nodes.filter((n) => n.role === 'ancestor'),
    data.nodes.filter((n) => n.role === 'self'),
    data.nodes.filter((n) => n.role === 'descendant'),
  ].filter((r) => r.length);
  if (data.nodes.length <= 1) return <p className="muted">No parent or child lots: this lot was not returned, repacked or merged.</p>;
  const widest = Math.max(...rows.map((r) => r.length));
  const width = widest * W + (widest - 1) * GAP_X + 20;
  const height = rows.length * H + (rows.length - 1) * GAP_Y + 20;
  const pos = new Map<string, { x: number; y: number }>();
  rows.forEach((r, ri) => {
    const rowWidth = r.length * W + (r.length - 1) * GAP_X;
    r.forEach((n, i) => pos.set(n._id, { x: (width - rowWidth) / 2 + i * (W + GAP_X), y: 10 + ri * (H + GAP_Y) }));
  });
  return (
    <svg className="graph-svg genealogy" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Genealogy of this lot">
      {data.edges.map((e) => {
        const a = pos.get(e.parentLot);
        const b = pos.get(e.childLot);
        if (!a || !b) return null;
        return (
          <g key={`${e.parentLot}-${e.childLot}`}>
            <line x1={a.x + W / 2} y1={a.y + H} x2={b.x + W / 2} y2={b.y} className="edge" />
            <text x={(a.x + b.x) / 2 + W / 2 + 6} y={(a.y + H + b.y) / 2 + 4} className="edge-label">
              {e.relation} · {e.qty}
            </text>
          </g>
        );
      })}
      {data.nodes.map((n) => {
        const p = pos.get(n._id)!;
        return (
          <g
            key={n._id}
            className={`node node-${n.role}`}
            tabIndex={0}
            role="link"
            aria-label={`Open lot ${n.dnaCode}`}
            onClick={() => navigate(`/dna/${n._id}`)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(`/dna/${n._id}`)}
          >
            <rect x={p.x} y={p.y} width={W} height={H} rx={8} />
            <text x={p.x + 8} y={p.y + 18} className="node-title">
              {n.dnaCode}
            </text>
            <text x={p.x + 8} y={p.y + 35} className="node-sub">
              {n.batchNo || '—'} · {humanize(n.status)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

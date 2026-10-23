import type { GraphEdge, GraphNode } from '../types';

const COLS: GraphNode['type'][] = ['supplier', 'product', 'position', 'order'];
const TITLES: Record<string, string> = { supplier: 'Suppliers', product: 'Products', position: 'Warehouse positions', order: 'Customer orders' };

/** Layered SVG view: supplier → products → warehouse positions → orders; affected nodes highlighted. */
export default function DependencyGraph({ nodes, edges, onlyAffected }: { nodes: GraphNode[]; edges: GraphEdge[]; onlyAffected?: boolean }) {
  const affectedIds = new Set(nodes.filter((n) => n.affected).map((n) => n.id));
  const shown = onlyAffected
    ? nodes.filter((n) => n.affected || edges.some((e) => (affectedIds.has(e.from) && e.to === n.id) || (affectedIds.has(e.to) && e.from === n.id && e.kind === 'offers')))
    : nodes;
  const byCol = COLS.map((t) => shown.filter((n) => n.type === t).sort((a, b) => Number(b.affected) - Number(a.affected) || a.label.localeCompare(b.label)));
  const rowH = 30;
  const colW = 230;
  const nodeW = 200;
  const height = Math.max(4, ...byCol.map((c) => c.length)) * rowH + 50;
  const width = COLS.length * colW + 10;
  const pos = new Map<string, { x: number; y: number }>();
  byCol.forEach((col, ci) => col.forEach((n, ri) => pos.set(n.id, { x: 10 + ci * colW, y: 40 + ri * rowH })));
  const visibleEdges = edges.filter((e) => pos.has(e.from) && pos.has(e.to));
  if (!shown.length) return <p className="muted">No nodes to show.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg className="graph-svg" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width }} role="img" aria-label="Dependency graph">
        {COLS.map((t, ci) => (
          <text key={t} x={10 + ci * colW} y={20} fontSize={12} fontWeight={700} fill="#26365b">
            {TITLES[t]}
          </text>
        ))}
        {visibleEdges.map((e, i) => {
          const a = pos.get(e.from)!;
          const b = pos.get(e.to)!;
          const sameCol = a.x === b.x;
          const x1 = sameCol ? a.x + nodeW : a.x + nodeW;
          const y1 = a.y + 10;
          const x2 = sameCol ? b.x + nodeW : b.x;
          const y2 = b.y + 10;
          const d = sameCol ? `M${x1},${y1} C${x1 + 24},${y1} ${x2 + 24},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1 + 20},${y1} ${x2 - 20},${y2} ${x2},${y2}`;
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={e.affected ? '#8c1d2f' : e.kind === 'offers' ? '#7fa4d6' : '#c9c2b6'}
              strokeWidth={e.affected ? 2 : 1}
              strokeDasharray={e.kind === 'offers' ? '4 3' : undefined}
            >
              <title>{e.kind.replace('_', ' ') + (e.quantityPer ? ` × ${e.quantityPer}` : '')}</title>
            </path>
          );
        })}
        {shown.map((n) => {
          const p = pos.get(n.id)!;
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`}>
              <rect width={nodeW} height={20} rx={5} fill={n.affected ? '#f6e7ea' : '#ffffff'} stroke={n.affected ? '#8c1d2f' : '#d3cbbf'} />
              <text x={8} y={14} fontSize={11} fill={n.affected ? '#6f1424' : '#4a505b'}>
                {n.label.length > 32 ? `${n.label.slice(0, 31)}…` : n.label}
              </text>
              <title>{n.label + (n.affected ? ` (affected, depth ${n.depth})` : '')}</title>
            </g>
          );
        })}
      </svg>
      <p className="muted small">Maroon = affected by the disruption. Dashed blue = alternative supplier offer (not a dependency).</p>
    </div>
  );
}

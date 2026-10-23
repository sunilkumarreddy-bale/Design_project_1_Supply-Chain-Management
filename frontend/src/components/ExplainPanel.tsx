import type { ReorderExplanation } from '../types';
import { number } from '../utils/format';
import Badge from './Badge';

const LEAD_SOURCE: Record<string, string> = {
  override: 'product override',
  blended: 'learned from received POs',
  nominal: "supplier's promise",
  default: '7-day default',
};

/** Glass-box reorder explanation (F1): inputs, policy, and every formula with the real numbers. */
export default function ExplainPanel({ explanation, title = 'Why this decision' }: { explanation: ReorderExplanation | null | undefined; title?: string }) {
  if (!explanation) return <p className="muted">No explanation is stored for this line.</p>;
  const e = explanation;
  const i = e.inputs;
  return (
    <section className="explain" aria-label={title}>
      <div className="explain-head">
        <h3>{title}</h3>
        <Badge tone={e.shouldReorder ? 'warning' : 'success'}>{e.shouldReorder ? `Reorder ${number(e.orderQuantity, 0)}` : 'No reorder needed'}</Badge>
      </div>
      <div className="explain-grid">
        <div>
          <span className="k">Daily demand d</span>
          <span className="v">
            {number(i.avgDailyDemand)} <small>({i.demandSource})</small>
          </span>
        </div>
        <div>
          <span className="k">Demand σ</span>
          <span className="v">{number(i.demandStdDev)}</span>
        </div>
        <div>
          <span className="k">Lead time L</span>
          <span className="v">
            {number(i.leadDays)} d <small>({LEAD_SOURCE[i.leadTimeSource] ?? i.leadTimeSource})</small>
          </span>
        </div>
        <div>
          <span className="k">Lead time σ</span>
          <span className="v">{number(i.sigmaLead)} d</span>
        </div>
        <div>
          <span className="k">Service level z</span>
          <span className="v">{number(i.z)}</span>
        </div>
        <div>
          <span className="k">Annual demand D</span>
          <span className="v">{number(i.annualDemand, 0)}</span>
        </div>
        <div>
          <span className="k">Order cost S / holding H</span>
          <span className="v">
            ₹{number(i.orderCost)} / ₹{number(i.holdingCost)}
          </span>
        </div>
        <div>
          <span className="k">On-hand + on-order</span>
          <span className="v">
            {number(i.onHand, 0)} + {number(i.onOrder, 0)} = {number(e.position, 0)}
          </span>
        </div>
      </div>
      <div className="explain-policy">
        <div>
          <span className="k">Safety stock</span>
          <span className="v">{number(e.policy.safetyStock, 1)}</span>
        </div>
        <div>
          <span className="k">Reorder point</span>
          <span className="v">{number(e.policy.reorderPoint, 0)}</span>
        </div>
        <div>
          <span className="k">EOQ</span>
          <span className="v">{number(e.policy.economicOrderQuantity, 0)}</span>
        </div>
      </div>
      <ol className="explain-steps">
        {e.steps.map((s, idx) => (
          <li key={idx}>
            <code>{s}</code>
          </li>
        ))}
      </ol>
    </section>
  );
}

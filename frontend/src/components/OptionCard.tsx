import type { ReactNode } from 'react';
import type { RecoveryOption } from '../types';
import { number, rupees } from '../utils/format';
import Badge from './Badge';

export default function OptionCard({ option, action }: { option: RecoveryOption; action?: ReactNode }) {
  return (
    <div className={`option-card rank-${option.rank}`}>
      <div className="row spread gap">
        <Badge tone={option.rank === 1 ? 'maroon' : 'navy'}>{`#${option.rank}`}</Badge>
        <strong className="grow">{option.label}</strong>
        <Badge tone={option.feasible ? 'success' : 'danger'}>{option.feasible ? 'Feasible' : 'Not feasible'}</Badge>
      </div>
      <table className="table table-dense">
        <thead>
          <tr>
            <th>Step</th>
            <th>Source</th>
            <th style={{ textAlign: 'right' }}>Qty</th>
            <th style={{ textAlign: 'right' }}>Lead</th>
            <th style={{ textAlign: 'right' }}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {option.steps.map((s, i) => (
            <tr key={i}>
              <td>{s.type === 'transfer' ? 'Transfer' : 'Purchase'}</td>
              <td>{s.type === 'transfer' ? s.fromWarehouseName : s.supplierName}</td>
              <td style={{ textAlign: 'right' }}>{number(s.quantity, 0)}</td>
              <td style={{ textAlign: 'right' }}>{number(s.leadTimeDays, 1)} d</td>
              <td style={{ textAlign: 'right' }}>{rupees(s.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="kv">
        <dt>Covered units</dt>
        <dd>{number(option.coveredUnits, 0)}</dd>
        <dt>Shortage left</dt>
        <dd className={option.shortageLeft > 0 ? 'error-text' : ''}>{number(option.shortageLeft, 0)}</dd>
        <dt>Total cost</dt>
        <dd>{rupees(option.totalCost)}</dd>
        <dt>ETA</dt>
        <dd>{number(option.etaDays, 1)} day(s)</dd>
      </dl>
      <ul className="checks" aria-label="Constraint checks">
        {option.constraintChecks.map((c) => (
          <li key={c.name} title={c.detail}>
            <span className={c.passed ? 'tick' : 'cross'} aria-label={c.passed ? 'passed' : 'failed'}>
              {c.passed ? '✓' : '✗'}
            </span>
            <span>
              {c.name}
              <span className="muted small"> · {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <ul className="explain-steps" style={{ paddingLeft: 18 }}>
        {option.explanation.map((e, i) => (
          <li key={i} className="small">
            {e}
          </li>
        ))}
      </ul>
      {action}
    </div>
  );
}

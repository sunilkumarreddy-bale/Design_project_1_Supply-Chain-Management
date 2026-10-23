import { render, screen } from '@testing-library/react';
import ExplainPanel from '../components/ExplainPanel';
import type { ReorderExplanation } from '../types';

const e: ReorderExplanation = {
  inputs: {
    avgDailyDemand: 10,
    demandStdDev: 0,
    demandSource: 'history',
    leadDays: 5,
    sigmaLead: 0,
    leadTimeSource: 'nominal',
    leadTimeSamples: 0,
    z: 1.65,
    annualDemand: 3650,
    orderCost: 20,
    holdingCost: 2,
    onHand: 30,
    onOrder: 0,
  },
  policy: { safetyStock: 0, reorderPoint: 50, economicOrderQuantity: 271 },
  position: 30,
  shouldReorder: true,
  orderQuantity: 271,
  steps: ['Reorder point = ceil(10 x 5 + 0) = 50', 'Order quantity = 1 x EOQ 271 = 271'],
};

describe('ExplainPanel', () => {
  it('shows the decision, policy numbers and every step', () => {
    render(<ExplainPanel explanation={e} />);
    expect(screen.getByText('Reorder 271')).toBeInTheDocument();
    expect(screen.getByText('Reorder point = ceil(10 x 5 + 0) = 50')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(/supplier's promise/)).toBeInTheDocument();
    expect(screen.getByText('30 + 0 = 30')).toBeInTheDocument();
  });
  it('says when no explanation exists', () => {
    render(<ExplainPanel explanation={null} />);
    expect(screen.getByText(/No explanation is stored/)).toBeInTheDocument();
  });
  it('shows a no-reorder decision', () => {
    render(<ExplainPanel explanation={{ ...e, shouldReorder: false, orderQuantity: 0 }} />);
    expect(screen.getByText('No reorder needed')).toBeInTheDocument();
  });
});

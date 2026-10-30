import { screen } from '@testing-library/react';
import Lifeline from '../components/dna/Lifeline';
import { LifeBar, LotStatusBadge, refPath } from '../components/dna/LotParts';
import type { Gene } from '../types';
import { renderWithProviders } from './utils';

const gene = (seq: number, type: string, extra: Partial<Gene> = {}): Gene => ({
  _id: `g${seq}`,
  lot: 'l1',
  seq,
  type,
  at: new Date(Date.UTC(2026, 0, seq)).toISOString(),
  actor: { _id: 'u1', name: 'Asha Admin' },
  actorRole: 'admin',
  warehouse: { _id: 'w1', code: 'WH-NORTH', name: 'Warehouse A' },
  fromWarehouse: null,
  toWarehouse: null,
  bin: null,
  qtyDelta: 0,
  qtyMoved: 0,
  qtyAfter: { onHand: 500, inTransit: 0 },
  cause: null,
  refType: null,
  refId: null,
  explanation: '',
  evidence: [],
  hash: 'h',
  prevHash: 'p',
  daysSincePrevious: seq === 1 ? null : 1,
  ...extra,
});

describe('Stock DNA components', () => {
  it('the lifeline runs from birth to death with explanations, quantities and reference links', () => {
    const genes = [
      gene(1, 'born', { qtyDelta: 500, explanation: 'Received 500 packets', refType: 'purchase_order', refId: 'po1' }),
      gene(2, 'transfer_out', { qtyMoved: 380, fromWarehouse: { _id: 'w1', code: 'WH-NORTH', name: 'A' }, toWarehouse: { _id: 'w2', code: 'WH-SOUTH', name: 'B' }, qtyAfter: { onHand: 120, inTransit: 380 } }),
      gene(3, 'write_off', { qtyDelta: -120, explanation: 'Expired milk', qtyAfter: { onHand: 0, inTransit: 0 } }),
      gene(4, 'death', { explanation: 'Lot died: expired after 6 days', actor: null }),
    ];
    renderWithProviders(<Lifeline genes={genes} lot={{ status: 'expired_disposed', death: { at: '2026-01-07', cause: 'expired', lifespanDays: 6, lifeUsedPct: 1, valueLost: 3000 } }} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveClass('gene-birth');
    expect(items[3]).toHaveClass('gene-death');
    expect(screen.getByText('#1 Born')).toBeInTheDocument();
    expect(screen.getByText('+500')).toBeInTheDocument();
    expect(screen.getByText('WH-NORTH → WH-SOUTH')).toBeInTheDocument();
    expect(screen.getByText('380 moved')).toBeInTheDocument();
    expect(screen.getByText('-120')).toHaveClass('neg');
    expect(screen.getByText('Lot died: expired after 6 days')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Purchase order/ })).toHaveAttribute('href', '/purchase-orders?highlight=po1');
    expect(screen.queryByText('Still alive')).not.toBeInTheDocument();
  });

  it('an alive lot ends with "Still alive"', () => {
    renderWithProviders(<Lifeline genes={[gene(1, 'born', { qtyDelta: 10 })]} lot={{ status: 'active', death: null }} />);
    expect(screen.getByText('Still alive')).toBeInTheDocument();
  });

  it('life bars expose their value as a meter and warn near the end of life', () => {
    renderWithProviders(<LifeBar label="Shelf life used" used={0.9} left="0.6 days left" />);
    const meter = screen.getByRole('meter', { name: 'Shelf life used' });
    expect(meter).toHaveAttribute('aria-valuenow', '90');
    expect(meter).toHaveClass('life-bar-warn');
    expect(screen.getByText('90%')).toBeInTheDocument();
  });

  it('shows recall and backfill tags with the status, and maps references to screens', () => {
    renderWithProviders(<LotStatusBadge lot={{ status: 'active', flags: { onHold: false, recalled: true, backfilled: true, qcRejected: false, expiryWarned: false } }} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Recalled')).toBeInTheDocument();
    expect(screen.getByText('Backfilled')).toBeInTheDocument();
    expect(refPath('recovery_plan', 'r1')).toBe('/recovery/r1');
    expect(refPath('customer_order', 'o1')).toBe('/orders?highlight=o1');
    expect(refPath('unknown', 'x')).toBeNull();
  });
});

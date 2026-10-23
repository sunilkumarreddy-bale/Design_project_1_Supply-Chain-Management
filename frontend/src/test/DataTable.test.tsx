import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import DataTable, { Column } from '../components/DataTable';

interface Row {
  id: string;
  name: string;
  qty: number;
}
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', sortValue: (r) => r.name },
  { key: 'qty', header: 'Qty', render: (r) => r.qty, sortValue: (r) => r.qty },
];

describe('DataTable', () => {
  it('shows the empty-state message', () => {
    render(<DataTable<Row> columns={columns} rows={[]} rowKey={(r) => r.id} empty="No products yet" />);
    expect(screen.getByText('No products yet')).toBeInTheDocument();
  });
  it('shows a loading skeleton instead of rows', () => {
    const { container } = render(<DataTable<Row> columns={columns} rows={undefined} loading rowKey={(r) => r.id} />);
    expect(container.querySelectorAll('.skeleton-row')).toHaveLength(4);
    expect(screen.queryByText('No records found')).not.toBeInTheDocument();
  });
  it('shows the error with a Retry button', async () => {
    const retry = vi.fn();
    render(<DataTable<Row> columns={columns} rows={undefined} error={{ data: { error: { message: 'Server unavailable' } } }} onRetry={retry} rowKey={(r) => r.id} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
  });
  it('sorts by a column ascending then descending', async () => {
    const rows = [
      { id: '1', name: 'B', qty: 2 },
      { id: '2', name: 'A', qty: 3 },
      { id: '3', name: 'C', qty: 1 },
    ];
    render(<DataTable<Row> columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(names()).toEqual(['B', 'A', 'C']);
    await userEvent.click(screen.getByRole('button', { name: /Qty/ }));
    expect(names()).toEqual(['C', 'B', 'A']);
    await userEvent.click(screen.getByRole('button', { name: /Qty/ }));
    expect(names()).toEqual(['A', 'B', 'C']);
  });
});

import { ReactNode, useMemo, useState } from 'react';
import { errorMessage } from '../api/client';
import Banner from './Banner';
import EmptyState from './EmptyState';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  /** Enables sorting on this column. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  caption?: string;
  dense?: boolean;
}

export default function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, empty, rowClassName, caption, dense }: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const sorted = useMemo(() => {
    if (!rows || !sort) return rows ?? [];
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const x = col.sortValue!(a);
      const y = col.sortValue!(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * sort.dir;
    });
  }, [rows, sort, columns]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  if (error && !loading) {
    return (
      <Banner tone="error" onRetry={onRetry}>
        {errorMessage(error)}
      </Banner>
    );
  }

  return (
    <div className="table-wrap">
      <table className={`table${dense ? ' table-dense' : ''}`}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  style={{ width: c.width, textAlign: c.align ?? 'left' }}
                  aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}
                  scope="col"
                >
                  {c.sortValue ? (
                    <button type="button" className="th-sort" onClick={() => toggle(c.key)}>
                      {c.header}
                      <span className="sort-ind" aria-hidden>
                        {active ? (sort!.dir === 1 ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 4 }, (_, i) => (
              <tr key={`sk-${i}`} className="skeleton-row" aria-hidden>
                {columns.map((c) => (
                  <td key={c.key}>
                    <span className="skeleton-line" />
                  </td>
                ))}
              </tr>
            ))}
          {!loading &&
            sorted.map((row) => (
              <tr key={rowKey(row)} className={rowClassName?.(row)}>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      {!loading && sorted.length === 0 && (typeof empty === 'string' || !empty ? <EmptyState title={(empty as string) ?? 'No records found'} /> : empty)}
    </div>
  );
}

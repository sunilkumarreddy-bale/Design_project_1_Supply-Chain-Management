import type { SelectHTMLAttributes } from 'react';
import { useProductsQuery, useWarehousesQuery } from '../api/inventory';
import { useSuppliersQuery } from '../api/procurement';

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string; activeOnly?: boolean; exclude?: string };

export function WarehouseSelect({ placeholder = 'Select warehouse', activeOnly = true, exclude, ...rest }: SelectProps) {
  const { data, isLoading } = useWarehousesQuery();
  const items = (data?.items ?? []).filter((w) => (!activeOnly || w.isActive) && w._id !== exclude);
  return (
    <select {...rest} disabled={rest.disabled || isLoading}>
      <option value="">{isLoading ? 'Loading...' : placeholder}</option>
      {items.map((w) => (
        <option key={w._id} value={w._id}>
          {w.code} · {w.name}
        </option>
      ))}
    </select>
  );
}

export function ProductSelect({ placeholder = 'Select product', ...rest }: SelectProps) {
  const { data, isLoading } = useProductsQuery({ limit: 1000 });
  return (
    <select {...rest} disabled={rest.disabled || isLoading}>
      <option value="">{isLoading ? 'Loading...' : placeholder}</option>
      {(data?.items ?? []).map((p) => (
        <option key={p._id} value={p._id}>
          {p.sku} · {p.name}
        </option>
      ))}
    </select>
  );
}

export function SupplierSelect({ placeholder = 'Select supplier', activeOnly, exclude, ...rest }: SelectProps) {
  const { data, isLoading } = useSuppliersQuery();
  const items = (data?.items ?? []).filter((s) => (!activeOnly || s.status === 'active') && s._id !== exclude);
  return (
    <select {...rest} disabled={rest.disabled || isLoading}>
      <option value="">{isLoading ? 'Loading...' : placeholder}</option>
      {items.map((s) => (
        <option key={s._id} value={s._id}>
          {s.name}
          {s.status !== 'active' ? ` (${s.status})` : ''}
        </option>
      ))}
    </select>
  );
}

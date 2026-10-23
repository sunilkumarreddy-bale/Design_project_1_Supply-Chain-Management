import { useEffect, useState } from 'react';
import { useGeocodeMutation, useUsersQuery } from '../api/admin';
import {
  useCreateWarehouseMutation,
  useEstimateRouteMutation,
  usePoliciesQuery,
  usePutPolicyMutation,
  usePutRouteMutation,
  useRoutesQuery,
  useUpdateWarehouseMutation,
  useWarehousesQuery,
} from '../api/inventory';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import FormField, { FormStatus } from '../components/FormField';
import { ProductSelect, WarehouseSelect } from '../components/Selects';
import WarehouseMap from '../components/WarehouseMap';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import { useForm } from '../hooks/useForm';
import type { StockPolicy, TransferRoute, Warehouse } from '../types';
import { number, rupees } from '../utils/format';
import { collect, nonNegative, optNum, required } from '../utils/validate';

interface ZoneDraft {
  code: string;
  name: string;
  bins: string;
}
const EMPTY = { code: '', name: '', address: '', city: '', manager: '', lat: '', lng: '' };

function WarehouseForm({ warehouse, onDone }: { warehouse: Warehouse | null; onDone: () => void }) {
  const { is } = useAuth();
  const isAdmin = is('admin');
  const [create] = useCreateWarehouseMutation();
  const [update] = useUpdateWarehouseMutation();
  const [geocode, geo] = useGeocodeMutation();
  const managers = useUsersQuery({ role: 'warehouse_manager', limit: 200 }, { skip: !isAdmin });
  const [zones, setZones] = useState<ZoneDraft[]>([]);
  const f = useForm(EMPTY, (v) =>
    collect({
      code: required(v.code, 'Code'),
      name: required(v.name, 'Name'),
      lat: v.lat && (Number(v.lat) < -90 || Number(v.lat) > 90 || Number.isNaN(Number(v.lat))) ? 'Latitude must be between -90 and 90' : undefined,
      lng: v.lng && (Number(v.lng) < -180 || Number(v.lng) > 180 || Number.isNaN(Number(v.lng))) ? 'Longitude must be between -180 and 180' : undefined,
    }),
  );
  const { reset } = f;
  useEffect(() => {
    if (warehouse) {
      reset({
        code: warehouse.code,
        name: warehouse.name,
        address: warehouse.address,
        city: warehouse.city,
        manager: warehouse.manager?._id ?? '',
        lat: warehouse.location ? String(warehouse.location.lat) : '',
        lng: warehouse.location ? String(warehouse.location.lng) : '',
      });
      setZones(warehouse.zones.map((z) => ({ code: z.code, name: z.name, bins: z.bins.join(', ') })));
    } else {
      reset(EMPTY);
      setZones([{ code: 'A', name: '', bins: 'A1, A2' }]);
    }
  }, [warehouse, reset]);

  const locate = async () => {
    f.setServerError('');
    try {
      const g = await geocode({ address: [f.values.address, f.values.city].filter(Boolean).join(', ') || f.values.name }).unwrap();
      f.set('lat', String(g.lat));
      f.set('lng', String(g.lng));
    } catch (e) {
      f.setServerError((e as { data?: { error?: { message?: string } } }).data?.error?.message ?? 'Could not locate the address');
    }
  };

  const onSubmit = f.submit(async (v) => {
    const zonesData = zones
      .filter((z) => z.code.trim())
      .map((z) => ({ code: z.code.trim().toUpperCase(), name: z.name.trim(), bins: z.bins.split(',').map((b) => b.trim().toUpperCase()).filter(Boolean) }));
    const data: Record<string, unknown> = {
      name: v.name.trim(),
      address: v.address.trim(),
      city: v.city.trim(),
      zones: zonesData,
    };
    if (v.lat !== '' && v.lng !== '') data.location = { lat: Number(v.lat), lng: Number(v.lng) };
    if (isAdmin) {
      data.code = v.code.trim();
      data.manager = v.manager || null;
    }
    if (warehouse) {
      await update({ id: warehouse._id, data }).unwrap();
      onDone();
      return `${warehouse.code} updated`;
    }
    const w = await create(data).unwrap();
    setZones([{ code: 'A', name: '', bins: 'A1, A2' }]);
    return `${w.code} created`;
  }, { keepValues: !!warehouse });

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <div className="card-head">
        <h2>{warehouse ? `Edit ${warehouse.code}` : 'Add warehouse'}</h2>
      </div>
      <div className="form-grid">
        <FormField label="Code" htmlFor="wf-code" error={f.errors.code} required>
          <input id="wf-code" {...f.bind('code')} disabled={!isAdmin} />
        </FormField>
        <FormField label="Name" htmlFor="wf-name" error={f.errors.name} required>
          <input id="wf-name" {...f.bind('name')} />
        </FormField>
        <FormField label="Address" htmlFor="wf-address">
          <input id="wf-address" {...f.bind('address')} />
        </FormField>
        <FormField label="City" htmlFor="wf-city">
          <input id="wf-city" {...f.bind('city')} />
        </FormField>
        <FormField label="Latitude" htmlFor="wf-lat" error={f.errors.lat}>
          <input id="wf-lat" inputMode="decimal" {...f.bind('lat')} />
        </FormField>
        <FormField label="Longitude" htmlFor="wf-lng" error={f.errors.lng}>
          <input id="wf-lng" inputMode="decimal" {...f.bind('lng')} />
        </FormField>
        {isAdmin && (
          <FormField label="Manager" htmlFor="wf-manager">
            <select id="wf-manager" {...f.bind('manager')} disabled={managers.isLoading}>
              <option value="">None</option>
              {managers.data?.items.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </FormField>
        )}
      </div>
      <div className="form-actions mb">
        <button type="button" className="btn btn-navy" onClick={locate} disabled={geo.isLoading}>
          {geo.isLoading ? 'Locating...' : 'Locate on map'}
        </button>
      </div>
      <h3>Zones and bins</h3>
      {zones.map((z, i) => (
        <div key={i} className="line-row">
          <FormField label="Zone code" htmlFor={`z-code-${i}`}>
            <input id={`z-code-${i}`} value={z.code} onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} />
          </FormField>
          <FormField label="Zone name" htmlFor={`z-name-${i}`}>
            <input id={`z-name-${i}`} value={z.name} onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          </FormField>
          <FormField label="Bins (comma separated)" htmlFor={`z-bins-${i}`}>
            <input id={`z-bins-${i}`} value={z.bins} onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, bins: e.target.value } : x)))} />
          </FormField>
          <button type="button" className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => setZones(zones.filter((_, j) => j !== i))}>
            Remove zone
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-sm mb" onClick={() => setZones([...zones, { code: '', name: '', bins: '' }])}>
        Add zone
      </button>
      <FormStatus error={f.serverError} success={f.success} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={f.saving}>
          {f.saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Close
        </button>
      </div>
    </form>
  );
}

function RoutesCard() {
  const routes = useRoutesQuery();
  const [putRoute] = usePutRouteMutation();
  const [estimate] = useEstimateRouteMutation();
  const f = useForm({ fromWarehouse: '', toWarehouse: '', leadTimeDays: '', costPerUnit: '' }, (v) =>
    collect({
      fromWarehouse: required(v.fromWarehouse, 'From'),
      toWarehouse: required(v.toWarehouse, 'To') ?? (v.toWarehouse === v.fromWarehouse ? 'Choose a different warehouse' : undefined),
      leadTimeDays: nonNegative(v.leadTimeDays, 'Lead time'),
      costPerUnit: nonNegative(v.costPerUnit, 'Cost per unit'),
    }),
  );
  const { busy, run } = useAction();
  const onSubmit = f.submit(async (v) => {
    await putRoute({ fromWarehouse: v.fromWarehouse, toWarehouse: v.toWarehouse, leadTimeDays: Number(v.leadTimeDays), costPerUnit: Number(v.costPerUnit) }).unwrap();
    return 'Route saved';
  });
  const est = () =>
    run('estimate', async () => {
      if (!f.values.fromWarehouse || !f.values.toWarehouse || f.values.fromWarehouse === f.values.toWarehouse) throw new Error('Choose two different warehouses first');
      const r = await estimate({ fromWarehouse: f.values.fromWarehouse, toWarehouse: f.values.toWarehouse }).unwrap();
      f.set('leadTimeDays', String(r.leadTimeDays));
      f.set('costPerUnit', String(r.costPerUnit));
      return r;
    }, (r) => `${number(r.distanceKm, 0)} km → ${r.leadTimeDays} day(s), ${rupees(r.costPerUnit)}/unit${r.saved ? ' (saved as estimated)' : r.note ? ` (${r.note})` : ''}`);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Transfer routes</h2>
      </div>
      <p className="muted small">Lead time and cost between warehouses, used by rebalancing, recovery and redistribution. Estimates use map distance at 400 km/day.</p>
      <form onSubmit={onSubmit} noValidate className="form-grid">
        <FormField label="From" htmlFor="r-from" error={f.errors.fromWarehouse}>
          <WarehouseSelect id="r-from" {...f.bind('fromWarehouse')} />
        </FormField>
        <FormField label="To" htmlFor="r-to" error={f.errors.toWarehouse}>
          <WarehouseSelect id="r-to" {...f.bind('toWarehouse')} />
        </FormField>
        <FormField label="Lead time (days)" htmlFor="r-lead" error={f.errors.leadTimeDays}>
          <input id="r-lead" type="number" step="0.1" {...f.bind('leadTimeDays')} />
        </FormField>
        <FormField label="Cost per unit (₹)" htmlFor="r-cost" error={f.errors.costPerUnit}>
          <input id="r-cost" type="number" step="0.01" {...f.bind('costPerUnit')} />
        </FormField>
        <div className="form-actions" style={{ alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary" disabled={f.saving}>
            {f.saving ? 'Saving...' : 'Save route'}
          </button>
          <button type="button" className="btn" onClick={est} disabled={busy === 'estimate'}>
            {busy === 'estimate' ? 'Estimating...' : 'Estimate from map'}
          </button>
        </div>
      </form>
      <FormStatus error={f.serverError} success={f.success} />
      <DataTable<TransferRoute>
        rows={routes.data?.items}
        loading={routes.isLoading}
        error={routes.error}
        onRetry={routes.refetch}
        rowKey={(r) => r._id}
        empty="No routes yet"
        dense
        columns={[
          { key: 'from', header: 'From', render: (r) => r.fromWarehouse.code, sortValue: (r) => r.fromWarehouse.code },
          { key: 'to', header: 'To', render: (r) => r.toWarehouse.code, sortValue: (r) => r.toWarehouse.code },
          { key: 'lead', header: 'Lead time', align: 'right', render: (r) => `${number(r.leadTimeDays, 1)} d` },
          { key: 'cost', header: 'Cost/unit', align: 'right', render: (r) => rupees(r.costPerUnit) },
          { key: 'km', header: 'Distance', align: 'right', render: (r) => (r.distanceKm ? `${number(r.distanceKm, 0)} km` : '—') },
          { key: 'est', header: 'Source', render: (r) => (r.estimated ? <Badge tone="info">Estimated</Badge> : <Badge tone="success">Entered</Badge>) },
          {
            key: 'edit',
            header: '',
            render: (r) => (
              <button type="button" className="btn btn-sm" onClick={() => f.setValues({ fromWarehouse: r.fromWarehouse._id, toWarehouse: r.toWarehouse._id, leadTimeDays: String(r.leadTimeDays), costPerUnit: String(r.costPerUnit) })}>
                Edit
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}

function PoliciesCard() {
  const { ownWarehouse } = useAuth();
  const policies = usePoliciesQuery({});
  const [put] = usePutPolicyMutation();
  const f = useForm({ product: '', warehouse: ownWarehouse ?? '', minStock: '', maxStock: '' }, (v) =>
    collect({
      product: required(v.product, 'Product'),
      warehouse: required(v.warehouse, 'Warehouse'),
      minStock: nonNegative(v.minStock, 'Min stock', true),
      maxStock: nonNegative(v.maxStock, 'Max stock', true) ?? (v.minStock && v.maxStock && Number(v.maxStock) < Number(v.minStock) ? 'Max must be at least min' : undefined),
    }),
  );
  const onSubmit = f.submit(async (v) => {
    await put({ product: v.product, warehouse: v.warehouse, minStock: optNum(v.minStock), maxStock: optNum(v.maxStock) }).unwrap();
    return 'Policy saved';
  });
  return (
    <div className="card">
      <div className="card-head">
        <h2>Stock policies (min / max)</h2>
      </div>
      <p className="muted small">Minimum stock overrides the computed safety stock for recovery; maximum caps redistribution into a warehouse. Leave blank to use the computed value.</p>
      <form onSubmit={onSubmit} noValidate className="form-grid">
        <FormField label="Product" htmlFor="pol-product" error={f.errors.product}>
          <ProductSelect id="pol-product" {...f.bind('product')} />
        </FormField>
        <FormField label="Warehouse" htmlFor="pol-wh" error={f.errors.warehouse}>
          <WarehouseSelect id="pol-wh" {...f.bind('warehouse')} disabled={!!ownWarehouse} />
        </FormField>
        <FormField label="Min stock" htmlFor="pol-min" error={f.errors.minStock}>
          <input id="pol-min" type="number" {...f.bind('minStock')} />
        </FormField>
        <FormField label="Max stock" htmlFor="pol-max" error={f.errors.maxStock}>
          <input id="pol-max" type="number" {...f.bind('maxStock')} />
        </FormField>
        <div className="form-actions" style={{ alignItems: 'end' }}>
          <button type="submit" className="btn btn-primary" disabled={f.saving}>
            {f.saving ? 'Saving...' : 'Save policy'}
          </button>
        </div>
      </form>
      <FormStatus error={f.serverError} success={f.success} />
      <DataTable<StockPolicy>
        rows={policies.data?.items}
        loading={policies.isLoading}
        error={policies.error}
        onRetry={policies.refetch}
        rowKey={(p) => p._id}
        empty="No policies; computed safety stock is used everywhere"
        dense
        columns={[
          { key: 'p', header: 'Product', render: (p) => p.product.sku },
          { key: 'w', header: 'Warehouse', render: (p) => p.warehouse.code },
          { key: 'min', header: 'Min', align: 'right', render: (p) => number(p.minStock, 0) },
          { key: 'max', header: 'Max', align: 'right', render: (p) => number(p.maxStock, 0) },
          {
            key: 'edit',
            header: '',
            render: (p) => (
              <button type="button" className="btn btn-sm" onClick={() => f.setValues({ product: p.product._id, warehouse: p.warehouse._id, minStock: p.minStock === null ? '' : String(p.minStock), maxStock: p.maxStock === null ? '' : String(p.maxStock) })}>
                Edit
              </button>
            ),
          },
        ]}
      />
    </div>
  );
}

export default function Warehouses() {
  const { is, user } = useAuth();
  const list = useWarehousesQuery();
  const [update] = useUpdateWarehouseMutation();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);
  const isAdmin = is('admin');
  const canEdit = (w: Warehouse) => isAdmin || (is('warehouse_manager') && user?.warehouse?._id === w._id);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Warehouses</h1>
          <p>Sites, zones and bins, map locations and transfer routes.</p>
        </div>
        {isAdmin && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
            {editing === 'new' ? 'Close form' : 'Add warehouse'}
          </button>
        )}
      </div>
      {editing && <WarehouseForm warehouse={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      <div className="grid grid-2 mt">
        <div className="card">
          <DataTable<Warehouse>
            rows={list.data?.items}
            loading={list.isLoading}
            error={list.error}
            onRetry={list.refetch}
            rowKey={(w) => w._id}
            empty="No warehouses yet"
            columns={[
              { key: 'code', header: 'Code', render: (w) => <strong>{w.code}</strong>, sortValue: (w) => w.code },
              { key: 'name', header: 'Name', sortValue: (w) => w.name },
              { key: 'city', header: 'City', sortValue: (w) => w.city },
              { key: 'zones', header: 'Zones', render: (w) => w.zones.map((z) => `${z.code} (${z.bins.length} bins)`).join(', ') || '—' },
              { key: 'manager', header: 'Manager', render: (w) => w.manager?.name ?? '—' },
              { key: 'active', header: 'Active', render: (w) => <Badge status={w.isActive ? 'active' : 'inactive'} /> },
              {
                key: 'actions',
                header: 'Actions',
                render: (w) => (
                  <div className="btn-group">
                    {canEdit(w) && (
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(w)}>
                        Edit
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy === w._id}
                        onClick={() => run(w._id, () => update({ id: w._id, data: { isActive: !w.isActive } }).unwrap(), `${w.code} ${w.isActive ? 'deactivated' : 'activated'}`)}
                      >
                        {busy === w._id ? 'Saving...' : w.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Map</h2>
          </div>
          <WarehouseMap warehouses={list.data?.items ?? []} />
        </div>
      </div>
      {is('admin', 'warehouse_manager') && (
        <div className="grid grid-2 mt">
          <RoutesCard />
          <PoliciesCard />
        </div>
      )}
    </>
  );
}

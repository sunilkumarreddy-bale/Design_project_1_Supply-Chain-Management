import { useState } from 'react';
import { useCreateUserMutation, useResetPasswordMutation, useUpdateUserMutation, useUsersQuery } from '../api/admin';
import Badge from '../components/Badge';
import DataTable from '../components/DataTable';
import FormField, { FormStatus } from '../components/FormField';
import Modal from '../components/Modal';
import Pager from '../components/Pager';
import { SupplierSelect, WarehouseSelect } from '../components/Selects';
import { useAction } from '../hooks/useAction';
import { useAuth } from '../hooks/useAuth';
import { useForm } from '../hooks/useForm';
import type { Role, User } from '../types';
import { dateTime } from '../utils/format';
import { ROLE_LABEL } from '../utils/roles';
import { collect, email, phoneE164, required } from '../utils/validate';

const ROLES: Role[] = ['admin', 'warehouse_manager', 'staff', 'supplier'];

function AddUserForm({ onDone }: { onDone: () => void }) {
  const [create] = useCreateUserMutation();
  const f = useForm({ name: '', email: '', password: '', role: 'staff' as Role, warehouse: '', supplier: '', phone: '' }, (v) =>
    collect({
      name: required(v.name, 'Name'),
      email: email(v.email),
      password: v.password.length < 8 ? 'Password must be at least 8 characters' : undefined,
      supplier: v.role === 'supplier' ? required(v.supplier, 'Supplier') : undefined,
      warehouse: v.role === 'warehouse_manager' || v.role === 'staff' ? required(v.warehouse, 'Warehouse') : undefined,
      phone: phoneE164(v.phone),
    }),
  );
  const onSubmit = f.submit(async (v) => {
    const u = await create({
      name: v.name.trim(),
      email: v.email.trim(),
      password: v.password,
      role: v.role,
      warehouse: v.role === 'warehouse_manager' || v.role === 'staff' ? v.warehouse : null,
      supplier: v.role === 'supplier' ? v.supplier : null,
      phone: v.phone.trim() || undefined,
    }).unwrap();
    return `${u.email} created`;
  });
  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2>Add user</h2>
      <div className="form-grid">
        <FormField label="Name" htmlFor="u-name" error={f.errors.name} required>
          <input id="u-name" {...f.bind('name')} />
        </FormField>
        <FormField label="Email" htmlFor="u-email" error={f.errors.email} required>
          <input id="u-email" type="email" {...f.bind('email')} />
        </FormField>
        <FormField label="Password" htmlFor="u-pw" error={f.errors.password} required>
          <input id="u-pw" type="password" autoComplete="new-password" {...f.bind('password')} />
        </FormField>
        <FormField label="Role" htmlFor="u-role">
          <select id="u-role" {...f.bind('role')}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </FormField>
        {f.values.role === 'supplier' && (
          <FormField label="Supplier" htmlFor="u-sup" error={f.errors.supplier} required>
            <SupplierSelect id="u-sup" {...f.bind('supplier')} />
          </FormField>
        )}
        {(f.values.role === 'warehouse_manager' || f.values.role === 'staff') && (
          <FormField label="Warehouse" htmlFor="u-wh" error={f.errors.warehouse} required>
            <WarehouseSelect id="u-wh" {...f.bind('warehouse')} />
          </FormField>
        )}
        <FormField label="Phone" htmlFor="u-phone" error={f.errors.phone}>
          <input id="u-phone" type="tel" {...f.bind('phone')} />
        </FormField>
      </div>
      <FormStatus error={f.serverError} success={f.success} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={f.saving}>
          {f.saving ? 'Saving...' : 'Add user'}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Close
        </button>
      </div>
    </form>
  );
}

function RoleModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [update] = useUpdateUserMutation();
  const f = useForm({ role: user.role, warehouse: user.warehouse?._id ?? '', supplier: user.supplier?._id ?? '' }, (v) =>
    collect({
      supplier: v.role === 'supplier' ? required(v.supplier, 'Supplier') : undefined,
      warehouse: v.role === 'warehouse_manager' || v.role === 'staff' ? required(v.warehouse, 'Warehouse') : undefined,
    }),
  );
  const onSubmit = f.submit(async (v) => {
    await update({
      id: user._id,
      data: { role: v.role, warehouse: v.role === 'warehouse_manager' || v.role === 'staff' ? v.warehouse : null, supplier: v.role === 'supplier' ? v.supplier : null },
    }).unwrap();
    setTimeout(onClose, 500);
    return 'Role updated';
  }, { keepValues: true });
  return (
    <Modal open title={`Change role: ${user.name}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <FormField label="Role" htmlFor="cr-role">
          <select id="cr-role" {...f.bind('role')}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </FormField>
        {f.values.role === 'supplier' && (
          <FormField label="Supplier" htmlFor="cr-sup" error={f.errors.supplier} required>
            <SupplierSelect id="cr-sup" {...f.bind('supplier')} />
          </FormField>
        )}
        {(f.values.role === 'warehouse_manager' || f.values.role === 'staff') && (
          <FormField label="Warehouse" htmlFor="cr-wh" error={f.errors.warehouse} required>
            <WarehouseSelect id="cr-wh" {...f.bind('warehouse')} />
          </FormField>
        )}
        <FormStatus error={f.serverError} success={f.success} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={f.saving}>
            {f.saving ? 'Saving...' : 'Save role'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [reset] = useResetPasswordMutation();
  const f = useForm({ newPassword: '' }, (v) => collect({ newPassword: v.newPassword.length < 8 ? 'Password must be at least 8 characters' : undefined }));
  const onSubmit = f.submit(async (v) => {
    await reset({ id: user._id, newPassword: v.newPassword }).unwrap();
    return `Password reset for ${user.email}`;
  });
  return (
    <Modal open title={`Reset password: ${user.name}`} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate>
        <FormField label="New password" htmlFor="rp-pw" error={f.errors.newPassword} required>
          <input id="rp-pw" type="password" autoComplete="new-password" {...f.bind('newPassword')} />
        </FormField>
        <FormStatus error={f.serverError} success={f.success} />
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={f.saving}>
            {f.saving ? 'Saving...' : 'Reset password'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [roleFor, setRoleFor] = useState<User | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const list = useUsersQuery({ role: role || undefined, page, limit: 50 });
  const [update] = useUpdateUserMutation();
  const { busy, run } = useAction();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Accounts, roles and warehouse or supplier scope.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(!adding)}>
          {adding ? 'Close form' : 'Add user'}
        </button>
      </div>
      {adding && <AddUserForm onDone={() => setAdding(false)} />}
      <div className="card">
        <div className="filters">
          <div className="field">
            <label htmlFor="us-role">Role</label>
            <select id="us-role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DataTable<User>
          rows={list.data?.items}
          loading={list.isLoading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(u) => u._id}
          empty="No users"
          columns={[
            { key: 'n', header: 'Name', render: (u) => <strong>{u.name}</strong>, sortValue: (u) => u.name },
            { key: 'e', header: 'Email', render: (u) => u.email, sortValue: (u) => u.email },
            { key: 'r', header: 'Role', render: (u) => <span className={`badge badge-role role-${u.role}`}>{ROLE_LABEL[u.role]}</span>, sortValue: (u) => u.role },
            { key: 's', header: 'Scope', render: (u) => (u.warehouse ? `${u.warehouse.code} · ${u.warehouse.name}` : u.supplier ? u.supplier.name : u.role === 'admin' ? 'All' : '—') },
            { key: 'a', header: 'Active', render: (u) => <Badge status={u.isActive ? 'active' : 'inactive'} /> },
            { key: 'l', header: 'Last login', render: (u) => dateTime(u.lastLoginAt), sortValue: (u) => u.lastLoginAt ?? '' },
            {
              key: 'x',
              header: 'Actions',
              render: (u) => (
                <div className="btn-group">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={u._id === me?._id || busy === u._id}
                    onClick={() => run(u._id, () => update({ id: u._id, data: { isActive: !u.isActive } }).unwrap(), `${u.email} ${u.isActive ? 'deactivated' : 'activated'}`)}
                  >
                    {busy === u._id ? 'Saving...' : u.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setResetFor(u)}>
                    Reset password
                  </button>
                  <button type="button" className="btn btn-sm" disabled={u._id === me?._id} onClick={() => setRoleFor(u)}>
                    Change role
                  </button>
                </div>
              ),
            },
          ]}
        />
        {list.data && <Pager page={page} limit={list.data.limit} total={list.data.total} onPage={setPage} />}
      </div>
      {roleFor && <RoleModal user={roleFor} onClose={() => setRoleFor(null)} />}
      {resetFor && <ResetModal user={resetFor} onClose={() => setResetFor(null)} />}
    </>
  );
}

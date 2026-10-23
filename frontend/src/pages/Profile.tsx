import { useEffect } from 'react';
import { useChangePasswordMutation, useMeQuery, useUpdateMeMutation } from '../api/auth';
import FormField, { FormStatus } from '../components/FormField';
import QueryState from '../components/QueryState';
import { useForm } from '../hooks/useForm';
import { ROLE_LABEL } from '../utils/roles';
import { collect, phoneE164, required } from '../utils/validate';
import { dateTime } from '../utils/format';

export default function Profile() {
  const me = useMeQuery();
  const [update] = useUpdateMeMutation();
  const [changePassword] = useChangePasswordMutation();
  const profile = useForm({ name: '', phone: '', inApp: true, email: true, sms: false }, (v) =>
    collect({
      name: required(v.name, 'Name'),
      phone: phoneE164(v.phone) ?? (v.sms && !v.phone ? 'A phone number is needed for SMS' : undefined),
    }),
  );
  const pw = useForm({ currentPassword: '', newPassword: '', confirm: '' }, (v) =>
    collect({
      currentPassword: required(v.currentPassword, 'Current password'),
      newPassword: v.newPassword.length < 8 ? 'New password must be at least 8 characters' : undefined,
      confirm: v.confirm !== v.newPassword ? 'Passwords do not match' : undefined,
    }),
  );
  const { reset } = profile;
  useEffect(() => {
    if (me.data) reset({ name: me.data.name, phone: me.data.phone ?? '', ...me.data.notify });
  }, [me.data, reset]);

  const saveProfile = profile.submit(async (v) => {
    const u = await update({ name: v.name.trim(), phone: v.phone.trim(), notify: { inApp: v.inApp, email: v.email, sms: v.sms } }).unwrap();
    reset({ name: u.name, phone: u.phone ?? '', ...u.notify });
    return 'Profile saved';
  }, { keepValues: true });
  const savePassword = pw.submit(async (v) => {
    await changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }).unwrap();
    return 'Password updated';
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Profile</h1>
          <p>Your details and how you want to be notified.</p>
        </div>
      </div>
      <QueryState loading={me.isLoading} error={me.error} onRetry={me.refetch}>
        <div className="grid grid-2">
          <form className="card" onSubmit={saveProfile} noValidate>
            <h2>Details</h2>
            {me.data && (
              <dl className="kv mb">
                <dt>Email</dt>
                <dd>{me.data.email}</dd>
                <dt>Role</dt>
                <dd>{ROLE_LABEL[me.data.role]}</dd>
                <dt>Scope</dt>
                <dd>{me.data.warehouse ? `${me.data.warehouse.code} · ${me.data.warehouse.name}` : me.data.supplier ? me.data.supplier.name : 'All warehouses'}</dd>
                <dt>Last login</dt>
                <dd>{dateTime(me.data.lastLoginAt)}</dd>
              </dl>
            )}
            <FormField label="Name" htmlFor="p-name" error={profile.errors.name} required>
              <input id="p-name" {...profile.bind('name')} />
            </FormField>
            <FormField label="Phone (for SMS)" htmlFor="p-phone" error={profile.errors.phone} hint="E.164 format, e.g. +919876543210">
              <input id="p-phone" type="tel" {...profile.bind('phone')} />
            </FormField>
            <fieldset className="field" style={{ border: 0, padding: 0 }}>
              <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Notification preferences</legend>
              <label className="check">
                <input type="checkbox" checked={profile.values.inApp} onChange={(e) => profile.set('inApp', e.target.checked)} /> In-app
              </label>
              <label className="check">
                <input type="checkbox" checked={profile.values.email} onChange={(e) => profile.set('email', e.target.checked)} /> Email
              </label>
              <label className="check">
                <input type="checkbox" checked={profile.values.sms} onChange={(e) => profile.set('sms', e.target.checked)} /> SMS
              </label>
            </fieldset>
            <FormStatus error={profile.serverError} success={profile.success} />
            <button type="submit" className="btn btn-primary" disabled={profile.saving}>
              {profile.saving ? 'Saving...' : 'Save'}
            </button>
          </form>
          <form className="card" onSubmit={savePassword} noValidate>
            <h2>Change password</h2>
            <FormField label="Current password" htmlFor="pw-current" error={pw.errors.currentPassword} required>
              <input id="pw-current" type="password" autoComplete="current-password" {...pw.bind('currentPassword')} />
            </FormField>
            <FormField label="New password" htmlFor="pw-new" error={pw.errors.newPassword} required>
              <input id="pw-new" type="password" autoComplete="new-password" {...pw.bind('newPassword')} />
            </FormField>
            <FormField label="Confirm new password" htmlFor="pw-confirm" error={pw.errors.confirm} required>
              <input id="pw-confirm" type="password" autoComplete="new-password" {...pw.bind('confirm')} />
            </FormField>
            <FormStatus error={pw.serverError} success={pw.success} />
            <button type="submit" className="btn btn-primary" disabled={pw.saving}>
              {pw.saving ? 'Saving...' : 'Update password'}
            </button>
          </form>
        </div>
      </QueryState>
    </>
  );
}

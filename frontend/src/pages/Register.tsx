import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useRegisterMutation } from '../api/auth';
import { useAppDispatch, useAppSelector } from '../app/store';
import FormField, { FormStatus } from '../components/FormField';
import { setCredentials } from '../features/auth/authSlice';
import { useForm } from '../hooks/useForm';
import { collect, email, required } from '../utils/validate';

export default function Register() {
  const [register] = useRegisterMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const token = useAppSelector((s) => s.auth.token);
  const f = useForm({ name: '', email: '', password: '', confirm: '' }, (v) =>
    collect({
      name: required(v.name, 'Name'),
      email: email(v.email),
      password: v.password.length < 8 ? 'Password must be at least 8 characters' : undefined,
      confirm: v.confirm !== v.password ? 'Passwords do not match' : undefined,
    }),
  );
  if (token) return <Navigate to="/" replace />;
  const onSubmit = f.submit(async (v) => {
    const r = await register({ name: v.name.trim(), email: v.email.trim(), password: v.password }).unwrap();
    dispatch(setCredentials(r));
    navigate('/', { replace: true });
  }, { keepValues: true });
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1>Create account</h1>
        <p className="muted small">New accounts start as staff. An admin assigns your warehouse.</p>
        <form onSubmit={onSubmit} noValidate>
          <FormField label="Name" htmlFor="reg-name" error={f.errors.name} required>
            <input id="reg-name" autoComplete="name" {...f.bind('name')} />
          </FormField>
          <FormField label="Email" htmlFor="reg-email" error={f.errors.email} required>
            <input id="reg-email" type="email" autoComplete="email" {...f.bind('email')} />
          </FormField>
          <FormField label="Password" htmlFor="reg-password" error={f.errors.password} hint="At least 8 characters" required>
            <input id="reg-password" type="password" autoComplete="new-password" {...f.bind('password')} />
          </FormField>
          <FormField label="Confirm password" htmlFor="reg-confirm" error={f.errors.confirm} required>
            <input id="reg-confirm" type="password" autoComplete="new-password" {...f.bind('confirm')} />
          </FormField>
          <FormStatus error={f.serverError} />
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={f.saving}>
            {f.saving ? 'Saving...' : 'Create account'}
          </button>
        </form>
        <p className="muted small">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

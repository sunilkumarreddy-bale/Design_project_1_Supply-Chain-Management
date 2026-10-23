import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useLoginMutation } from '../api/auth';
import { useAppDispatch, useAppSelector } from '../app/store';
import FormField, { FormStatus } from '../components/FormField';
import { setCredentials } from '../features/auth/authSlice';
import { useForm } from '../hooks/useForm';
import { collect, email, required } from '../utils/validate';

const DEMO = ['admin@example.com', 'manager@example.com', 'staff@example.com', 'supplier@example.com', 'supplier2@example.com'];

export default function Login() {
  const [login] = useLoginMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAppSelector((s) => s.auth.token);
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const f = useForm({ email: '', password: '' }, (v) => collect({ email: email(v.email), password: required(v.password, 'Password') }));

  if (token) return <Navigate to={from} replace />;

  const onSubmit = f.submit(async (v) => {
    const r = await login({ email: v.email.trim(), password: v.password }).unwrap();
    dispatch(setCredentials(r));
    navigate(from, { replace: true });
  }, { keepValues: true });

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden style={{ color: '#fff' }}>
            ◈
          </span>
          <span>
            Smart Inventory
            <small style={{ color: 'var(--muted)' }}>Supply chain control</small>
          </span>
        </div>
        <h1>Sign in</h1>
        <form onSubmit={onSubmit} noValidate>
          <FormField label="Email" htmlFor="login-email" error={f.errors.email} required>
            <input id="login-email" type="email" autoComplete="username" {...f.bind('email')} aria-invalid={!!f.errors.email} />
          </FormField>
          <FormField label="Password" htmlFor="login-password" error={f.errors.password} required>
            <input id="login-password" type="password" autoComplete="current-password" {...f.bind('password')} aria-invalid={!!f.errors.password} />
          </FormField>
          <FormStatus error={f.serverError} />
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={f.saving}>
            {f.saving ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <p className="muted small">
          New here? <Link to="/register">Create an account</Link>
        </p>
        <div className="demo-box">
          <strong>Demo accounts</strong> (password <code>Password123!</code>):
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {DEMO.map((e) => (
              <li key={e}>
                <button type="button" onClick={() => f.setValues({ email: e, password: 'Password123!' })}>
                  {e}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

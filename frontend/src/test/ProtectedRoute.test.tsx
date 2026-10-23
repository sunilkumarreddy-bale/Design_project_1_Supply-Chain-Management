import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../components/ProtectedRoute';
import { renderWithProviders, userFixture } from './utils';

const tree = (
  <Routes>
    <Route path="/login" element={<div>Login screen</div>} />
    <Route path="/forbidden" element={<div>Forbidden screen</div>} />
    <Route
      path="/users"
      element={
        <ProtectedRoute roles={['admin']}>
          <div>Users screen</div>
        </ProtectedRoute>
      }
    />
  </Routes>
);

const auth = (role: 'admin' | 'staff' | null) => ({
  auth: { token: role ? 't' : null, user: role ? (userFixture(role) as never) : null, selectedWarehouse: '' },
});

describe('ProtectedRoute', () => {
  it('redirects to /login without a token', () => {
    renderWithProviders(tree, { route: '/users', preloadedState: auth(null) });
    expect(screen.getByText('Login screen')).toBeInTheDocument();
  });
  it('shows /forbidden when the role is not allowed', () => {
    renderWithProviders(tree, { route: '/users', preloadedState: auth('staff') });
    expect(screen.getByText('Forbidden screen')).toBeInTheDocument();
  });
  it('renders the page for an allowed role', () => {
    renderWithProviders(tree, { route: '/users', preloadedState: auth('admin') });
    expect(screen.getByText('Users screen')).toBeInTheDocument();
  });
  it('waits for the profile when only a token is known', () => {
    renderWithProviders(tree, { route: '/users', preloadedState: { auth: { token: 't', user: null, selectedWarehouse: '' } } });
    expect(screen.getByText(/Loading your workspace/)).toBeInTheDocument();
  });
});

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { client } from '../api/client';
import Login from '../pages/Login';
import { renderWithProviders, userFixture } from './utils';

describe('Login page', () => {
  it('shows the demo accounts and validates required fields', async () => {
    renderWithProviders(<Login />, { route: '/login' });
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  it('signs in, stores the token and redirects', async () => {
    const spy = vi.spyOn(client, 'request').mockResolvedValueOnce({ data: { token: 'tok-123', user: userFixture('admin') } } as never);
    const { store } = renderWithProviders(
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<div>Home page</div>} />
      </Routes>,
      { route: '/login' },
    );
    await userEvent.click(screen.getByRole('button', { name: 'manager@example.com' }));
    expect(screen.getByLabelText(/Email/)).toHaveValue('manager@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ url: '/auth/login', method: 'POST', data: { email: 'manager@example.com', password: 'Password123!' } }));
    expect(store.getState().auth.token).toBe('tok-123');
    expect(localStorage.getItem('sis.token')).toBe('tok-123');
    spy.mockRestore();
  });

  it('shows the server error for bad credentials', async () => {
    const spy = vi.spyOn(client, 'request').mockRejectedValueOnce({ response: { status: 401, data: { error: { message: 'Invalid email or password' } } } });
    renderWithProviders(<Login />, { route: '/login' });
    await userEvent.type(screen.getByLabelText(/Email/), 'a@b.com');
    await userEvent.type(screen.getByLabelText(/Password/), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password'));
    spy.mockRestore();
  });
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { client } from '../api/client';
import Register from '../pages/Register';
import { renderWithProviders } from './utils';

describe('Register form validation', () => {
  it('validates every field before calling the API', async () => {
    const spy = vi.spyOn(client, 'request');
    renderWithProviders(<Register />, { route: '/register' });
    await userEvent.type(screen.getByLabelText(/^Email/), 'not-an-email');
    await userEvent.type(screen.getByLabelText(/^Password/), 'short');
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('disables the button and shows Saving... while submitting', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    const spy = vi.spyOn(client, 'request').mockReturnValueOnce(new Promise((r) => (resolve = r)) as never);
    renderWithProviders(<Register />, { route: '/register' });
    await userEvent.type(screen.getByLabelText(/^Name/), 'Priya');
    await userEvent.type(screen.getByLabelText(/^Email/), 'priya@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'longenough1');
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'longenough1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled();
    resolve({ data: { token: 't', user: { _id: 'u', name: 'Priya', email: 'priya@example.com', role: 'staff', warehouse: null, supplier: null, notify: { inApp: true, email: true, sms: false }, isActive: true, lastLoginAt: null } } });
    spy.mockRestore();
  });
});

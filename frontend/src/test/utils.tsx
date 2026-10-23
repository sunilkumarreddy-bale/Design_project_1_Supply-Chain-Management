import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { makeStore, RootState } from '../app/store';

export function renderWithProviders(ui: ReactElement, { route = '/', preloadedState }: { route?: string; preloadedState?: Partial<RootState> } = {}) {
  const store = makeStore(preloadedState);
  const result = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>
    </Provider>,
  );
  return { store, ...result };
}

export const userFixture = (role: 'admin' | 'warehouse_manager' | 'staff' | 'supplier') => ({
  _id: 'u1',
  name: 'Test User',
  email: 'test@example.com',
  role,
  warehouse: role === 'admin' || role === 'supplier' ? null : { _id: 'w1', code: 'WH-NORTH', name: 'Warehouse A' },
  supplier: role === 'supplier' ? { _id: 's1', name: 'Acme' } : null,
  notify: { inApp: true, email: true, sms: false },
  isActive: true,
  lastLoginAt: null,
});

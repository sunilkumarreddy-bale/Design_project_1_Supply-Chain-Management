import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { TOKEN_KEY } from '../../api/client';
import type { User } from '../../types';

const WAREHOUSE_KEY = 'sis.warehouse';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode); the session still works in memory */
  }
}

export interface AuthState {
  token: string | null;
  user: User | null;
  /** Warehouse filter chosen in the top bar ('' = all warehouses). Managers and staff are pinned to theirs. */
  selectedWarehouse: string;
}

const initialState: AuthState = { token: read(TOKEN_KEY), user: null, selectedWarehouse: read(WAREHOUSE_KEY) ?? '' };

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, action: PayloadAction<{ token: string; user: User }>) {
      state.token = action.payload.token;
      state.user = action.payload.user;
      write(TOKEN_KEY, action.payload.token);
      if (action.payload.user.warehouse && action.payload.user.role !== 'admin') {
        state.selectedWarehouse = action.payload.user.warehouse._id;
      }
    },
    setUser(state, action: PayloadAction<User>) {
      state.user = action.payload;
      if (action.payload.warehouse && action.payload.role !== 'admin') state.selectedWarehouse = action.payload.warehouse._id;
    },
    setSelectedWarehouse(state, action: PayloadAction<string>) {
      state.selectedWarehouse = action.payload;
      write(WAREHOUSE_KEY, action.payload || null);
    },
    logout(state) {
      state.token = null;
      state.user = null;
      state.selectedWarehouse = '';
      write(TOKEN_KEY, null);
      write(WAREHOUSE_KEY, null);
    },
  },
});

export const { setCredentials, setUser, setSelectedWarehouse, logout } = authSlice.actions;
export default authSlice.reducer;

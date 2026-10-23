import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import { api } from '../api/base';
import { setAuthToken, setUnauthorizedHandler } from '../api/client';
import auth, { logout } from '../features/auth/authSlice';
import realtime from '../features/realtime/realtimeSlice';
import notifications, { addToast } from '../features/notifications/notificationsSlice';

export const rootReducer = combineReducers({ auth, realtime, notifications, [api.reducerPath]: api.reducer });
export type RootState = ReturnType<typeof rootReducer>;

export function makeStore(preloaded?: Partial<RootState>) {
  const store = configureStore({
    reducer: rootReducer,
    preloadedState: preloaded as RootState | undefined,
    middleware: (gDM) => gDM().concat(api.middleware),
  });
  // keep the axios client's token in step with the store
  let current = store.getState().auth.token;
  setAuthToken(current);
  store.subscribe(() => {
    const next = store.getState().auth.token;
    if (next !== current) {
      current = next;
      setAuthToken(next);
    }
  });
  setUnauthorizedHandler(() => {
    if (!store.getState().auth.token) return;
    store.dispatch(logout());
    store.dispatch(api.util.resetApiState());
    store.dispatch(addToast('Your session has ended, please sign in again', 'warning'));
  });
  setupListeners(store.dispatch);
  return store;
}

export const store = makeStore();
export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

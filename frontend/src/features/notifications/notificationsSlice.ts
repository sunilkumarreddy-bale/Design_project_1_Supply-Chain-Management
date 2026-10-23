import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface NotificationsState {
  toasts: Toast[];
  /** Notifications received live since the last fetch, used to bump the bell immediately. */
  liveUnread: number;
}

let nextId = 1;
const initialState: NotificationsState = { toasts: [], liveUnread: 0 };

const slice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    addToast: {
      reducer(state, action: PayloadAction<Toast>) {
        state.toasts = [...state.toasts, action.payload].slice(-5);
      },
      prepare(message: string, tone: ToastTone = 'info') {
        return { payload: { id: nextId++, tone, message } };
      },
    },
    dismissToast(state, action: PayloadAction<number>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
    bumpUnread(state) {
      state.liveUnread += 1;
    },
    resetLiveUnread(state) {
      state.liveUnread = 0;
    },
  },
});

export const { addToast, dismissToast, bumpUnread, resetLiveUnread } = slice.actions;
export default slice.reducer;

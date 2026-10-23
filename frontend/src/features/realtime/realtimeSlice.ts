import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type SocketStatus = 'connected' | 'connecting' | 'disconnected';

export interface RealtimeEvent {
  event: string;
  at: string;
  summary: string;
}

interface RealtimeState {
  status: SocketStatus;
  lastEvents: RealtimeEvent[];
  lastEventAt: string | null;
}

const initialState: RealtimeState = { status: 'disconnected', lastEvents: [], lastEventAt: null };

const realtimeSlice = createSlice({
  name: 'realtime',
  initialState,
  reducers: {
    setStatus(state, action: PayloadAction<SocketStatus>) {
      state.status = action.payload;
    },
    pushEvent(state, action: PayloadAction<RealtimeEvent>) {
      state.lastEvents = [action.payload, ...state.lastEvents].slice(0, 20);
      state.lastEventAt = action.payload.at;
    },
  },
});

export const { setStatus, pushEvent } = realtimeSlice.actions;
export default realtimeSlice.reducer;

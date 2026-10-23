import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, Tag } from '../../api/base';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { addToast, bumpUnread } from '../notifications/notificationsSlice';
import { pushEvent, setStatus } from './realtimeSlice';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || undefined;

/** Server events and the cached data each one makes stale. */
export const EVENT_TAGS: Record<string, Tag[]> = {
  'stock:update': ['Stock', 'Dashboard', 'Insights', 'Product'],
  'alert:new': ['Alert', 'Dashboard'],
  'alert:update': ['Alert'],
  'alert:resolved': ['Alert', 'Dashboard'],
  'po:created': ['PO', 'Dashboard', 'Insights'],
  'po:approved': ['PO', 'Dashboard'],
  'po:rejected': ['PO', 'Dashboard'],
  'po:confirmed': ['PO'],
  'po:dispatched': ['PO'],
  'po:received': ['PO', 'Stock', 'Dashboard', 'Insights', 'Supplier'],
  'po:cancelled': ['PO', 'Dashboard'],
  'po:paid': ['PO'],
  'transfer:update': ['Transfer', 'Stock', 'Dashboard'],
  'recovery:update': ['Recovery', 'Dashboard'],
  'redistribution:update': ['Redistribution', 'Dashboard'],
  'simulation:done': ['Run'],
  'supplier:update': ['Supplier'],
  'count:update': ['Count'],
  'notification:new': ['Notification'],
};

function summarize(event: string, payload: any): string {
  if (event === 'alert:new') return payload?.message ?? 'New alert';
  if (event.startsWith('po:')) return `${payload?.poNumber ?? 'Purchase order'} ${event.slice(3)}`;
  if (event === 'stock:update') return `Stock ${payload?.action ?? 'changed'}`;
  if (event === 'notification:new') return payload?.subject ?? 'Notification';
  return event.replace(':', ' ');
}

/** Connects Socket.io with the JWT, keeps the live status, refreshes cached queries and shows toasts. */
export default function SocketManager() {
  const token = useAppSelector((s) => s.auth.token);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!token) {
      dispatch(setStatus('disconnected'));
      return;
    }
    dispatch(setStatus('connecting'));
    const socket: Socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 10000 });
    socket.on('connect', () => dispatch(setStatus('connected')));
    socket.on('disconnect', () => dispatch(setStatus('disconnected')));
    socket.on('connect_error', () => dispatch(setStatus('disconnected')));
    for (const [event, tags] of Object.entries(EVENT_TAGS)) {
      socket.on(event, (payload: unknown) => {
        dispatch(api.util.invalidateTags(tags));
        dispatch(pushEvent({ event, at: new Date().toISOString(), summary: summarize(event, payload) }));
        if (event === 'alert:new') {
          const p = payload as { severity?: string; message?: string };
          dispatch(addToast(p.message ?? 'New alert', p.severity === 'critical' ? 'error' : 'warning'));
        }
        if (event === 'notification:new') dispatch(bumpUnread());
      });
    }
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [token, dispatch]);

  return null;
}

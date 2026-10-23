import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../app/store';
import { dismissToast, Toast as ToastT } from '../features/notifications/notificationsSlice';

function ToastItem({ t }: { t: ToastT }) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const timer = setTimeout(() => dispatch(dismissToast(t.id)), t.tone === 'error' ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [t, dispatch]);
  return (
    <div className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
      <span>{t.message}</span>
      <button type="button" className="btn btn-icon" aria-label="Dismiss notification" onClick={() => dispatch(dismissToast(t.id))}>
        ✕
      </button>
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useAppSelector((s) => s.notifications.toasts);
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}

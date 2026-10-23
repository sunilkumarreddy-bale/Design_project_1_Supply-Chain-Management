import { useState } from 'react';
import { errorMessage } from '../api/client';
import { useAppDispatch } from '../app/store';
import { addToast } from '../features/notifications/notificationsSlice';

/** Wraps a one-click action: tracks which item is busy and reports success or failure as a toast. */
export function useAction() {
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <R>(key: string, fn: () => Promise<R>, successMessage?: string | ((r: R) => string)) => {
    setBusy(key);
    try {
      const r = await fn();
      if (successMessage) dispatch(addToast(typeof successMessage === 'function' ? successMessage(r) : successMessage, 'success'));
      return r;
    } catch (e) {
      dispatch(addToast(errorMessage(e), 'error'));
      return undefined;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

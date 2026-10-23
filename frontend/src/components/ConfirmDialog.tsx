import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import Banner from './Banner';
import Modal from './Modal';

/** Confirmation dialog; with requireReason it asks for a reason (reject, decline...). */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  requireReason,
  reasonLabel = 'Reason',
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setReason('');
      setError('');
    }
  }, [open]);
  const confirm = async () => {
    if (requireReason && !reason.trim()) {
      setError(`${reasonLabel} is required`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={confirm} disabled={busy}>
            {busy ? 'Saving...' : confirmLabel}
          </button>
        </>
      }
    >
      {message && <div className="confirm-message">{message}</div>}
      {requireReason && (
        <div className="field">
          <label htmlFor="confirm-reason">{reasonLabel}</label>
          <textarea id="confirm-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      {error && <Banner tone="error">{error}</Banner>}
    </Modal>
  );
}

import { useEffect, useId, useRef, useState } from 'react';

type ScannerLike = { stop: () => Promise<void>; clear: () => void; isScanning?: boolean };

/** Live camera QR scanner (html5-qrcode), loaded on demand. Falls back to a message when the camera is denied. */
export default function QrScanner({ onScan }: { onScan: (text: string) => void }) {
  const id = `qr-${useId().replace(/:/g, '')}`;
  const scanner = useRef<ScannerLike | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const last = useRef<{ text: string; at: number } | null>(null);

  const stop = async () => {
    const s = scanner.current;
    scanner.current = null;
    setRunning(false);
    if (s) {
      try {
        await s.stop();
        s.clear();
      } catch {
        /* already stopped */
      }
    }
  };

  const start = async () => {
    setError('');
    setStarting(true);
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const s = new Html5Qrcode(id);
      scanner.current = s as unknown as ScannerLike;
      await s.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (text) => {
          const now = Date.now();
          if (last.current && last.current.text === text && now - last.current.at < 2500) return;
          last.current = { text, at: now };
          onScan(text);
        },
        () => undefined,
      );
      setRunning(true);
    } catch (e) {
      scanner.current = null;
      const msg = (e as Error)?.message ?? String(e);
      setError(
        /permission|denied|NotAllowed/i.test(msg)
          ? 'Camera access was denied. Allow the camera in your browser settings, or type the SKU below.'
          : /NotFound|no camera|Requested device not found/i.test(msg)
            ? 'No camera was found on this device. Type the SKU below instead.'
            : `The camera could not start (${msg}). Type the SKU below instead.`,
      );
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => () => void stop(), []);

  return (
    <div className="scanner">
      <div id={id} className={`scanner-view${running ? ' on' : ''}`} aria-label="Camera preview">
        {!running && <span className="muted">Camera is off</span>}
      </div>
      <div className="row gap">
        {!running ? (
          <button type="button" className="btn btn-primary" onClick={start} disabled={starting}>
            {starting ? 'Starting camera...' : 'Start camera'}
          </button>
        ) : (
          <button type="button" className="btn" onClick={stop}>
            Stop camera
          </button>
        )}
      </div>
      {error && (
        <div className="banner banner-warning" role="alert">
          <div className="banner-body">{error}</div>
        </div>
      )}
    </div>
  );
}

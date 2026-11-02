import { useEffect, useId, useRef, useState } from 'react';

type ScannerLike = { stop: () => Promise<void>; clear: () => void; isScanning?: boolean };

/**
 * Second decoder on the same camera frames. html5-qrcode's bundled zxing misses some valid codes (in testing,
 * 1 to 4 of 17 real Stock DNA labels depending on error-correction level), so every frame html5-qrcode has not
 * decoded is also given to jsQR. Frames are scaled down to at most 640 px on the longer side.
 */
function startFallbackDecoder(container: HTMLElement, onText: (text: string) => void): () => void {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let busy = false;
  let jsQR: typeof import('jsqr').default | null = null;
  void import('jsqr').then((m) => {
    jsQR = m.default;
  });
  const timer = window.setInterval(() => {
    const video = container.querySelector('video');
    if (stopped || busy || !jsQR || !ctx || !video || video.readyState < 2 || !video.videoWidth) return;
    busy = true;
    try {
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hit = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'attemptBoth' });
      if (hit?.data) onText(hit.data);
    } finally {
      busy = false;
    }
  }, 250);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

/** Live camera QR scanner (html5-qrcode), loaded on demand. Falls back to a message when the camera is denied. */
export default function QrScanner({ onScan }: { onScan: (text: string) => void }) {
  const id = `qr-${useId().replace(/:/g, '')}`;
  const scanner = useRef<ScannerLike | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const last = useRef<{ text: string; at: number } | null>(null);
  const stopFallback = useRef<(() => void) | null>(null);

  /** One handler for both decoders; the same code seen again within 2.5 s is ignored. */
  const handle = (text: string) => {
    const now = Date.now();
    if (last.current && last.current.text === text && now - last.current.at < 2500) return;
    last.current = { text, at: now };
    onScan(text);
  };

  const stop = async () => {
    const s = scanner.current;
    scanner.current = null;
    stopFallback.current?.();
    stopFallback.current = null;
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
        {
          fps: 10,
          // the scan box follows the camera view (70% of its shorter side), so a dense label that fills the
          // view is not cropped; a fixed 220 px box missed Stock DNA labels in testing
          qrbox: (w: number, h: number) => {
            const side = Math.max(150, Math.floor(Math.min(w, h) * 0.7));
            return { width: side, height: side };
          },
        },
        (text) => handle(text),
        () => undefined,
      );
      const el = document.getElementById(id);
      if (el) stopFallback.current = startFallbackDecoder(el, handle);
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
      <div className={`scanner-view${running ? ' on' : ''}`} aria-label="Camera preview">
        {/* html5-qrcode owns this element's children: React must never render inside it */}
        <div id={id} className="scanner-target" />
        {!running && !starting && <span className="muted scanner-off">Camera is off</span>}
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

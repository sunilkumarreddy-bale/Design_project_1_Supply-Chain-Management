import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import QrScanner from '../components/QrScanner';

const { start } = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    start = start;
    stop = vi.fn().mockResolvedValue(undefined);
    clear = vi.fn();
  },
}));

describe('QrScanner', () => {
  beforeEach(() => start.mockReset());

  it('passes a decoded code to onScan once, ignoring the same code again within 2.5 s', async () => {
    const onScan = vi.fn();
    start.mockImplementation(async (...args: unknown[]) => {
      const ok = args[2] as ((t: string) => void) | undefined;
      if (typeof ok !== 'function') return;
      ok('SKU-BAT-004');
      ok('SKU-BAT-004');
    });
    render(<QrScanner onScan={onScan} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(await screen.findByRole('button', { name: 'Stop camera' })).toBeInTheDocument();
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('SKU-BAT-004');
    // the scan box follows the camera view instead of a fixed 220 px square
    const cfg = start.mock.calls.find((c) => c.length === 4)![1] as { qrbox: (w: number, h: number) => { width: number } };
    expect(cfg.qrbox(640, 480).width).toBe(336);
  });

  it('explains a denied camera and a missing camera', async () => {
    start.mockRejectedValueOnce(new Error('NotAllowedError: Permission denied'));
    const { unmount } = render(<QrScanner onScan={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Camera access was denied/);
    unmount();
    start.mockRejectedValueOnce(new Error('NotFoundError: Requested device not found'));
    render(<QrScanner onScan={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No camera was found/);
  });

  it('keeps React content out of the element the scanner library manages', () => {
    const { container } = render(<QrScanner onScan={vi.fn()} />);
    const target = container.querySelector('.scanner-target');
    expect(target).toBeEmptyDOMElement();
    expect(screen.getByText('Camera is off').parentElement).not.toBe(target);
  });
});

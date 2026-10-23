const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** Indian rupee amount, e.g. ₹6,600 or ₹1,25,000.50 */
export function rupees(n: number | null | undefined, whole = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return (whole ? inr0 : inr).format(n);
}

export function number(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return digits === 2 ? num.format(n) : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(n);
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function date(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** yyyy-mm-dd for <input type="date"> */
export function inputDate(d: string | Date | null | undefined): string {
  if (!d) return '';
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? '' : x.toISOString().slice(0, 10);
}

/** Whole days from now until the date (negative when past). */
export function daysUntil(d: string | Date | null | undefined, now = new Date()): number | null {
  if (!d) return null;
  return Math.floor((new Date(d).getTime() - now.getTime()) / 86400000);
}

export function humanize(s: string | null | undefined): string {
  if (!s) return '';
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function shortHash(h: string | null | undefined, n = 10): string {
  return h ? `${h.slice(0, n)}…` : '—';
}

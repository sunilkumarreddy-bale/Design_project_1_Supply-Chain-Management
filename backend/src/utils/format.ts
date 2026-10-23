/** Formats a number for explanation text: integers stay whole, others get up to `digits` decimals. */
export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return String(n);
  const r = Number(n.toFixed(digits));
  return Number.isInteger(r) ? String(r) : r.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

/** Indian rupee amount for explanation text, e.g. "Rs 6,600". */
export function rupees(n: number): string {
  const r = Math.round(n * 100) / 100;
  return `Rs ${r.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

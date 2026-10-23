export type Errors<T> = Partial<Record<keyof T, string>>;

export const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === '';

export function required(v: unknown, label = 'This field'): string | undefined {
  return isBlank(v) ? `${label} is required` : undefined;
}

export function positive(v: unknown, label = 'Value'): string | undefined {
  if (isBlank(v)) return `${label} is required`;
  const n = Number(v);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  return n > 0 ? undefined : `${label} must be greater than 0`;
}

export function nonNegative(v: unknown, label = 'Value', optional = false): string | undefined {
  if (isBlank(v)) return optional ? undefined : `${label} is required`;
  const n = Number(v);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  return n >= 0 ? undefined : `${label} must be 0 or more`;
}

export function email(v: unknown): string | undefined {
  if (isBlank(v)) return 'Email is required';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)) ? undefined : 'Enter a valid email';
}

export function phoneE164(v: unknown): string | undefined {
  if (isBlank(v)) return undefined;
  return /^\+[1-9]\d{6,14}$/.test(String(v)) ? undefined : 'Use E.164 format, e.g. +919876543210';
}

/** Collects the defined messages into an errors object. */
export function collect<T>(checks: Partial<Record<keyof T, string | undefined>>): Errors<T> {
  const out: Errors<T> = {};
  for (const [k, v] of Object.entries(checks) as [keyof T, string | undefined][]) if (v) out[k] = v;
  return out;
}

export const optNum = (v: unknown): number | null => (isBlank(v) ? null : Number(v));

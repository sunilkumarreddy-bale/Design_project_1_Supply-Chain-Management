import { ChangeEvent, FormEvent, useCallback, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import type { Errors } from '../utils/validate';

/**
 * Form state with client validation, a saving flag ("Saving..."), a red server-error banner and a green
 * success banner. On success the form resets to its initial values unless keepValues is set.
 */
export function useForm<T extends Record<string, any>>(initial: T, validate?: (v: T) => Errors<T>) {
  const initialRef = useRef(initial);
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Errors<T>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState('');

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((p) => ({ ...p, [key]: value }));
    setErrors((p) => (p[key] ? { ...p, [key]: undefined } : p));
  }, []);

  const bind = <K extends keyof T>(key: K) => ({
    name: String(key),
    value: (typeof values[key] === 'boolean' ? undefined : (values[key] ?? '')) as string,
    checked: typeof values[key] === 'boolean' ? (values[key] as boolean) : undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const t = e.target as HTMLInputElement;
      set(key, (t.type === 'checkbox' ? t.checked : t.value) as T[K]);
    },
  });

  const reset = useCallback((next?: T) => {
    if (next) initialRef.current = next;
    setValues(next ?? initialRef.current);
    setErrors({});
  }, []);

  const submit =
    (fn: (v: T) => Promise<string | void>, opts: { keepValues?: boolean } = {}) =>
    async (e?: FormEvent) => {
      e?.preventDefault();
      setServerError('');
      setSuccess('');
      const errs = validate ? validate(values) : {};
      setErrors(errs);
      if (Object.values(errs).some(Boolean)) return false;
      setSaving(true);
      try {
        const msg = await fn(values);
        setSuccess(msg || 'Saved');
        if (!opts.keepValues) setValues(initialRef.current);
        return true;
      } catch (err) {
        setServerError(errorMessage(err));
        return false;
      } finally {
        setSaving(false);
      }
    };

  return { values, set, bind, errors, setErrors, saving, serverError, success, setSuccess, setServerError, submit, reset, setValues };
}

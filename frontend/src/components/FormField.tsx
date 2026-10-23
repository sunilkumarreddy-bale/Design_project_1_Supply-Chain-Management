import type { ReactNode } from 'react';

export default function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  required,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={`field${error ? ' field-error' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="req" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <div className="hint" id={`${htmlFor}-hint`}>
          {hint}
        </div>
      )}
      {error && (
        <div className="error-text" id={`${htmlFor}-error`} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** Red / green banners shown at the bottom of every form. */
export function FormStatus({ error, success }: { error?: string; success?: string }) {
  return (
    <>
      {error && (
        <div className="banner banner-error" role="alert">
          <div className="banner-body">{error}</div>
        </div>
      )}
      {success && (
        <div className="banner banner-success" role="status">
          <div className="banner-body">{success}</div>
        </div>
      )}
    </>
  );
}

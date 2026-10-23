import axios, { AxiosError, AxiosRequestConfig } from 'axios';

export const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
export const TOKEN_KEY = 'sis.token';

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export const client = axios.create({ baseURL: API_URL, timeout: 120000 });

client.interceptors.request.use((cfg) => {
  if (authToken) cfg.headers.set('Authorization', `Bearer ${authToken}`);
  return cfg;
});

client.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response?.status === 401 && authToken && !String(err.config?.url).includes('/auth/login')) onUnauthorized?.();
    return Promise.reject(err);
  },
);

export interface ApiErrorBody {
  error?: { message?: string; code?: string; details?: { path: string; message: string }[] };
}

/** Human-readable message from an axios / RTK Query error. */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (!e) return fallback;
  const anyE = e as { data?: ApiErrorBody; status?: number | string; error?: string; message?: string; response?: { data?: ApiErrorBody } };
  const body = anyE.data ?? anyE.response?.data;
  if (body?.error?.message) return body.error.message;
  if (anyE.status === 'FETCH_ERROR' || anyE.message === 'Network Error') return 'Cannot reach the server. Check your connection and try again.';
  if (typeof anyE.error === 'string') return anyE.error;
  if (anyE.message) return anyE.message;
  return fallback;
}

/** Downloads a file (CSV / PDF) from the API with the auth header and saves it with the server's filename. */
export async function downloadFile(path: string, params?: Record<string, unknown>, fallbackName = 'download') {
  const res = await client.get(path, { params, responseType: 'blob' } as AxiosRequestConfig);
  const disposition = String(res.headers['content-disposition'] ?? '');
  const name = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

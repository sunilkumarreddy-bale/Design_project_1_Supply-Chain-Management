/** Small fetch wrapper used by the real drivers; throws with the provider's message on non-2xx. */
export async function httpJson<T = unknown>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text */
    }
    if (!res.ok) {
      const msg =
        typeof body === 'object' && body
          ? JSON.stringify(body).slice(0, 300)
          : String(body).slice(0, 300) || res.statusText;
      throw new Error(`HTTP ${res.status} from ${new URL(url).host}: ${msg}`);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export type FetchLike = typeof globalThis.fetch;

export interface RequestJsonOptions {
  method?: string; // default GET
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number; // abort after this long (default 10s)
  fetch?: FetchLike; // default globalThis.fetch
}

/** fetch + abort-timeout + status check, returning parsed JSON. Throws on no-fetch, non-2xx, or invalid JSON. */
export async function requestJson<T>(url: string, opts: RequestJsonOptions = {}): Promise<T> {
  const doFetch = opts.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!doFetch) throw new Error('no global fetch — pass `fetch` (e.g. undici on Node <18)');
  const method = opts.method ?? 'GET';
  const res = await doFetch(url, {
    method,
    headers: opts.headers,
    body: opts.body,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

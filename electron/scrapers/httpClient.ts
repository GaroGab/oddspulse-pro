export const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
};

export class ScrapeAbortedError extends Error {
  constructor(message = 'Ciclo di scraping interrotto') {
    super(message);
    this.name = 'ScrapeAbortedError';
  }
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof ScrapeAbortedError) return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ScrapeAbortedError();
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new ScrapeAbortedError());
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ScrapeAbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function parseCacheAgeSec(headers: Headers): number {
  const raw = headers.get('age');
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
}

export function appendCacheBuster(url: string, paramName = '_t'): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${paramName}=${Date.now()}`;
}

export function computeEffectiveScrapedAt(nowMs: number, cacheAgeSec = 0): number {
  const safeAge = Number.isFinite(cacheAgeSec) && cacheAgeSec > 0 ? cacheAgeSec : 0;
  return Math.max(0, nowMs - safeAge * 1000);
}

async function fetchWithTimeout(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    headers?: Record<string, string>;
    noCacheHeaders?: boolean;
    timeoutMs: number;
    signal?: AbortSignal;
  }
): Promise<Response> {
  throwIfAborted(options.signal);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const parentSignal = options.signal;
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const headers: Record<string, string> = {
      ...DEFAULT_HEADERS,
      ...(options.noCacheHeaders
        ? { 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' }
        : {}),
      ...(options.headers ?? {}),
    };
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      signal: controller.signal,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return await fetch(url, init);
  } catch (err) {
    if (parentSignal?.aborted) {
      throw new ScrapeAbortedError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

export async function fetchTextWithMeta(
  url: string,
  options?: {
    headers?: Record<string, string>;
    noCacheHeaders?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<{ text: string; latencyMs: number; cacheAgeSec: number }> {
  const started = Date.now();
  const res = await fetchWithTimeout(url, {
    headers: options?.headers,
    noCacheHeaders: options?.noCacheHeaders,
    timeoutMs: options?.timeoutMs ?? 11000,
    signal: options?.signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const cacheAgeSec = parseCacheAgeSec(res.headers);
  const text = await res.text();
  return { text, latencyMs: Date.now() - started, cacheAgeSec };
}

export async function fetchText(
  url: string,
  options?: {
    headers?: Record<string, string>;
    noCacheHeaders?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<string> {
  const { text } = await fetchTextWithMeta(url, options);
  return text;
}

export async function fetchJson<T>(
  url: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: unknown;
    headers?: Record<string, string>;
    noCacheHeaders?: boolean;
    timeoutMs?: number;
    retries?: number;
    signal?: AbortSignal;
  }
): Promise<{ data: T; latencyMs: number; cacheAgeSec: number }> {
  const timeoutMs = options?.timeoutMs ?? 12000;
  const retries = options?.retries ?? 1;
  const started = Date.now();

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    throwIfAborted(options?.signal);
    try {
      const res = await fetchWithTimeout(url, {
        method: options?.method,
        body: options?.body,
        headers: options?.headers,
        noCacheHeaders: options?.noCacheHeaders,
        timeoutMs,
        signal: options?.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status} ${res.statusText}${text ? ': ' + text.slice(0, 120) : ''}`);
        // Don't retry client 4xx except 429
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw err;
        }
        lastErr = err;
        if (attempt < retries) {
          await sleep(res.status === 429 ? 1200 : 400, options?.signal);
          continue;
        }
        throw err;
      }

      const cacheAgeSec = parseCacheAgeSec(res.headers);
      const data = (await res.json()) as T;
      return { data, latencyMs: Date.now() - started, cacheAgeSec };
    } catch (e) {
      if (options?.signal?.aborted || e instanceof ScrapeAbortedError) {
        throw new ScrapeAbortedError();
      }
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) {
        await sleep(350, options?.signal);
        continue;
      }
    }
  }
  throw lastErr ?? new Error('Unknown fetch error');
}

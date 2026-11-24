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

async function fetchWithTimeout(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    headers?: Record<string, string>;
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

export async function fetchText(
  url: string,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<string> {
  const res = await fetchWithTimeout(url, {
    headers: options?.headers,
    timeoutMs: options?.timeoutMs ?? 11000,
    signal: options?.signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

export async function fetchJson<T>(
  url: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
    retries?: number;
    signal?: AbortSignal;
  }
): Promise<{ data: T; latencyMs: number }> {
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

      const data = (await res.json()) as T;
      return { data, latencyMs: Date.now() - started };
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

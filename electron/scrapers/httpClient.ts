export const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson<T>(
  url: string,
  options?: {
    method?: 'GET' | 'POST';
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
    retries?: number;
  }
): Promise<{ data: T; latencyMs: number }> {
  const timeoutMs = options?.timeoutMs ?? 12000;
  const retries = options?.retries ?? 1;
  const started = Date.now();

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        ...DEFAULT_HEADERS,
        ...(options?.headers ?? {}),
      };
      const init: RequestInit = {
        method: options?.method ?? 'GET',
        headers,
        signal: controller.signal,
      };
      if (options?.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      }

      const res = await fetch(url, init);
      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status} ${res.statusText}${text ? ': ' + text.slice(0, 120) : ''}`);
        // Don't retry client 4xx except 429
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw err;
        }
        lastErr = err;
        if (attempt < retries) {
          await sleep(res.status === 429 ? 1200 : 400);
          continue;
        }
        throw err;
      }

      const data = (await res.json()) as T;
      return { data, latencyMs: Date.now() - started };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) {
        await sleep(350);
        continue;
      }
    }
  }
  throw lastErr ?? new Error('Unknown fetch error');
}

import type { ConnectionDiagnostic, SourceStatus } from './types';

export function formatFriendlyNetworkError(raw: string | null | undefined): string {
  if (!raw) return 'Errore di rete durante il recupero delle quote';
  const low = raw.toLowerCase();
  if (
    low.includes('enotfound') ||
    low.includes('eai_again') ||
    low.includes('getaddrinfo') ||
    low.includes('dns')
  ) {
    return 'Impossibile risolvere i domini (verifica connessione internet o DNS)';
  }
  if (low.includes('abort') || low.includes('timeout') || low.includes('etimedout')) {
    return 'Timeout di connessione: i server non hanno risposto in tempo';
  }
  if (
    low.includes('fetch failed') ||
    low.includes('econnrefused') ||
    low.includes('econnreset') ||
    low.includes('enetunreach') ||
    low.includes('ehostunreach') ||
    low.includes('network')
  ) {
    return 'Connessione internet assente, instabile o bloccata da firewall/VPN';
  }
  if (low.includes('403') || low.includes('429')) {
    return 'Accesso temporaneamente limitato dai server remoti (HTTP 403/429)';
  }
  return raw;
}

/**
 * Computes an accurate, deterministic ConnectionDiagnostic from source statuses
 * and OS/Electron online state so the UI never confuses network errors with empty filters.
 */
export function computeConnectionDiagnostic(params: {
  sources: SourceStatus[];
  isSystemOnline: boolean;
  hasCompletedCycle: boolean;
}): ConnectionDiagnostic {
  const { sources, isSystemOnline, hasCompletedCycle } = params;
  const enabled = sources.filter((s) => s.enabled);
  const active = enabled.filter((s) => s.state === 'ok');
  const failed = enabled.filter((s) => s.state === 'error');
  const exchangesOnline = active.filter((s) => s.kind === 'exchange').length;
  const exchangesEnabled = enabled.filter((s) => s.kind === 'exchange').length;
  const bookmakersOnline = active.filter((s) => s.kind === 'bookmaker').length;
  const bookmakersEnabled = enabled.filter((s) => s.kind === 'bookmaker').length;

  const firstErr = failed.find((s) => s.lastError)?.lastError ?? null;
  const lastErrorSummary = !isSystemOnline
    ? 'Nessuna connessione internet rilevata sul dispositivo'
    : firstErr
    ? formatFriendlyNetworkError(firstErr)
    : null;

  if (!isSystemOnline) {
    return {
      health: 'offline',
      isSystemOnline: false,
      failedSourcesCount: failed.length,
      activeSourcesCount: active.length,
      enabledSourcesCount: enabled.length,
      exchangesOnlineCount: exchangesOnline,
      bookmakersOnlineCount: bookmakersOnline,
      lastErrorSummary,
    };
  }

  if (!hasCompletedCycle && failed.length === 0 && active.length === 0) {
    return {
      health: 'idle',
      isSystemOnline: true,
      failedSourcesCount: 0,
      activeSourcesCount: 0,
      enabledSourcesCount: enabled.length,
      exchangesOnlineCount: 0,
      bookmakersOnlineCount: 0,
      lastErrorSummary: null,
    };
  }

  // Offline if all enabled sources failed, OR if zero exchanges or zero bookmakers are reachable due to errors.
  // Never treat mid-cycle (while other sources of that kind are still scraping) as offline!
  const exchangesScraping = enabled.some((s) => s.kind === 'exchange' && s.state === 'scraping');
  const bookmakersScraping = enabled.some((s) => s.kind === 'bookmaker' && s.state === 'scraping');
  const allFailed =
    enabled.length > 0 &&
    active.length === 0 &&
    !exchangesScraping &&
    !bookmakersScraping &&
    failed.length > 0;
  const noExchangesReachable =
    exchangesEnabled > 0 &&
    exchangesOnline === 0 &&
    !exchangesScraping &&
    failed.some((s) => s.kind === 'exchange');
  const noBookmakersReachable =
    bookmakersEnabled > 0 &&
    bookmakersOnline === 0 &&
    !bookmakersScraping &&
    failed.some((s) => s.kind === 'bookmaker');

  if (allFailed || noExchangesReachable || noBookmakersReachable) {
    return {
      health: 'offline',
      isSystemOnline: true,
      failedSourcesCount: failed.length,
      activeSourcesCount: active.length,
      enabledSourcesCount: enabled.length,
      exchangesOnlineCount: exchangesOnline,
      bookmakersOnlineCount: bookmakersOnline,
      lastErrorSummary:
        lastErrorSummary ??
        (noExchangesReachable
          ? 'Nessun Betting Exchange raggiungibile: impossibile calcolare le quote Banca'
          : 'Impossibile raggiungere i siti dei bookmaker'),
    };
  }

  if (failed.length > 0) {
    return {
      health: 'degraded',
      isSystemOnline: true,
      failedSourcesCount: failed.length,
      activeSourcesCount: active.length,
      enabledSourcesCount: enabled.length,
      exchangesOnlineCount: exchangesOnline,
      bookmakersOnlineCount: bookmakersOnline,
      lastErrorSummary,
    };
  }

  return {
    health: active.length > 0 ? 'online' : 'idle',
    isSystemOnline: true,
    failedSourcesCount: 0,
    activeSourcesCount: active.length,
    enabledSourcesCount: enabled.length,
    exchangesOnlineCount: exchangesOnline,
    bookmakersOnlineCount: bookmakersOnline,
    lastErrorSummary: null,
  };
}

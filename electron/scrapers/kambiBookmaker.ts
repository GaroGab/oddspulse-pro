import { matchesScrapeDateWindow } from '../../src/shared/dateRange';
import type {
  MarketType,
  RawScrapedMarket,
  SelectionQuote,
  SourceId,
  SportKey,
  TargetedScrapeFilter,
} from '../../src/shared/types';
import {
  appendCacheBuster,
  computeEffectiveScrapedAt,
  fetchJson,
  isAbortError,
  sleep,
  throwIfAborted,
} from './httpClient';
import { matchesEventHints } from './matchLinker';

interface KambiOutcome {
  label?: string;
  englishLabel?: string;
  type?: string; // OT_ONE, OT_CROSS, OT_TWO, OT_OVER, OT_UNDER, OT_YES, OT_NO
  line?: number; // e.g., 2500 for 2.5
  odds?: number; // decimal * 1000
  status?: string;
}

interface KambiBetOffer {
  criterion?: { id?: number; label?: string; englishLabel?: string };
  betOfferType?: { id?: number; name?: string; englishName?: string };
  outcomes?: KambiOutcome[];
  suspended?: boolean;
}

interface KambiEventEntry {
  event: {
    id: number;
    name: string;
    englishName?: string;
    homeName?: string;
    awayName?: string;
    start: string;
    group?: string;
    sport?: string;
    state?: string; // NOT_STARTED, STARTED
    path?: Array<{ name?: string; englishName?: string }>;
  };
  betOffers?: KambiBetOffer[];
}

interface KambiListResponse {
  events?: KambiEventEntry[];
}

interface KambiSingleEventResponse {
  events?: Array<KambiEventEntry['event']>;
  betOffers?: KambiBetOffer[];
}

export interface KambiBrandSpec {
  sourceId: SourceId;
  sourceName: string;
  kambiOperator: string;
  baseUrl: string;
}

export const KAMBI_BRANDS: Record<string, KambiBrandSpec> = {
  '888sport_it': {
    sourceId: '888sport_it',
    sourceName: '888sport.it',
    kambiOperator: '888it',
    baseUrl: 'https://www.888sport.it/#/event/',
  },
  leovegas_it: {
    sourceId: 'leovegas_it',
    sourceName: 'LeoVegas.it',
    kambiOperator: 'leoit',
    baseUrl: 'https://www.leovegas.it/scommesse#event/',
  },
  unibet: {
    sourceId: 'unibet',
    sourceName: 'Unibet',
    kambiOperator: 'ub',
    baseUrl: 'https://www.unibet.it/betting/sports/event/',
  },
  paf: {
    sourceId: 'paf',
    sourceName: 'Paf Sports',
    kambiOperator: 'paf',
    baseUrl: 'https://www.paf.com/betting#event/',
  },
};

const SPORTS: Array<{ sport: SportKey; kambiPath: string }> = [
  { sport: 'football', kambiPath: 'football' },
  { sport: 'tennis', kambiPath: 'tennis' },
  { sport: 'basketball', kambiPath: 'basketball' },
];

const KAMBI_FUTURE_FOOTBALL_PATHS = [
  'football/italy',
  'football/england',
  'football/spain',
  'football/germany',
  'football/france',
  'football/netherlands',
  'football/portugal',
  'football/champions_league',
  'football/europa_league',
  'football/conference_league',
];

const KAMBI_FUTURE_BASKETBALL_PATHS = [
  'basketball/nba',
  'basketball/euroleague',
  'basketball/italy',
];

function extractKambiEventMarkets(params: {
  spec: KambiBrandSpec;
  sport: SportKey;
  ev: KambiEventEntry['event'];
  betOffers: KambiBetOffer[];
  scrapedAt: number;
  cacheAgeSec: number;
}): RawScrapedMarket[] {
  const { spec, sport, ev, betOffers, scrapedAt, cacheAgeSec } = params;
  if (!ev.homeName || !ev.awayName) return [];
  const homeTeam = ev.homeName.trim();
  const awayTeam = ev.awayName.trim();
  const league =
    ev.group ??
    ev.path?.[ev.path.length - 1]?.name ??
    (sport === 'football' ? 'Calcio' : sport === 'tennis' ? 'Tennis' : 'Basket');

  const out: RawScrapedMarket[] = [];
  const seenMarketTypes = new Set<MarketType>();

  for (const bo of betOffers) {
    if (bo.suspended) continue;
    const outcomes = (bo.outcomes ?? []).filter(
      (o) => (!o.status || o.status === 'OPEN') && o.odds && o.odds > 1005
    );
    if (outcomes.length < 2) continue;

    const boTypeId = bo.betOfferType?.id;
    const critId = bo.criterion?.id;
    const boType = (bo.betOfferType?.englishName ?? bo.betOfferType?.name ?? '').toLowerCase();
    const crit = (bo.criterion?.englishLabel ?? bo.criterion?.label ?? '').toLowerCase();

    // 1X2 Football (strictly Full Time / Tempi Regolamentari, never First Goal or 3-way Handicap)
    if (
      sport === 'football' &&
      !seenMarketTypes.has('1X2') &&
      outcomes.length === 3 &&
      outcomes.every((o) => o.line === undefined) &&
      outcomes.some((o) => o.type === 'OT_ONE') &&
      outcomes.some((o) => o.type === 'OT_CROSS') &&
      outcomes.some((o) => o.type === 'OT_TWO') &&
      (!boTypeId || boTypeId === 2) &&
      !boType.includes('handicap') &&
      (critId === 1001159858 ||
        !/half|tempo|first|primo|second|corner|card|cartellin|penalty|rigore|double|score|gol/i.test(
          crit
        ))
    ) {
      const sels: SelectionQuote[] = [];
      for (const o of outcomes) {
        const dec = Math.round((o.odds! / 1000) * 100) / 100;
        if (o.type === 'OT_ONE')
          sels.push({ canonicalKey: 'HOME', label: `${homeTeam} (1)`, backOdds: dec });
        else if (o.type === 'OT_CROSS')
          sels.push({ canonicalKey: 'DRAW', label: 'Pareggio (X)', backOdds: dec });
        else if (o.type === 'OT_TWO')
          sels.push({ canonicalKey: 'AWAY', label: `${awayTeam} (2)`, backOdds: dec });
      }
      if (sels.length === 3) {
        seenMarketTypes.add('1X2');
        out.push({
          sourceId: spec.sourceId,
          sourceName: spec.sourceName,
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId: String(ev.id),
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: ev.start,
          marketType: '1X2',
          marketLabel: 'Esito Finale 1X2',
          selections: sels,
          eventUrl: `${spec.baseUrl}${ev.id}`,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // Football Over/Under 2.5 (strictly Match Total Goals, never Team Totals / Corners / Cards)
    if (
      sport === 'football' &&
      !seenMarketTypes.has('OVER_UNDER_25') &&
      outcomes.length === 2 &&
      outcomes.some((o) => o.type === 'OT_OVER' && o.line === 2500) &&
      outcomes.some((o) => o.type === 'OT_UNDER' && o.line === 2500) &&
      (!boTypeId || boTypeId === 6) &&
      (critId === 1001159926 ||
        !/half|tempo|corner|card|cartellin| by |home|away|casa|ospite|squadra|team|shot|tiro/i.test(
          crit
        ))
    ) {
      const sels: SelectionQuote[] = [];
      for (const o of outcomes) {
        const dec = Math.round((o.odds! / 1000) * 100) / 100;
        if (o.type === 'OT_OVER')
          sels.push({ canonicalKey: 'OVER_25', label: 'Over 2.5', backOdds: dec });
        else if (o.type === 'OT_UNDER')
          sels.push({ canonicalKey: 'UNDER_25', label: 'Under 2.5', backOdds: dec });
      }
      if (sels.length === 2) {
        seenMarketTypes.add('OVER_UNDER_25');
        out.push({
          sourceId: spec.sourceId,
          sourceName: spec.sourceName,
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId: String(ev.id),
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: ev.start,
          marketType: 'OVER_UNDER_25',
          marketLabel: 'Under/Over 2.5 Gol',
          selections: sels,
          eventUrl: `${spec.baseUrl}${ev.id}`,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // Football Both Teams To Score (BTTS)
    if (
      sport === 'football' &&
      !seenMarketTypes.has('BTTS') &&
      outcomes.length === 2 &&
      outcomes.some((o) => o.type === 'OT_YES') &&
      outcomes.some((o) => o.type === 'OT_NO') &&
      (critId === 1001642858 ||
        (/both teams to score|entrambe le squadre/i.test(crit) &&
          !/half|tempo|1st|2nd|first|second/i.test(crit)))
    ) {
      const sels: SelectionQuote[] = [];
      for (const o of outcomes) {
        const dec = Math.round((o.odds! / 1000) * 100) / 100;
        if (o.type === 'OT_YES')
          sels.push({ canonicalKey: 'BTTS_YES', label: 'Goal (Sì)', backOdds: dec });
        else if (o.type === 'OT_NO')
          sels.push({ canonicalKey: 'BTTS_NO', label: 'NoGoal (No)', backOdds: dec });
      }
      if (sels.length === 2) {
        seenMarketTypes.add('BTTS');
        out.push({
          sourceId: spec.sourceId,
          sourceName: spec.sourceName,
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId: String(ev.id),
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: ev.start,
          marketType: 'BTTS',
          marketLabel: 'Goal / NoGoal',
          selections: sels,
          eventUrl: `${spec.baseUrl}${ev.id}`,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // Tennis & Basketball H2H (Moneyline / Testa a Testa)
    if (
      (sport === 'tennis' || sport === 'basketball') &&
      !seenMarketTypes.has('H2H') &&
      outcomes.length === 2 &&
      outcomes.every((o) => o.line === undefined) &&
      outcomes.some((o) => o.type === 'OT_ONE') &&
      outcomes.some((o) => o.type === 'OT_TWO') &&
      (!boTypeId || boTypeId === 2) &&
      !boType.includes('handicap') &&
      !/set|quarter|half|quarto|tempo|game|gioco|point|punto|first|primo/i.test(crit)
    ) {
      const sels: SelectionQuote[] = [];
      for (const o of outcomes) {
        const dec = Math.round((o.odds! / 1000) * 100) / 100;
        if (o.type === 'OT_ONE')
          sels.push({ canonicalKey: 'HOME', label: `${homeTeam} (1)`, backOdds: dec });
        else if (o.type === 'OT_TWO')
          sels.push({ canonicalKey: 'AWAY', label: `${awayTeam} (2)`, backOdds: dec });
      }
      if (sels.length === 2) {
        seenMarketTypes.add('H2H');
        out.push({
          sourceId: spec.sourceId,
          sourceName: spec.sourceName,
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId: String(ev.id),
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: ev.start,
          marketType: 'H2H',
          marketLabel: 'Testa a Testa',
          selections: sels,
          eventUrl: `${spec.baseUrl}${ev.id}`,
          scrapedAt,
          cacheAgeSec,
        });
      }
    }
  }

  return out;
}

export async function scrapeKambiBrand(
  spec: KambiBrandSpec,
  includeLive: boolean,
  filter?: TargetedScrapeFilter,
  signal?: AbortSignal
): Promise<{ markets: RawScrapedMarket[]; latencyMs: number }> {
  const started = Date.now();
  const nowMs = Date.now();
  const markets: RawScrapedMarket[] = [];
  let succeededRequests = 0;
  let lastErr: unknown = null;

  const dateWindow = filter?.dateWindow;
  const needsFutureLeaguePaths = Boolean(dateWindow && dateWindow.endMs > nowMs + 20 * 3600_000);
  const includesNearTerm = !dateWindow || dateWindow.startMs <= nowMs + 24 * 3600_000;

  const targetSports =
    filter?.sports && filter.sports.length > 0
      ? SPORTS.filter((s) => filter.sports!.includes(s.sport))
      : SPORTS;

  const jobs: Array<{ sport: SportKey; kambiPath: string }> = [];
  for (const sp of targetSports) {
    if (!needsFutureLeaguePaths) {
      jobs.push(sp);
    } else if (sp.sport === 'football') {
      if (includesNearTerm) jobs.push({ sport: 'football', kambiPath: 'football' });
      for (const p of KAMBI_FUTURE_FOOTBALL_PATHS) {
        jobs.push({ sport: 'football', kambiPath: p });
      }
    } else if (sp.sport === 'basketball') {
      if (includesNearTerm) jobs.push({ sport: 'basketball', kambiPath: 'basketball' });
      for (const p of KAMBI_FUTURE_BASKETBALL_PATHS) {
        jobs.push({ sport: 'basketball', kambiPath: p });
      }
    } else {
      jobs.push(sp);
    }
  }

  const seenEventIds = new Set<number>();
  const pauseMs = needsFutureLeaguePaths ? 110 : 180;

  for (let jobIdx = 0; jobIdx < jobs.length; jobIdx++) {
    const sp = jobs[jobIdx];
    throwIfAborted(signal);
    const url = appendCacheBuster(
      `https://eu-offering-api.kambicdn.com/offering/v2018/${spec.kambiOperator}/listView/${sp.kambiPath}.json?lang=it_IT&market=IT&client_id=2&channel_id=1&useCombined=true`
    );
    try {
      const { data, cacheAgeSec } = await fetchJson<KambiListResponse>(url, {
        noCacheHeaders: true,
        timeoutMs: 12000,
        retries: 1,
        signal,
      });
      const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);
      const entries = data.events ?? [];

      for (const entry of entries) {
        const ev = entry.event;
        if (!ev || !ev.homeName || !ev.awayName) continue;
        if (seenEventIds.has(ev.id)) continue;
        if (!includeLive && ev.state && ev.state !== 'NOT_STARTED') continue;
        if (!includeLive && Date.parse(ev.start) < nowMs - 60_000) continue;
        if (dateWindow && !matchesScrapeDateWindow(ev.start, dateWindow)) continue;
        seenEventIds.add(ev.id);

        const homeTeam = ev.homeName.trim();
        const awayTeam = ev.awayName.trim();
        if (
          filter?.eventHints?.length &&
          !matchesEventHints(`${homeTeam} - ${awayTeam}`, homeTeam, awayTeam, sp.sport, filter.eventHints)
        ) {
          continue;
        }

        markets.push(
          ...extractKambiEventMarkets({
            spec,
            sport: sp.sport,
            ev,
            betOffers: entry.betOffers ?? [],
            scrapedAt,
            cacheAgeSec,
          })
        );
      }
      succeededRequests++;
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      lastErr = err;
    }
    // Gentle pause between requests to avoid Kambi 429
    if (jobIdx < jobs.length - 1) {
      await sleep(pauseMs, signal);
    }
  }

  if (succeededRequests === 0 && lastErr) {
    throw lastErr;
  }

  return { markets, latencyMs: Date.now() - started };
}

/**
 * Ultra-fast (~50-150ms) single-event live verification on Kambi betoffer endpoint.
 */
export async function verifyKambiEvent(params: {
  spec: KambiBrandSpec;
  eventId: string;
  sport: SportKey;
  marketType: MarketType;
  includeLive: boolean;
  signal?: AbortSignal;
}): Promise<{
  market: RawScrapedMarket | null;
  latencyMs: number;
  cacheAgeSec: number;
}> {
  const started = Date.now();
  const url = appendCacheBuster(
    `https://eu-offering-api.kambicdn.com/offering/v2018/${params.spec.kambiOperator}/betoffer/event/${encodeURIComponent(
      params.eventId
    )}.json?lang=it_IT&market=IT&client_id=2&channel_id=1`
  );
  const { data, cacheAgeSec } = await fetchJson<KambiSingleEventResponse>(url, {
    noCacheHeaders: true,
    timeoutMs: 7000,
    retries: 0,
    signal: params.signal,
  });

  const ev = data.events?.[0];
  if (!ev) {
    return { market: null, latencyMs: Date.now() - started, cacheAgeSec };
  }
  if (!params.includeLive && ev.state && ev.state !== 'NOT_STARTED') {
    return { market: null, latencyMs: Date.now() - started, cacheAgeSec };
  }

  const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);
  const extracted = extractKambiEventMarkets({
    spec: params.spec,
    sport: params.sport,
    ev,
    betOffers: data.betOffers ?? [],
    scrapedAt,
    cacheAgeSec,
  });

  return {
    market: extracted.find((m) => m.marketType === params.marketType) ?? null,
    latencyMs: Date.now() - started,
    cacheAgeSec,
  };
}

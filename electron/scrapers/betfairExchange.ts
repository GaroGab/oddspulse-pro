import { matchesScrapeDateWindow } from '../../src/shared/dateRange';
import type {
  MarketType,
  RawScrapedMarket,
  SelectionQuote,
  SportKey,
  TargetedScrapeFilter,
} from '../../src/shared/types';
import {
  computeEffectiveScrapedAt,
  fetchJson,
  isAbortError,
  sleep,
  throwIfAborted,
} from './httpClient';
import { matchesEventHints, teamSimilarity } from './matchLinker';

const SCAN_URL =
  'https://scan-inbf.betfair.it/www/sports/navigation/facet/v1/search?_ak=nzIFcwyWhrlwYMrh&alt=json';
const ERO_BASE =
  'https://ero.betfair.it/www/sports/exchange/readonly/v1/bymarket?_ak=nzIFcwyWhrlwYMrh&alt=json&currencyCode=EUR&locale=it&rollupLimit=2&rollupModel=STAKE&virtualise=true&types=MARKET_STATE,MARKET_DESCRIPTION,EVENT,RUNNER_DESCRIPTION,RUNNER_STATE,RUNNER_EXCHANGE_PRICES_BEST';

interface BetfairScanResult {
  eventId?: number;
  marketId?: string;
  competitionId?: number;
  eventTypeId?: number;
}

interface BetfairScanResponse {
  results?: BetfairScanResult[];
  attachments?: {
    competitions?: Record<string, { name?: string; competitionId?: number }>;
    events?: Record<string, { name?: string; openDate?: string; competitionId?: number }>;
  };
}

interface BetfairEroResponse {
  eventTypes?: Array<{
    eventTypeId: number;
    eventNodes?: Array<{
      eventId: number;
      event: {
        eventName: string;
        openDate: string;
        countryCode?: string;
      };
      marketNodes?: Array<{
        marketId: string;
        state?: {
          inplay?: boolean;
          status?: string;
          totalMatched?: number;
        };
        description?: {
          marketName?: string;
          marketType?: string;
          marketTime?: string;
        };
        runners?: Array<{
          selectionId: number;
          description?: {
            runnerName?: string;
            sortPriority?: number;
          };
          state?: {
            sortPriority?: number;
            status?: string;
          };
          exchange?: {
            availableToBack?: Array<{ price: number; size: number }>;
            availableToLay?: Array<{ price: number; size: number }>;
          };
        }>;
      }>;
    }>;
  }>;
}

function splitEventTeams(eventName: string): [string, string] | null {
  const separators = [' - ', ' v ', ' vs ', ' @ '];
  for (const sep of separators) {
    const idx = eventName.indexOf(sep);
    if (idx > 0) {
      return [eventName.slice(0, idx).trim(), eventName.slice(idx + sep.length).trim()];
    }
  }
  return null;
}

function mapBetfairMarket(
  sport: SportKey,
  bfMarketType: string
): { marketType: MarketType; marketLabel: string } | null {
  if (sport === 'football') {
    if (bfMarketType === 'MATCH_ODDS') return { marketType: '1X2', marketLabel: 'Esito Finale 1X2' };
    if (bfMarketType === 'OVER_UNDER_25')
      return { marketType: 'OVER_UNDER_25', marketLabel: 'Under/Over 2.5 Gol' };
    if (bfMarketType === 'BOTH_TEAMS_TO_SCORE')
      return { marketType: 'BTTS', marketLabel: 'Goal / NoGoal' };
    return null;
  }
  if (bfMarketType === 'MATCH_ODDS' || bfMarketType === 'MONEY_LINE') {
    return { marketType: 'H2H', marketLabel: 'Testa a Testa' };
  }
  return null;
}

function mapRunnerCanonicalKey(
  sport: SportKey,
  marketType: MarketType,
  runnerName: string,
  runnerIdx: number,
  homeTeam: string,
  awayTeam: string
): { key: string; label: string } | null {
  const rn = runnerName.trim();
  const rnLow = rn.toLowerCase();

  if (marketType === '1X2') {
    if (rnLow === 'pareggio' || rnLow === 'the draw' || rnLow === 'draw' || rnLow === 'x') {
      return { key: 'DRAW', label: 'Pareggio (X)' };
    }
    if (rnLow === homeTeam.toLowerCase()) {
      return { key: 'HOME', label: `${homeTeam} (1)` };
    }
    if (rnLow === awayTeam.toLowerCase()) {
      return { key: 'AWAY', label: `${awayTeam} (2)` };
    }
    const simH = teamSimilarity(rn, homeTeam, sport);
    const simA = teamSimilarity(rn, awayTeam, sport);
    if (simH >= 0.65 && simH > simA + 0.08) {
      return { key: 'HOME', label: `${homeTeam} (1)` };
    }
    if (simA >= 0.65 && simA > simH + 0.08) {
      return { key: 'AWAY', label: `${awayTeam} (2)` };
    }
    if (runnerIdx === 0) return { key: 'HOME', label: `${homeTeam} (1)` };
    if (runnerIdx === 1) return { key: 'AWAY', label: `${awayTeam} (2)` };
    return null;
  }

  if (marketType === 'H2H') {
    if (rnLow === homeTeam.toLowerCase()) {
      return { key: 'HOME', label: `${homeTeam} (1)` };
    }
    if (rnLow === awayTeam.toLowerCase()) {
      return { key: 'AWAY', label: `${awayTeam} (2)` };
    }
    const simH = teamSimilarity(rn, homeTeam, sport);
    const simA = teamSimilarity(rn, awayTeam, sport);
    if (simH >= 0.65 && simH > simA + 0.08) {
      return { key: 'HOME', label: `${homeTeam} (1)` };
    }
    if (simA >= 0.65 && simA > simH + 0.08) {
      return { key: 'AWAY', label: `${awayTeam} (2)` };
    }
    if (runnerIdx === 0) return { key: 'HOME', label: `${homeTeam} (1)` };
    if (runnerIdx === 1) return { key: 'AWAY', label: `${awayTeam} (2)` };
    return null;
  }

  if (marketType === 'OVER_UNDER_25') {
    if (rnLow.includes('over') || rnLow.includes('più') || rnLow.includes('piu')) {
      return { key: 'OVER_25', label: 'Over 2.5' };
    }
    if (rnLow.includes('under') || rnLow.includes('meno')) {
      return { key: 'UNDER_25', label: 'Under 2.5' };
    }
    return null;
  }

  if (marketType === 'BTTS') {
    if (rnLow === 'sì' || rnLow === 'si' || rnLow === 'yes' || rnLow === 'goal') {
      return { key: 'BTTS_YES', label: 'Goal (Sì)' };
    }
    if (rnLow === 'no' || rnLow === 'nogoal' || rnLow === 'no goal') {
      return { key: 'BTTS_NO', label: 'NoGoal (No)' };
    }
    return null;
  }

  return null;
}

function pickBestBack(levels?: Array<{ price: number; size: number }>): { price: number; size: number } | undefined {
  if (!levels || levels.length === 0) return undefined;
  let best: { price: number; size: number } | undefined;
  for (const lvl of levels) {
    if (!Number.isFinite(lvl.price) || lvl.price <= 1.005) continue;
    if (!Number.isFinite(lvl.size) || lvl.size <= 0) continue;
    if (!best || lvl.price > best.price) best = lvl;
  }
  return best;
}

function pickBestLay(levels?: Array<{ price: number; size: number }>): { price: number; size: number } | undefined {
  if (!levels || levels.length === 0) return undefined;
  let best: { price: number; size: number } | undefined;
  for (const lvl of levels) {
    if (!Number.isFinite(lvl.price) || lvl.price <= 1.005) continue;
    if (!Number.isFinite(lvl.size) || lvl.size <= 0) continue;
    if (!best || lvl.price < best.price) best = lvl;
  }
  return best;
}

function sportFromEventTypeId(eventTypeId: number): SportKey | null {
  if (eventTypeId === 1) return 'football';
  if (eventTypeId === 2) return 'tennis';
  if (eventTypeId === 7522) return 'basketball';
  return null;
}

function parseBetfairEroMarkets(params: {
  ero: BetfairEroResponse;
  includeLive: boolean;
  nowMs: number;
  cacheAgeSec: number;
  eventCompMap?: Map<number, string>;
  dateWindow?: TargetedScrapeFilter['dateWindow'];
  forcedSport?: SportKey;
}): RawScrapedMarket[] {
  const { ero, includeLive, nowMs, cacheAgeSec, eventCompMap, dateWindow, forcedSport } = params;
  const markets: RawScrapedMarket[] = [];
  const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);

  for (const et of ero.eventTypes ?? []) {
    const sport = forcedSport ?? sportFromEventTypeId(et.eventTypeId);
    if (!sport) continue;

    for (const evNode of et.eventNodes ?? []) {
      const evName = evNode.event?.eventName ?? '';
      const teams = splitEventTeams(evName);
      if (!teams) continue;
      const [homeTeam, awayTeam] = teams;
      const league =
        eventCompMap?.get(evNode.eventId) ??
        (sport === 'football'
          ? 'Calcio'
          : sport === 'tennis'
          ? 'Tennis ATP/WTA'
          : 'Basket');

      for (const mn of evNode.marketNodes ?? []) {
        if (mn.state?.status && mn.state.status !== 'OPEN') continue;
        if (!includeLive && mn.state?.inplay) continue;

        const startTime = mn.description?.marketTime ?? evNode.event.openDate;
        if (!includeLive && new Date(startTime).getTime() < nowMs - 60_000) continue;
        if (dateWindow && !matchesScrapeDateWindow(startTime, dateWindow)) continue;

        const mapped = mapBetfairMarket(sport, mn.description?.marketType ?? '');
        if (!mapped) continue;

        const sortedRunners = [...(mn.runners ?? [])].sort((a, b) => {
          const pa = a.state?.sortPriority ?? a.description?.sortPriority ?? 999;
          const pb = b.state?.sortPriority ?? b.description?.sortPriority ?? 999;
          return pa - pb;
        });

        const selections: SelectionQuote[] = [];
        const usedKeys = new Set<string>();
        sortedRunners.forEach((rn, idx) => {
          if (rn.state?.status && rn.state.status !== 'ACTIVE') return;
          const name = rn.description?.runnerName ?? '';
          const keyInfo = mapRunnerCanonicalKey(
            sport,
            mapped.marketType,
            name,
            idx,
            homeTeam,
            awayTeam
          );
          if (!keyInfo || usedKeys.has(keyInfo.key)) return;

          const bestBack = pickBestBack(rn.exchange?.availableToBack);
          const bestLay = pickBestLay(rn.exchange?.availableToLay);
          if (!bestLay && !bestBack) return;

          usedKeys.add(keyInfo.key);
          selections.push({
            canonicalKey: keyInfo.key,
            label: keyInfo.label,
            backOdds: bestBack?.price,
            backLiquidity: bestBack?.size,
            layOdds: bestLay?.price,
            layLiquidity: bestLay?.size,
          });
        });

        if (selections.length >= 2) {
          markets.push({
            sourceId: 'betfair_exchange',
            sourceName: 'Betfair Exchange IT',
            sourceKind: 'exchange',
            sport,
            league,
            eventId: String(evNode.eventId),
            sourceMarketId: mn.marketId,
            eventName: `${homeTeam} - ${awayTeam}`,
            homeTeam,
            awayTeam,
            startTime,
            marketType: mapped.marketType,
            marketLabel: mapped.marketLabel,
            selections,
            eventUrl: `https://www.betfair.it/exchange/plus/it/market/${mn.marketId}`,
            scrapedAt,
            cacheAgeSec,
          });
        }
      }
    }
  }

  return markets;
}

const SPORT_CONFIGS: Array<{
  sport: SportKey;
  eventTypeId: number;
  marketTypeCodes: string[];
  maxResults: number;
}> = [
  {
    sport: 'football',
    eventTypeId: 1,
    marketTypeCodes: ['MATCH_ODDS', 'OVER_UNDER_25', 'BOTH_TEAMS_TO_SCORE'],
    maxResults: 120,
  },
  {
    sport: 'tennis',
    eventTypeId: 2,
    marketTypeCodes: ['MATCH_ODDS'],
    maxResults: 45,
  },
  {
    sport: 'basketball',
    eventTypeId: 7522,
    marketTypeCodes: ['MATCH_ODDS', 'MONEY_LINE'],
    maxResults: 45,
  },
];

export async function scrapeBetfairExchange(
  includeLive: boolean,
  filter?: TargetedScrapeFilter,
  signal?: AbortSignal
): Promise<{
  markets: RawScrapedMarket[];
  latencyMs: number;
}> {
  const started = Date.now();
  const markets: RawScrapedMarket[] = [];
  const nowMs = Date.now();
  let succeededSports = 0;
  let lastErr: unknown = null;

  const dateWindow = filter?.dateWindow;
  const windowAfterMs = dateWindow
    ? includeLive
      ? dateWindow.startMs
      : Math.max(nowMs, dateWindow.startMs)
    : null;
  if (dateWindow && windowAfterMs !== null && windowAfterMs > dateWindow.endMs) {
    return { markets, latencyMs: Date.now() - started };
  }

  const targetSports =
    filter?.sports && filter.sports.length > 0
      ? SPORT_CONFIGS.filter((sc) => filter.sports!.includes(sc.sport))
      : SPORT_CONFIGS;

  for (const sc of targetSports) {
    throwIfAborted(signal);
    try {
      const scanPayload = {
        filter: {
          marketBettingTypes: ['ODDS'],
          productTypes: ['EXCHANGE'],
          marketTypeCodes: sc.marketTypeCodes,
          selectBy: 'MAXIMUM_TRADED',
          contentGroup: { language: 'it', regionCode: 'UK' },
          ...(dateWindow && windowAfterMs !== null
            ? {
                marketStartingAfter: new Date(windowAfterMs).toISOString(),
                marketStartingBefore: new Date(dateWindow.endMs).toISOString(),
              }
            : includeLive
            ? {}
            : { marketStartingAfter: new Date(nowMs).toISOString() }),
          maxResults: sc.maxResults,
          eventTypeIds: [sc.eventTypeId],
        },
        facets: [
          { type: 'EVENT', maxValues: sc.maxResults },
          { type: 'COMPETITION', maxValues: 150 },
        ],
        currencyCode: 'EUR',
        locale: 'it',
      };

      const { data: scan } = await fetchJson<BetfairScanResponse>(SCAN_URL, {
        method: 'POST',
        body: scanPayload,
        timeoutMs: 12000,
        signal,
      });

      const compById = new Map<number, string>();
      if (scan.attachments?.competitions) {
        for (const c of Object.values(scan.attachments.competitions)) {
          if (c.competitionId && c.name) compById.set(c.competitionId, c.name);
        }
      }

      const scanEvents = scan.attachments?.events ?? {};
      const eventCompMap = new Map<number, string>();
      const marketIds: string[] = [];
      for (const r of scan.results ?? []) {
        if (r.eventId !== undefined) {
          const evMeta = scanEvents[String(r.eventId)];
          if (
            dateWindow &&
            evMeta?.openDate &&
            !matchesScrapeDateWindow(evMeta.openDate, dateWindow)
          ) {
            continue;
          }
          if (
            filter?.eventHints?.length &&
            evMeta?.name &&
            !matchesEventHints(evMeta.name, '', '', sc.sport, filter.eventHints)
          ) {
            continue;
          }
        }
        if (r.marketId) marketIds.push(r.marketId);
        if (r.eventId && r.competitionId && compById.has(r.competitionId)) {
          eventCompMap.set(r.eventId, compById.get(r.competitionId)!);
        }
      }

      // Fetch ERO prices in batches of 20 (stays safely under Betfair ERO TOO_MUCH_DATA weight limit with RUNNER_STATE)
      const batchSize = 20;
      for (let i = 0; i < marketIds.length; i += batchSize) {
        throwIfAborted(signal);
        const batch = marketIds.slice(i, i + batchSize);
        const eroUrl = `${ERO_BASE}&marketIds=${batch.join(',')}`;
        const { data: ero, cacheAgeSec } = await fetchJson<BetfairEroResponse>(eroUrl, {
          timeoutMs: 12000,
          signal,
        });

        markets.push(
          ...parseBetfairEroMarkets({
            ero,
            includeLive,
            nowMs,
            cacheAgeSec,
            eventCompMap,
            dateWindow,
            forcedSport: sc.sport,
          })
        );
        if (i + batchSize < marketIds.length) {
          await sleep(60, signal);
        }
      }
      succeededSports++;
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      lastErr = err;
    }
  }

  if (succeededSports === 0 && lastErr) {
    throw lastErr;
  }

  return { markets, latencyMs: Date.now() - started };
}

/**
 * Ultra-fast batch or single-market live price refresh on Betfair Exchange ERO (~150-300ms).
 * Used both for end-of-cycle freshness resync and on-demand single-row live verification.
 */
export async function refreshBetfairExchangeMarkets(params: {
  marketIds: string[];
  includeLive: boolean;
  signal?: AbortSignal;
}): Promise<{
  marketsByMarketId: Map<string, RawScrapedMarket>;
  latencyMs: number;
  cacheAgeSec: number;
}> {
  const started = Date.now();
  const uniqueIds = Array.from(new Set(params.marketIds.filter(Boolean)));
  const marketsByMarketId = new Map<string, RawScrapedMarket>();
  if (uniqueIds.length === 0) {
    return { marketsByMarketId, latencyMs: 0, cacheAgeSec: 0 };
  }

  const nowMs = Date.now();
  let maxCacheAgeSec = 0;
  const batches: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += 20) {
    batches.push(uniqueIds.slice(i, i + 20));
  }

  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      throwIfAborted(params.signal);
      const eroUrl = `${ERO_BASE}&marketIds=${batch.join(',')}`;
      const { data: ero, cacheAgeSec } = await fetchJson<BetfairEroResponse>(eroUrl, {
        timeoutMs: 7000,
        retries: 0,
        signal: params.signal,
      });
      maxCacheAgeSec = Math.max(maxCacheAgeSec, cacheAgeSec);
      return parseBetfairEroMarkets({
        ero,
        includeLive: params.includeLive,
        nowMs,
        cacheAgeSec,
      });
    })
  );

  for (const res of results) {
    if (res.status === 'fulfilled') {
      for (const m of res.value) {
        if (m.sourceMarketId) {
          marketsByMarketId.set(m.sourceMarketId, m);
        }
      }
    } else if (params.signal?.aborted || isAbortError(res.reason)) {
      throw res.reason;
    }
  }

  return {
    marketsByMarketId,
    latencyMs: Date.now() - started,
    cacheAgeSec: maxCacheAgeSec,
  };
}

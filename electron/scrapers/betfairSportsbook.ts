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
const SMP_URL =
  'https://smp.betfair.it/www/sports/fixedodds/readonly/v1/getMarketPrices?_ak=nzIFcwyWhrlwYMrh&alt=json';

interface SbMarketMeta {
  marketId: string;
  eventId: number;
  competitionId?: number;
  marketName?: string;
  marketTime?: string;
  marketType?: string;
  inPlay?: boolean;
  runners?: Array<{
    selectionId: number;
    runnerName: string;
    sortPriority?: number;
    runnerStatus?: string;
  }>;
}

interface SbEventMeta {
  eventId: number;
  name: string;
  openDate: string;
  competitionId?: number;
}

interface SbScanResp {
  results?: Array<{ sportsbookMarketId?: string; eventId?: number }>;
  attachments?: {
    sportsBookMarkets?: Record<string, SbMarketMeta>;
    events?: Record<string, SbEventMeta>;
    competitions?: Record<string, { competitionId?: number; name?: string }>;
  };
}

interface SmpPriceRespItem {
  marketId: string;
  marketStatus?: string;
  inplay?: boolean;
  runnerDetails?: Array<{
    selectionId: number;
    runnerStatus?: string;
    runnerOdds?: {
      decimalDisplayOdds?: { decimalOdds?: number };
      trueOdds?: { decimalOdds?: { decimalOdds?: number } };
    };
  }>;
}

function splitEventTeams(eventName: string): [string, string] | null {
  for (const sep of [' - ', ' v ', ' vs ', ' @ ']) {
    const idx = eventName.indexOf(sep);
    if (idx > 0) {
      return [eventName.slice(0, idx).trim(), eventName.slice(idx + sep.length).trim()];
    }
  }
  return null;
}

function mapSbMarket(
  sport: SportKey,
  mType: string
): { marketType: MarketType; marketLabel: string } | null {
  if (sport === 'football') {
    if (mType === 'MATCH_ODDS' || mType === 'WIN-DRAW-WIN')
      return { marketType: '1X2', marketLabel: 'Esito Finale 1X2' };
    if (mType === 'OVER_UNDER_25')
      return { marketType: 'OVER_UNDER_25', marketLabel: 'Under/Over 2.5 Gol' };
    if (mType === 'BOTH_TEAMS_TO_SCORE')
      return { marketType: 'BTTS', marketLabel: 'Goal / NoGoal' };
    return null;
  }
  if (mType === 'MATCH_ODDS' || mType === 'MONEY_LINE') {
    return { marketType: 'H2H', marketLabel: 'Testa a Testa' };
  }
  return null;
}

function mapRunner(
  sport: SportKey,
  marketType: MarketType,
  runnerName: string,
  idx: number,
  home: string,
  away: string
): { key: string; label: string } | null {
  const rn = runnerName.trim();
  const low = rn.toLowerCase();
  if (marketType === '1X2') {
    if (low === 'pareggio' || low === 'draw' || low === 'the draw' || low === 'x') {
      return { key: 'DRAW', label: 'Pareggio (X)' };
    }
    if (low === home.toLowerCase()) return { key: 'HOME', label: `${home} (1)` };
    if (low === away.toLowerCase()) return { key: 'AWAY', label: `${away} (2)` };
    const simH = teamSimilarity(rn, home, sport);
    const simA = teamSimilarity(rn, away, sport);
    if (simH >= 0.65 && simH > simA + 0.08) return { key: 'HOME', label: `${home} (1)` };
    if (simA >= 0.65 && simA > simH + 0.08) return { key: 'AWAY', label: `${away} (2)` };
    if (idx === 0) return { key: 'HOME', label: `${home} (1)` };
    if (idx === 1) return { key: 'AWAY', label: `${away} (2)` };
    return null;
  }
  if (marketType === 'H2H') {
    if (low === home.toLowerCase()) return { key: 'HOME', label: `${home} (1)` };
    if (low === away.toLowerCase()) return { key: 'AWAY', label: `${away} (2)` };
    const simH = teamSimilarity(rn, home, sport);
    const simA = teamSimilarity(rn, away, sport);
    if (simH >= 0.65 && simH > simA + 0.08) return { key: 'HOME', label: `${home} (1)` };
    if (simA >= 0.65 && simA > simH + 0.08) return { key: 'AWAY', label: `${away} (2)` };
    if (idx === 0) return { key: 'HOME', label: `${home} (1)` };
    if (idx === 1) return { key: 'AWAY', label: `${away} (2)` };
    return null;
  }
  if (marketType === 'OVER_UNDER_25') {
    if (low.includes('over') || low.includes('più') || low.includes('piu'))
      return { key: 'OVER_25', label: 'Over 2.5' };
    if (low.includes('under') || low.includes('meno'))
      return { key: 'UNDER_25', label: 'Under 2.5' };
    return null;
  }
  if (marketType === 'BTTS') {
    if (low === 'sì' || low === 'si' || low === 'yes' || low === 'goal')
      return { key: 'BTTS_YES', label: 'Goal (Sì)' };
    if (low === 'no' || low === 'nogoal' || low === 'no goal')
      return { key: 'BTTS_NO', label: 'NoGoal (No)' };
    return null;
  }
  return null;
}

const SPORT_SPECS: Array<{
  sport: SportKey;
  eventTypeId: number;
  marketTypeCodes: string[];
  maxResults: number;
}> = [
  {
    sport: 'football',
    eventTypeId: 1,
    marketTypeCodes: ['MATCH_ODDS', 'OVER_UNDER_25', 'BOTH_TEAMS_TO_SCORE'],
    maxResults: 110,
  },
  {
    sport: 'tennis',
    eventTypeId: 2,
    marketTypeCodes: ['MATCH_ODDS'],
    maxResults: 40,
  },
  {
    sport: 'basketball',
    eventTypeId: 7522,
    marketTypeCodes: ['MATCH_ODDS', 'MONEY_LINE'],
    maxResults: 40,
  },
];

export async function scrapeBetfairSportsbook(
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
  const nowIso = new Date(nowMs).toISOString();
  const dateWindow = filter?.dateWindow;
  const windowAfterMs = dateWindow
    ? includeLive
      ? dateWindow.startMs
      : Math.max(nowMs, dateWindow.startMs)
    : null;
  if (dateWindow && windowAfterMs !== null && windowAfterMs > dateWindow.endMs) {
    return { markets, latencyMs: Date.now() - started };
  }
  let succeededSports = 0;
  let lastErr: unknown = null;

  const targetSpecs =
    filter?.sports && filter.sports.length > 0
      ? SPORT_SPECS.filter((sp) => filter.sports!.includes(sp.sport))
      : SPORT_SPECS;

  for (const sp of targetSpecs) {
    throwIfAborted(signal);
    try {
      const payload = {
        filter: {
          productTypes: ['SPORTSBOOK'],
          marketTypeCodes: sp.marketTypeCodes,
          contentGroup: { language: 'it', regionCode: 'UK' },
          ...(dateWindow && windowAfterMs !== null
            ? {
                marketStartingAfter: new Date(windowAfterMs).toISOString(),
                marketStartingBefore: new Date(dateWindow.endMs).toISOString(),
              }
            : includeLive
            ? {}
            : { marketStartingAfter: nowIso }),
          maxResults: sp.maxResults,
          eventTypeIds: [sp.eventTypeId],
        },
        facets: [
          { type: 'EVENT', maxValues: sp.maxResults },
          { type: 'COMPETITION', maxValues: 150 },
          { type: 'MARKET', maxValues: sp.maxResults },
        ],
        currencyCode: 'EUR',
        locale: 'it',
      };

      const { data: scan } = await fetchJson<SbScanResp>(SCAN_URL, {
        method: 'POST',
        body: payload,
        timeoutMs: 12000,
        signal,
      });

      const sbMarkets = scan.attachments?.sportsBookMarkets ?? {};
      const eventsMap = scan.attachments?.events ?? {};
      const compsMap = scan.attachments?.competitions ?? {};

      const marketIds = Object.values(sbMarkets)
        .filter((m) => {
          if (!includeLive && m.inPlay) return false;
          const ev = eventsMap[String(m.eventId)];
          const startTime = m.marketTime ?? ev?.openDate;
          if (dateWindow && startTime && !matchesScrapeDateWindow(startTime, dateWindow)) {
            return false;
          }
          if (filter?.eventHints?.length) {
            if (ev?.name && !matchesEventHints(ev.name, '', '', sp.sport, filter.eventHints)) {
              return false;
            }
          }
          return true;
        })
        .map((m) => m.marketId);

      // Fetch fixed-odds prices in chunks of 40
      const priceMap = new Map<string, { item: SmpPriceRespItem; cacheAgeSec: number }>();
      for (let i = 0; i < marketIds.length; i += 40) {
        throwIfAborted(signal);
        const chunk = marketIds.slice(i, i + 40);
        const { data: prices, cacheAgeSec } = await fetchJson<SmpPriceRespItem[]>(SMP_URL, {
          method: 'POST',
          body: { marketIds: chunk, currencyCode: 'EUR' },
          timeoutMs: 12000,
          signal,
        });
        for (const p of prices ?? []) {
          priceMap.set(p.marketId, { item: p, cacheAgeSec });
        }
        if (i + 40 < marketIds.length) await sleep(100, signal);
      }

      for (const m of Object.values(sbMarkets)) {
        if (!includeLive && m.inPlay) continue;
        const mapped = mapSbMarket(sp.sport, m.marketType ?? '');
        if (!mapped) continue;

        const ev = eventsMap[String(m.eventId)];
        if (!ev) continue;
        const startTime = m.marketTime ?? ev.openDate;
        if (!includeLive && new Date(startTime).getTime() < nowMs - 60_000) continue;
        const teams = splitEventTeams(ev.name);
        if (!teams) continue;
        const [homeTeam, awayTeam] = teams;

        const priceEntry = priceMap.get(m.marketId);
        if (!priceEntry) continue;
        const priceObj = priceEntry.item;
        if (priceObj.marketStatus && priceObj.marketStatus !== 'OPEN') continue;
        if (!includeLive && priceObj.inplay) continue;

        const oddsBySel = new Map<number, number>();
        for (const rd of priceObj.runnerDetails ?? []) {
          if (rd.runnerStatus && rd.runnerStatus !== 'ACTIVE') continue;
          const dec =
            rd.runnerOdds?.decimalDisplayOdds?.decimalOdds ??
            rd.runnerOdds?.trueOdds?.decimalOdds?.decimalOdds;
          if (dec && dec > 1.005) {
            oddsBySel.set(rd.selectionId, Math.round(dec * 100) / 100);
          }
        }

        const selections: SelectionQuote[] = [];
        const selectionMeta: Record<string, string> = {};
        const usedKeys = new Set<string>();
        const sortedRunners = [...(m.runners ?? [])].sort(
          (a, b) => (a.sortPriority ?? 0) - (b.sortPriority ?? 0)
        );
        sortedRunners.forEach((rn, idx) => {
          if (rn.runnerStatus && rn.runnerStatus !== 'ACTIVE') return;
          const backOdds = oddsBySel.get(rn.selectionId);
          if (!backOdds) return;
          const mappedRunner = mapRunner(
            sp.sport,
            mapped.marketType,
            rn.runnerName,
            idx,
            homeTeam,
            awayTeam
          );
          if (!mappedRunner || usedKeys.has(mappedRunner.key)) return;
          usedKeys.add(mappedRunner.key);
          selectionMeta[`sel_${mappedRunner.key}`] = String(rn.selectionId);
          selections.push({
            canonicalKey: mappedRunner.key,
            label: mappedRunner.label,
            backOdds,
          });
        });

        if (selections.length >= 2) {
          const compName =
            compsMap[String(m.competitionId ?? ev.competitionId ?? '')]?.name ??
            (sp.sport === 'football' ? 'Calcio' : sp.sport === 'tennis' ? 'Tennis' : 'Basket');

          markets.push({
            sourceId: 'betfair_sportsbook',
            sourceName: 'Betfair Sportsbook IT',
            sourceKind: 'bookmaker',
            sport: sp.sport,
            league: compName,
            eventId: String(ev.eventId),
            sourceMarketId: m.marketId,
            sourceMetadata: selectionMeta,
            eventName: `${homeTeam} - ${awayTeam}`,
            homeTeam,
            awayTeam,
            startTime,
            marketType: mapped.marketType,
            marketLabel: mapped.marketLabel,
            selections,
            eventUrl: `https://www.betfair.it/sport/`,
            scrapedAt: computeEffectiveScrapedAt(Date.now(), priceEntry.cacheAgeSec),
            cacheAgeSec: priceEntry.cacheAgeSec,
          });
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
 * Ultra-fast (~150ms) single-market live verification on Betfair Sportsbook SMP.
 */
export async function verifyBetfairSportsbookMarket(params: {
  marketId: string;
  selectionIdsByKey: Record<string, string>;
  includeLive: boolean;
  signal?: AbortSignal;
}): Promise<{
  isOpen: boolean;
  oddsByKey: Record<string, number>;
  latencyMs: number;
  cacheAgeSec: number;
}> {
  const started = Date.now();
  const { data: prices, cacheAgeSec } = await fetchJson<SmpPriceRespItem[]>(SMP_URL, {
    method: 'POST',
    body: { marketIds: [params.marketId], currencyCode: 'EUR' },
    timeoutMs: 7000,
    retries: 0,
    signal: params.signal,
  });

  const item = (prices ?? []).find((p) => p.marketId === params.marketId);
  if (!item) {
    return { isOpen: false, oddsByKey: {}, latencyMs: Date.now() - started, cacheAgeSec };
  }
  if (item.marketStatus && item.marketStatus !== 'OPEN') {
    return { isOpen: false, oddsByKey: {}, latencyMs: Date.now() - started, cacheAgeSec };
  }
  if (!params.includeLive && item.inplay) {
    return { isOpen: false, oddsByKey: {}, latencyMs: Date.now() - started, cacheAgeSec };
  }

  const selById = new Map<string, number>();
  for (const rd of item.runnerDetails ?? []) {
    if (rd.runnerStatus && rd.runnerStatus !== 'ACTIVE') continue;
    const dec =
      rd.runnerOdds?.decimalDisplayOdds?.decimalOdds ??
      rd.runnerOdds?.trueOdds?.decimalOdds?.decimalOdds;
    if (dec && dec > 1.005) {
      selById.set(String(rd.selectionId), Math.round(dec * 100) / 100);
    }
  }

  const oddsByKey: Record<string, number> = {};
  for (const [k, selId] of Object.entries(params.selectionIdsByKey)) {
    const key = k.startsWith('sel_') ? k.slice(4) : k;
    const val = selById.get(selId);
    if (val) oddsByKey[key] = val;
  }

  return {
    isOpen: true,
    oddsByKey,
    latencyMs: Date.now() - started,
    cacheAgeSec,
  };
}

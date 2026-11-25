import {
  getDirettaDayOffsetsForWindow,
  matchesScrapeDateWindow,
} from '../../src/shared/dateRange';
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
  DEFAULT_HEADERS,
  fetchJson,
  fetchText,
  isAbortError,
  throwIfAborted,
} from './httpClient';
import { matchesEventHints, teamSimilarity } from './matchLinker';

const FEED_BASE = 'https://400.flashscore.ninja/400/x/feed';
const GQL_BASE = 'https://global.ds.lsapp.eu/odds/pq_graphql';

const DIRETTA_HEADERS: Record<string, string> = {
  ...DEFAULT_HEADERS,
  Origin: 'https://www.diretta.it',
  Referer: 'https://www.diretta.it/',
  'x-fsign': 'SW9D1eZo',
};

export interface AdmBookmakerSpec {
  sourceId: SourceId;
  bookmakerId: number;
  name: string;
  url: string;
}

export const ITALIAN_ADM_BOOKMAKERS: AdmBookmakerSpec[] = [
  {
    sourceId: 'sisal_it',
    bookmakerId: 159,
    name: 'Sisal.it',
    url: 'https://www.sisal.it/scommesse-matchpoint',
  },
  {
    sourceId: 'snai_it',
    bookmakerId: 199,
    name: 'SNAI.it',
    url: 'https://www.snai.it/sport',
  },
  {
    sourceId: 'betflag_it',
    bookmakerId: 823,
    name: 'Betflag.it',
    url: 'https://www.betflag.it/sport',
  },
  {
    sourceId: 'eurobet_it',
    bookmakerId: 322,
    name: 'Eurobet.it',
    url: 'https://www.eurobet.it/it/scommesse/',
  },
  {
    sourceId: 'goldbet_it',
    bookmakerId: 188,
    name: 'GoldBet.it',
    url: 'https://www.goldbet.it/scommesse/sport',
  },
  {
    sourceId: 'lottomatica_it',
    bookmakerId: 335,
    name: 'Lottomatica.it',
    url: 'https://www.lottomatica.it/scommesse',
  },
  {
    sourceId: 'planetwin365_it',
    bookmakerId: 467,
    name: 'Planetwin365.it',
    url: 'https://www.planetwin365.it/it/scommesse',
  },
  {
    sourceId: 'bet365_it',
    bookmakerId: 419,
    name: 'bet365.it',
    url: 'https://www.bet365.it/',
  },
  {
    sourceId: 'betsson_it',
    bookmakerId: 773,
    name: 'Betsson.it',
    url: 'https://www.betsson.it/scommesse',
  },
  {
    sourceId: 'domusbet_it',
    bookmakerId: 548,
    name: 'DomusBet.it',
    url: 'https://www.domusbet.it/scommesse',
  },
  {
    sourceId: 'daznbet_it',
    bookmakerId: 1185,
    name: 'DAZN Bet.it',
    url: 'https://www.daznbet.it/scommesse',
  },
  {
    sourceId: 'williamhill_it',
    bookmakerId: 372,
    name: 'WilliamHill.it',
    url: 'https://sports.williamhill.it/',
  },
];

interface ScheduledDirettaEvent {
  eventId: string;
  sport: SportKey;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeParticipantId: string;
  awayParticipantId: string;
  startMs: number;
  startTime: string;
  isLive: boolean;
}

interface DirettaOddsItem {
  eventParticipantId: string | null;
  value: string;
  active: boolean;
  handicap: { value: string } | null;
  selection: string | null;
  bothTeamsToScore: boolean | null;
  result?: string | null;
}

interface DirettaEventOddsBlock {
  bookmakerId: number;
  bettingType: string;
  bettingScope: string;
  odds: DirettaOddsItem[];
}

interface DirettaGraphQLResp {
  data?: {
    findOddsByEventId?: {
      odds?: DirettaEventOddsBlock[];
    };
  };
}

async function fetchFeedText(url: string, signal?: AbortSignal): Promise<string> {
  return fetchText(appendCacheBuster(url), {
    headers: DIRETTA_HEADERS,
    noCacheHeaders: true,
    timeoutMs: 11000,
    signal,
  });
}

function parseDirettaSchedule(
  raw: string,
  sport: SportKey,
  includeLive: boolean
): ScheduledDirettaEvent[] {
  const events: ScheduledDirettaEvent[] = [];
  const blocks = raw.split('~');
  let currentLeague =
    sport === 'football' ? 'Calcio' : sport === 'tennis' ? 'Tennis' : 'Basket';

  for (const block of blocks) {
    if (block.startsWith('ZA÷')) {
      const m = block.match(/ZA÷([^¬]+)/);
      if (m) currentLeague = m[1].trim();
      continue;
    }
    if (!block.startsWith('AA÷')) continue;

    const fields: Record<string, string> = {};
    const parts = block.split('¬');
    for (const p of parts) {
      const sep = p.indexOf('÷');
      if (sep > 0) {
        fields[p.slice(0, sep)] = p.slice(sep + 1);
      }
    }

    const status = fields['AB']; // 1 = prematch, 2 = live, 3 = finished
    if (status !== '1' && !(includeLive && status === '2')) continue;

    const eventId = fields['AA'];
    const tsSec = Number(fields['AD']);
    const homeTeam = (fields['AE'] ?? '').trim();
    const awayTeam = (fields['AF'] ?? '').trim();
    const homeParticipantId = fields['JA'] ?? '';
    const awayParticipantId = fields['JB'] ?? '';

    if (!eventId || !homeTeam || !awayTeam || !Number.isFinite(tsSec) || tsSec <= 0) continue;

    const startMs = tsSec * 1000;
    events.push({
      eventId,
      sport,
      league: currentLeague,
      homeTeam,
      awayTeam,
      homeParticipantId,
      awayParticipantId,
      startMs,
      startTime: new Date(startMs).toISOString(),
      isLive: status === '2',
    });
  }

  return events;
}

/**
 * Matches Diretta scheduled events against live Exchange events so we fetch
 * Sisal / SNAI / Betflag / Eurobet / GoldBet odds specifically for liquid, matchable events
 * (plus top Italian/European leagues as fallback if Exchanges returned few events).
 */
function selectTargetDirettaEvents(
  schedule: ScheduledDirettaEvent[],
  exchangeMarkets: RawScrapedMarket[],
  maxEvents = 135
): ScheduledDirettaEvent[] {
  // Deduplicate unique exchange events by sport + eventId
  const exEventsBySport = new Map<
    SportKey,
    Array<{ home: string; away: string; startMs: number }>
  >();
  const seenEx = new Set<string>();

  for (const em of exchangeMarkets) {
    const k = `${em.sport}:${em.sourceId}:${em.eventId}`;
    if (seenEx.has(k)) continue;
    seenEx.add(k);
    const startMs = new Date(em.startTime).getTime();
    if (!Number.isFinite(startMs)) continue;
    const arr = exEventsBySport.get(em.sport) ?? [];
    arr.push({ home: em.homeTeam, away: em.awayTeam, startMs });
    exEventsBySport.set(em.sport, arr);
  }

  const TIME_WIN = 95 * 60 * 1000;
  const matched: ScheduledDirettaEvent[] = [];
  const matchedIds = new Set<string>();

  for (const ev of schedule) {
    const exList = exEventsBySport.get(ev.sport);
    if (!exList || exList.length === 0) continue;

    let hit = false;
    for (const ex of exList) {
      if (Math.abs(ex.startMs - ev.startMs) > TIME_WIN) continue;
      const sh = teamSimilarity(ev.homeTeam, ex.home, ev.sport);
      const sa = teamSimilarity(ev.awayTeam, ex.away, ev.sport);
      if ((sh + sa) / 2 >= 0.76 && Math.min(sh, sa) >= 0.62) {
        hit = true;
        break;
      }
      const shSw = teamSimilarity(ev.homeTeam, ex.away, ev.sport);
      const saSw = teamSimilarity(ev.awayTeam, ex.home, ev.sport);
      if ((shSw + saSw) / 2 >= 0.8 && Math.min(shSw, saSw) >= 0.68) {
        hit = true;
        break;
      }
    }

    if (hit && !matchedIds.has(ev.eventId)) {
      matchedIds.add(ev.eventId);
      matched.push(ev);
      if (matched.length >= maxEvents) break;
    }
  }

  // If fewer than target matched (e.g., quiet night or future window), supplement with top leagues for Dutcher coverage
  const minSupplementFloor = maxEvents >= 145 ? 55 : 35;
  const maxSupplementCap = maxEvents >= 145 ? 80 : 60;
  if (matched.length < minSupplementFloor) {
    const primaryTopLeagueRe =
      /^(?:ITALIA:\s*Serie [AB]|INGHILTERRA:\s*(?:Premier League|Championship)|SPAGNA:\s*LaLiga|GERMANIA:\s*Bundesliga|FRANCIA:\s*Ligue 1|OLANDA:\s*Eredivisie|PORTOGALLO:\s*Liga|EUROPA:\s*(?:Champions|Europa|Conference)|ATP|WTA|USA:\s*NBA|EUROPA:\s*Eurolega)/i;
    const secondaryTopLeagueRe =
      /Serie A|Serie B|Premier League|LaLiga|Bundesliga|Ligue 1|Champions|Europa|ATP|WTA|NBA|Eurolega/i;

    for (const re of [primaryTopLeagueRe, secondaryTopLeagueRe]) {
      for (const ev of schedule) {
        if (matched.length >= maxSupplementCap) break;
        if (matchedIds.has(ev.eventId)) continue;
        if (re.test(ev.league)) {
          matchedIds.add(ev.eventId);
          matched.push(ev);
        }
      }
      if (matched.length >= maxSupplementCap) break;
    }
  }

  return matched;
}

function parseOddNum(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 1.005 || n > 500) return null;
  return Math.round(n * 100) / 100;
}

function extractMarketsFromOddsResponse(
  ev: ScheduledDirettaEvent,
  blocks: DirettaEventOddsBlock[],
  activeSpecsByBookmakerId: Map<number, AdmBookmakerSpec>,
  outBySource: Map<SourceId, RawScrapedMarket[]>,
  cacheAgeSec = 0
) {
  // Prioritize FULL_TIME_OVER_TIME / FULL_TIME_INCLUDING_OVERTIME over FULL_TIME for basketball H2H
  const orderedBlocks =
    ev.sport === 'basketball'
      ? [...blocks].sort((a, b) => {
          const rank = (scope: string) =>
            scope === 'FULL_TIME_OVER_TIME' || scope === 'FULL_TIME_INCLUDING_OVERTIME'
              ? 0
              : scope === 'FULL_TIME'
              ? 1
              : 2;
          return rank(a.bettingScope) - rank(b.bettingScope);
        })
      : blocks;

  const effectiveScrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);

  for (const blk of orderedBlocks) {
    const spec = activeSpecsByBookmakerId.get(blk.bookmakerId);
    if (!spec) continue;

    const activeItems = (blk.odds ?? []).filter(
      (o) => o.active !== false && (!o.result || o.result === 'NONE')
    );
    if (activeItems.length < 2) continue;

    let marketType: MarketType | null = null;
    let marketLabel = '';
    const selections: SelectionQuote[] = [];

    if (
      ev.sport === 'football' &&
      blk.bettingType === 'HOME_DRAW_AWAY' &&
      blk.bettingScope === 'FULL_TIME'
    ) {
      marketType = '1X2';
      marketLabel = 'Esito Finale 1X2';
      for (const item of activeItems) {
        const dec = parseOddNum(item.value);
        if (!dec) continue;
        if (item.eventParticipantId === ev.homeParticipantId) {
          selections.push({ canonicalKey: 'HOME', label: `${ev.homeTeam} (1)`, backOdds: dec });
        } else if (item.eventParticipantId === ev.awayParticipantId) {
          selections.push({ canonicalKey: 'AWAY', label: `${ev.awayTeam} (2)`, backOdds: dec });
        } else if (item.eventParticipantId === null) {
          selections.push({ canonicalKey: 'DRAW', label: 'Pareggio (X)', backOdds: dec });
        }
      }
      if (selections.length !== 3) continue;
    } else if (
      ev.sport === 'football' &&
      blk.bettingType === 'OVER_UNDER' &&
      blk.bettingScope === 'FULL_TIME'
    ) {
      marketType = 'OVER_UNDER_25';
      marketLabel = 'Under/Over 2.5 Gol';
      for (const item of activeItems) {
        const hVal = Number.parseFloat(item.handicap?.value ?? '');
        if (!Number.isFinite(hVal) || Math.abs(hVal - 2.5) > 0.001) continue;
        const dec = parseOddNum(item.value);
        if (!dec) continue;
        if (item.selection === 'OVER') {
          selections.push({ canonicalKey: 'OVER_25', label: 'Over 2.5', backOdds: dec });
        } else if (item.selection === 'UNDER') {
          selections.push({ canonicalKey: 'UNDER_25', label: 'Under 2.5', backOdds: dec });
        }
      }
      if (selections.length !== 2) continue;
    } else if (
      ev.sport === 'football' &&
      blk.bettingType === 'BOTH_TEAMS_TO_SCORE' &&
      blk.bettingScope === 'FULL_TIME'
    ) {
      marketType = 'BTTS';
      marketLabel = 'Goal / NoGoal';
      for (const item of activeItems) {
        const dec = parseOddNum(item.value);
        if (!dec) continue;
        if (item.bothTeamsToScore === true) {
          selections.push({ canonicalKey: 'BTTS_YES', label: 'Goal (Sì)', backOdds: dec });
        } else if (item.bothTeamsToScore === false) {
          selections.push({ canonicalKey: 'BTTS_NO', label: 'NoGoal (No)', backOdds: dec });
        }
      }
      if (selections.length !== 2) continue;
    } else if (
      (ev.sport === 'tennis' || ev.sport === 'basketball') &&
      blk.bettingType === 'HOME_AWAY' &&
      (blk.bettingScope === 'FULL_TIME_OVER_TIME' ||
        blk.bettingScope === 'FULL_TIME_INCLUDING_OVERTIME' ||
        blk.bettingScope === 'FULL_TIME')
    ) {
      marketType = 'H2H';
      marketLabel = 'Testa a Testa';
      for (const item of activeItems) {
        const dec = parseOddNum(item.value);
        if (!dec) continue;
        if (item.eventParticipantId === ev.homeParticipantId) {
          selections.push({ canonicalKey: 'HOME', label: `${ev.homeTeam} (1)`, backOdds: dec });
        } else if (item.eventParticipantId === ev.awayParticipantId) {
          selections.push({ canonicalKey: 'AWAY', label: `${ev.awayTeam} (2)`, backOdds: dec });
        }
      }
      if (selections.length !== 2) continue;
    }

    if (!marketType) continue;

    const bucket = outBySource.get(spec.sourceId)!;
    // Prevent duplicate market type for same event+bookie (e.g., FULL_TIME_OVER_TIME vs FULL_TIME)
    if (bucket.some((m) => m.eventId === ev.eventId && m.marketType === marketType)) continue;

    bucket.push({
      sourceId: spec.sourceId,
      sourceName: spec.name,
      sourceKind: 'bookmaker',
      sport: ev.sport,
      league: ev.league,
      eventId: ev.eventId,
      sourceMetadata: {
        homeParticipantId: ev.homeParticipantId,
        awayParticipantId: ev.awayParticipantId,
      },
      eventName: `${ev.homeTeam} - ${ev.awayTeam}`,
      homeTeam: ev.homeTeam,
      awayTeam: ev.awayTeam,
      startTime: ev.startTime,
      marketType,
      marketLabel,
      selections,
      eventUrl: spec.url,
      scrapedAt: effectiveScrapedAt,
      cacheAgeSec,
      isAggregator: true,
    });
  }
}

const scheduleCache = new Map<string, { fetchedAt: number; events: ScheduledDirettaEvent[] }>();
const SCHEDULE_CACHE_TTL_MS = 90_000;

export async function prefetchDirettaSchedules(params: {
  includeLive: boolean;
  filter?: TargetedScrapeFilter;
  signal?: AbortSignal;
}): Promise<ScheduledDirettaEvent[]> {
  const { includeLive, filter, signal } = params;
  throwIfAborted(signal);

  const dayOffsets = getDirettaDayOffsetsForWindow(filter?.dateWindow);
  if (dayOffsets.length === 0) return [];

  const sportFeeds: Array<{ sport: SportKey; sportCode: number }> = [
    { sport: 'football', sportCode: 1 },
    { sport: 'tennis', sportCode: 2 },
    { sport: 'basketball', sportCode: 3 },
  ];
  const requestedSports =
    filter?.sports && filter.sports.length > 0
      ? sportFeeds.filter((sf) => filter.sports!.includes(sf.sport))
      : sportFeeds;

  const feedJobs: Array<{ sport: SportKey; url: string }> = [];
  for (const sf of requestedSports) {
    for (const offset of dayOffsets) {
      feedJobs.push({
        sport: sf.sport,
        url: `${FEED_BASE}/f_${sf.sportCode}_${offset}_1_it-it_1`,
      });
    }
  }

  const useScheduleCache = Boolean(filter);
  const feedResults = await Promise.allSettled(
    feedJobs.map(async (job) => {
      const cacheKey = `${job.url}:${includeLive ? 'live' : 'pre'}`;
      if (useScheduleCache) {
        const cached = scheduleCache.get(cacheKey);
        if (cached && Date.now() - cached.fetchedAt < SCHEDULE_CACHE_TTL_MS) {
          return cached.events;
        }
      }
      const text = await fetchFeedText(job.url, signal);
      const parsed = parseDirettaSchedule(text, job.sport, includeLive);
      scheduleCache.set(cacheKey, { fetchedAt: Date.now(), events: parsed });
      return parsed;
    })
  );

  throwIfAborted(signal);

  const nowMs = Date.now();
  const allScheduled: ScheduledDirettaEvent[] = [];
  const seenEvIds = new Set<string>();
  let fulfilledFeeds = 0;
  let firstFeedErr: unknown = null;
  for (const r of feedResults) {
    if (r.status === 'fulfilled') {
      fulfilledFeeds++;
      for (const ev of r.value) {
        if (!includeLive && ev.startMs < nowMs - 60_000) continue;
        if (filter?.dateWindow && !matchesScrapeDateWindow(ev.startMs, filter.dateWindow)) {
          continue;
        }
        if (!seenEvIds.has(ev.eventId)) {
          seenEvIds.add(ev.eventId);
          allScheduled.push(ev);
        }
      }
    } else if (!firstFeedErr) {
      firstFeedErr = r.reason;
    }
  }

  if (fulfilledFeeds === 0 && firstFeedErr) {
    throw firstFeedErr instanceof Error ? firstFeedErr : new Error(String(firstFeedErr));
  }

  return allScheduled;
}

export async function scrapeItalianAdmBookmakers(params: {
  exchangeMarkets: RawScrapedMarket[];
  enabledSourceIds: SourceId[];
  includeLive: boolean;
  filter?: TargetedScrapeFilter;
  prefetchedSchedule?: ScheduledDirettaEvent[];
  signal?: AbortSignal;
}): Promise<{
  marketsBySource: Map<SourceId, RawScrapedMarket[]>;
  latencyMs: number;
  scannedEvents: number;
}> {
  const started = Date.now();
  const { exchangeMarkets, enabledSourceIds, includeLive, filter, prefetchedSchedule, signal } =
    params;
  throwIfAborted(signal);

  const enabledSet = new Set(enabledSourceIds);
  const activeSpecs = ITALIAN_ADM_BOOKMAKERS.filter((s) => enabledSet.has(s.sourceId));
  const marketsBySource = new Map<SourceId, RawScrapedMarket[]>();
  for (const s of activeSpecs) marketsBySource.set(s.sourceId, []);

  if (activeSpecs.length === 0) {
    return { marketsBySource, latencyMs: 0, scannedEvents: 0 };
  }

  const activeSpecsByBkId = new Map(activeSpecs.map((s) => [s.bookmakerId, s]));

  // 1. Use prefetched Diretta schedules (started in parallel with Exchanges) or fetch now
  const allScheduled =
    prefetchedSchedule ?? (await prefetchDirettaSchedules({ includeLive, filter, signal }));
  if (allScheduled.length === 0) {
    return { marketsBySource, latencyMs: Date.now() - started, scannedEvents: 0 };
  }

  // 2. Filter directly by tracked event hints when targeted, otherwise match against Exchange events
  const targets =
    filter?.eventHints && filter.eventHints.length > 0
      ? allScheduled
          .filter((ev) =>
            matchesEventHints(
              `${ev.homeTeam} - ${ev.awayTeam}`,
              ev.homeTeam,
              ev.awayTeam,
              ev.sport,
              filter.eventHints
            )
          )
          .slice(0, 12)
      : selectTargetDirettaEvents(
          allScheduled,
          exchangeMarkets,
          filter?.dateWindow ? 150 : 140
        );

  // 3. Fetch GraphQL odds with cache-busting (_t) so edge CDN never serves stale multi-minute caches
  const CONCURRENCY = 16;
  let cursor = 0;

  const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
    while (cursor < targets.length) {
      throwIfAborted(signal);
      const idx = cursor++;
      const ev = targets[idx];
      try {
        const url = appendCacheBuster(
          `${GQL_BASE}?_hash=oce&eventId=${encodeURIComponent(
            ev.eventId
          )}&projectId=400&geoIpCode=IT&geoIpSubdivisionCode=IT`
        );
        const { data, cacheAgeSec } = await fetchJson<DirettaGraphQLResp>(url, {
          headers: DIRETTA_HEADERS,
          noCacheHeaders: true,
          timeoutMs: 9000,
          retries: 0,
          signal,
        });
        const oddsBlocks = data?.data?.findOddsByEventId?.odds ?? [];
        if (oddsBlocks.length > 0) {
          extractMarketsFromOddsResponse(
            ev,
            oddsBlocks,
            activeSpecsByBkId,
            marketsBySource,
            cacheAgeSec
          );
        }
      } catch (err) {
        if (signal?.aborted || isAbortError(err)) throw err;
        // Ignore single event timeout
      }
    }
  });

  await Promise.all(workers);
  throwIfAborted(signal);

  return {
    marketsBySource,
    latencyMs: Date.now() - started,
    scannedEvents: targets.length,
  };
}

/**
 * Ultra-fast (~150-250ms) single-event live verification for an Italian ADM bookmaker
 * via cache-busted Diretta GraphQL.
 */
export async function verifyItalianAdmEvent(params: {
  sourceId: SourceId;
  eventId: string;
  sport: SportKey;
  marketType: MarketType;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  homeParticipantId?: string;
  awayParticipantId?: string;
  signal?: AbortSignal;
}): Promise<{
  market: RawScrapedMarket | null;
  latencyMs: number;
  cacheAgeSec: number;
}> {
  const started = Date.now();
  const spec = ITALIAN_ADM_BOOKMAKERS.find((s) => s.sourceId === params.sourceId);
  if (!spec || !params.eventId) {
    return { market: null, latencyMs: 0, cacheAgeSec: 0 };
  }

  let homeParticipantId = params.homeParticipantId ?? '';
  let awayParticipantId = params.awayParticipantId ?? '';

  // Recover participant IDs from recent schedule cache if missing (e.g. legacy row)
  if (!homeParticipantId || !awayParticipantId) {
    for (const entry of scheduleCache.values()) {
      const found = entry.events.find((e) => e.eventId === params.eventId);
      if (found) {
        homeParticipantId = found.homeParticipantId;
        awayParticipantId = found.awayParticipantId;
        break;
      }
    }
  }

  const url = appendCacheBuster(
    `${GQL_BASE}?_hash=oce&eventId=${encodeURIComponent(
      params.eventId
    )}&projectId=400&geoIpCode=IT&geoIpSubdivisionCode=IT`
  );
  const { data, cacheAgeSec } = await fetchJson<DirettaGraphQLResp>(url, {
    headers: DIRETTA_HEADERS,
    noCacheHeaders: true,
    timeoutMs: 7000,
    retries: 0,
    signal: params.signal,
  });

  const blocks = data?.data?.findOddsByEventId?.odds ?? [];
  const outBySource = new Map<SourceId, RawScrapedMarket[]>([[spec.sourceId, []]]);
  const activeSpecsByBkId = new Map<number, AdmBookmakerSpec>([[spec.bookmakerId, spec]]);
  const ev: ScheduledDirettaEvent = {
    eventId: params.eventId,
    sport: params.sport,
    league: '',
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    homeParticipantId,
    awayParticipantId,
    startMs: Date.parse(params.startTime) || Date.now(),
    startTime: params.startTime,
    isLive: false,
  };

  extractMarketsFromOddsResponse(ev, blocks, activeSpecsByBkId, outBySource, cacheAgeSec);
  const market =
    (outBySource.get(spec.sourceId) ?? []).find((m) => m.marketType === params.marketType) ?? null;

  return {
    market,
    latencyMs: Date.now() - started,
    cacheAgeSec,
  };
}

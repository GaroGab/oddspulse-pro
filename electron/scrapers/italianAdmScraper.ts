import type {
  MarketType,
  RawScrapedMarket,
  SelectionQuote,
  SourceId,
  SportKey,
  TargetedScrapeFilter,
} from '../../src/shared/types';
import { DEFAULT_HEADERS, fetchJson } from './httpClient';
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

async function fetchFeedText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 11000);
  try {
    const res = await fetch(url, { headers: DIRETTA_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
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

  // If fewer than 35 matched (e.g., quiet night), supplement with top leagues for Dutcher coverage
  if (matched.length < 35) {
    const topLeagueRe =
      /Serie A|Serie B|Premier League|LaLiga|Bundesliga|Ligue 1|Champions|Europa|ATP|WTA|NBA|Eurolega/i;
    for (const ev of schedule) {
      if (matched.length >= 60) break;
      if (matchedIds.has(ev.eventId)) continue;
      if (topLeagueRe.test(ev.league)) {
        matchedIds.add(ev.eventId);
        matched.push(ev);
      }
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
  outBySource: Map<SourceId, RawScrapedMarket[]>
) {
  for (const blk of blocks) {
    const spec = activeSpecsByBookmakerId.get(blk.bookmakerId);
    if (!spec) continue;

    const activeItems = (blk.odds ?? []).filter((o) => o.active !== false);
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
        if (item.handicap?.value !== '2.5') continue;
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
      (blk.bettingScope === 'FULL_TIME' || blk.bettingScope === 'FULL_TIME_INCLUDING_OVERTIME')
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
    // Prevent duplicate market type for same event+bookie (e.g., FULL_TIME vs FULL_TIME_INCLUDING_OVERTIME)
    if (bucket.some((m) => m.eventId === ev.eventId && m.marketType === marketType)) continue;

    bucket.push({
      sourceId: spec.sourceId,
      sourceName: spec.name,
      sourceKind: 'bookmaker',
      sport: ev.sport,
      league: ev.league,
      eventId: ev.eventId,
      eventName: `${ev.homeTeam} - ${ev.awayTeam}`,
      homeTeam: ev.homeTeam,
      awayTeam: ev.awayTeam,
      startTime: ev.startTime,
      marketType,
      marketLabel,
      selections,
      eventUrl: spec.url,
      scrapedAt: Date.now(),
    });
  }
}

const scheduleCache = new Map<string, { fetchedAt: number; events: ScheduledDirettaEvent[] }>();
const SCHEDULE_CACHE_TTL_MS = 4 * 60_000;

export async function scrapeItalianAdmBookmakers(params: {
  exchangeMarkets: RawScrapedMarket[];
  enabledSourceIds: SourceId[];
  includeLive: boolean;
  filter?: TargetedScrapeFilter;
}): Promise<{
  marketsBySource: Map<SourceId, RawScrapedMarket[]>;
  latencyMs: number;
  scannedEvents: number;
}> {
  const started = Date.now();
  const { exchangeMarkets, enabledSourceIds, includeLive, filter } = params;

  const enabledSet = new Set(enabledSourceIds);
  const activeSpecs = ITALIAN_ADM_BOOKMAKERS.filter((s) => enabledSet.has(s.sourceId));
  const marketsBySource = new Map<SourceId, RawScrapedMarket[]>();
  for (const s of activeSpecs) marketsBySource.set(s.sourceId, []);

  if (activeSpecs.length === 0) {
    return { marketsBySource, latencyMs: 0, scannedEvents: 0 };
  }

  const activeSpecsByBkId = new Map(activeSpecs.map((s) => [s.bookmakerId, s]));

  // 1. Fetch today (day=0) & tomorrow (day=1) schedules in parallel across requested sports
  const allFeedJobs: Array<{ sport: SportKey; url: string }> = [
    { sport: 'football', url: `${FEED_BASE}/f_1_0_1_it-it_1` },
    { sport: 'football', url: `${FEED_BASE}/f_1_1_1_it-it_1` },
    { sport: 'tennis', url: `${FEED_BASE}/f_2_0_1_it-it_1` },
    { sport: 'tennis', url: `${FEED_BASE}/f_2_1_1_it-it_1` },
    { sport: 'basketball', url: `${FEED_BASE}/f_3_0_1_it-it_1` },
    { sport: 'basketball', url: `${FEED_BASE}/f_3_1_1_it-it_1` },
  ];
  const feedJobs =
    filter?.sports && filter.sports.length > 0
      ? allFeedJobs.filter((j) => filter.sports!.includes(j.sport))
      : allFeedJobs;

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
      const text = await fetchFeedText(job.url);
      const parsed = parseDirettaSchedule(text, job.sport, includeLive);
      scheduleCache.set(cacheKey, { fetchedAt: Date.now(), events: parsed });
      return parsed;
    })
  );

  const allScheduled: ScheduledDirettaEvent[] = [];
  const seenEvIds = new Set<string>();
  let fulfilledFeeds = 0;
  let firstFeedErr: unknown = null;
  for (const r of feedResults) {
    if (r.status === 'fulfilled') {
      fulfilledFeeds++;
      for (const ev of r.value) {
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
      : selectTargetDirettaEvents(allScheduled, exchangeMarkets, 140);

  // 3. Fetch GraphQL odds with clean bounded concurrency (14 parallel workers)
  const CONCURRENCY = 14;
  let cursor = 0;

  const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
    while (cursor < targets.length) {
      const idx = cursor++;
      const ev = targets[idx];
      try {
        const url = `${GQL_BASE}?_hash=oce&eventId=${encodeURIComponent(
          ev.eventId
        )}&projectId=400&geoIpCode=IT&geoIpSubdivisionCode=IT`;
        const { data } = await fetchJson<DirettaGraphQLResp>(url, {
          headers: DIRETTA_HEADERS,
          timeoutMs: 9000,
          retries: 0,
        });
        const oddsBlocks = data?.data?.findOddsByEventId?.odds ?? [];
        if (oddsBlocks.length > 0) {
          extractMarketsFromOddsResponse(ev, oddsBlocks, activeSpecsByBkId, marketsBySource);
        }
      } catch {
        // Ignore single event timeout
      }
    }
  });

  await Promise.all(workers);

  return {
    marketsBySource,
    latencyMs: Date.now() - started,
    scannedEvents: targets.length,
  };
}

import { calculateSingleMatch } from './math';
import {
  SOURCE_CATALOG,
  type AppSettings,
  type BetMode,
  type MarketType,
  type OddsmatcherRow,
  type RatingWatch,
  type RatingWatchInput,
  type RatingWatchMatchSnapshot,
  type SourceId,
  type SportKey,
  type TargetedScrapeFilter,
} from './types';

export const ADM_BATCH_SOURCES = new Set<SourceId>([
  'sisal_it',
  'snai_it',
  'betflag_it',
  'eurobet_it',
  'goldbet_it',
]);

export const KAMBI_SOURCES = new Set<SourceId>([
  '888sport_it',
  'leovegas_it',
  'unibet',
  'paf',
]);

const QUERY_STOP_TOKENS = new Set(['vs', 'v', 'fc', 'ac', 'as', 'sc', 'ss']);

/**
 * Normalizes team/event text for accent-insensitive, case-insensitive matching.
 */
export function normalizeWatchQuery(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns true if the tracked event has already started beyond the 5-minute grace window
 * (unless live events are explicitly enabled by settings).
 */
export function isWatchExpired(
  watch: Pick<RatingWatch, 'startTime'>,
  nowMs = Date.now(),
  includeLiveEvents = false
): boolean {
  if (includeLiveEvents || !watch.startTime) return false;
  const startMs = new Date(watch.startTime).getTime();
  if (!Number.isFinite(startMs)) return false;
  return startMs < nowMs - 5 * 60_000;
}

function tokenizeWatchPart(raw: string): string[] {
  return normalizeWatchQuery(raw)
    .split(' ')
    .filter((tok) => tok.length >= 2 && !QUERY_STOP_TOKENS.has(tok));
}

function splitEventTeamsText(raw: string): [string, string] | null {
  for (const sep of [' - ', ' vs ', ' v ', ' @ ']) {
    const idx = raw.indexOf(sep);
    if (idx > 0) {
      const a = raw.slice(0, idx).trim();
      const b = raw.slice(idx + sep.length).trim();
      if (a && b) return [a, b];
    }
  }
  return null;
}

/**
 * Matches a candidate OddsmatcherRow against a watch's event identity (exact key first, then fuzzy token/team match).
 */
export function matchesWatchEvent(
  watch: Pick<RatingWatch, 'eventKey' | 'eventName' | 'sport'>,
  row: OddsmatcherRow
): boolean {
  if (watch.sport && row.sport !== watch.sport) return false;
  if (watch.eventKey && row.eventKey === watch.eventKey) return true;

  const queryNorm = normalizeWatchQuery(watch.eventName);
  if (!queryNorm) return false;

  const rowHay = normalizeWatchQuery(`${row.eventName} ${row.homeTeam} ${row.awayTeam}`);
  const rowHome = normalizeWatchQuery(row.homeTeam);
  const rowAway = normalizeWatchQuery(row.awayTeam);

  const pair = splitEventTeamsText(watch.eventName);
  if (pair) {
    const tA = tokenizeWatchPart(pair[0]);
    const tB = tokenizeWatchPart(pair[1]);
    if (tA.length > 0 && tB.length > 0) {
      const directOk =
        tA.every((tok) => rowHome.includes(tok) || rowHay.includes(tok)) &&
        tB.every((tok) => rowAway.includes(tok) || rowHay.includes(tok));
      const swappedOk =
        tA.every((tok) => rowAway.includes(tok) || rowHay.includes(tok)) &&
        tB.every((tok) => rowHome.includes(tok) || rowHay.includes(tok));
      if (directOk || swappedOk) return true;
    }
  }

  const tokens = tokenizeWatchPart(watch.eventName);
  if (tokens.length === 0) return rowHay.includes(queryNorm);
  return tokens.every((tok) => rowHay.includes(tok));
}

/**
 * Evaluates a single RatingWatch against current Oddsmatcher rows and determines
 * the best qualifying quote plus whether an alert should fire right now.
 */
export function evaluateRatingWatch(
  watch: RatingWatch,
  rows: OddsmatcherRow[],
  opts?: { nowMs?: number; includeLiveEvents?: boolean }
): {
  isExpired: boolean;
  bestMatch: RatingWatchMatchSnapshot | null;
  shouldTrigger: boolean;
} {
  const nowMs = opts?.nowMs ?? Date.now();
  const isExpired = isWatchExpired(watch, nowMs, Boolean(opts?.includeLiveEvents));
  if (isExpired) {
    return { isExpired: true, bestMatch: null, shouldTrigger: false };
  }

  const bookSet = watch.bookmakerIds.length > 0 ? new Set(watch.bookmakerIds) : null;
  const exSet = watch.exchangeIds.length > 0 ? new Set(watch.exchangeIds) : null;

  let bestMatch: RatingWatchMatchSnapshot | null = null;

  for (const row of rows) {
    if (!matchesWatchEvent(watch, row)) continue;
    if (watch.marketType !== 'ALL' && row.marketType !== watch.marketType) continue;
    if (watch.selectionKey !== 'ALL' && row.selectionKey !== watch.selectionKey) continue;
    if (bookSet && !bookSet.has(row.bookmakerId)) continue;
    if (exSet && !exSet.has(row.exchangeId)) continue;
    if (row.liquidity < watch.minLiquidity) continue;
    if (row.backOdds < watch.minBackOdds || row.backOdds > watch.maxBackOdds) continue;

    const calc = calculateSingleMatch({
      mode: watch.mode,
      stake: 100,
      backOdds: row.backOdds,
      layOdds: row.layOdds,
      commission: row.commission,
      refundAmount: 100,
      refundRetention: watch.refundRetention,
      balanceBias: 0,
    });

    if (
      !bestMatch ||
      calc.rating > bestMatch.rating ||
      (Math.abs(calc.rating - bestMatch.rating) < 1e-6 && row.liquidity > bestMatch.liquidity)
    ) {
      bestMatch = {
        rowId: row.id,
        eventName: row.eventName,
        league: row.league,
        startTime: row.startTime,
        marketType: row.marketType,
        marketLabel: row.marketLabel,
        selectionKey: row.selectionKey,
        selectionLabel: row.selectionLabel,
        bookmakerId: row.bookmakerId,
        bookmakerName: row.bookmakerName,
        backOdds: row.backOdds,
        exchangeId: row.exchangeId,
        exchangeName: row.exchangeName,
        layOdds: row.layOdds,
        liquidity: row.liquidity,
        commission: row.commission,
        rating: calc.rating,
        expectedProfit: calc.expectedProfit,
        matchedAt: nowMs,
      };
    }
  }

  const cooldownMs = Math.max(10, watch.cooldownSec) * 1000;
  const inCooldown = Boolean(watch.lastTriggeredAt && nowMs - watch.lastTriggeredAt < cooldownMs);

  const shouldTrigger =
    watch.enabled &&
    bestMatch !== null &&
    bestMatch.rating >= watch.targetRating - 1e-6 &&
    !inCooldown;

  return {
    isExpired: false,
    bestMatch,
    shouldTrigger,
  };
}

export interface AdaptiveWatchPlan {
  activeWatches: RatingWatch[];
  expiredWatchIds: string[];
  bookmakerIds: SourceId[];
  exchangeIds: SourceId[];
  sports?: SportKey[];
  eventHints: NonNullable<TargetedScrapeFilter['eventHints']>;
  intervalSec: number | null;
  rateLimitReasons: string[];
}

function computeIntervalForSources(
  bookmakerSet: Set<SourceId>,
  exchangeSet: Set<SourceId>
): { intervalSec: number; rateLimitReasons: string[] } {
  let admCount = 0;
  let kambiCount = 0;
  for (const b of bookmakerSet) {
    if (ADM_BATCH_SOURCES.has(b)) admCount++;
    if (KAMBI_SOURCES.has(b)) kambiCount++;
  }
  const nonAdmCount = bookmakerSet.size - admCount;
  const exCount = exchangeSet.size;

  // ADM sources share Diretta/GraphQL event queries, so marginal cost per additional ADM bookie is lower
  const effectiveLoad =
    nonAdmCount + exCount + (admCount > 0 ? 1 + (admCount - 1) * 0.5 : 0);

  let intervalSec = Math.min(
    45,
    Math.max(8, Math.round(8 + Math.max(0, effectiveLoad - 2) * 3.5))
  );
  const rateLimitReasons: string[] = [];

  if (kambiCount >= 2) {
    intervalSec = Math.max(intervalSec, 20);
    rateLimitReasons.push('Floor anti-429 Kambi (20s)');
  } else if (kambiCount === 1) {
    intervalSec = Math.max(intervalSec, 15);
    rateLimitReasons.push('Floor anti-429 Kambi (15s)');
  }

  if (bookmakerSet.has('the_odds_api')) {
    intervalSec = Math.max(intervalSec, 60);
    rateLimitReasons.push('Floor quota The Odds API (60s)');
  }

  return { intervalSec, rateLimitReasons };
}

/**
 * Computes the minimal set of sources, sports, event hints, and safe monotonic polling interval
 * required by all currently active (enabled & non-expired) rating watches.
 */
export function computeAdaptiveWatchPlan(
  watches: RatingWatch[],
  settings: AppSettings,
  nowMs = Date.now()
): AdaptiveWatchPlan {
  const expiredWatchIds: string[] = [];
  const activeWatches: RatingWatch[] = [];

  for (const w of watches) {
    if (isWatchExpired(w, nowMs, settings.includeLiveEvents)) {
      expiredWatchIds.push(w.id);
    } else if (w.enabled) {
      activeWatches.push(w);
    }
  }

  if (activeWatches.length === 0) {
    return {
      activeWatches: [],
      expiredWatchIds,
      bookmakerIds: [],
      exchangeIds: [],
      eventHints: [],
      intervalSec: null,
      rateLimitReasons: [],
    };
  }

  const enabledCatalogBookmakers = SOURCE_CATALOG.filter(
    (s) =>
      s.kind === 'bookmaker' &&
      (settings.enabledSources[s.id] ?? s.enabled) &&
      (s.id !== 'the_odds_api' || settings.theOddsApiKey.trim().length >= 8)
  ).map((s) => s.id);

  const enabledCatalogExchanges = SOURCE_CATALOG.filter(
    (s) => s.kind === 'exchange' && (settings.enabledSources[s.id] ?? s.enabled)
  ).map((s) => s.id);

  const bookmakerSet = new Set<SourceId>();
  const exchangeSet = new Set<SourceId>();
  const sportSet = new Set<SportKey>();
  let needsAllSports = false;

  const eventHints: NonNullable<TargetedScrapeFilter['eventHints']> = [];
  const seenHints = new Set<string>();

  for (const w of activeWatches) {
    if (w.bookmakerIds.length === 0) {
      for (const b of enabledCatalogBookmakers) bookmakerSet.add(b);
    } else {
      for (const b of w.bookmakerIds) {
        if (b === 'the_odds_api' && settings.theOddsApiKey.trim().length < 8) continue;
        bookmakerSet.add(b);
      }
    }

    if (w.exchangeIds.length === 0) {
      for (const ex of enabledCatalogExchanges) exchangeSet.add(ex);
    } else {
      for (const ex of w.exchangeIds) exchangeSet.add(ex);
    }

    if (w.sport) sportSet.add(w.sport);
    else needsAllSports = true;

    const hintKey = `${normalizeWatchQuery(w.eventName)}|${w.sport ?? ''}`;
    if (!seenHints.has(hintKey)) {
      seenHints.add(hintKey);
      const pair = splitEventTeamsText(w.eventName);
      eventHints.push({
        eventName: w.eventName,
        homeTeam: pair?.[0],
        awayTeam: pair?.[1],
        sport: w.sport,
      });
    }
  }

  // Fallback to all enabled sources if a watch explicitly pinned sources that are unavailable (e.g. OddsAPI without key)
  if (bookmakerSet.size === 0) {
    for (const b of enabledCatalogBookmakers) bookmakerSet.add(b);
  }
  if (exchangeSet.size === 0) {
    for (const ex of enabledCatalogExchanges) exchangeSet.add(ex);
  }

  const { intervalSec, rateLimitReasons } = computeIntervalForSources(bookmakerSet, exchangeSet);

  return {
    activeWatches,
    expiredWatchIds,
    bookmakerIds: Array.from(bookmakerSet),
    exchangeIds: Array.from(exchangeSet),
    sports: needsAllSports || sportSet.size === 0 ? undefined : Array.from(sportSet),
    eventHints,
    intervalSec,
    rateLimitReasons,
  };
}

/**
 * Estimates polling cadence for a single draft watch configuration inside the Radar Rating UI form.
 */
export function estimateSingleWatchInterval(
  draft: Pick<RatingWatchInput, 'bookmakerIds' | 'exchangeIds'>,
  settings: AppSettings
): { intervalSec: number; bookCount: number; exCount: number; rateLimitReasons: string[] } {
  const enabledBookies = SOURCE_CATALOG.filter(
    (s) =>
      s.kind === 'bookmaker' &&
      (settings.enabledSources[s.id] ?? s.enabled) &&
      (s.id !== 'the_odds_api' || settings.theOddsApiKey.trim().length >= 8)
  ).map((s) => s.id);

  const enabledExchanges = SOURCE_CATALOG.filter(
    (s) => s.kind === 'exchange' && (settings.enabledSources[s.id] ?? s.enabled)
  ).map((s) => s.id);

  const bookmakerSet = new Set<SourceId>(
    draft.bookmakerIds.length > 0 ? draft.bookmakerIds : enabledBookies
  );
  const exchangeSet = new Set<SourceId>(
    draft.exchangeIds.length > 0 ? draft.exchangeIds : enabledExchanges
  );

  const { intervalSec, rateLimitReasons } = computeIntervalForSources(bookmakerSet, exchangeSet);
  return {
    intervalSec,
    bookCount: bookmakerSet.size,
    exCount: exchangeSet.size,
    rateLimitReasons,
  };
}

export function getSelectionOptionsForMarket(
  marketType: MarketType | 'ALL'
): Array<{ value: string; label: string }> {
  const all = { value: 'ALL', label: 'Qualsiasi esito' };
  switch (marketType) {
    case '1X2':
      return [
        all,
        { value: 'HOME', label: '1 (Casa)' },
        { value: 'DRAW', label: 'X (Pareggio)' },
        { value: 'AWAY', label: '2 (Trasferta)' },
      ];
    case 'H2H':
      return [
        all,
        { value: 'HOME', label: '1 (Casa / Giocatore 1)' },
        { value: 'AWAY', label: '2 (Trasferta / Giocatore 2)' },
      ];
    case 'OVER_UNDER_25':
      return [
        all,
        { value: 'OVER_25', label: 'Over 2.5' },
        { value: 'UNDER_25', label: 'Under 2.5' },
      ];
    case 'BTTS':
      return [
        all,
        { value: 'BTTS_YES', label: 'Goal (Sì)' },
        { value: 'BTTS_NO', label: 'NoGoal (No)' },
      ];
    default:
      return [
        all,
        { value: 'HOME', label: '1 (Casa)' },
        { value: 'DRAW', label: 'X (Pareggio)' },
        { value: 'AWAY', label: '2 (Trasferta)' },
        { value: 'OVER_25', label: 'Over 2.5' },
        { value: 'UNDER_25', label: 'Under 2.5' },
        { value: 'BTTS_YES', label: 'Goal (Sì)' },
        { value: 'BTTS_NO', label: 'NoGoal (No)' },
      ];
  }
}

export function betModeLabelIt(mode: BetMode): string {
  switch (mode) {
    case 'normal':
      return 'Normale';
    case 'snr':
      return 'Freebet SNR';
    case 'sr':
      return 'Bonus SR';
    case 'rf':
      return 'Rimborso RF';
  }
}

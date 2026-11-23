import { matchesDateRange, type DateRangeValue } from './dateRange';
import { calculatePuntaPunta, round2, type PuntaPuntaCalcInput } from './math';
import type {
  BackMarketGroup,
  BackOutcomeQuote,
  BetMode,
  MarketType,
  ScrapeSnapshot,
  SourceId,
  SportKey,
} from './types';

export type OutcomesFilterMode =
  | 'diverse_all'
  | 'diverse_2way'
  | 'diverse_3way'
  | 'any_bookie';

export type PuntaPuntaSortKey =
  | 'rating'
  | 'profit'
  | 'backOdds'
  | 'impliedProb'
  | 'startTime';

export interface PuntaPuntaFilterConfig {
  mode: BetMode;
  stake: number;
  anchorMode?: PuntaPuntaCalcInput['anchorMode'];
  refundAmount?: number;
  refundRetention?: number;
  sport: SportKey | 'ALL';
  market: MarketType | 'ALL';
  outcomesMode: OutcomesFilterMode;
  primaryBookmakers: string[];
  hedgeBookmakers: string[];
  minBack: number;
  maxBack: number;
  minRating: number;
  onlySurebets: boolean;
  dateRange: DateRangeValue;
  search: string;
  sortBy?: PuntaPuntaSortKey;
  sortDir?: 'desc' | 'asc';
  nowMs?: number;
}

export interface PuntaPuntaLeg {
  role: 'primary' | 'hedge';
  selectionKey: string;
  selectionLabel: string;
  bookmakerId: SourceId;
  bookmakerName: string;
  odds: number;
  stake: number;
  potentialReturn: number;
  eventUrl?: string;
}

export interface PuntaPuntaCandidateRow {
  id: string;
  groupId: string;
  eventKey: string;
  sport: SportKey;
  league: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  marketType: MarketType;
  marketLabel: string;
  outcomeCount: number;
  primaryLeg: PuntaPuntaLeg;
  hedgeLegs: PuntaPuntaLeg[];
  legs: PuntaPuntaLeg[];
  rating: number;
  guaranteedProfit: number;
  impliedProbSum: number;
  lavagnaPct: number;
  hedgeTotal: number;
  totalCashOutlay: number;
  effectiveRefund: number;
  profits: number[];
  returns: number[];
  isSurebet: boolean;
  updatedAt: number;
  groupQuotesBySelection: Record<string, BackOutcomeQuote[]>;
}

export interface PuntaPuntaStats {
  totalMatched: number;
  surebetsCount: number;
  bestRating: number;
  avgLavagnaTop20: number;
}

export interface PuntaPuntaMatchResult {
  rows: PuntaPuntaCandidateRow[];
  stats: PuntaPuntaStats;
}

const CANONICAL_OUTCOME_ORDER: Record<MarketType, string[]> = {
  '1X2': ['HOME', 'DRAW', 'AWAY'],
  OVER_UNDER_25: ['OVER_25', 'UNDER_25'],
  BTTS: ['BTTS_YES', 'BTTS_NO'],
  H2H: ['HOME', 'AWAY'],
};

function splitEventTeams(eventName: string): { homeTeam: string; awayTeam: string } {
  const vsParts = eventName.split(/\s+vs\s+|\s+-\s+/i);
  if (vsParts.length >= 2) {
    return { homeTeam: vsParts[0].trim(), awayTeam: vsParts.slice(1).join(' - ').trim() };
  }
  return { homeTeam: eventName.trim(), awayTeam: '' };
}

/**
 * Extracts raw per-bookmaker market groups from a ScrapeSnapshot.
 * Uses native snapshot.backMarketGroups when populated; falls back to
 * reconstructing groups from snapshot.rows + snapshot.dutcherRows (e.g. legacy
 * or mock test snapshots).
 */
export function extractBackMarketGroupsFromSnapshot(
  snapshot: Pick<ScrapeSnapshot, 'backMarketGroups' | 'rows' | 'dutcherRows'>
): BackMarketGroup[] {
  if (snapshot.backMarketGroups && snapshot.backMarketGroups.length > 0) {
    return snapshot.backMarketGroups;
  }

  interface MutableGroup {
    id: string;
    eventKey: string;
    sport: SportKey;
    league: string;
    eventName: string;
    homeTeam: string;
    awayTeam: string;
    startTime: string;
    marketType: MarketType;
    marketLabel: string;
    outcomesMap: Map<string, string>;
    quoteMap: Map<string, BackOutcomeQuote>; // selectionKey|bookmakerId -> quote
    updatedAt: number;
  }

  const groups = new Map<string, MutableGroup>();

  const ensureGroup = (meta: {
    eventKey: string;
    sport: SportKey;
    league: string;
    eventName: string;
    homeTeam?: string;
    awayTeam?: string;
    startTime: string;
    marketType: MarketType;
    marketLabel: string;
    updatedAt: number;
  }): MutableGroup => {
    const id = `${meta.eventKey}|${meta.marketType}`;
    let existing = groups.get(id);
    if (!existing) {
      const split =
        meta.homeTeam && meta.awayTeam
          ? { homeTeam: meta.homeTeam, awayTeam: meta.awayTeam }
          : splitEventTeams(meta.eventName);
      existing = {
        id,
        eventKey: meta.eventKey,
        sport: meta.sport,
        league: meta.league,
        eventName: meta.eventName,
        homeTeam: meta.homeTeam || split.homeTeam,
        awayTeam: meta.awayTeam || split.awayTeam,
        startTime: meta.startTime,
        marketType: meta.marketType,
        marketLabel: meta.marketLabel,
        outcomesMap: new Map(),
        quoteMap: new Map(),
        updatedAt: meta.updatedAt,
      };
      groups.set(id, existing);
    } else if (meta.updatedAt > existing.updatedAt) {
      existing.updatedAt = meta.updatedAt;
    }
    return existing;
  };

  const upsertQuote = (group: MutableGroup, quote: BackOutcomeQuote) => {
    if (!Number.isFinite(quote.odds) || quote.odds <= 1.01) return;
    if (!group.outcomesMap.has(quote.selectionKey)) {
      group.outcomesMap.set(quote.selectionKey, quote.selectionLabel);
    }
    const qKey = `${quote.selectionKey}|${quote.bookmakerId}`;
    const prev = group.quoteMap.get(qKey);
    if (!prev || quote.odds > prev.odds) {
      group.quoteMap.set(qKey, quote);
    }
  };

  for (const r of snapshot.rows) {
    const g = ensureGroup({
      eventKey: r.eventKey,
      sport: r.sport,
      league: r.league,
      eventName: r.eventName,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      startTime: r.startTime,
      marketType: r.marketType,
      marketLabel: r.marketLabel,
      updatedAt: r.updatedAt,
    });
    upsertQuote(g, {
      selectionKey: r.selectionKey,
      selectionLabel: r.selectionLabel,
      bookmakerId: r.bookmakerId,
      bookmakerName: r.bookmakerName,
      odds: r.backOdds,
      eventUrl: r.bookmakerUrl,
      updatedAt: r.updatedAt,
    });
  }

  for (const dr of snapshot.dutcherRows) {
    const g = ensureGroup({
      eventKey: dr.eventKey,
      sport: dr.sport,
      league: dr.league,
      eventName: dr.eventName,
      startTime: dr.startTime,
      marketType: dr.marketType,
      marketLabel: dr.marketLabel,
      updatedAt: dr.updatedAt,
    });
    for (const leg of dr.legs) {
      upsertQuote(g, {
        selectionKey: leg.selectionKey,
        selectionLabel: leg.selectionLabel,
        bookmakerId: leg.bookmakerId,
        bookmakerName: leg.bookmakerName,
        odds: leg.odds,
        eventUrl: leg.bookmakerUrl,
        updatedAt: dr.updatedAt,
      });
    }
  }

  const out: BackMarketGroup[] = [];
  for (const g of groups.values()) {
    const canonical = CANONICAL_OUTCOME_ORDER[g.marketType];
    const hasAllCanonical = canonical && canonical.every((k) => g.outcomesMap.has(k));
    const orderedKeys = hasAllCanonical
      ? canonical
      : Array.from(g.outcomesMap.keys());
    if (orderedKeys.length < 2) continue;

    out.push({
      id: g.id,
      eventKey: g.eventKey,
      sport: g.sport,
      league: g.league,
      eventName: g.eventName,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      startTime: g.startTime,
      marketType: g.marketType,
      marketLabel: g.marketLabel,
      outcomes: orderedKeys.map((k) => ({ key: k, label: g.outcomesMap.get(k) || k })),
      quotes: Array.from(g.quoteMap.values()),
      updatedAt: g.updatedAt,
    });
  }

  return out;
}

/**
 * Generates, filters, computes Punta-Punta stakes & ratings, and sorts candidate
 * Bookmaker-vs-Bookmaker matchups across all scraped events.
 */
export function findPuntaPuntaMatches(
  snapshot: Pick<ScrapeSnapshot, 'backMarketGroups' | 'rows' | 'dutcherRows'>,
  config: PuntaPuntaFilterConfig
): PuntaPuntaMatchResult {
  const groups = extractBackMarketGroupsFromSnapshot(snapshot);
  const nowMs = config.nowMs ?? Date.now();
  const safeStake = Math.max(1, config.stake || 100);
  const primarySet = config.primaryBookmakers.length > 0 ? new Set(config.primaryBookmakers) : null;
  const hedgeSet = config.hedgeBookmakers.length > 0 ? new Set(config.hedgeBookmakers) : null;
  const q = config.search.trim().toLowerCase();

  const list: PuntaPuntaCandidateRow[] = [];

  for (const group of groups) {
    if (config.sport !== 'ALL' && group.sport !== config.sport) continue;
    if (config.market !== 'ALL' && group.marketType !== config.market) continue;
    const outcomeCount = group.outcomes.length;
    if (outcomeCount < 2 || outcomeCount > 4) continue;
    if (config.outcomesMode === 'diverse_2way' && outcomeCount !== 2) continue;
    if (config.outcomesMode === 'diverse_3way' && outcomeCount !== 3) continue;
    if (!matchesDateRange(group.startTime, config.dateRange, nowMs)) continue;

    // Organize quotes per selectionKey sorted descending by odds
    const groupQuotesBySelection: Record<string, BackOutcomeQuote[]> = {};
    for (const oc of group.outcomes) {
      groupQuotesBySelection[oc.key] = [];
    }
    for (const quote of group.quotes) {
      if (!Number.isFinite(quote.odds) || quote.odds <= 1.01) continue;
      if (groupQuotesBySelection[quote.selectionKey]) {
        groupQuotesBySelection[quote.selectionKey].push(quote);
      }
    }

    let complete = true;
    for (const oc of group.outcomes) {
      const arr = groupQuotesBySelection[oc.key];
      if (!arr || arr.length === 0) {
        complete = false;
        break;
      }
      arr.sort((a, b) => b.odds - a.odds);
    }
    if (!complete) continue;

    // Iterate every outcome slot and every bookmaker quote as the Primary (leg 0) bet
    for (let primaryIdx = 0; primaryIdx < group.outcomes.length; primaryIdx++) {
      const primaryOutcome = group.outcomes[primaryIdx];
      const primaryCandidates = groupQuotesBySelection[primaryOutcome.key];

      for (const primaryQuote of primaryCandidates) {
        if (primarySet && !primarySet.has(primaryQuote.bookmakerId)) continue;
        if (primaryQuote.odds < config.minBack || primaryQuote.odds > config.maxBack) continue;

        // Pick best allowed coverage bookmaker for each remaining outcome
        const hedgeQuotes: BackOutcomeQuote[] = [];
        let missingHedge = false;

        for (let j = 0; j < group.outcomes.length; j++) {
          if (j === primaryIdx) continue;
          const hedgeCandidates = groupQuotesBySelection[group.outcomes[j].key];
          let chosen: BackOutcomeQuote | null = null;
          for (const hq of hedgeCandidates) {
            if (hedgeSet && !hedgeSet.has(hq.bookmakerId)) continue;
            if (
              config.outcomesMode !== 'any_bookie' &&
              hq.bookmakerId === primaryQuote.bookmakerId
            ) {
              continue;
            }
            chosen = hq;
            break; // already sorted desc by odds
          }
          if (!chosen) {
            missingHedge = true;
            break;
          }
          hedgeQuotes.push(chosen);
        }

        if (missingHedge) continue;

        const oddsArr = [primaryQuote.odds, ...hedgeQuotes.map((h) => h.odds)];
        const impliedProbSum = oddsArr.reduce((acc, o) => acc + 1 / o, 0);

        // Outlier guard against mislinked team names / corrupted cross-site lines
        if (impliedProbSum < 0.72 || impliedProbSum > 1.85) continue;

        const normalRating = round2((1 / impliedProbSum) * 100);
        const isSurebet = normalRating >= 100;
        if (config.onlySurebets && !isSurebet) continue;

        const calc = calculatePuntaPunta({
          mode: config.mode,
          stake: safeStake,
          odds: oddsArr,
          anchorMode: config.anchorMode,
          refundAmount: config.refundAmount,
          refundRetention: config.refundRetention,
        });

        if (calc.rating < config.minRating) continue;

        if (q) {
          const hay = `${group.eventName} ${group.league} ${group.marketLabel} ${primaryQuote.selectionLabel} ${primaryQuote.bookmakerName} ${hedgeQuotes
            .map((h) => `${h.selectionLabel} ${h.bookmakerName}`)
            .join(' ')}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }

        const primaryLeg: PuntaPuntaLeg = {
          role: 'primary',
          selectionKey: primaryQuote.selectionKey,
          selectionLabel: primaryQuote.selectionLabel,
          bookmakerId: primaryQuote.bookmakerId,
          bookmakerName: primaryQuote.bookmakerName,
          odds: primaryQuote.odds,
          stake: calc.stakes[0] ?? safeStake,
          potentialReturn: calc.returns[0] ?? 0,
          eventUrl: primaryQuote.eventUrl,
        };

        const hedgeLegs: PuntaPuntaLeg[] = hedgeQuotes.map((hq, idx) => ({
          role: 'hedge',
          selectionKey: hq.selectionKey,
          selectionLabel: hq.selectionLabel,
          bookmakerId: hq.bookmakerId,
          bookmakerName: hq.bookmakerName,
          odds: hq.odds,
          stake: calc.stakes[idx + 1] ?? 0,
          potentialReturn: calc.returns[idx + 1] ?? 0,
          eventUrl: hq.eventUrl,
        }));

        const hedgeSig = hedgeLegs.map((h) => `${h.selectionKey}:${h.bookmakerId}`).join('+');

        list.push({
          id: `${group.id}|${primaryLeg.selectionKey}|${primaryLeg.bookmakerId}|${hedgeSig}`,
          groupId: group.id,
          eventKey: group.eventKey,
          sport: group.sport,
          league: group.league,
          eventName: group.eventName,
          homeTeam: group.homeTeam,
          awayTeam: group.awayTeam,
          startTime: group.startTime,
          marketType: group.marketType,
          marketLabel: group.marketLabel,
          outcomeCount,
          primaryLeg,
          hedgeLegs,
          legs: [primaryLeg, ...hedgeLegs],
          rating: calc.rating,
          guaranteedProfit: calc.guaranteedProfit,
          impliedProbSum,
          lavagnaPct: round2(impliedProbSum * 100),
          hedgeTotal: calc.hedgeTotal,
          totalCashOutlay: calc.totalCashOutlay,
          effectiveRefund: calc.effectiveRefund,
          profits: calc.profits,
          returns: calc.returns,
          isSurebet,
          updatedAt: group.updatedAt,
          groupQuotesBySelection,
        });
      }
    }
  }

  const sortBy = config.sortBy ?? 'rating';
  const sortDir = config.sortDir ?? 'desc';
  const mult = sortDir === 'desc' ? -1 : 1;

  list.sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'rating') cmp = a.rating - b.rating;
    else if (sortBy === 'profit') cmp = a.guaranteedProfit - b.guaranteedProfit;
    else if (sortBy === 'backOdds') cmp = a.primaryLeg.odds - b.primaryLeg.odds;
    else if (sortBy === 'impliedProb') cmp = a.lavagnaPct - b.lavagnaPct;
    else cmp = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    return cmp * mult;
  });

  const surebetsCount = list.filter((r) => r.isSurebet).length;
  const bestRating = list.length > 0 ? Math.max(...list.map((r) => r.rating)) : 0;
  const top20 = list.slice(0, 20);
  const avgLavagnaTop20 =
    top20.length > 0
      ? round2(top20.reduce((acc, r) => acc + r.lavagnaPct, 0) / top20.length)
      : 0;

  return {
    rows: list,
    stats: {
      totalMatched: list.length,
      surebetsCount,
      bestRating,
      avgLavagnaTop20,
    },
  };
}

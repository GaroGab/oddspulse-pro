import { describe, expect, it } from 'vitest';
import {
  calculateDutcher,
  calculatePuntaPunta,
  calculateSequentialMultiodds,
  calculateSingleMatch,
  computeAutoPuntaPuntaRolloverRating,
  computeAutoRolloverRating,
  findBestMultiodds,
} from './math';
import { linkScrapedMarkets, matchesEventHints, normalizeTeamName, teamSimilarity } from '../../electron/scrapers/matchLinker';
import {
  filterManualMultioddsCatalog,
  sortMultipleLegs,
  validateManualMultipleCandidate,
} from './multioddsValidation';
import { computeConnectionDiagnostic, formatFriendlyNetworkError } from './networkHealth';
import {
  extractBackMarketGroupsFromSnapshot,
  findPuntaPuntaMatches,
} from './puntaPuntaMatcher';
import {
  buildAutoScrapeSettingsPatch,
  getEffectiveAutoRefreshSec,
  isAutoScrapeActive,
} from './autoScrape';
import {
  EMPTY_DATE_RANGE,
  formatScrapeDateWindowLabel,
  getDirettaDayOffsetsForWindow,
  matchesScrapeDateWindow,
  needsFutureDateScrape,
  resolveScrapeDateWindow,
} from './dateRange';
import {
  appendIgnoredWatchEvent,
  buildCompetitionOptions,
  computeAdaptiveWatchPlan,
  countAvailableCompetitions,
  evaluateRatingWatch,
  extractMatchEventKey,
  formatFittingListSummary,
  getTopCompetitionValues,
  isRowSurebet,
  isWatchExpired,
  matchesWatchLeague,
  matchesWatchLeagues,
  removeIgnoredWatchEvent,
  resolveCanonicalCompetition,
} from './ratingWatch';
import {
  buildSavedMultipleInputFromPlan,
  evaluateSavedMultiplePlan,
  syncLiveOddsForSavedPlan,
} from './savedMultiples';
import {
  buildBookmakerSourceOptions,
  buildExchangeSourceOptions,
  SCRAPER_DISABLED_BOOKMAKER_REASON,
  SCRAPER_DISABLED_EXCHANGE_REASON,
} from './sourceOptions';
import {
  DEFAULT_SETTINGS,
  type DutcherRow,
  type OddsmatcherRow,
  type RatingWatch,
  type RawScrapedMarket,
  type SavedMultiplePlan,
  type SourceStatus,
} from './types';

function makeRow(partial: Partial<OddsmatcherRow> & { id: string; startTime: string }): OddsmatcherRow {
  return {
    eventKey: `ev_${partial.id}`,
    sport: 'football',
    league: 'Serie A',
    eventName: `TeamA ${partial.id} - TeamB ${partial.id}`,
    homeTeam: `TeamA ${partial.id}`,
    awayTeam: `TeamB ${partial.id}`,
    marketType: '1X2',
    marketLabel: 'Esito Finale 1X2',
    selectionKey: 'HOME',
    selectionLabel: 'TeamA (1)',
    bookmakerId: '888sport_it',
    bookmakerName: '888sport.it',
    bookmakerColor: '#ff6600',
    backOdds: 2.0,
    backDelta: 'same',
    exchangeId: 'betfair_exchange',
    exchangeName: 'Betfair Exchange IT',
    exchangeColor: '#ffb80c',
    layOdds: 2.0,
    layDelta: 'same',
    liquidity: 500,
    commission: 0.05,
    ratingNormal: 97.44,
    ratingSnr: 48.72,
    rawRating: 100,
    isSurebet: false,
    updatedAt: Date.now(),
    ...partial,
  };
}

describe('Matched Betting Single Calculator', () => {
  it('computes balanced Normale qualifying bet accurately', () => {
    const res = calculateSingleMatch({
      mode: 'normal',
      stake: 100,
      backOdds: 2.0,
      layOdds: 2.0,
      commission: 0.05,
    });
    expect(res.layStake).toBeCloseTo(102.56, 2);
    expect(res.liability).toBeCloseTo(102.56, 2);
    expect(res.bookieWinProfit).toBeCloseTo(-2.56, 2);
    expect(res.exchangeWinProfit).toBeCloseTo(-2.56, 2);
    expect(res.rating).toBeCloseTo(97.44, 2);
  });

  it('computes SNR Freebet extraction accurately', () => {
    const res = calculateSingleMatch({
      mode: 'snr',
      stake: 100,
      backOdds: 5.0,
      layOdds: 5.2,
      commission: 0.05,
    });
    // Lay = 100 * 4 / (5.2 - 0.05) = 400 / 5.15 = 77.67
    expect(res.layStake).toBeCloseTo(77.67, 2);
    expect(res.bookieWinProfit).toBeCloseTo(73.79, 1);
    expect(res.exchangeWinProfit).toBeCloseTo(73.79, 1);
    expect(res.rating).toBeCloseTo(73.79, 2);
  });

  it('supports Underlay (0 loss if bookmaker wins) and Overlay (0 loss if exchange wins)', () => {
    const under = calculateSingleMatch({
      mode: 'normal',
      stake: 100,
      backOdds: 2.0,
      layOdds: 2.1,
      commission: 0.05,
      balanceBias: -1,
    });
    expect(under.bookieWinProfit).toBeCloseTo(0, 1);
    expect(under.exchangeWinProfit).toBeLessThan(0);

    const over = calculateSingleMatch({
      mode: 'normal',
      stake: 100,
      backOdds: 2.0,
      layOdds: 2.1,
      commission: 0.05,
      balanceBias: 1,
    });
    expect(over.exchangeWinProfit).toBeCloseTo(0, 1);
    expect(over.bookieWinProfit).toBeLessThan(0);
  });

  it('computes RF (Rimborso/Cashback) profit accurately', () => {
    const rf = calculateSingleMatch({
      mode: 'rf',
      stake: 50,
      backOdds: 3.0,
      layOdds: 3.1,
      commission: 0.05,
      refundAmount: 50,
      refundRetention: 70, // €35 cash equivalent
    });
    expect(Math.abs(rf.bookieWinProfit - rf.exchangeWinProfit)).toBeLessThan(0.05);
    expect(rf.expectedProfit).toBeGreaterThan(20);
  });
});

describe('Multiodds Sequential Lay Engine', () => {
  it('guarantees EQUAL net profit across ALL 4 outcomes of a 3-leg sequential multiple', () => {
    const r1 = makeRow({ id: '1', startTime: '2026-11-22T12:00:00Z', backOdds: 2.0, layOdds: 2.0, commission: 0.05 });
    const r2 = makeRow({ id: '2', startTime: '2026-11-22T15:00:00Z', backOdds: 2.0, layOdds: 2.0, commission: 0.05 });
    const r3 = makeRow({ id: '3', startTime: '2026-11-22T18:00:00Z', backOdds: 2.0, layOdds: 2.0, commission: 0.05 });

    const plan = calculateSequentialMultiodds({
      rows: [r3, r1, r2], // intentionally unsorted to verify chronological sort
      mode: 'normal',
      stake: 100,
      minGapRequiredMinutes: 120,
    });

    expect(plan.nonOverlapping).toBe(true);
    expect(plan.minGapMinutes).toBe(180);
    expect(plan.guaranteedProfit).toBeCloseTo(-7.5, 1);
    expect(plan.profitIfAllWin).toBeCloseTo(-7.5, 1);
    for (const step of plan.legs) {
      expect(step.profitIfLostHere).toBeCloseTo(-7.5, 1);
    }
  });

  it('filters out overlapping matches when minGapMinutes is enforced', () => {
    const r1 = makeRow({ id: 'a', startTime: '2026-11-22T14:00:00Z', backOdds: 1.8, layOdds: 1.82 });
    const r2 = makeRow({ id: 'b', startTime: '2026-11-22T14:30:00Z', backOdds: 1.9, layOdds: 1.92 }); // overlaps with r1!
    const r3 = makeRow({ id: 'c', startTime: '2026-11-22T17:00:00Z', backOdds: 2.0, layOdds: 2.02 });
    const r4 = makeRow({ id: 'd', startTime: '2026-11-22T20:00:00Z', backOdds: 1.7, layOdds: 1.72 });

    const plans = findBestMultiodds({
      rows: [r1, r2, r3, r4],
      bookmakerId: 'ALL',
      exchangeId: 'ALL',
      legsCount: 3,
      mode: 'normal',
      stake: 50,
      minLegOdds: 1.2,
      maxLegOdds: 5,
      minCombinedOdds: 2.0,
      maxCombinedOdds: 30,
      minLiquidity: 10,
      minGapMinutes: 120,
      bonusBoostPct: 0,
      refundAmount: 0,
      refundRetention: 70,
    });

    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.nonOverlapping).toBe(true);
      expect(p.minGapMinutes).toBeGreaterThanOrEqual(120);
      // r1 and r2 must never appear together
      const ids = p.legs.map((l) => l.row.id);
      expect(ids.includes('a') && ids.includes('b')).toBe(false);
    }
  });

  it('supports multi-select bookmakerIds filter in findBestMultiodds', () => {
    const sisal1 = makeRow({ id: 's1', eventKey: 'ev_s1', bookmakerId: 'sisal_it', bookmakerName: 'Sisal.it', startTime: '2026-11-22T12:00:00Z', backOdds: 2.0, layOdds: 2.02 });
    const sisal2 = makeRow({ id: 's2', eventKey: 'ev_s2', bookmakerId: 'sisal_it', bookmakerName: 'Sisal.it', startTime: '2026-11-22T15:00:00Z', backOdds: 2.0, layOdds: 2.02 });
    const snai1 = makeRow({ id: 'n1', eventKey: 'ev_n1', bookmakerId: 'snai_it', bookmakerName: 'SNAI.it', startTime: '2026-11-22T12:00:00Z', backOdds: 2.1, layOdds: 2.12 });
    const snai2 = makeRow({ id: 'n2', eventKey: 'ev_n2', bookmakerId: 'snai_it', bookmakerName: 'SNAI.it', startTime: '2026-11-22T15:00:00Z', backOdds: 2.1, layOdds: 2.12 });
    const euro1 = makeRow({ id: 'e1', eventKey: 'ev_e1', bookmakerId: 'eurobet_it', bookmakerName: 'Eurobet.it', startTime: '2026-11-22T12:00:00Z', backOdds: 2.2, layOdds: 2.21 });
    const euro2 = makeRow({ id: 'e2', eventKey: 'ev_e2', bookmakerId: 'eurobet_it', bookmakerName: 'Eurobet.it', startTime: '2026-11-22T15:00:00Z', backOdds: 2.2, layOdds: 2.21 });

    const plans = findBestMultiodds({
      rows: [sisal1, sisal2, snai1, snai2, euro1, euro2],
      bookmakerIds: ['sisal_it', 'snai_it'],
      exchangeId: 'ALL',
      legsCount: 2,
      mode: 'normal',
      stake: 50,
      minLegOdds: 1.2,
      maxLegOdds: 5,
      minCombinedOdds: 2.0,
      maxCombinedOdds: 20,
      minLiquidity: 10,
      minGapMinutes: 120,
      bonusBoostPct: 0,
      refundAmount: 0,
      refundRetention: 70,
    });

    expect(plans.length).toBe(2);
    expect(plans.every((p) => p.bookmakerId === 'sisal_it' || p.bookmakerId === 'snai_it')).toBe(true);
    expect(plans.some((p) => p.bookmakerId === 'eurobet_it')).toBe(false);
  });

  it('supports multi-select exchangeIds filter in findBestMultiodds', () => {
    const bf1 = makeRow({ id: 'bf1', eventKey: 'ev_bf1', exchangeId: 'betfair_exchange', exchangeName: 'Betfair Exchange IT', startTime: '2026-11-22T12:00:00Z', backOdds: 2.0, layOdds: 2.02 });
    const bf2 = makeRow({ id: 'bf2', eventKey: 'ev_bf2', exchangeId: 'betfair_exchange', exchangeName: 'Betfair Exchange IT', startTime: '2026-11-22T15:00:00Z', backOdds: 2.0, layOdds: 2.02 });
    const fl1 = makeRow({ id: 'fl1', eventKey: 'ev_fl1', exchangeId: 'betflag_exchange', exchangeName: 'Betflag Exchange IT', startTime: '2026-11-22T18:00:00Z', backOdds: 2.05, layOdds: 2.06 });
    const sm1 = makeRow({ id: 'sm1', eventKey: 'ev_sm1', exchangeId: 'smarkets_exchange', exchangeName: 'Smarkets Exchange', startTime: '2026-11-22T21:00:00Z', backOdds: 2.1, layOdds: 2.1 });

    const plans = findBestMultiodds({
      rows: [bf1, bf2, fl1, sm1],
      exchangeIds: ['betfair_exchange', 'betflag_exchange'],
      legsCount: 2,
      mode: 'normal',
      stake: 50,
      minLegOdds: 1.2,
      maxLegOdds: 5,
      minCombinedOdds: 2.0,
      maxCombinedOdds: 20,
      minLiquidity: 10,
      minGapMinutes: 120,
      bonusBoostPct: 0,
      refundAmount: 0,
      refundRetention: 70,
    });

    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      for (const leg of p.legs) {
        expect(['betfair_exchange', 'betflag_exchange']).toContain(leg.row.exchangeId);
        expect(leg.row.exchangeId).not.toBe('smarkets_exchange');
      }
    }
  });

  it('supports Oddsmatcher filters (sport, market, search, minRating, onlySurebets, noSurebets, dateRange) in findBestMultiodds', () => {
    const fb1 = makeRow({
      id: 'fb1',
      eventKey: 'ev_fb1',
      sport: 'football',
      league: 'Serie A',
      eventName: 'Inter - Milan',
      marketType: '1X2',
      selectionLabel: 'Inter (1)',
      startTime: '2026-11-22T12:00:00Z',
      backOdds: 2.0,
      layOdds: 2.02,
      ratingNormal: 96.5,
      isSurebet: false,
    });
    const fb2 = makeRow({
      id: 'fb2',
      eventKey: 'ev_fb2',
      sport: 'football',
      league: 'Serie A',
      eventName: 'Juventus - Roma',
      marketType: '1X2',
      selectionLabel: 'Juventus (1)',
      startTime: '2026-11-22T16:00:00Z',
      backOdds: 2.0,
      layOdds: 2.02,
      ratingNormal: 96.5,
      isSurebet: false,
    });
    const fbSure = makeRow({
      id: 'fb_sure',
      eventKey: 'ev_fb_sure',
      sport: 'football',
      league: 'Premier League',
      eventName: 'Arsenal - Chelsea',
      marketType: 'OVER_UNDER_25',
      selectionLabel: 'Over 2.5',
      startTime: '2026-11-22T20:00:00Z',
      backOdds: 2.2,
      layOdds: 2.0,
      ratingNormal: 109.5,
      isSurebet: true,
    });
    const fbSure2 = makeRow({
      id: 'fb_sure2',
      eventKey: 'ev_fb_sure2',
      sport: 'football',
      league: 'Premier League',
      eventName: 'Liverpool - City',
      marketType: 'OVER_UNDER_25',
      selectionLabel: 'Over 2.5',
      startTime: '2026-11-23T12:00:00Z',
      backOdds: 2.2,
      layOdds: 2.0,
      ratingNormal: 109.5,
      isSurebet: true,
    });
    const tn1 = makeRow({
      id: 'tn1',
      eventKey: 'ev_tn1',
      sport: 'tennis',
      league: 'ATP Finals',
      eventName: 'Sinner - Alcaraz',
      marketType: 'H2H',
      selectionLabel: 'Sinner (1)',
      startTime: '2026-11-22T12:00:00Z',
      backOdds: 2.0,
      layOdds: 2.02,
      ratingNormal: 96.5,
      isSurebet: false,
    });
    const tn2 = makeRow({
      id: 'tn2',
      eventKey: 'ev_tn2',
      sport: 'tennis',
      league: 'ATP Finals',
      eventName: 'Zverev - Fritz',
      marketType: 'H2H',
      selectionLabel: 'Zverev (1)',
      startTime: '2026-11-22T18:00:00Z',
      backOdds: 2.0,
      layOdds: 2.02,
      ratingNormal: 96.5,
      isSurebet: false,
    });

    const baseCfg = {
      rows: [fb1, fb2, fbSure, fbSure2, tn1, tn2],
      legsCount: 2,
      mode: 'normal' as const,
      stake: 50,
      minLegOdds: 1.2,
      maxLegOdds: 5,
      minCombinedOdds: 2.0,
      maxCombinedOdds: 20,
      minLiquidity: 10,
      minGapMinutes: 120,
      bonusBoostPct: 0,
      refundAmount: 0,
      refundRetention: 70,
    };

    // Sport filter
    const tennisPlans = findBestMultiodds({ ...baseCfg, sport: 'tennis' });
    expect(tennisPlans.length).toBe(1);
    expect(tennisPlans[0].legs.every((l) => l.row.sport === 'tennis')).toBe(true);

    // Market filter
    const ouPlans = findBestMultiodds({ ...baseCfg, market: 'OVER_UNDER_25' });
    expect(ouPlans.length).toBe(1);
    expect(ouPlans[0].legs.every((l) => l.row.marketType === 'OVER_UNDER_25')).toBe(true);

    // noSurebets excludes single-leg surebets
    const noSurePlans = findBestMultiodds({ ...baseCfg, sport: 'football', noSurebets: true });
    expect(noSurePlans.length).toBe(1);
    expect(noSurePlans[0].legs.every((l) => !l.row.isSurebet)).toBe(true);

    // onlySurebets keeps only multiples with plan rating >= 100%
    const onlySurePlans = findBestMultiodds({ ...baseCfg, onlySurebets: true });
    expect(onlySurePlans.length).toBeGreaterThan(0);
    expect(onlySurePlans.every((p) => p.rating >= 100)).toBe(true);

    // minRating filters resulting plan rating
    const highRatingPlans = findBestMultiodds({ ...baseCfg, minRating: 105 });
    expect(highRatingPlans.length).toBe(1);
    expect(highRatingPlans[0].rating).toBeGreaterThanOrEqual(105);

    // search filters legs by text
    const searchPlans = findBestMultiodds({ ...baseCfg, search: 'Inter' });
    expect(searchPlans.length).toBe(0); // Only 1 matching event < 2 legs

    // dateRange filters by calendar window
    const dateFiltered = findBestMultiodds({
      ...baseCfg,
      dateRange: { mode: 'range', startDate: '2026-11-23', endDate: '2026-11-23' },
    });
    expect(dateFiltered.length).toBe(0); // Only 1 event on 2026-11-23
  });
});

describe('Dutcher Engine', () => {
  it('computes guaranteed positive profit on a 2-way surebet', () => {
    const row: DutcherRow = {
      id: 'd1',
      eventKey: 'ev1',
      sport: 'tennis',
      league: 'ATP',
      eventName: 'Player A - Player B',
      startTime: '2026-11-22T15:00:00Z',
      marketType: 'H2H',
      marketLabel: 'Testa a Testa',
      legs: [
        {
          selectionKey: 'HOME',
          selectionLabel: 'Player A (1)',
          bookmakerId: 'leovegas_it',
          bookmakerName: 'LeoVegas.it',
          bookmakerColor: '#ff8a1f',
          odds: 2.2,
        },
        {
          selectionKey: 'AWAY',
          selectionLabel: 'Player B (2)',
          bookmakerId: 'pinnacle',
          bookmakerName: 'Pinnacle',
          bookmakerColor: '#3b82f6',
          odds: 2.0,
        },
      ],
      impliedProbSum: 1 / 2.2 + 1 / 2.0,
      rating: 104.76,
      isSurebet: true,
      updatedAt: Date.now(),
    };

    const res = calculateDutcher({ row, stake: 100, anchorMode: 'total' });
    expect(res.rating).toBeGreaterThan(104);
    expect(res.guaranteedProfit).toBeGreaterThan(4.5);
    expect(Math.abs(res.profits[0] - res.profits[1])).toBeLessThan(0.05);
  });
});

describe('Punta-Punta Standalone Calculator', () => {
  it('computes normal 2-way surebet accurately for both leg0 and total anchors', () => {
    const leg0 = calculatePuntaPunta({
      mode: 'normal',
      stake: 100,
      odds: [2.2, 2.0],
      anchorMode: 'leg0',
    });
    expect(leg0.stakes[0]).toBe(100);
    expect(leg0.stakes[1]).toBe(110);
    expect(leg0.totalCashOutlay).toBe(210);
    expect(leg0.profits[0]).toBeCloseTo(10, 2);
    expect(leg0.profits[1]).toBeCloseTo(10, 2);
    expect(leg0.rating).toBeGreaterThan(104);

    const total = calculatePuntaPunta({
      mode: 'normal',
      stake: 100,
      odds: [2.2, 2.0],
      anchorMode: 'total',
    });
    expect(total.totalCashOutlay).toBeCloseTo(100, 1);
    expect(Math.abs(total.profits[0] - total.profits[1])).toBeLessThan(0.05);
    expect(total.guaranteedProfit).toBeGreaterThan(4.5);
    expect(total.rating).toBeGreaterThan(104);
  });

  it('computes Freebet SNR 2-way Punta-Punta extraction accurately', () => {
    const res = calculatePuntaPunta({
      mode: 'snr',
      stake: 100,
      odds: [5.0, 1.25],
    });
    expect(res.stakes[0]).toBe(100);
    expect(res.stakes[1]).toBe(320);
    expect(res.totalCashOutlay).toBe(320);
    expect(res.profits).toEqual([80, 80]);
    expect(res.rating).toBe(80);
  });

  it('computes Bonus SR 2-way Punta-Punta extraction accurately', () => {
    const res = calculatePuntaPunta({
      mode: 'sr',
      stake: 50,
      odds: [2.0, 2.0],
    });
    expect(res.stakes).toEqual([50, 50]);
    expect(res.totalCashOutlay).toBe(50);
    expect(res.profits).toEqual([50, 50]);
    expect(res.rating).toBe(100);
  });

  it('computes Rimborso RF 3-way Punta-Punta equalizing all 3 outcomes', () => {
    const res = calculatePuntaPunta({
      mode: 'rf',
      stake: 50,
      odds: [3.0, 3.2, 2.6],
      refundAmount: 50,
      refundRetention: 70, // effectiveRefund = 35
    });
    expect(res.effectiveRefund).toBe(35);
    expect(res.totalCashOutlay).toBeCloseTo(130.17, 2);
    expect(res.profits[0]).toBeCloseTo(19.83, 1);
    expect(res.profits[1]).toBeCloseTo(19.83, 1);
    expect(res.profits[2]).toBeCloseTo(19.83, 1);
    expect(Math.abs(Math.max(...res.profits) - Math.min(...res.profits))).toBeLessThan(0.05);
  });

  it('supports Underlay and Overlay balancing across Normal (qualifying & surebet, leg0 & total), SNR/SR, and RF', () => {
    // 1. Normal qualifying bet (leg0)
    const qualUnder = calculatePuntaPunta({
      mode: 'normal',
      stake: 100,
      odds: [2.0, 1.9],
      anchorMode: 'leg0',
      balanceBias: -1,
    });
    expect(qualUnder.hedgeTotal).toBeCloseTo(100, 2);
    expect(qualUnder.profits[0]).toBeCloseTo(0, 1);
    expect(qualUnder.profits[1]).toBeLessThan(0);

    const qualOver = calculatePuntaPunta({
      mode: 'normal',
      stake: 100,
      odds: [2.0, 1.9],
      anchorMode: 'leg0',
      balanceBias: 1,
    });
    expect(qualOver.profits[1]).toBeCloseTo(0, 1);
    expect(qualOver.profits[0]).toBeLessThan(0);
    expect(qualUnder.underlayHedgeTotal).toBeLessThan(qualUnder.balancedHedgeTotal);
    expect(qualOver.overlayHedgeTotal).toBeGreaterThan(qualOver.balancedHedgeTotal);

    // 2. Normal surebet (leg0)
    const sureUnder = calculatePuntaPunta({
      mode: 'normal',
      stake: 100,
      odds: [2.2, 2.0],
      anchorMode: 'leg0',
      balanceBias: -1,
    });
    expect(sureUnder.profits[0]).toBeCloseTo(20, 1);
    expect(sureUnder.profits[1]).toBeCloseTo(0, 1);

    const sureOver = calculatePuntaPunta({
      mode: 'normal',
      stake: 100,
      odds: [2.2, 2.0],
      anchorMode: 'leg0',
      balanceBias: 1,
    });
    expect(sureOver.profits[0]).toBeCloseTo(0, 1);
    expect(sureOver.profits[1]).toBeCloseTo(20, 1);

    // 3. Normal 3-way with total budget anchor keeps totalCashOutlay === 100
    const totUnder = calculatePuntaPunta({
      mode: 'normal',
      stake: 100,
      odds: [2.4, 2.8, 3.8],
      anchorMode: 'total',
      balanceBias: -1,
    });
    expect(totUnder.totalCashOutlay).toBeCloseTo(100, 1);
    expect(totUnder.profits[0]).toBeCloseTo(0, 1);
    expect(totUnder.profits[1]).toBeCloseTo(totUnder.profits[2], 1);
    expect(totUnder.profits[1]).toBeLessThan(0);

    const totOver = calculatePuntaPunta({
      mode: 'normal',
      stake: 100,
      odds: [2.4, 2.8, 3.8],
      anchorMode: 'total',
      balanceBias: 1,
    });
    expect(totOver.totalCashOutlay).toBeCloseTo(100, 1);
    expect(totOver.profits[0]).toBeLessThan(0);
    expect(totOver.profits[1]).toBeCloseTo(0, 1);
    expect(totOver.profits[2]).toBeCloseTo(0, 1);

    // 4. SNR uses ±15% hedge adjustment
    const snrUnder = calculatePuntaPunta({
      mode: 'snr',
      stake: 100,
      odds: [5.0, 1.25],
      balanceBias: -1,
    });
    expect(snrUnder.hedgeTotal).toBeCloseTo(320 * 0.85, 2);
    expect(snrUnder.profits[0]).toBeGreaterThan(snrUnder.profits[1]);

    const snrOver = calculatePuntaPunta({
      mode: 'snr',
      stake: 100,
      odds: [5.0, 1.25],
      balanceBias: 1,
    });
    expect(snrOver.hedgeTotal).toBeCloseTo(320 * 1.15, 2);
    expect(snrOver.profits[1]).toBeGreaterThan(snrOver.profits[0]);

    // 5. RF 3-way Underlay & Overlay
    const rfUnder = calculatePuntaPunta({
      mode: 'rf',
      stake: 50,
      odds: [3.0, 3.2, 2.6],
      refundAmount: 50,
      refundRetention: 70,
      balanceBias: -1,
    });
    expect(rfUnder.profits[0]).toBeGreaterThan(20);
    expect(rfUnder.profits[1]).toBeCloseTo(0, 1);
    expect(rfUnder.profits[2]).toBeCloseTo(0, 1);

    const rfOver = calculatePuntaPunta({
      mode: 'rf',
      stake: 50,
      odds: [3.0, 3.2, 2.6],
      refundAmount: 50,
      refundRetention: 70,
      balanceBias: 1,
    });
    expect(rfOver.profits[0]).toBeCloseTo(0, 1);
    expect(rfOver.profits[1]).toBeGreaterThan(20);
    expect(rfOver.profits[2]).toBeGreaterThan(20);
  });
});

describe('Fuzzy Match Linker', () => {
  it('normalizes Italian and English team aliases accurately', () => {
    expect(normalizeTeamName('Bayern Monaco')).toBe('bayern munich');
    expect(normalizeTeamName('FC Bayern München')).toBe('bayern munich');
    expect(teamSimilarity('Inter Milan', 'FC Internazionale Milano', 'football')).toBeGreaterThan(0.9);
    expect(teamSimilarity('C. Alcaraz', 'Alcaraz, Carlos', 'tennis')).toBeGreaterThan(0.9);
  });

  it('links reversed Home/Away feeds while swapping selections safely', () => {
    const m1: RawScrapedMarket = {
      sourceId: 'betfair_exchange',
      sourceName: 'Betfair Exchange IT',
      sourceKind: 'exchange',
      sport: 'tennis',
      league: 'ATP',
      eventId: '1',
      eventName: 'Carlos Alcaraz - Ben Shelton',
      homeTeam: 'Carlos Alcaraz',
      awayTeam: 'Ben Shelton',
      startTime: '2026-11-22T15:00:00Z',
      marketType: 'H2H',
      marketLabel: 'Testa a Testa',
      selections: [
        { canonicalKey: 'HOME', label: 'Alcaraz', layOdds: 1.4, layLiquidity: 500 },
        { canonicalKey: 'AWAY', label: 'Shelton', layOdds: 3.4, layLiquidity: 300 },
      ],
      scrapedAt: Date.now(),
    };

    const m2: RawScrapedMarket = {
      sourceId: 'pinnacle',
      sourceName: 'Pinnacle',
      sourceKind: 'bookmaker',
      sport: 'tennis',
      league: 'ATP',
      eventId: '2',
      eventName: 'Ben Shelton - C. Alcaraz',
      homeTeam: 'Ben Shelton',
      awayTeam: 'C. Alcaraz',
      startTime: '2026-11-22T15:00:00Z',
      marketType: 'H2H',
      marketLabel: 'Testa a Testa',
      selections: [
        { canonicalKey: 'HOME', label: 'Shelton', backOdds: 3.35 },
        { canonicalKey: 'AWAY', label: 'Alcaraz', backOdds: 1.38 },
      ],
      scrapedAt: Date.now(),
    };

    const groups = linkScrapedMarkets([m1, m2]);
    expect(groups.length).toBe(1);
    const entries = groups[0].marketsByType.get('H2H')!;
    expect(entries.length).toBe(2);
    const pinEntry = entries.find((e) => e.market.sourceId === 'pinnacle')!;
    expect(pinEntry.swapped).toBe(true);
    // After swap, Alcaraz (1.38) must be aligned under HOME to match Betfair's Alcaraz (1.40)
    const homeSel = pinEntry.selections.find((s) => s.canonicalKey === 'HOME')!;
    expect(homeSel.backOdds).toBe(1.38);
  });
});

describe('Connection Health Diagnostics', () => {
  const makeSrc = (
    id: SourceStatus['id'],
    kind: SourceStatus['kind'],
    state: SourceStatus['state'],
    lastError: string | null = null
  ): SourceStatus => ({
    id,
    name: id,
    shortName: id,
    kind,
    color: '#fff',
    enabled: state !== 'disabled',
    state,
    latencyMs: 0,
    eventsCount: state === 'ok' ? 10 : 0,
    marketsCount: state === 'ok' ? 20 : 0,
    lastScrapedAt: Date.now(),
    lastError,
    successCount: state === 'ok' ? 1 : 0,
    errorCount: state === 'error' ? 1 : 0,
  });

  it('detects offline when system is offline or all enabled sources fail', () => {
    const diagOfflineOs = computeConnectionDiagnostic({
      sources: [makeSrc('betfair_exchange', 'exchange', 'idle')],
      isSystemOnline: false,
      hasCompletedCycle: true,
    });
    expect(diagOfflineOs.health).toBe('offline');
    expect(diagOfflineOs.isSystemOnline).toBe(false);

    const diagAllFailed = computeConnectionDiagnostic({
      sources: [
        makeSrc('betfair_exchange', 'exchange', 'error', 'TypeError: fetch failed'),
        makeSrc('sisal_it', 'bookmaker', 'error', 'getaddrinfo ENOTFOUND'),
      ],
      isSystemOnline: true,
      hasCompletedCycle: true,
    });
    expect(diagAllFailed.health).toBe('offline');
    expect(diagAllFailed.failedSourcesCount).toBe(2);
    expect(diagAllFailed.lastErrorSummary).toContain('Connessione internet');
  });

  it('detects degraded when some sources fail while exchanges and bookmakers remain reachable', () => {
    const diag = computeConnectionDiagnostic({
      sources: [
        makeSrc('betfair_exchange', 'exchange', 'ok'),
        makeSrc('sisal_it', 'bookmaker', 'ok'),
        makeSrc('snai_it', 'bookmaker', 'error', 'AbortError: timeout'),
      ],
      isSystemOnline: true,
      hasCompletedCycle: true,
    });
    expect(diag.health).toBe('degraded');
    expect(diag.failedSourcesCount).toBe(1);
    expect(formatFriendlyNetworkError('AbortError: timeout')).toContain('Timeout');
  });

  it('does not falsely report offline mid-cycle while another exchange is still scraping', () => {
    const diagMidCycle = computeConnectionDiagnostic({
      sources: [
        makeSrc('betflag_exchange', 'exchange', 'error', 'HTTP 403'),
        makeSrc('betfair_exchange', 'exchange', 'scraping'),
        makeSrc('sisal_it', 'bookmaker', 'ok'),
      ],
      isSystemOnline: true,
      hasCompletedCycle: true,
    });
    expect(diagMidCycle.health).toBe('degraded');
    expect(diagMidCycle.health).not.toBe('offline');
  });
});

describe('Manual Multiodds Validation Engine', () => {
  const nowMs = new Date('2026-11-22T12:00:00Z').getTime();

  it('enforces exact >= 2h (120m) chronological gap before, after, and between legs', () => {
    const leg1800 = makeRow({
      id: 'leg1',
      eventKey: 'ev1',
      bookmakerId: 'sisal_it',
      bookmakerName: 'Sisal.it',
      startTime: '2026-11-22T18:00:00Z',
    });

    // 1h 59m after -> rejected
    const tooCloseAfter = makeRow({
      id: 'c1',
      eventKey: 'ev_c1',
      bookmakerId: 'sisal_it',
      startTime: '2026-11-22T19:59:00Z',
    });
    const resTooClose = validateManualMultipleCandidate(tooCloseAfter, [leg1800], { nowMs });
    expect(resTooClose.eligible).toBe(false);
    expect(resTooClose.reason).toBe('time_gap');
    expect(resTooClose.gapMinutes).toBe(119);
    expect(resTooClose.conflictStepIndex).toBe(1);

    // Exactly 2h 00m after -> accepted
    const exactAfter = makeRow({
      id: 'c2',
      eventKey: 'ev_c2',
      bookmakerId: 'sisal_it',
      startTime: '2026-11-22T20:00:00Z',
    });
    expect(validateManualMultipleCandidate(exactAfter, [leg1800], { nowMs }).eligible).toBe(true);

    // Exactly 2h 00m before -> accepted; 1h 59m before -> rejected
    const exactBefore = makeRow({
      id: 'c3',
      eventKey: 'ev_c3',
      bookmakerId: 'sisal_it',
      startTime: '2026-11-22T16:00:00Z',
    });
    expect(validateManualMultipleCandidate(exactBefore, [leg1800], { nowMs }).eligible).toBe(true);

    const tooCloseBefore = makeRow({
      id: 'c4',
      eventKey: 'ev_c4',
      bookmakerId: 'sisal_it',
      startTime: '2026-11-22T16:01:00Z',
    });
    expect(validateManualMultipleCandidate(tooCloseBefore, [leg1800], { nowMs }).reason).toBe('time_gap');

    // Inserting between 15:00 and 20:00
    const leg1500 = makeRow({
      id: 'leg15',
      eventKey: 'ev15',
      bookmakerId: 'sisal_it',
      startTime: '2026-11-22T15:00:00Z',
    });
    const leg2000 = makeRow({
      id: 'leg20',
      eventKey: 'ev20',
      bookmakerId: 'sisal_it',
      startTime: '2026-11-22T20:00:00Z',
    });
    const sorted = sortMultipleLegs([leg2000, leg1500]);
    expect(sorted.map((x) => x.id)).toEqual(['leg15', 'leg20']);

    const betweenValid = makeRow({
      id: 'c5',
      eventKey: 'ev_c5',
      bookmakerId: 'sisal_it',
      startTime: '2026-11-22T17:30:00Z',
    });
    expect(validateManualMultipleCandidate(betweenValid, [leg1500, leg2000], { nowMs }).eligible).toBe(true);

    const betweenInvalid = makeRow({
      id: 'c6',
      eventKey: 'ev_c6',
      bookmakerId: 'sisal_it',
      startTime: '2026-11-22T18:30:00Z',
    });
    const resMid = validateManualMultipleCandidate(betweenInvalid, [leg1500, leg2000], { nowMs });
    expect(resMid.eligible).toBe(false);
    expect(resMid.reason).toBe('time_gap');
    expect(resMid.conflictStepIndex).toBe(2);
  });

  it('rejects different bookmaker, duplicate event, past start time, zero liquidity, duplicate selection, and max legs', () => {
    const leg1 = makeRow({
      id: 'leg1',
      eventKey: 'ev1',
      bookmakerId: 'sisal_it',
      bookmakerName: 'Sisal.it',
      startTime: '2026-11-22T15:00:00Z',
    });

    expect(
      validateManualMultipleCandidate(
        makeRow({ id: 'd_book', eventKey: 'ev_x', bookmakerId: 'snai_it', startTime: '2026-11-22T19:00:00Z' }),
        [leg1],
        { nowMs }
      ).reason
    ).toBe('different_bookmaker');

    expect(
      validateManualMultipleCandidate(
        makeRow({ id: 'same_ev', eventKey: 'ev1', bookmakerId: 'sisal_it', startTime: '2026-11-22T19:00:00Z' }),
        [leg1],
        { nowMs }
      ).reason
    ).toBe('same_event');

    expect(
      validateManualMultipleCandidate(
        makeRow({ id: 'past', eventKey: 'ev_p', bookmakerId: 'sisal_it', startTime: '2026-11-22T11:30:00Z' }),
        [leg1],
        { nowMs }
      ).reason
    ).toBe('event_started');

    expect(
      validateManualMultipleCandidate(
        makeRow({ id: 'zero_liq', eventKey: 'ev_z', bookmakerId: 'sisal_it', startTime: '2026-11-22T19:00:00Z', liquidity: 0 }),
        [leg1],
        { nowMs }
      ).reason
    ).toBe('no_liquidity');

    expect(
      validateManualMultipleCandidate(leg1, [leg1], { nowMs }).reason
    ).toBe('already_selected');

    expect(
      validateManualMultipleCandidate(
        makeRow({ id: 'extra', eventKey: 'ev_ext', bookmakerId: 'sisal_it', startTime: '2026-11-23T12:00:00Z' }),
        [leg1],
        { nowMs, maxLegs: 1 }
      ).reason
    ).toBe('max_legs');
  });
});

describe('Rating Watch Engine & Adaptive Interval', () => {
  const makeWatch = (partial?: Partial<RatingWatch>): RatingWatch => ({
    id: 'w1',
    createdAt: 1000,
    updatedAt: 1000,
    enabled: true,
    eventKey: 'football:2026-11-22:inter__milan',
    eventName: 'Inter - Milan',
    sport: 'football',
    league: 'Serie A',
    startTime: '2026-11-22T20:00:00Z',
    marketType: '1X2',
    selectionKey: 'ALL',
    bookmakerIds: ['sisal_it'],
    exchangeIds: ['betfair_exchange'],
    mode: 'normal',
    targetRating: 98.5,
    refundRetention: 70,
    minLiquidity: 20,
    minBackOdds: 1.2,
    maxBackOdds: 15,
    autoPauseOnTrigger: true,
    cooldownSec: 60,
    lastCheckedAt: null,
    lastBestMatch: null,
    lastTriggeredAt: null,
    triggerCount: 0,
    ...partial,
  });

  it('matches event/filters/target rating and respects cooldown and expiry', () => {
    const nowMs = new Date('2026-11-22T15:00:00Z').getTime();
    const rowLow = makeRow({
      id: 'r_low',
      eventKey: 'football:2026-11-22:inter__milan',
      eventName: 'Inter - Milan',
      homeTeam: 'Inter',
      awayTeam: 'Milan',
      startTime: '2026-11-22T20:00:00Z',
      bookmakerId: 'sisal_it',
      bookmakerName: 'Sisal.it',
      exchangeId: 'betfair_exchange',
      backOdds: 2.0,
      layOdds: 2.06,
      commission: 0.045,
      liquidity: 120,
    });
    const rowHigh = makeRow({
      id: 'r_high',
      eventKey: 'football:2026-11-22:inter__milan',
      eventName: 'Inter - Milan',
      homeTeam: 'Inter',
      awayTeam: 'Milan',
      startTime: '2026-11-22T20:00:00Z',
      selectionKey: 'DRAW',
      selectionLabel: 'Pareggio (X)',
      bookmakerId: 'sisal_it',
      bookmakerName: 'Sisal.it',
      exchangeId: 'betfair_exchange',
      backOdds: 3.5,
      layOdds: 3.4, // >100% surebet
      commission: 0.045,
      liquidity: 85,
    });
    const rowOtherBookie = makeRow({
      id: 'r_snai',
      eventKey: 'football:2026-11-22:inter__milan',
      eventName: 'Inter - Milan',
      homeTeam: 'Inter',
      awayTeam: 'Milan',
      startTime: '2026-11-22T20:00:00Z',
      bookmakerId: 'snai_it',
      backOdds: 3.6,
      layOdds: 3.4,
      liquidity: 200,
    });

    const watch = makeWatch({ targetRating: 99.0 });
    const eval1 = evaluateRatingWatch(watch, [rowLow, rowHigh, rowOtherBookie], { nowMs });
    expect(eval1.isExpired).toBe(false);
    expect(eval1.bestMatch?.rowId).toBe('r_high');
    expect(eval1.bestMatch?.rating).toBeGreaterThan(99.0);
    expect(eval1.shouldTrigger).toBe(true);

    // Filter by selectionKey HOME excludes DRAW rowHigh -> falls back to rowLow (<99%)
    const evalHomeOnly = evaluateRatingWatch(
      makeWatch({ selectionKey: 'HOME', targetRating: 99.0 }),
      [rowLow, rowHigh],
      { nowMs }
    );
    expect(evalHomeOnly.bestMatch?.rowId).toBe('r_low');
    expect(evalHomeOnly.shouldTrigger).toBe(false);

    // Respects cooldown window
    const evalCooldown = evaluateRatingWatch(
      makeWatch({ targetRating: 99.0, lastTriggeredAt: nowMs - 20_000, cooldownSec: 60 }),
      [rowHigh],
      { nowMs }
    );
    expect(evalCooldown.shouldTrigger).toBe(false);

    // SNR mode evaluation
    const evalSnr = evaluateRatingWatch(
      makeWatch({ mode: 'snr', targetRating: 70.0 }),
      [rowHigh],
      { nowMs }
    );
    expect(evalSnr.bestMatch?.rating).toBeGreaterThan(70);
    expect(evalSnr.shouldTrigger).toBe(true);

    // Expiry check after kickoff + 5 min grace
    expect(
      isWatchExpired(watch, new Date('2026-11-22T20:06:00Z').getTime(), false)
    ).toBe(true);
    expect(
      isWatchExpired(watch, new Date('2026-11-22T20:06:00Z').getTime(), true)
    ).toBe(false);
  });

  it('scales polling interval monotonically with selected sources and applies safety floors', () => {
    const nowMs = new Date('2026-11-22T15:00:00Z').getTime();
    const baseSettings = {
      ...DEFAULT_SETTINGS,
      theOddsApiKey: 'test-key-123456',
    };

    const planMinimal = computeAdaptiveWatchPlan(
      [makeWatch({ bookmakerIds: ['sisal_it'], exchangeIds: ['betfair_exchange'] })],
      baseSettings,
      nowMs
    );
    expect(planMinimal.intervalSec).toBe(8);
    expect(planMinimal.bookmakerIds).toEqual(['sisal_it']);
    expect(planMinimal.exchangeIds).toEqual(['betfair_exchange']);
    expect(planMinimal.sports).toEqual(['football']);

    const planFiveAdm = computeAdaptiveWatchPlan(
      [
        makeWatch({
          bookmakerIds: ['sisal_it', 'snai_it', 'betflag_it', 'eurobet_it', 'goldbet_it'],
          exchangeIds: ['betfair_exchange', 'smarkets_exchange'],
        }),
      ],
      baseSettings,
      nowMs
    );
    expect(planFiveAdm.intervalSec).toBeGreaterThan(planMinimal.intervalSec!);

    const planOneKambi = computeAdaptiveWatchPlan(
      [makeWatch({ bookmakerIds: ['888sport_it'], exchangeIds: ['betfair_exchange'] })],
      baseSettings,
      nowMs
    );
    expect(planOneKambi.intervalSec).toBeGreaterThanOrEqual(15);
    expect(planOneKambi.rateLimitReasons.some((r) => r.includes('Kambi'))).toBe(true);

    const planTwoKambi = computeAdaptiveWatchPlan(
      [
        makeWatch({
          bookmakerIds: ['888sport_it', 'leovegas_it'],
          exchangeIds: ['betfair_exchange'],
        }),
      ],
      baseSettings,
      nowMs
    );
    expect(planTwoKambi.intervalSec).toBeGreaterThanOrEqual(20);

    const planOddsApi = computeAdaptiveWatchPlan(
      [makeWatch({ bookmakerIds: ['the_odds_api'], exchangeIds: ['betfair_exchange'] })],
      baseSettings,
      nowMs
    );
    expect(planOddsApi.intervalSec).toBeGreaterThanOrEqual(60);

    // Hints match swapped or alias team names cleanly
    expect(
      matchesEventHints(
        'FC Internazionale Milano - AC Milan',
        'FC Internazionale Milano',
        'AC Milan',
        'football',
        [{ eventName: 'Milan - Inter', sport: 'football' }]
      )
    ).toBe(true);
  });

  it('supports eventless filter-only RatingWatch (only bookmaker/exchange/sport/rating filters)', () => {
    const nowMs = Date.now();
    const futureIso = new Date(nowMs + 2 * 3600_000).toISOString();
    const wildcardWatch: RatingWatch = {
      id: 'w-wildcard',
      createdAt: nowMs,
      updatedAt: nowMs,
      enabled: true,
      eventName: '',
      marketType: 'ALL',
      selectionKey: 'ALL',
      bookmakerIds: ['sisal_it'],
      exchangeIds: ['betfair_exchange'],
      mode: 'normal',
      targetRating: 99,
      refundRetention: 70,
      minLiquidity: 10,
      minBackOdds: 1.2,
      maxBackOdds: 15,
      autoPauseOnTrigger: true,
      cooldownSec: 60,
      lastCheckedAt: null,
      lastBestMatch: null,
      lastTriggeredAt: null,
      triggerCount: 0,
    };

    const rows = [
      makeRow({
        id: 'other-bk',
        eventName: 'Roma - Lazio',
        startTime: futureIso,
        bookmakerId: 'snai_it',
        bookmakerName: 'SNAI.it',
        exchangeId: 'betfair_exchange',
        backOdds: 2.2,
        layOdds: 2.1,
        commission: 0.045,
        liquidity: 100,
      }),
      makeRow({
        id: 'target-bk',
        eventName: 'Juventus - Torino',
        startTime: futureIso,
        bookmakerId: 'sisal_it',
        bookmakerName: 'Sisal.it',
        exchangeId: 'betfair_exchange',
        backOdds: 2.1,
        layOdds: 2.04,
        commission: 0.045,
        liquidity: 120,
      }),
    ];

    const res = evaluateRatingWatch(wildcardWatch, rows, { nowMs });
    expect(res.isExpired).toBe(false);
    expect(res.bestMatch?.eventName).toBe('Juventus - Torino');
    expect(res.bestMatch?.bookmakerId).toBe('sisal_it');
    expect(res.shouldTrigger).toBe(true);

    // When an eventless watch is active, adaptive plan keeps eventHints empty so targeted scrape does not drop events
    const plan = computeAdaptiveWatchPlan([wildcardWatch], DEFAULT_SETTINGS, nowMs);
    expect(plan.activeWatches).toHaveLength(1);
    expect(plan.bookmakerIds).toEqual(['sisal_it']);
    expect(plan.exchangeIds).toEqual(['betfair_exchange']);
    expect(plan.eventHints).toEqual([]);
  });

  it('filters watches by competition (Serie A, Serie B, LaLiga, Bundesliga, ATP, NBA) across multi-source league labels', () => {
    expect(resolveCanonicalCompetition('ITALIA: Serie A', 'football')).toBe('Serie A');
    expect(resolveCanonicalCompetition('Italy Serie B', 'football')).toBe('Serie B');
    expect(resolveCanonicalCompetition('SPAGNA: LaLiga', 'football')).toBe('LaLiga');
    expect(resolveCanonicalCompetition('Spain La Liga', 'football')).toBe('LaLiga');
    expect(resolveCanonicalCompetition('ATP - SINGOLARE: Roma', 'tennis')).toBe('ATP');
    expect(resolveCanonicalCompetition('USA: NBA', 'basketball')).toBe('NBA');

    expect(matchesWatchLeague('Serie A', 'ITALIA: Serie A', 'football')).toBe(true);
    expect(matchesWatchLeague('Serie A', 'Italy Serie A', 'football')).toBe(true);
    expect(matchesWatchLeague('Serie A', 'ITALIA: Serie B', 'football')).toBe(false);
    expect(matchesWatchLeague('Serie A', 'BRASILE: Serie A', 'football')).toBe(false);
    expect(matchesWatchLeague('Serie A', 'Serie A', 'basketball')).toBe(false);
    expect(matchesWatchLeague('Bundesliga', 'GERMANIA: Bundesliga', 'football')).toBe(true);
    expect(matchesWatchLeague('Bundesliga', 'GERMANIA: 2. Bundesliga', 'football')).toBe(false);

    const nowMs = Date.now();
    const futureIso = new Date(nowMs + 3600_000).toISOString();

    const serieBWatch = makeWatch({
      eventKey: undefined,
      eventName: '',
      sport: undefined,
      league: 'Serie B',
      startTime: undefined,
      bookmakerIds: [],
      exchangeIds: [],
      targetRating: 95,
    });

    const rows: OddsmatcherRow[] = [
      makeRow({
        id: 'serie-a-higher',
        eventName: 'Inter - Napoli',
        league: 'ITALIA: Serie A',
        startTime: futureIso,
        backOdds: 2.2,
        layOdds: 2.04,
      }),
      makeRow({
        id: 'serie-b-match',
        eventName: 'Palermo - Bari',
        league: 'ITALIA: Serie B',
        startTime: futureIso,
        backOdds: 2.05,
        layOdds: 2.04,
      }),
    ];

    const res = evaluateRatingWatch(serieBWatch, rows, { nowMs });
    expect(res.bestMatch?.rowId).toBe('serie-b-match');
    expect(res.bestMatch?.eventName).toBe('Palermo - Bari');
    expect(res.shouldTrigger).toBe(true);

    const plan = computeAdaptiveWatchPlan([serieBWatch], DEFAULT_SETTINGS, nowMs);
    expect(plan.sports).toEqual(['football']);
    expect(plan.eventHints).toEqual([]);

    // Multi-select competitions: ['Serie B', 'Premier League'] matches either and excludes Serie A
    expect(matchesWatchLeagues(['Serie B', 'Premier League'], 'ITALIA: Serie B', 'football')).toBe(
      true
    );
    expect(
      matchesWatchLeagues(['Serie B', 'Premier League'], 'England Premier League', 'football')
    ).toBe(true);
    expect(matchesWatchLeagues(['Serie B', 'Premier League'], 'ITALIA: Serie A', 'football')).toBe(
      false
    );

    const multiLeagueWatch = makeWatch({
      eventKey: undefined,
      eventName: '',
      sport: undefined,
      league: 'Serie A',
      leagues: ['Serie A', 'ATP'],
      startTime: undefined,
      bookmakerIds: [],
      exchangeIds: [],
      targetRating: 95,
    });
    const multiEval = evaluateRatingWatch(multiLeagueWatch, rows, { nowMs });
    expect(multiEval.bestMatch?.rowId).toBe('serie-a-higher');

    const multiPlan = computeAdaptiveWatchPlan([multiLeagueWatch], DEFAULT_SETTINGS, nowMs);
    expect(multiPlan.sports).toEqual(['football', 'tennis']);

    expect(formatFittingListSummary(['Serie A', 'Serie B'], 26)).toBe('Serie A, Serie B');
    expect(formatFittingListSummary(['Serie A', 'Serie B', 'Serie C'], 26)).toBe(
      'Serie A, Serie B, Serie C'
    );
    expect(
      formatFittingListSummary(['Serie A', 'Serie B', 'Serie C', 'Premier League'], 26)
    ).toBe('Serie A, Serie B +2');
  });

  it('builds Top Competizioni preset across football 1st/2nd tiers, tennis ATP/international, and basketball NBA/top', () => {
    const allTop = getTopCompetitionValues('ALL');
    const footballTop = getTopCompetitionValues('football');
    const tennisTop = getTopCompetitionValues('tennis');
    const basketTop = getTopCompetitionValues('basketball');

    expect(footballTop).toContain('Serie A');
    expect(footballTop).toContain('Serie B');
    expect(footballTop).not.toContain('Serie C');
    expect(footballTop).toContain('Premier League');
    expect(footballTop).toContain('Championship');
    expect(footballTop).toContain('LaLiga');
    expect(footballTop).toContain('LaLiga 2');
    expect(footballTop).toContain('Bundesliga');
    expect(footballTop).toContain('2. Bundesliga');
    expect(footballTop).toContain('Ligue 1');
    expect(footballTop).toContain('Ligue 2');
    expect(footballTop).toContain('Eredivisie');
    expect(footballTop).toContain('Eerste Divisie');
    expect(footballTop).toContain('Liga Portugal');
    expect(footballTop).toContain('Liga Portugal 2');
    expect(footballTop).toContain('Champions League');

    expect(tennisTop).toContain('ATP');
    expect(tennisTop).toContain('WTA');
    expect(tennisTop).toContain('Grand Slam');
    expect(tennisTop).toContain('Tornei Internazionali');
    expect(tennisTop).not.toContain('Challenger');

    expect(basketTop).toContain('NBA');
    expect(basketTop).toContain('Eurolega');
    expect(basketTop).toContain('Serie A Basket');

    expect(allTop.length).toBe(footballTop.length + tennisTop.length + basketTop.length);

    expect(resolveCanonicalCompetition('SPAGNA: LaLiga 2', 'football')).toBe('LaLiga 2');
    expect(resolveCanonicalCompetition('Spain LaLiga Hypermotion', 'football')).toBe('LaLiga 2');
    expect(resolveCanonicalCompetition('GERMANIA: 2. Bundesliga', 'football')).toBe('2. Bundesliga');
    expect(resolveCanonicalCompetition('FRANCIA: Ligue 2', 'football')).toBe('Ligue 2');
    expect(resolveCanonicalCompetition('OLANDA: Eerste Divisie', 'football')).toBe('Eerste Divisie');
    expect(resolveCanonicalCompetition('PORTOGALLO: Liga Portugal 2', 'football')).toBe('Liga Portugal 2');
    expect(resolveCanonicalCompetition('COPPA DAVIS - GRUPPO MONDIALE', 'tennis')).toBe(
      'Tornei Internazionali'
    );
    expect(resolveCanonicalCompetition('United Cup', 'tennis')).toBe('Tornei Internazionali');

    expect(matchesWatchLeagues(allTop, 'ITALIA: Serie B', 'football')).toBe(true);
    expect(matchesWatchLeagues(allTop, 'SPAGNA: LaLiga 2', 'football')).toBe(true);
    expect(matchesWatchLeagues(allTop, 'GERMANIA: 2. Bundesliga', 'football')).toBe(true);
    expect(matchesWatchLeagues(allTop, 'FRANCIA: Ligue 2', 'football')).toBe(true);
    expect(matchesWatchLeagues(allTop, 'ATP - SINGOLARE: Roma', 'tennis')).toBe(true);
    expect(matchesWatchLeagues(allTop, 'Davis Cup', 'tennis')).toBe(true);
    expect(matchesWatchLeagues(allTop, 'USA: NBA', 'basketball')).toBe(true);

    expect(matchesWatchLeagues(allTop, 'ITALIA: Serie C', 'football')).toBe(false);
    expect(matchesWatchLeagues(allTop, 'BRASILE: Serie A', 'football')).toBe(false);
    expect(matchesWatchLeagues(allTop, 'ATP Challenger: Milano', 'tennis')).toBe(false);
    expect(matchesWatchLeagues(allTop, 'USA: WNBA', 'basketball')).toBe(false);
  });

  it('filters RatingWatch by calendar dateRange, prioritizes competitions in range, and sets adaptive plan dateWindow', () => {
    const baseNow = new Date(2026, 10, 24, 12, 0, 0, 0).getTime(); // 2026-11-24 12:00 local
    const todayIso = new Date(2026, 10, 24, 20, 0, 0, 0).toISOString();
    const weekendSatIso = new Date(2026, 10, 28, 18, 0, 0, 0).toISOString();
    const weekendSunIso = new Date(2026, 10, 29, 20, 45, 0, 0).toISOString();

    const todayRow = makeRow({
      id: 'today-row',
      eventKey: 'ev_today',
      eventName: 'Inter - Napoli',
      league: 'ITALIA: Serie A',
      startTime: todayIso,
      backOdds: 2.3,
      layOdds: 2.1, // higher rating, but outside weekend range
    });
    const satRow = makeRow({
      id: 'sat-row',
      eventKey: 'ev_sat',
      eventName: 'Arsenal - Chelsea',
      league: 'INGHILTERRA: Premier League',
      startTime: weekendSatIso,
      backOdds: 2.1,
      layOdds: 2.04,
    });
    const sunExtraRow = makeRow({
      id: 'sun-row',
      eventKey: 'ev_sun',
      eventName: 'Feyenoord - Ajax',
      league: 'OLANDA: Eredivisie',
      startTime: weekendSunIso,
      backOdds: 2.05,
      layOdds: 2.04,
    });

    const weekendWatch = makeWatch({
      eventKey: undefined,
      eventName: '',
      sport: undefined,
      league: undefined,
      leagues: [],
      startTime: undefined,
      dateRange: { mode: 'range', startDate: '2026-11-28', endDate: '2026-11-29' },
      bookmakerIds: [],
      exchangeIds: [],
      targetRating: 95,
    });

    // Today's row is ignored even though it has a higher rating; Saturday's row matches
    const evRes = evaluateRatingWatch(weekendWatch, [todayRow, satRow, sunExtraRow], {
      nowMs: baseNow,
    });
    expect(evRes.isExpired).toBe(false);
    expect(evRes.bestMatch?.rowId).toBe('sat-row');
    expect(evRes.shouldTrigger).toBe(true);

    // Past dateRange expires cleanly when includeLiveEvents is false
    const pastRangeWatch = makeWatch({
      eventKey: undefined,
      eventName: '',
      startTime: undefined,
      dateRange: { mode: 'range', startDate: '2026-11-20', endDate: '2026-11-21' },
    });
    expect(isWatchExpired(pastRangeWatch, baseNow, false)).toBe(true);
    expect(isWatchExpired(pastRangeWatch, baseNow, true)).toBe(false);

    // Adaptive watch plan computes dateWindow even when general autoScrapeEnabled is false
    const stoppedAutoSettings = { ...DEFAULT_SETTINGS, autoScrapeEnabled: false };
    const planSingle = computeAdaptiveWatchPlan([weekendWatch], stoppedAutoSettings, baseNow);
    expect(planSingle.activeWatches).toHaveLength(1);
    expect(planSingle.dateWindow?.startDate).toBe('2026-11-28');
    expect(planSingle.dateWindow?.endDate).toBe('2026-11-29');

    // Mixed unrestricted + future dateRange watch widens dateWindow from today through 2026-11-29
    const nearWatch = makeWatch({
      id: 'w-near',
      eventKey: undefined,
      eventName: '',
      startTime: undefined,
      dateRange: undefined,
    });
    const planMixed = computeAdaptiveWatchPlan(
      [nearWatch, weekendWatch],
      stoppedAutoSettings,
      baseNow
    );
    expect(planMixed.dateWindow?.startDate).toBe('2026-11-24');
    expect(planMixed.dateWindow?.endDate).toBe('2026-11-29');

    // Competition options prioritize leagues present in the date-filtered event list
    const dateEvents = [satRow, sunExtraRow];
    expect(countAvailableCompetitions(dateEvents)).toBe(2);
    const prioritizedOpts = buildCompetitionOptions(dateEvents, undefined, [], true);
    expect(prioritizedOpts[0].value).toBe('Premier League');
    expect(prioritizedOpts[1].value).toBe('Eredivisie');
  });

  it('ignores excluded events in evaluateRatingWatch, falls back cleanly to next match, and restores via helper', () => {
    const baseNow = new Date('2026-11-24T12:00:00Z').getTime();
    const rowFirst = makeRow({
      id: 'ev_first|1X2|HOME|snai_it|Snai|betfair_it',
      eventKey: 'ev_first',
      eventName: 'Inter - Milan',
      homeTeam: 'Inter',
      awayTeam: 'Milan',
      league: 'Serie A',
      startTime: '2026-11-24T19:45:00Z',
      backOdds: 2.1,
      layOdds: 2.08,
      liquidity: 450,
    });
    const rowSecond = makeRow({
      id: 'ev_second|1X2|HOME|snai_it|Snai|betfair_it',
      eventKey: 'ev_second',
      eventName: 'Napoli - Roma',
      homeTeam: 'Napoli',
      awayTeam: 'Roma',
      league: 'Serie A',
      startTime: '2026-11-24T20:00:00Z',
      backOdds: 2.04,
      layOdds: 2.04,
      liquidity: 350,
    });

    const baseWatch = makeWatch({
      eventKey: undefined,
      eventName: '',
      startTime: undefined,
      sport: 'football',
      leagues: ['Serie A'],
      bookmakerIds: [],
      exchangeIds: [],
      targetRating: 95,
    });

    const initialEval = evaluateRatingWatch(baseWatch, [rowFirst, rowSecond], { nowMs: baseNow });
    expect(initialEval.shouldTrigger).toBe(true);
    expect(initialEval.bestMatch?.eventName).toBe('Inter - Milan');
    expect(extractMatchEventKey(initialEval.bestMatch!)).toBe('ev_first');

    // Ignore first match (simulate user clicking "Ignora evento")
    const ignoredList = appendIgnoredWatchEvent([], initialEval.bestMatch!, baseNow + 1000);
    expect(ignoredList).toHaveLength(1);
    // Re-appending the same event (even with missing eventKey fallback via rowId) deduplicates cleanly
    const dedupedList = appendIgnoredWatchEvent(
      ignoredList,
      { ...initialEval.bestMatch!, eventKey: undefined },
      baseNow + 2000
    );
    expect(dedupedList).toHaveLength(1);

    const watchAfterIgnore = { ...baseWatch, ignoredEvents: dedupedList };
    const afterIgnoreEval = evaluateRatingWatch(watchAfterIgnore, [rowFirst, rowSecond], {
      nowMs: baseNow + 2000,
    });
    expect(afterIgnoreEval.bestMatch?.eventName).toBe('Napoli - Roma');
    expect(afterIgnoreEval.bestMatch?.rowId).toBe(rowSecond.id);
    expect(afterIgnoreEval.shouldTrigger).toBe(true);

    // Fallback matching when eventKey differs or is absent matches by normalized name + startTime
    const watchByNameOnly = {
      ...baseWatch,
      ignoredEvents: [{ eventName: 'inter - milan', startTime: '2026-11-24T19:45:00Z', ignoredAt: baseNow }],
    };
    const rowFirstAltKey = { ...rowFirst, eventKey: 'different_source_key' };
    const altKeyEval = evaluateRatingWatch(watchByNameOnly, [rowFirstAltKey, rowSecond], {
      nowMs: baseNow + 3000,
    });
    expect(altKeyEval.bestMatch?.eventName).toBe('Napoli - Roma');

    // Restoring removes the event from ignoredEvents and allows it to win again
    const restoredList = removeIgnoredWatchEvent(dedupedList, dedupedList[0]);
    expect(restoredList).toHaveLength(0);
    const restoredEval = evaluateRatingWatch(
      { ...baseWatch, ignoredEvents: restoredList },
      [rowFirst, rowSecond],
      { nowMs: baseNow + 4000 }
    );
    expect(restoredEval.bestMatch?.eventName).toBe('Inter - Milan');
  });

  it('excludes surebet rows when excludeSurebets (No Surebet) is enabled', () => {
    const nowMs = new Date('2026-11-22T15:00:00Z').getTime();
    const surebetRow = makeRow({
      id: 'r_surebet',
      eventKey: 'football:2026-11-22:inter__milan',
      eventName: 'Inter - Milan',
      homeTeam: 'Inter',
      awayTeam: 'Milan',
      startTime: '2026-11-22T20:00:00Z',
      bookmakerId: 'sisal_it',
      exchangeId: 'betfair_exchange',
      backOdds: 3.5,
      layOdds: 3.3,
      commission: 0.045,
      isSurebet: true,
      liquidity: 150,
    });
    const qualifyingRow = makeRow({
      id: 'r_qualifying',
      eventKey: 'football:2026-11-22:inter__milan',
      eventName: 'Inter - Milan',
      homeTeam: 'Inter',
      awayTeam: 'Milan',
      startTime: '2026-11-22T20:00:00Z',
      selectionKey: 'DRAW',
      selectionLabel: 'Pareggio (X)',
      bookmakerId: 'sisal_it',
      exchangeId: 'betfair_exchange',
      backOdds: 3.1,
      layOdds: 3.05,
      commission: 0.045,
      isSurebet: false,
      liquidity: 150,
    });

    expect(isRowSurebet(surebetRow)).toBe(true);
    expect(isRowSurebet(qualifyingRow)).toBe(false);
    // Also detects surebet via odds/commission even when isSurebet flag was omitted on synthetic row
    expect(isRowSurebet({ ...surebetRow, isSurebet: false })).toBe(true);

    // Without excludeSurebets, the surebet wins
    const withSurebet = evaluateRatingWatch(
      makeWatch({ targetRating: 95, excludeSurebets: false }),
      [surebetRow, qualifyingRow],
      { nowMs }
    );
    expect(withSurebet.bestMatch?.rowId).toBe('r_surebet');
    expect(withSurebet.shouldTrigger).toBe(true);

    // With excludeSurebets, the surebet is filtered out and qualifyingRow is selected
    const withoutSurebet = evaluateRatingWatch(
      makeWatch({ targetRating: 95, excludeSurebets: true }),
      [surebetRow, qualifyingRow],
      { nowMs }
    );
    expect(withoutSurebet.bestMatch?.rowId).toBe('r_qualifying');
    expect(withoutSurebet.shouldTrigger).toBe(true);

    // If only surebets exist, bestMatch is null and shouldTrigger is false
    const onlySurebetsRes = evaluateRatingWatch(
      makeWatch({ mode: 'snr', targetRating: 65, excludeSurebets: true }),
      [surebetRow],
      { nowMs }
    );
    expect(onlySurebetsRes.bestMatch).toBeNull();
    expect(onlySurebetsRes.shouldTrigger).toBe(false);
  });
});

describe('Saved Multiple Progressive Engine', () => {
  it('matches calculateSequentialMultiodds initially, recalculates remaining steps cleanly on progressive odds changes, and short-circuits on loss', () => {
    const leg1 = makeRow({
      id: 'sm_1',
      eventKey: 'ev_sm_1',
      startTime: '2026-11-22T15:00:00Z',
      backOdds: 2.0,
      layOdds: 2.04,
      commission: 0.045,
      liquidity: 300,
    });
    const leg2 = makeRow({
      id: 'sm_2',
      eventKey: 'ev_sm_2',
      startTime: '2026-11-22T18:00:00Z',
      backOdds: 2.0,
      layOdds: 2.04,
      commission: 0.045,
      liquidity: 300,
    });
    const leg3 = makeRow({
      id: 'sm_3',
      eventKey: 'ev_sm_3',
      startTime: '2026-11-22T21:00:00Z',
      backOdds: 2.0,
      layOdds: 2.04,
      commission: 0.045,
      liquidity: 300,
    });

    const seqPlan = calculateSequentialMultiodds({
      rows: [leg1, leg2, leg3],
      mode: 'normal',
      stake: 50,
      bonusBoostPct: 0,
      refundAmount: 0,
      refundRetention: 70,
    });

    const input = buildSavedMultipleInputFromPlan({
      plan: seqPlan,
      mode: 'normal',
      stake: 50,
      bonusBoostPct: 0,
      refundAmount: 0,
      refundRetention: 70,
      minGapMinutes: 120,
      customName: 'Test Serie A',
    });

    const savedPlan: SavedMultiplePlan = {
      ...input,
      id: 'multi_test_1',
      createdAt: 1000,
      updatedAt: 1000,
    };

    // 1. Initial evaluation matches sequential plan to the cent
    const eval0 = evaluateSavedMultiplePlan(savedPlan);
    expect(eval0.rating).toBeCloseTo(seqPlan.rating, 2);
    expect(eval0.initialRating).toBeCloseTo(seqPlan.rating, 2);
    expect(eval0.ratingDelta).toBe(0);
    expect(eval0.projectedProfit).toBeCloseTo(seqPlan.guaranteedProfit, 2);
    expect(eval0.steps[0].layStake).toBeCloseTo(seqPlan.legs[0].layStake, 2);
    expect(eval0.steps[1].layStake).toBeCloseTo(seqPlan.legs[1].layStake, 2);
    expect(eval0.steps[2].layStake).toBeCloseTo(seqPlan.legs[2].layStake, 2);

    // 2. Progressive scenario: Leg 1 won on bookmaker with locked stake; Leg 2 layOdds drops 2.04 -> 1.95
    const step1LockedStake = eval0.steps[0].layStake;
    const progressedPlan: SavedMultiplePlan = {
      ...savedPlan,
      legs: savedPlan.legs.map((l, idx) =>
        idx === 0
          ? { ...l, status: 'won_bookie', lockedLayStake: step1LockedStake }
          : idx === 1
          ? { ...l, layOdds: 1.95 }
          : l
      ),
    };

    const eval1 = evaluateSavedMultiplePlan(progressedPlan);
    expect(eval1.nextPendingIndex).toBe(1);
    expect(eval1.steps[0].layStake).toBe(step1LockedStake);
    // Remaining pending steps (Step 2 and Step 3) and win-all equalize tightly
    expect(eval1.steps[1].profitIfLostHere).toBeCloseTo(eval1.steps[2].profitIfLostHere, 1);
    expect(eval1.steps[2].profitIfLostHere).toBeCloseTo(eval1.profitIfAllWin, 1);
    // Lower lay odds on Step 2 reduces liability -> improves rating & profit vs baseline
    expect(eval1.projectedProfit).toBeGreaterThan(eval0.projectedProfit);
    expect(eval1.ratingDelta).toBeGreaterThan(0);

    // 3. Live sync only updates pending legs, never touches won_bookie/laid legs
    const liveLeg1Changed = { ...leg1, layOdds: 3.1, liquidity: 999 };
    const liveLeg3Changed = { ...leg3, layOdds: 1.9, liquidity: 550 };
    const { nextPlan: syncedPlan, updatedCount } = syncLiveOddsForSavedPlan(progressedPlan, [
      liveLeg1Changed,
      liveLeg3Changed,
    ]);
    expect(updatedCount).toBe(1);
    expect(syncedPlan.legs[0].layOdds).toBe(2.04); // locked leg untouched
    expect(syncedPlan.legs[2].layOdds).toBe(1.9); // pending leg updated

    // 4. Early termination: if Leg 1 lost on bookmaker, Steps 2 & 3 are skipped
    const lostPlan: SavedMultiplePlan = {
      ...savedPlan,
      legs: savedPlan.legs.map((l, idx) =>
        idx === 0 ? { ...l, status: 'lost_bookie', lockedLayStake: step1LockedStake } : l
      ),
    };
    const evalLost = evaluateSavedMultiplePlan(lostPlan);
    expect(evalLost.settledOutcome).toBe('lost_at_leg');
    expect(evalLost.lostAtIndex).toBe(0);
    expect(evalLost.steps[1].skipped).toBe(true);
    expect(evalLost.steps[1].layStake).toBe(0);
    expect(evalLost.steps[2].skipped).toBe(true);
    expect(evalLost.projectedProfit).toBeCloseTo(evalLost.steps[0].profitIfLostHere, 2);
  });
});

describe('Punta-Punta Matcher Engine', () => {
  const mkSnapshot = () => {
    const startTomorrow = new Date(Date.now() + 24 * 3600_000).toISOString();
    const startLaterWeek = new Date(Date.now() + 5 * 24 * 3600_000).toISOString();

    return {
      rows: [
        makeRow({
          id: 'r1',
          eventKey: 'fb_inter_milan',
          sport: 'football',
          league: 'Serie A',
          eventName: 'Inter - Milan',
          homeTeam: 'Inter',
          awayTeam: 'Milan',
          startTime: startTomorrow,
          marketType: 'BTTS',
          marketLabel: 'Goal / NoGoal',
          selectionKey: 'BTTS_YES',
          selectionLabel: 'Goal (Sì)',
          bookmakerId: 'snai_it',
          bookmakerName: 'Snai.it',
          backOdds: 2.15,
        }),
        makeRow({
          id: 'r2',
          eventKey: 'fb_inter_milan',
          sport: 'football',
          league: 'Serie A',
          eventName: 'Inter - Milan',
          homeTeam: 'Inter',
          awayTeam: 'Milan',
          startTime: startTomorrow,
          marketType: 'BTTS',
          marketLabel: 'Goal / NoGoal',
          selectionKey: 'BTTS_NO',
          selectionLabel: 'NoGoal (No)',
          bookmakerId: 'sisal_it',
          bookmakerName: 'Sisal.it',
          backOdds: 2.05,
        }),
      ],
      dutcherRows: [] as DutcherRow[],
      backMarketGroups: [
        {
          id: 'fb_inter_milan|BTTS',
          eventKey: 'fb_inter_milan',
          sport: 'football' as const,
          league: 'Serie A',
          eventName: 'Inter - Milan',
          homeTeam: 'Inter',
          awayTeam: 'Milan',
          startTime: startTomorrow,
          marketType: 'BTTS' as const,
          marketLabel: 'Goal / NoGoal',
          outcomes: [
            { key: 'BTTS_YES', label: 'Goal (Sì)' },
            { key: 'BTTS_NO', label: 'NoGoal (No)' },
          ],
          quotes: [
            {
              selectionKey: 'BTTS_YES',
              selectionLabel: 'Goal (Sì)',
              bookmakerId: 'snai_it' as const,
              bookmakerName: 'Snai.it',
              odds: 2.15,
              updatedAt: Date.now(),
            },
            {
              selectionKey: 'BTTS_YES',
              selectionLabel: 'Goal (Sì)',
              bookmakerId: 'eurobet_it' as const,
              bookmakerName: 'Eurobet.it',
              odds: 1.92,
              updatedAt: Date.now(),
            },
            {
              selectionKey: 'BTTS_NO',
              selectionLabel: 'NoGoal (No)',
              bookmakerId: 'sisal_it' as const,
              bookmakerName: 'Sisal.it',
              odds: 2.05,
              updatedAt: Date.now(),
            },
            {
              selectionKey: 'BTTS_NO',
              selectionLabel: 'NoGoal (No)',
              bookmakerId: 'snai_it' as const,
              bookmakerName: 'Snai.it',
              odds: 1.85,
              updatedAt: Date.now(),
            },
          ],
          updatedAt: Date.now(),
        },
        {
          id: 'fb_juve_napoli|1X2',
          eventKey: 'fb_juve_napoli',
          sport: 'football' as const,
          league: 'Serie A',
          eventName: 'Juventus - Napoli',
          homeTeam: 'Juventus',
          awayTeam: 'Napoli',
          startTime: startLaterWeek,
          marketType: '1X2' as const,
          marketLabel: 'Esito Finale 1X2',
          outcomes: [
            { key: 'HOME', label: 'Juventus (1)' },
            { key: 'DRAW', label: 'Pareggio (X)' },
            { key: 'AWAY', label: 'Napoli (2)' },
          ],
          quotes: [
            {
              selectionKey: 'HOME',
              selectionLabel: 'Juventus (1)',
              bookmakerId: 'goldbet_it' as const,
              bookmakerName: 'Goldbet.it',
              odds: 4.5,
              updatedAt: Date.now(),
            },
            {
              selectionKey: 'DRAW',
              selectionLabel: 'Pareggio (X)',
              bookmakerId: 'pinnacle' as const,
              bookmakerName: 'Pinnacle',
              odds: 3.4,
              updatedAt: Date.now(),
            },
            {
              selectionKey: 'AWAY',
              selectionLabel: 'Napoli (2)',
              bookmakerId: 'pinnacle' as const,
              bookmakerName: 'Pinnacle',
              odds: 1.9,
              updatedAt: Date.now(),
            },
          ],
          updatedAt: Date.now(),
        },
      ],
    };
  };

  it('reconstructs BackMarketGroups cleanly from rows when native backMarketGroups is missing', () => {
    const base = mkSnapshot();
    const legacy = {
      rows: base.rows,
      dutcherRows: base.dutcherRows,
      backMarketGroups: undefined,
    };
    const groups = extractBackMarketGroupsFromSnapshot(legacy);
    expect(groups).toHaveLength(1);
    expect(groups[0].marketType).toBe('BTTS');
    expect(groups[0].outcomes.map((o) => o.key)).toEqual(['BTTS_YES', 'BTTS_NO']);
    expect(groups[0].quotes).toHaveLength(2);
  });

  it('matches Punta-Punta across Normal, SNR, SR and RF modes without pairing same bookmaker by default', () => {
    const snap = mkSnapshot();

    const normalRes = findPuntaPuntaMatches(snap, {
      mode: 'normal',
      stake: 100,
      anchorMode: 'leg0',
      sport: 'ALL',
      market: 'ALL',
      outcomesMode: 'diverse_all',
      primaryBookmakers: [],
      hedgeBookmakers: [],
      minBack: 1.1,
      maxBack: 15,
      minRating: 0,
      onlySurebets: false,
      dateRange: EMPTY_DATE_RANGE,
      search: '',
    });

    // Inter - Milan BTTS has Snai (2.15) vs Sisal (2.05) => 1/2.15 + 1/2.05 = 0.9529 < 1 (Surebet!)
    const top = normalRes.rows[0];
    expect(top.eventName).toBe('Inter - Milan');
    expect(top.isSurebet).toBe(true);
    expect(top.rating).toBeGreaterThan(100);
    expect(top.primaryLeg.bookmakerId).not.toBe(top.hedgeLegs[0].bookmakerId);
    expect(normalRes.stats.surebetsCount).toBeGreaterThanOrEqual(2);

    // Filter out Snai on primary -> Eurobet (1.92) vs Sisal (2.05) still works cleanly
    const snaiExcluded = findPuntaPuntaMatches(snap, {
      mode: 'normal',
      stake: 100,
      sport: 'ALL',
      market: 'ALL',
      outcomesMode: 'diverse_all',
      primaryBookmakers: ['eurobet_it'],
      hedgeBookmakers: [],
      minBack: 1.1,
      maxBack: 15,
      minRating: 0,
      onlySurebets: false,
      dateRange: EMPTY_DATE_RANGE,
      search: '',
    });
    expect(snaiExcluded.rows).toHaveLength(1);
    expect(snaiExcluded.rows[0].primaryLeg.bookmakerId).toBe('eurobet_it');
    expect(snaiExcluded.rows[0].hedgeLegs[0].bookmakerId).toBe('sisal_it');

    // SNR mode on 3-way 1X2 (Goldbet 4.50 vs Pinnacle 3.40 & 1.90) matches calculatePuntaPunta math
    const snrRes = findPuntaPuntaMatches(snap, {
      mode: 'snr',
      stake: 50,
      sport: 'ALL',
      market: '1X2',
      outcomesMode: 'diverse_3way',
      primaryBookmakers: ['goldbet_it'],
      hedgeBookmakers: ['pinnacle'],
      minBack: 3.0,
      maxBack: 15,
      minRating: 50,
      onlySurebets: false,
      dateRange: EMPTY_DATE_RANGE,
      search: 'juventus',
    });
    expect(snrRes.rows).toHaveLength(1);
    const directMath = calculatePuntaPunta({
      mode: 'snr',
      stake: 50,
      odds: [4.5, 3.4, 1.9],
    });
    expect(snrRes.rows[0].rating).toBeCloseTo(directMath.rating, 2);
    expect(snrRes.rows[0].guaranteedProfit).toBeCloseTo(directMath.guaranteedProfit, 2);
  });

  it('respects 2-way filter, onlySurebets, and dateRange filters', () => {
    const snap = mkSnapshot();

    const only2Way = findPuntaPuntaMatches(snap, {
      mode: 'normal',
      stake: 100,
      sport: 'ALL',
      market: 'ALL',
      outcomesMode: 'diverse_2way',
      primaryBookmakers: [],
      hedgeBookmakers: [],
      minBack: 1.1,
      maxBack: 15,
      minRating: 0,
      onlySurebets: true,
      dateRange: { mode: 'hours', hours: 48, startDate: null, endDate: null },
      search: '',
    });

    expect(only2Way.rows.length).toBeGreaterThanOrEqual(2);
    expect(only2Way.rows.every((r) => r.outcomeCount === 2 && r.isSurebet)).toBe(true);
  });
});

describe('Auto-Scrape Pause & Restart Helpers', () => {
  it('evaluates isAutoScrapeActive from autoScrapeEnabled and refreshIntervalSec', () => {
    expect(isAutoScrapeActive(DEFAULT_SETTINGS)).toBe(true);
    expect(isAutoScrapeActive({ autoScrapeEnabled: false, refreshIntervalSec: 60 })).toBe(false);
    expect(isAutoScrapeActive({ autoScrapeEnabled: true, refreshIntervalSec: 0 })).toBe(false);
    expect(isAutoScrapeActive({ autoScrapeEnabled: true, refreshIntervalSec: 30 })).toBe(true);
  });

  it('preserves user interval on stop and restores it (or falls back to 60s) on restart', () => {
    const customSettings = {
      ...DEFAULT_SETTINGS,
      refreshIntervalSec: 120,
      autoScrapeEnabled: true,
    };

    const stopPatch = buildAutoScrapeSettingsPatch(customSettings, false);
    expect(stopPatch).toEqual({ autoScrapeEnabled: false });
    const stopped = { ...customSettings, ...stopPatch };
    expect(stopped.refreshIntervalSec).toBe(120);
    expect(isAutoScrapeActive(stopped)).toBe(false);

    const restartPatch = buildAutoScrapeSettingsPatch(stopped, true);
    expect(restartPatch).toEqual({ autoScrapeEnabled: true, refreshIntervalSec: 120 });

    const manualSettings = {
      ...DEFAULT_SETTINGS,
      refreshIntervalSec: 0,
      autoScrapeEnabled: false,
    };
    expect(getEffectiveAutoRefreshSec(manualSettings)).toBe(60);
    expect(buildAutoScrapeSettingsPatch(manualSettings, true)).toEqual({
      autoScrapeEnabled: true,
      refreshIntervalSec: 60,
    });
  });
});

describe('Future Date Range Scraping Helpers', () => {
  const fixedNow = new Date(2026, 10, 24, 12, 0, 0).getTime(); // 2026-11-24 12:00 local

  it('resolves normalized date windows and detects future ranges accurately', () => {
    expect(resolveScrapeDateWindow(EMPTY_DATE_RANGE)).toBeNull();
    expect(
      resolveScrapeDateWindow({ mode: 'hours', hours: 6, startDate: null, endDate: null })
    ).toBeNull();

    expect(needsFutureDateScrape(EMPTY_DATE_RANGE, fixedNow)).toBe(false);
    expect(
      needsFutureDateScrape(
        { mode: 'range', startDate: '2026-11-24', endDate: '2026-11-24' },
        fixedNow
      )
    ).toBe(false);
    expect(
      needsFutureDateScrape(
        { mode: 'range', startDate: '2026-11-23', endDate: '2026-11-23' },
        fixedNow
      )
    ).toBe(false);

    // Future single day (+5 days) & reversed range (+6 -> +5)
    const futureWin = resolveScrapeDateWindow({
      mode: 'range',
      startDate: '2026-11-30',
      endDate: '2026-11-29',
    });
    expect(futureWin).not.toBeNull();
    expect(futureWin!.startDate).toBe('2026-11-29');
    expect(futureWin!.endDate).toBe('2026-11-30');
    expect(futureWin!.endMs).toBeGreaterThan(futureWin!.startMs);
    expect(
      needsFutureDateScrape(
        { mode: 'range', startDate: '2026-11-29', endDate: '2026-11-30' },
        fixedNow
      )
    ).toBe(true);
    expect(
      needsFutureDateScrape(
        { mode: 'range', startDate: '2026-11-24', endDate: '2026-11-30' },
        fixedNow
      )
    ).toBe(true);
  });

  it('computes Diretta/Flashscore day offsets clamped to 0..7', () => {
    expect(getDirettaDayOffsetsForWindow(undefined, fixedNow)).toEqual([0, 1]);

    const win56 = resolveScrapeDateWindow({
      mode: 'range',
      startDate: '2026-11-29',
      endDate: '2026-11-30',
    })!;
    expect(getDirettaDayOffsetsForWindow(win56, fixedNow)).toEqual([5, 6]);

    const winWide = resolveScrapeDateWindow({
      mode: 'range',
      startDate: '2026-11-28',
      endDate: '2026-12-05',
    })!;
    expect(getDirettaDayOffsetsForWindow(winWide, fixedNow)).toEqual([4, 5, 6, 7]);

    const winTooFar = resolveScrapeDateWindow({
      mode: 'range',
      startDate: '2026-12-04',
      endDate: '2026-12-06',
    })!;
    expect(getDirettaDayOffsetsForWindow(winTooFar, fixedNow)).toEqual([]);
  });

  it('matches timestamps against ScrapeDateWindow and formats labels', () => {
    const win = resolveScrapeDateWindow({
      mode: 'range',
      startDate: '2026-11-29',
      endDate: '2026-11-30',
    })!;
    const inside = new Date(2026, 10, 29, 15, 0, 0).toISOString();
    const outsideBefore = new Date(2026, 10, 28, 22, 0, 0).toISOString();
    const outsideAfter = new Date(2026, 11, 1, 10, 0, 0).toISOString();

    expect(matchesScrapeDateWindow(inside, win)).toBe(true);
    expect(matchesScrapeDateWindow(outsideBefore, win)).toBe(false);
    expect(matchesScrapeDateWindow(outsideAfter, win)).toBe(false);
    expect(formatScrapeDateWindowLabel(win)).toBe('29/11–30/11');
    expect(
      formatScrapeDateWindowLabel({ startDate: '2026-11-29', endDate: '2026-11-29' })
    ).toBe('29/11');
  });
});

describe('Bonus Rollover Calculator & Auto Rating Engine', () => {
  it('equalizes net campaign profit for all-in Rollover with future wagering cost', () => {
    // R=100, B=100, S=200 (all-in), W=600 -> W_after=400 @ 95% => C_win=20, C_lose=0
    // y = (200 * 5 - 20) / (5 - 0.05) = 980 / 4.95 = 197.98
    const res = calculateSingleMatch({
      mode: 'rollover',
      stake: 200,
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 600,
      estimatedRating: 95,
      backOdds: 5.0,
      layOdds: 5.0,
      commission: 0.05,
    });

    expect(res.layStake).toBeCloseTo(197.98, 2);
    expect(res.bookieWinProfit).toBeCloseTo(88.08, 1);
    expect(res.exchangeWinProfit).toBeCloseTo(88.08, 1);
    expect(Math.abs(res.bookieWinProfit - res.exchangeWinProfit)).toBeLessThan(0.05);
    expect(res.rating).toBeCloseTo(88.08, 1);
    expect(res.rollover?.rolloverAfter).toBe(400);
    expect(res.rollover?.futureRolloverCostIfWin).toBe(20);
    expect(res.rollover?.futureRolloverCostIfLose).toBe(0);
    expect(res.rollover?.clearsRolloverOnLose).toBe(true);
    expect(res.rollover?.completesRolloverOnThisBet).toBe(false);
    expect(res.rollover?.bookieBalanceIfWin).toBe(1000);
    expect(res.rollover?.bookieBalanceIfLose).toBe(0);
  });

  it('distinguishes mixed vs bonus_first wallet rules on partial rollover stakes', () => {
    // Partial stake S=100 out of R=100 + B=100, W=600, est=95% -> W_after=500 -> future cost=25
    const mixed = calculateSingleMatch({
      mode: 'rollover',
      stake: 100,
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 600,
      estimatedRating: 95,
      rolloverWalletRule: 'mixed',
      backOdds: 2.0,
      layOdds: 2.04,
      commission: 0.045,
    });
    expect(mixed.rollover?.clearsRolloverOnLose).toBe(false);
    expect(mixed.rollover?.futureRolloverCostIfWin).toBe(25);
    expect(mixed.rollover?.futureRolloverCostIfLose).toBe(25);
    expect(mixed.layStake).toBeCloseTo((100 * 2.0) / (2.04 - 0.045), 2);
    expect(Math.abs(mixed.bookieWinProfit - mixed.exchangeWinProfit)).toBeLessThan(0.05);

    // Under bonus_first, staking S=100 wipes out the €100 bonus on loss -> C_lose = 0
    const bonusFirst = calculateSingleMatch({
      mode: 'rollover',
      stake: 100,
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 600,
      estimatedRating: 95,
      rolloverWalletRule: 'bonus_first',
      backOdds: 2.0,
      layOdds: 2.04,
      commission: 0.045,
    });
    expect(bonusFirst.rollover?.clearsRolloverOnLose).toBe(true);
    expect(bonusFirst.rollover?.futureRolloverCostIfWin).toBe(25);
    expect(bonusFirst.rollover?.futureRolloverCostIfLose).toBe(0);
    expect(bonusFirst.layStake).toBeCloseTo((100 * 2.0 - 25) / (2.04 - 0.045), 2);
    expect(Math.abs(bonusFirst.bookieWinProfit - bonusFirst.exchangeWinProfit)).toBeLessThan(0.05);
    expect(bonusFirst.expectedProfit).toBeGreaterThan(mixed.expectedProfit);
  });

  it('completes rollover with zero future cost when stake >= rolloverRemaining and matches normal/sr boundary limits', () => {
    const finish = calculateSingleMatch({
      mode: 'rollover',
      stake: 200,
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 150,
      estimatedRating: 94,
      backOdds: 2.5,
      layOdds: 2.54,
      commission: 0.045,
    });
    expect(finish.rollover?.completesRolloverOnThisBet).toBe(true);
    expect(finish.rollover?.rolloverAfter).toBe(0);
    expect(finish.rollover?.futureRolloverCostIfWin).toBe(0);
    expect(finish.rollover?.futureRolloverCostIfLose).toBe(0);
    expect(Math.abs(finish.bookieWinProfit - finish.exchangeWinProfit)).toBeLessThan(0.05);

    // Pure Real (B=0, W=0) matches normal mode
    const asNormal = calculateSingleMatch({
      mode: 'rollover',
      stake: 100,
      realBalance: 100,
      bonusBalance: 0,
      rolloverRemaining: 0,
      backOdds: 2.0,
      layOdds: 2.0,
      commission: 0.05,
    });
    const norm = calculateSingleMatch({
      mode: 'normal',
      stake: 100,
      backOdds: 2.0,
      layOdds: 2.0,
      commission: 0.05,
    });
    expect(asNormal.layStake).toBe(norm.layStake);
    expect(asNormal.expectedProfit).toBe(norm.expectedProfit);
    expect(asNormal.rating).toBe(norm.rating);

    // Pure Bonus (R=0, B=100, W=0) matches sr mode
    const asSr = calculateSingleMatch({
      mode: 'rollover',
      stake: 100,
      realBalance: 0,
      bonusBalance: 100,
      rolloverRemaining: 0,
      backOdds: 3.0,
      layOdds: 3.1,
      commission: 0.05,
    });
    const sr = calculateSingleMatch({
      mode: 'sr',
      stake: 100,
      backOdds: 3.0,
      layOdds: 3.1,
      commission: 0.05,
    });
    expect(asSr.layStake).toBe(sr.layStake);
    expect(asSr.expectedProfit).toBe(sr.expectedProfit);
  });

  it('supports Underlay and Overlay bias in Rollover mode', () => {
    const baseCfg = {
      mode: 'rollover' as const,
      stake: 200,
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 600,
      estimatedRating: 95,
      backOdds: 5.0,
      layOdds: 5.0,
      commission: 0.05,
    };
    const under = calculateSingleMatch({ ...baseCfg, balanceBias: -1 });
    const bal = calculateSingleMatch({ ...baseCfg, balanceBias: 0 });
    const over = calculateSingleMatch({ ...baseCfg, balanceBias: 1 });

    expect(under.layStake).toBeLessThan(bal.layStake);
    expect(over.layStake).toBeGreaterThan(bal.layStake);
    expect(under.bookieWinProfit).toBeGreaterThan(under.exchangeWinProfit);
    expect(over.exchangeWinProfit).toBeGreaterThan(over.bookieWinProfit);
    expect(under.exchangeWinProfit).toBeCloseTo(0, 1);
    expect(over.bookieWinProfit).toBeCloseTo(0, 1);
  });

  it('computes Punta-Punta Rollover across 2-way and 3-way markets', () => {
    const pp2 = calculatePuntaPunta({
      mode: 'rollover',
      stake: 200,
      odds: [4.0, 1.35],
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 600,
      estimatedRating: 95,
    });
    expect(pp2.stakes[0]).toBe(200);
    // Target hedge return = 200*4 - 20 = 780 -> P2 stake = 780/1.35 = 577.78
    expect(pp2.stakes[1]).toBeCloseTo(577.78, 2);
    expect(Math.abs(pp2.profits[0] - pp2.profits[1])).toBeLessThan(0.05);
    expect(pp2.guaranteedProfit).toBeGreaterThan(90);

    const pp3 = calculatePuntaPunta({
      mode: 'rollover',
      stake: 200,
      odds: [4.0, 3.2, 2.3],
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 600,
      estimatedRating: 95,
    });
    expect(Math.abs(Math.max(...pp3.profits) - Math.min(...pp3.profits))).toBeLessThan(0.05);
  });

  it('automatically estimates Rollover rating from Oddsmatcher rows while ignoring surebet spikes', () => {
    const rows: OddsmatcherRow[] = [
      makeRow({ id: 'sure', backOdds: 2.5, layOdds: 2.0, liquidity: 500, ratingNormal: 118.0, startTime: '2026-11-26T12:00:00Z' }),
      makeRow({ id: 'lowOdds', backOdds: 1.1, layOdds: 1.11, liquidity: 500, ratingNormal: 98.5, startTime: '2026-11-26T12:00:00Z' }),
      makeRow({ id: 'lowLiq', backOdds: 2.0, layOdds: 2.02, liquidity: 2, ratingNormal: 98.8, startTime: '2026-11-26T12:00:00Z' }),
      makeRow({ id: 'r1', backOdds: 2.0, layOdds: 2.02, liquidity: 100, ratingNormal: 97.6, startTime: '2026-11-26T12:00:00Z' }),
      makeRow({ id: 'r2', backOdds: 2.2, layOdds: 2.24, liquidity: 120, ratingNormal: 96.4, startTime: '2026-11-26T12:00:00Z' }),
      makeRow({ id: 'r3', backOdds: 1.8, layOdds: 1.84, liquidity: 80, ratingNormal: 95.8, startTime: '2026-11-26T12:00:00Z' }),
    ];

    const auto = computeAutoRolloverRating({ rows });
    expect(auto.source).toBe('oddsmatcher');
    expect(auto.sampleCount).toBe(3);
    expect(auto.estimatedRating).toBe(96.4);

    // Fallback to current quote when fewer than 3 Oddsmatcher rows qualify
    const fromQuote = computeAutoRolloverRating({
      rows: [],
      currentBackOdds: 2.0,
      currentLayOdds: 2.04,
      currentCommission: 0.045,
    });
    expect(fromQuote.source).toBe('current_quote');
    expect(fromQuote.estimatedRating).toBeCloseTo(95.74, 2);

    // Default fallback
    const def = computeAutoRolloverRating({ rows: [] });
    expect(def.source).toBe('default');
    expect(def.estimatedRating).toBe(96);

    const ppFromQuote = computeAutoPuntaPuntaRolloverRating({ currentOdds: [1.92, 1.96] });
    expect(ppFromQuote.source).toBe('current_quote');
    expect(ppFromQuote.estimatedRating).toBeCloseTo(100 / (1 / 1.92 + 1 / 1.96), 1);

    // Surebet current quote [2.0, 2.05] (>100%) is safely capped at 99.8%
    const ppCapped = computeAutoPuntaPuntaRolloverRating({ currentOdds: [2.0, 2.05] });
    expect(ppCapped.source).toBe('current_quote');
    expect(ppCapped.estimatedRating).toBe(99.8);
  });

  it('computes equalized Sequential Multiodds in Rollover mode (all-in bust-out + partial mixed vs bonus_first)', () => {
    const legs: OddsmatcherRow[] = [
      makeRow({ id: 'mr1', startTime: '2026-11-26T12:00:00Z', backOdds: 2.0, layOdds: 2.04, commission: 0.05 }),
      makeRow({ id: 'mr2', startTime: '2026-11-26T15:00:00Z', backOdds: 2.0, layOdds: 2.04, commission: 0.05 }),
      makeRow({ id: 'mr3', startTime: '2026-11-26T18:00:00Z', backOdds: 2.0, layOdds: 2.04, commission: 0.05 }),
    ];

    // All-in bust-out: real=100, bonus=100, stake=200, rollover=600 -> after bet rollover=400, cost@95%=20
    const allInPlan = calculateSequentialMultiodds({
      rows: legs,
      mode: 'rollover',
      stake: 200,
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 600,
      estimatedRating: 95,
      rolloverWalletRule: 'mixed',
    });

    expect(allInPlan.rollover).toBeDefined();
    expect(allInPlan.rollover!.clearsRolloverOnLose).toBe(true);
    expect(allInPlan.rollover!.futureRolloverCostIfWin).toBe(20);
    expect(allInPlan.rollover!.futureRolloverCostIfLose).toBe(0);
    expect(Math.abs(allInPlan.legs[0].profitIfLostHere - allInPlan.guaranteedProfit)).toBeLessThan(0.05);
    expect(Math.abs(allInPlan.legs[1].profitIfLostHere - allInPlan.guaranteedProfit)).toBeLessThan(0.05);
    expect(Math.abs(allInPlan.legs[2].profitIfLostHere - allInPlan.guaranteedProfit)).toBeLessThan(0.05);
    expect(Math.abs(allInPlan.profitIfAllWin - allInPlan.guaranteedProfit)).toBeLessThan(0.05);
    expect(allInPlan.guaranteedProfit).toBeGreaterThan(70);

    // Partial stake (100 out of 200): bonus_first clears rollover on lose, mixed keeps remaining rollover
    const partialMixed = calculateSequentialMultiodds({
      rows: legs.slice(0, 2),
      mode: 'rollover',
      stake: 100,
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 500,
      estimatedRating: 95,
      rolloverWalletRule: 'mixed',
    });
    const partialBonusFirst = calculateSequentialMultiodds({
      rows: legs.slice(0, 2),
      mode: 'rollover',
      stake: 100,
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 500,
      estimatedRating: 95,
      rolloverWalletRule: 'bonus_first',
    });

    expect(partialMixed.rollover!.clearsRolloverOnLose).toBe(false);
    expect(partialMixed.rollover!.futureRolloverCostIfLose).toBe(20);
    expect(partialBonusFirst.rollover!.clearsRolloverOnLose).toBe(true);
    expect(partialBonusFirst.rollover!.futureRolloverCostIfLose).toBe(0);
    expect(partialBonusFirst.guaranteedProfit).toBeGreaterThan(partialMixed.guaranteedProfit);
  });

  it('supports findBestMultiodds and SavedMultiplePlan roundtrip in Rollover mode', () => {
    const rows: OddsmatcherRow[] = [
      makeRow({ id: 'fbm1', startTime: '2026-11-26T12:00:00Z', backOdds: 2.1, layOdds: 2.12, ratingNormal: 96.5, liquidity: 200 }),
      makeRow({ id: 'fbm2', startTime: '2026-11-26T16:00:00Z', backOdds: 2.2, layOdds: 2.22, ratingNormal: 96.8, liquidity: 200 }),
      makeRow({ id: 'fbm3', startTime: '2026-11-26T20:00:00Z', backOdds: 2.0, layOdds: 2.04, ratingNormal: 95.8, liquidity: 200 }),
    ];

    const best = findBestMultiodds({
      rows,
      legsCount: 2,
      mode: 'rollover',
      stake: 200,
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 500,
      estimatedRating: 96,
      rolloverWalletRule: 'mixed',
      minLegOdds: 1.5,
      maxLegOdds: 4.0,
      minCombinedOdds: 2.0,
      maxCombinedOdds: 20,
      minLiquidity: 50,
      minGapMinutes: 120,
      bonusBoostPct: 0,
      refundAmount: 0,
      refundRetention: 70,
    });

    expect(best.length).toBeGreaterThan(0);
    const top = best[0];
    expect(top.rollover).toBeDefined();
    expect(top.rollover!.rolloverAfter).toBe(300);

    const savedInput = buildSavedMultipleInputFromPlan({
      plan: top,
      mode: 'rollover',
      stake: 200,
      bonusBoostPct: 0,
      refundAmount: 0,
      refundRetention: 70,
      realBalance: 100,
      bonusBalance: 100,
      rolloverRemaining: 500,
      estimatedRating: 96,
      rolloverWalletRule: 'mixed',
      minGapMinutes: 120,
    });
    expect(savedInput.mode).toBe('rollover');
    expect(savedInput.bonusBalance).toBe(100);
    expect(savedInput.rolloverRemaining).toBe(500);

    const savedPlan: SavedMultiplePlan = {
      ...savedInput,
      id: 'saved_roll_1',
      createdAt: 1000,
      updatedAt: 1000,
    };
    const ev0 = evaluateSavedMultiplePlan(savedPlan);
    expect(ev0.rollover).toBeDefined();
    expect(ev0.rating).toBeCloseTo(top.rating, 2);
    expect(ev0.projectedProfit).toBeCloseTo(top.guaranteedProfit, 2);
    expect(ev0.ratingDelta).toBeCloseTo(0, 2);

    // Advance step 1 as won_bookie and settle step 2 as lost_bookie -> realized profit matches projection
    const settledPlan: SavedMultiplePlan = {
      ...savedPlan,
      status: 'completed',
      legs: savedPlan.legs.map((l, idx) =>
        idx === 0
          ? { ...l, status: 'won_bookie', lockedLayStake: top.legs[0].layStake }
          : { ...l, status: 'lost_bookie', lockedLayStake: top.legs[1].layStake }
      ),
    };
    const evSettled = evaluateSavedMultiplePlan(settledPlan);
    expect(evSettled.settledOutcome).toBe('lost_at_leg');
    expect(evSettled.projectedProfit).toBeCloseTo(top.guaranteedProfit, 2);
  });
});

describe('Bookmaker Filter Validation against Scraper Enabled Sources', () => {
  const makeBkStatus = (
    id: SourceStatus['id'],
    name: string,
    state: SourceStatus['state'],
    lastError: string | null = null
  ): SourceStatus => ({
    id,
    name,
    shortName: name,
    kind: 'bookmaker',
    color: '#3b82f6',
    enabled: state !== 'disabled',
    state,
    latencyMs: 120,
    eventsCount: state === 'ok' ? 10 : 0,
    marketsCount: state === 'ok' ? 30 : 0,
    lastScrapedAt: null,
    lastError,
    successCount: state === 'ok' ? 1 : 0,
    errorCount: state === 'error' ? 1 : 0,
  });

  it('marks bookmakers deselected in snapshot.sources as disabled with explanatory scraper reason', () => {
    const options = buildBookmakerSourceOptions({
      sources: [
        makeBkStatus('sisal_it', 'Sisal.it', 'disabled'),
        makeBkStatus('snai_it', 'SNAI.it', 'ok'),
        makeBkStatus('eurobet_it', 'Eurobet.it', 'error', 'HTTP 503'),
      ],
      rows: [],
      backMarketGroups: [],
      dutcherRows: [],
    });

    expect(options.map((o) => o.id)).toEqual(['snai_it', 'eurobet_it', 'sisal_it']);

    const snai = options.find((o) => o.id === 'snai_it');
    expect(snai?.disabled).toBeFalsy();

    const eurobet = options.find((o) => o.id === 'eurobet_it');
    expect(eurobet?.disabled).toBe(true);
    expect(eurobet?.disabledKind).toBe('error');
    expect(eurobet?.disabledReason).toContain('HTTP 503');

    const sisal = options.find((o) => o.id === 'sisal_it');
    expect(sisal?.disabled).toBe(true);
    expect(sisal?.disabledKind).toBe('scraper_disabled');
    expect(sisal?.disabledReason).toBe(SCRAPER_DISABLED_BOOKMAKER_REASON);
  });

  it('immediately inhibits bookmakers deselected via enabledSources override even with stale rows', () => {
    const staleRow = makeRow({
      id: 'stale_sisal',
      startTime: '2026-11-26T18:00:00Z',
      bookmakerId: 'sisal_it',
      bookmakerName: 'Sisal.it',
    });

    const options = buildBookmakerSourceOptions(
      {
        sources: [
          makeBkStatus('sisal_it', 'Sisal.it', 'ok'),
          makeBkStatus('snai_it', 'SNAI.it', 'ok'),
        ],
        rows: [staleRow],
        backMarketGroups: [],
        dutcherRows: [],
      },
      { sisal_it: false, snai_it: true }
    );

    const sisal = options.find((o) => o.id === 'sisal_it');
    expect(sisal?.disabled).toBe(true);
    expect(sisal?.disabledKind).toBe('scraper_disabled');
    expect(sisal?.disabledReason).toBe(SCRAPER_DISABLED_BOOKMAKER_REASON);

    // Re-enabling makes it selectable again
    const reenabled = buildBookmakerSourceOptions(
      {
        sources: [
          makeBkStatus('sisal_it', 'Sisal.it', 'disabled'),
          makeBkStatus('snai_it', 'SNAI.it', 'ok'),
        ],
        rows: [],
        backMarketGroups: [],
        dutcherRows: [],
      },
      { sisal_it: true, snai_it: true }
    );
    expect(reenabled.find((o) => o.id === 'sisal_it')?.disabled).toBeFalsy();
  });

  it('keeps disabled scraper bookmakers marked disabled in catalog fallback when snapshot has no sources', () => {
    const options = buildBookmakerSourceOptions(
      {
        sources: [],
        rows: [],
        backMarketGroups: [],
        dutcherRows: [],
      },
      { ...DEFAULT_SETTINGS.enabledSources, bet365_it: false }
    );

    const bet365 = options.find((o) => o.id === 'bet365_it');
    expect(bet365?.disabled).toBe(true);
    expect(bet365?.disabledKind).toBe('scraper_disabled');

    const oddsApi = options.find((o) => o.id === 'the_odds_api');
    expect(oddsApi?.disabled).toBe(true);
    expect(oddsApi?.disabledKind).toBe('scraper_disabled');
  });

  it('marks exchanges deselected in scraper as disabled with explanatory reason and supports override/reenable', () => {
    const makeExStatus = (
      id: SourceStatus['id'],
      name: string,
      state: SourceStatus['state'],
      lastError: string | null = null
    ): SourceStatus => ({
      id,
      name,
      shortName: name,
      kind: 'exchange',
      color: '#ffb80c',
      enabled: state !== 'disabled',
      state,
      latencyMs: 90,
      eventsCount: state === 'ok' ? 12 : 0,
      marketsCount: state === 'ok' ? 40 : 0,
      lastScrapedAt: null,
      lastError,
      successCount: state === 'ok' ? 1 : 0,
      errorCount: state === 'error' ? 1 : 0,
    });

    const options = buildExchangeSourceOptions({
      sources: [
        makeExStatus('smarkets_exchange', 'Smarkets', 'disabled'),
        makeExStatus('betfair_exchange', 'Betfair Exchange IT', 'ok'),
        makeExStatus('betflag_exchange', 'Betflag Exchange IT', 'error', 'HTTP 403'),
      ],
    });

    expect(options.map((o) => o.id)).toEqual([
      'betfair_exchange',
      'betflag_exchange',
      'smarkets_exchange',
    ]);

    const betfair = options.find((o) => o.id === 'betfair_exchange');
    expect(betfair?.disabled).toBeFalsy();

    const betflag = options.find((o) => o.id === 'betflag_exchange');
    expect(betflag?.disabled).toBe(true);
    expect(betflag?.disabledKind).toBe('error');
    expect(betflag?.disabledReason).toContain('HTTP 403');

    const smarkets = options.find((o) => o.id === 'smarkets_exchange');
    expect(smarkets?.disabled).toBe(true);
    expect(smarkets?.disabledKind).toBe('scraper_disabled');
    expect(smarkets?.disabledReason).toBe(SCRAPER_DISABLED_EXCHANGE_REASON);

    // Immediate override before snapshot updates + fallback catalog check
    const overridden = buildExchangeSourceOptions(
      {
        sources: [
          makeExStatus('betfair_exchange', 'Betfair Exchange IT', 'ok'),
          makeExStatus('smarkets_exchange', 'Smarkets', 'disabled'),
        ],
      },
      { betfair_exchange: false, smarkets_exchange: true }
    );
    expect(overridden.find((o) => o.id === 'betfair_exchange')?.disabled).toBe(true);
    expect(overridden.find((o) => o.id === 'betfair_exchange')?.disabledKind).toBe(
      'scraper_disabled'
    );
    expect(overridden.find((o) => o.id === 'smarkets_exchange')?.disabled).toBeFalsy();

    const catalogFallback = buildExchangeSourceOptions(
      { sources: [] },
      { betflag_exchange: false }
    );
    expect(catalogFallback.find((o) => o.id === 'betflag_exchange')?.disabled).toBe(true);
    expect(catalogFallback.find((o) => o.id === 'betflag_exchange')?.disabledKind).toBe(
      'scraper_disabled'
    );
  });
});

describe('Manual Multiodds Catalog Filtering', () => {
  it('enforces bookmaker, exchange, and all other filters even when onlyEligible is false', () => {
    const nowMs = new Date('2026-11-25T12:00:00Z').getTime();
    const future4h = new Date(nowMs + 4 * 3600_000).toISOString();
    const future5h = new Date(nowMs + 5 * 3600_000).toISOString();
    const future9h = new Date(nowMs + 9 * 3600_000).toISOString();
    const past1h = new Date(nowMs - 3600_000).toISOString();

    const sisalBfEligible = makeRow({
      id: 'm_sisal_bf_ok',
      eventKey: 'ev_1',
      sport: 'football',
      league: 'ITALIA: Serie A',
      eventName: 'Inter - Milan',
      startTime: future4h,
      marketType: '1X2',
      bookmakerId: 'sisal_it',
      bookmakerName: 'Sisal.it',
      exchangeId: 'betfair_exchange',
      exchangeName: 'Betfair Exchange IT',
      backOdds: 2.1,
      layOdds: 2.12,
      liquidity: 150,
      ratingNormal: 97.5,
      ratingSnr: 52.0,
    });

    const sisalBfGapConflict = makeRow({
      id: 'm_sisal_bf_gap',
      eventKey: 'ev_2',
      sport: 'football',
      league: 'ITALIA: Serie A',
      eventName: 'Roma - Lazio',
      startTime: future5h, // < 2h gap from ev_1
      marketType: '1X2',
      bookmakerId: 'sisal_it',
      bookmakerName: 'Sisal.it',
      exchangeId: 'betfair_exchange',
      exchangeName: 'Betfair Exchange IT',
      backOdds: 2.2,
      layOdds: 2.24,
      liquidity: 120,
      ratingNormal: 96.8,
      ratingSnr: 50.0,
    });

    const sisalBfStarted = makeRow({
      id: 'm_sisal_bf_past',
      eventKey: 'ev_3',
      sport: 'football',
      league: 'ITALIA: Serie A',
      eventName: 'Juve - Torino',
      startTime: past1h,
      marketType: '1X2',
      bookmakerId: 'sisal_it',
      bookmakerName: 'Sisal.it',
      exchangeId: 'betfair_exchange',
      exchangeName: 'Betfair Exchange IT',
      backOdds: 2.0,
      layOdds: 2.02,
      liquidity: 200,
      ratingNormal: 97.9,
      ratingSnr: 49.0,
    });

    const sisalSmOtherExchange = makeRow({
      id: 'm_sisal_sm',
      eventKey: 'ev_4',
      sport: 'football',
      league: 'ITALIA: Serie A',
      eventName: 'Napoli - Atalanta',
      startTime: future9h,
      marketType: '1X2',
      bookmakerId: 'sisal_it',
      bookmakerName: 'Sisal.it',
      exchangeId: 'smarkets_exchange',
      exchangeName: 'Smarkets Exchange',
      backOdds: 2.3,
      layOdds: 2.32,
      liquidity: 180,
      ratingNormal: 98.2,
      ratingSnr: 54.0,
    });

    const snaiBfOtherBookie = makeRow({
      id: 'm_snai_bf',
      eventKey: 'ev_5',
      sport: 'football',
      league: 'ITALIA: Serie A',
      eventName: 'Bologna - Fiorentina',
      startTime: future9h,
      marketType: '1X2',
      bookmakerId: 'snai_it',
      bookmakerName: 'SNAI.it',
      exchangeId: 'betfair_exchange',
      exchangeName: 'Betfair Exchange IT',
      backOdds: 2.4,
      layOdds: 2.42,
      liquidity: 220,
      ratingNormal: 99.1,
      ratingSnr: 57.0,
    });

    const sisalBfTennis = makeRow({
      id: 'm_sisal_bf_tennis',
      eventKey: 'ev_6',
      sport: 'tennis',
      league: 'ATP - SINGOLARE: Roma',
      eventName: 'Sinner - Alcaraz',
      startTime: future9h,
      marketType: 'H2H',
      bookmakerId: 'sisal_it',
      bookmakerName: 'Sisal.it',
      exchangeId: 'betfair_exchange',
      exchangeName: 'Betfair Exchange IT',
      backOdds: 1.9,
      layOdds: 1.92,
      liquidity: 300,
      ratingNormal: 98.5,
      ratingSnr: 47.0,
    });

    const allRows = [
      sisalBfEligible,
      sisalBfGapConflict,
      sisalBfStarted,
      sisalSmOtherExchange,
      snaiBfOtherBookie,
      sisalBfTennis,
    ];

    const baseInput = {
      rows: allRows,
      selectedLegs: [] as OddsmatcherRow[],
      mode: 'normal' as const,
      search: '',
      sport: 'ALL' as const,
      leagues: [] as string[],
      market: 'ALL' as const,
      bookmakerIds: [] as string[],
      exchangeIds: [] as string[],
      minLegOdds: 1.01,
      maxLegOdds: 25,
      minRating: 0,
      minLiquidity: 0,
      dateRange: EMPTY_DATE_RANGE,
      onlySurebets: false,
      noSurebets: false,
      onlyEligible: false,
      minGapMinutes: 120,
      nowMs,
    };

    // 1. With onlyEligible=false, bookmaker + exchange + sport + rating filters still strictly filter the list
    const filteredEmptySlip = filterManualMultioddsCatalog({
      ...baseInput,
      sport: 'football',
      bookmakerIds: ['sisal_it'],
      exchangeIds: ['betfair_exchange'],
      minRating: 97,
      onlyEligible: false,
    });
    expect(filteredEmptySlip.items.map((x) => x.row.id)).toEqual([
      'm_sisal_bf_past',
      'm_sisal_bf_ok',
    ]);
    expect(filteredEmptySlip.eligibleCount).toBe(1);
    expect(filteredEmptySlip.ineligibleCount).toBe(1);

    // 2. When 1 leg is selected (locked to sisal_it) and onlyEligible=false, other bookmakers MUST NOT appear
    //    even if bookmakerIds was [] or included multiple bookmakers before locking
    const filteredWithLockedLeg = filterManualMultioddsCatalog({
      ...baseInput,
      selectedLegs: [sisalBfEligible],
      bookmakerIds: [],
      exchangeIds: ['betfair_exchange'],
      onlyEligible: false,
    });
    const lockedIds = filteredWithLockedLeg.items.map((x) => x.row.id);
    expect(lockedIds).not.toContain('m_snai_bf');
    expect(lockedIds).not.toContain('m_sisal_sm');
    expect(lockedIds).toEqual([
      'm_sisal_bf_ok',
      'm_sisal_bf_tennis',
      'm_sisal_bf_past',
      'm_sisal_bf_gap',
    ]);

    // 3. Toggling onlyEligible=true hides the ineligible rows of the locked bookmaker while keeping eligible ones
    const filteredOnlyEligible = filterManualMultioddsCatalog({
      ...baseInput,
      selectedLegs: [sisalBfEligible],
      bookmakerIds: [],
      exchangeIds: ['betfair_exchange'],
      onlyEligible: true,
    });
    expect(filteredOnlyEligible.items.map((x) => x.row.id)).toEqual([
      'm_sisal_bf_ok',
      'm_sisal_bf_tennis',
    ]);
  });
});

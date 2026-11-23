import type {
  BetMode,
  DutcherRow,
  MultioddsPlan,
  MultioddsStep,
  OddsmatcherRow,
  SingleCalcInput,
  SingleCalcResult,
} from './types';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/**
 * Computes exact Matched Betting lay stake, liability, payoffs, and rating
 * for Normale, SNR (Freebet), SR (Bonus Reale), and RF (Rimborso/Cashback),
 * with optional Underlay (-1) / Balanced (0) / Overlay (+1) shift.
 */
export function calculateSingleMatch(input: SingleCalcInput): SingleCalcResult {
  const {
    mode,
    stake,
    backOdds,
    layOdds,
    commission,
    refundAmount = 0,
    refundRetention = 70,
    balanceBias = 0,
  } = input;

  if (stake <= 0 || backOdds <= 1 || layOdds <= 1 || layOdds <= commission) {
    return {
      layStake: 0,
      balancedLayStake: 0,
      underlayStake: 0,
      overlayStake: 0,
      liability: 0,
      bookieWinProfit: 0,
      exchangeWinProfit: 0,
      expectedProfit: 0,
      rating: 0,
      rawRating: 0,
    };
  }

  const denom = layOdds - commission;
  const effectiveRefund = mode === 'rf' ? Math.max(0, refundAmount) * (Math.max(0, refundRetention) / 100) : 0;

  let balancedLayStake = 0;
  let underlayStake = 0;
  let overlayStake = 0;

  if (mode === 'normal') {
    balancedLayStake = (stake * backOdds) / denom;
    // Underlay: break even if bookmaker wins (when back < lay)
    underlayStake = Math.min(balancedLayStake, (stake * (backOdds - 1)) / (layOdds - 1));
    // Overlay: break even if exchange wins
    overlayStake = Math.max(balancedLayStake, stake / (1 - commission));
  } else if (mode === 'snr') {
    balancedLayStake = (stake * (backOdds - 1)) / denom;
    underlayStake = balancedLayStake * 0.85;
    overlayStake = balancedLayStake * 1.15;
  } else if (mode === 'sr') {
    balancedLayStake = (stake * backOdds) / denom;
    underlayStake = balancedLayStake * 0.85;
    overlayStake = balancedLayStake * 1.15;
  } else {
    // RF (Rimborso / Risk-Free)
    balancedLayStake = Math.max(0, (stake * backOdds - effectiveRefund) / denom);
    underlayStake = Math.max(0, Math.min(balancedLayStake, (stake * (backOdds - 1)) / (layOdds - 1)));
    overlayStake = Math.max(balancedLayStake, Math.max(0, (stake - effectiveRefund) / (1 - commission)));
  }

  const clampedBias = Math.max(-1, Math.min(1, balanceBias));
  let layStake = balancedLayStake;
  if (clampedBias < 0) {
    layStake = balancedLayStake + (balancedLayStake - underlayStake) * clampedBias;
  } else if (clampedBias > 0) {
    layStake = balancedLayStake + (overlayStake - balancedLayStake) * clampedBias;
  }
  layStake = Math.max(0, layStake);

  const liability = layStake * (layOdds - 1);

  let bookieWinProfit = 0;
  let exchangeWinProfit = 0;

  if (mode === 'normal') {
    bookieWinProfit = stake * (backOdds - 1) - liability;
    exchangeWinProfit = layStake * (1 - commission) - stake;
  } else if (mode === 'snr') {
    bookieWinProfit = stake * (backOdds - 1) - liability;
    exchangeWinProfit = layStake * (1 - commission);
  } else if (mode === 'sr') {
    bookieWinProfit = stake * backOdds - liability;
    exchangeWinProfit = layStake * (1 - commission);
  } else {
    // RF
    bookieWinProfit = stake * (backOdds - 1) - liability;
    exchangeWinProfit = layStake * (1 - commission) - stake + effectiveRefund;
  }

  const expectedProfit = (bookieWinProfit + exchangeWinProfit) / 2;
  const rawRating = (backOdds / layOdds) * 100;

  let rating = 0;
  if (mode === 'normal') {
    // Standard Italian Matched Betting rating (100 + Profit/Stake*100)
    rating = ((backOdds * (1 - commission)) / denom) * 100;
  } else if (mode === 'snr') {
    rating = (((backOdds - 1) * (1 - commission)) / denom) * 100;
  } else if (mode === 'sr') {
    rating = ((backOdds * (1 - commission)) / denom) * 100;
  } else {
    // RF rating: profit as % of refundAmount (or stake if refundAmount=0)
    const base = refundAmount > 0 ? refundAmount : stake;
    rating = (expectedProfit / base) * 100;
  }

  return {
    layStake: round2(layStake),
    balancedLayStake: round2(balancedLayStake),
    underlayStake: round2(underlayStake),
    overlayStake: round2(overlayStake),
    liability: round2(liability),
    bookieWinProfit: round2(bookieWinProfit),
    exchangeWinProfit: round2(exchangeWinProfit),
    expectedProfit: round2(expectedProfit),
    rating: round2(rating),
    rawRating: round2(rawRating),
  };
}

export function quickRatings(backOdds: number, layOdds: number, commission: number): {
  ratingNormal: number;
  ratingSnr: number;
  rawRating: number;
  isSurebet: boolean;
} {
  if (backOdds <= 1 || layOdds <= 1 || layOdds <= commission) {
    return { ratingNormal: 0, ratingSnr: 0, rawRating: 0, isSurebet: false };
  }
  const denom = layOdds - commission;
  const ratingNormal = round2(((backOdds * (1 - commission)) / denom) * 100);
  const ratingSnr = round2((((backOdds - 1) * (1 - commission)) / denom) * 100);
  const rawRating = round2((backOdds / layOdds) * 100);
  return {
    ratingNormal,
    ratingSnr,
    rawRating,
    isSurebet: ratingNormal >= 100,
  };
}

/**
 * Exact backward-induction Sequential Lay calculator for an N-leg accumulator (Multiodds).
 * Guarantees EQUAL net profit regardless of whether the multiple loses on leg 1, 2, ..., N, or wins all legs.
 */
export function calculateSequentialMultiodds(params: {
  rows: OddsmatcherRow[];
  mode: BetMode;
  stake: number;
  commissionOverride?: number;
  bonusBoostPct?: number; // e.g., 5 for +5% multipla bonus on winnings
  refundAmount?: number;
  refundRetention?: number;
  minGapRequiredMinutes?: number;
}): MultioddsPlan {
  const {
    rows,
    mode,
    stake,
    commissionOverride,
    bonusBoostPct = 0,
    refundAmount = 0,
    refundRetention = 70,
    minGapRequiredMinutes = 120,
  } = params;

  // Sort legs chronologically (required for sequential laying!)
  const sorted = [...rows].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const n = sorted.length;
  const combinedBackOdds = sorted.reduce((acc, r) => acc * r.backOdds, 1);
  const boostFactor = 1 + Math.max(0, bonusBoostPct) / 100;

  // Boost applies to net winnings on Italian bookmakers (e.g. +5% multipla bonus)
  const boostedBackOdds =
    mode === 'snr'
      ? 1 + (combinedBackOdds - 1) * boostFactor
      : 1 + (combinedBackOdds - 1) * boostFactor;

  const winPayout =
    mode === 'snr'
      ? stake * (combinedBackOdds - 1) * boostFactor
      : stake * boostedBackOdds;

  const initialOutlay = mode === 'normal' || mode === 'rf' ? stake : 0;
  const effectiveRefund =
    mode === 'rf' ? Math.max(0, refundAmount) * (Math.max(0, refundRetention) / 100) : 0;

  // Backward induction from leg N-1 down to 0
  const layStakes = new Array<number>(n).fill(0);
  const liabilities = new Array<number>(n).fill(0);
  const commissions = sorted.map((r) =>
    commissionOverride !== undefined ? commissionOverride : r.commission
  );

  let nextValue = winPayout;
  for (let i = n - 1; i >= 0; i--) {
    const L = sorted[i].layOdds;
    const c = commissions[i];
    const denom = Math.max(0.01, L - c);
    const y = Math.max(0, (nextValue - effectiveRefund) / denom);
    layStakes[i] = y;
    liabilities[i] = y * (L - 1);
    nextValue = y * (1 - c) + effectiveRefund;
  }

  let cumLiab = 0;
  let minGapMinutes = Infinity;
  const steps: MultioddsStep[] = [];

  for (let i = 0; i < n; i++) {
    const prevLiab = cumLiab;
    cumLiab += liabilities[i];
    let gapMin: number | null = null;
    if (i > 0) {
      const diffMs =
        new Date(sorted[i].startTime).getTime() - new Date(sorted[i - 1].startTime).getTime();
      gapMin = Math.round(diffMs / 60000);
      if (gapMin < minGapMinutes) minGapMinutes = gapMin;
    }
    const profitIfLostHere =
      layStakes[i] * (1 - commissions[i]) + effectiveRefund - prevLiab - initialOutlay;

    steps.push({
      legIndex: i + 1,
      row: sorted[i],
      backOdds: sorted[i].backOdds,
      layOdds: sorted[i].layOdds,
      commission: commissions[i],
      layStake: round2(layStakes[i]),
      liability: round2(liabilities[i]),
      cumulativeLiability: round2(cumLiab),
      profitIfLostHere: round2(profitIfLostHere),
      gapMinutesFromPrev: gapMin,
    });
  }

  const profitIfAllWin = round2(winPayout - cumLiab - initialOutlay);
  const guaranteedProfit = round2(nextValue - initialOutlay);

  // Combined effective lay odds: product of (L_i - c) / (1 - c)
  const effectiveCombinedLayOdds = sorted.reduce((acc, r, idx) => {
    const c = commissions[idx];
    return acc * ((r.layOdds - c) / Math.max(0.01, 1 - c));
  }, 1);

  let rating = 0;
  if (mode === 'normal') {
    rating = stake > 0 ? round2((1 + guaranteedProfit / stake) * 100) : 0;
  } else if (mode === 'snr' || mode === 'sr') {
    rating = stake > 0 ? round2((guaranteedProfit / stake) * 100) : 0;
  } else {
    const base = refundAmount > 0 ? refundAmount : stake;
    rating = base > 0 ? round2((guaranteedProfit / base) * 100) : 0;
  }

  const minLiquidity = Math.min(...sorted.map((r) => r.liquidity));
  const safeMinGap = Number.isFinite(minGapMinutes) ? minGapMinutes : 999;

  return {
    id: sorted.map((r) => r.id).join('__'),
    bookmakerId: sorted[0].bookmakerId,
    bookmakerName: sorted[0].bookmakerName,
    bookmakerColor: sorted[0].bookmakerColor,
    exchangeId: sorted[0].exchangeId,
    exchangeName: sorted[0].exchangeName,
    legs: steps,
    combinedBackOdds: round2(combinedBackOdds),
    boostedBackOdds: round2(boostedBackOdds),
    effectiveCombinedLayOdds: round2(effectiveCombinedLayOdds),
    rating,
    profitIfAllWin,
    guaranteedProfit,
    maxCumulativeLiability: round2(cumLiab),
    minLiquidity: round2(minLiquidity),
    minGapMinutes: safeMinGap,
    nonOverlapping: n <= 1 || safeMinGap >= minGapRequiredMinutes,
  };
}

export interface MultioddsSearchConfig {
  rows: OddsmatcherRow[];
  bookmakerId?: string; // 'ALL' or specific bookmakerId (legacy single filter)
  bookmakerIds?: string[]; // Optional multi-select bookmaker filter ([] = all)
  exchangeId?: string; // 'ALL' or specific exchangeId (legacy single filter)
  exchangeIds?: string[]; // Optional multi-select exchange filter ([] = all)
  legsCount: number; // 2..5
  mode: BetMode;
  stake: number;
  minLegOdds: number;
  maxLegOdds: number;
  minCombinedOdds: number;
  maxCombinedOdds: number;
  minLiquidity: number;
  minGapMinutes: number; // e.g., 120 min for non-overlapping sequential lay (0 = allow overlap)
  bonusBoostPct: number;
  refundAmount: number;
  refundRetention: number;
  commissionOverride?: number;
  lockedRowIds?: string[];
  maxResults?: number;
}

/**
 * Fast beam-search / combinatorial optimizer that finds the top highest-rating
 * single-bookmaker N-leg accumulators respecting distinct events, non-overlapping kickoff gaps,
 * per-leg odds bounds, combined odds bounds, and minimum liquidity.
 */
export function findBestMultiodds(cfg: MultioddsSearchConfig): MultioddsPlan[] {
  const {
    rows,
    bookmakerId = 'ALL',
    bookmakerIds,
    exchangeId = 'ALL',
    exchangeIds,
    legsCount,
    mode,
    stake,
    minLegOdds,
    maxLegOdds,
    minCombinedOdds,
    maxCombinedOdds,
    minLiquidity,
    minGapMinutes,
    bonusBoostPct,
    refundAmount,
    refundRetention,
    commissionOverride,
    lockedRowIds = [],
    maxResults = 40,
  } = cfg;

  const targetLegs = Math.max(2, Math.min(5, Math.floor(legsCount)));

  // Filter candidate rows
  const filtered = rows.filter((r) => {
    if (bookmakerIds && bookmakerIds.length > 0) {
      if (!bookmakerIds.includes(r.bookmakerId)) return false;
    } else if (bookmakerId && bookmakerId !== 'ALL' && r.bookmakerId !== bookmakerId) {
      return false;
    }
    if (exchangeIds && exchangeIds.length > 0) {
      if (!exchangeIds.includes(r.exchangeId)) return false;
    } else if (exchangeId && exchangeId !== 'ALL' && r.exchangeId !== exchangeId) {
      return false;
    }
    if (r.backOdds < minLegOdds || r.backOdds > maxLegOdds) return false;
    if (r.liquidity < minLiquidity) return false;
    return true;
  });

  // Group by bookmaker (a multipla MUST be placed on a single bookmaker!)
  const byBookmaker = new Map<string, OddsmatcherRow[]>();
  for (const r of filtered) {
    const arr = byBookmaker.get(r.bookmakerId) ?? [];
    arr.push(r);
    byBookmaker.set(r.bookmakerId, arr);
  }

  const lockedSet = new Set(lockedRowIds);
  const allPlans: MultioddsPlan[] = [];

  for (const [, bookRows] of byBookmaker) {
    // Keep only the best selection per eventKey (unless locked) to ensure no two legs are on the same match
    const bestPerEvent = new Map<string, OddsmatcherRow>();
    for (const r of bookRows) {
      if (lockedSet.has(r.id)) {
        bestPerEvent.set(r.eventKey, r);
        continue;
      }
      const existing = bestPerEvent.get(r.eventKey);
      if (!existing) {
        bestPerEvent.set(r.eventKey, r);
      } else if (!lockedSet.has(existing.id)) {
        const scoreNew = mode === 'snr' ? r.ratingSnr : r.ratingNormal;
        const scoreOld = mode === 'snr' ? existing.ratingSnr : existing.ratingNormal;
        if (scoreNew > scoreOld) {
          bestPerEvent.set(r.eventKey, r);
        }
      }
    }

    // Separate locked rows for this bookmaker
    const lockedRows = Array.from(bestPerEvent.values()).filter((r) => lockedSet.has(r.id));
    if (lockedSet.size > 0 && lockedRows.length !== lockedSet.size) {
      // Locked rows belong to another bookmaker
      continue;
    }

    // Take top 26 highest-rating events for fast, rich combinatorial search
    const pool = Array.from(bestPerEvent.values())
      .filter((r) => !lockedSet.has(r.id))
      .sort((a, b) => {
        const sa = mode === 'snr' ? a.ratingSnr : a.ratingNormal;
        const sb = mode === 'snr' ? b.ratingSnr : b.ratingNormal;
        return sb - sa;
      })
      .slice(0, 26);

    const remainingNeeded = targetLegs - lockedRows.length;
    if (remainingNeeded < 0 || pool.length < remainingNeeded) continue;

    // Precompute timestamps in minutes for ultra-fast overlap checks
    const tsMin = (r: OddsmatcherRow) => Math.floor(new Date(r.startTime).getTime() / 60000);

    const isTimeCompatible = (chosen: OddsmatcherRow[], candidate: OddsmatcherRow): boolean => {
      if (minGapMinutes <= 0) return true;
      const tCand = tsMin(candidate);
      for (const c of chosen) {
        if (Math.abs(tsMin(c) - tCand) < minGapMinutes) return false;
      }
      return true;
    };

    const chosen: OddsmatcherRow[] = [...lockedRows];
    let evaluated = 0;
    const MAX_EVAL = 3500;

    const dfs = (startIdx: number, currentCombinedOdds: number) => {
      if (evaluated >= MAX_EVAL) return;
      if (chosen.length === targetLegs) {
        evaluated++;
        if (currentCombinedOdds < minCombinedOdds || currentCombinedOdds > maxCombinedOdds) return;
        const plan = calculateSequentialMultiodds({
          rows: chosen,
          mode,
          stake,
          commissionOverride,
          bonusBoostPct,
          refundAmount,
          refundRetention,
          minGapRequiredMinutes: minGapMinutes,
        });
        allPlans.push(plan);
        return;
      }

      const slotsLeft = targetLegs - chosen.length;
      for (let i = startIdx; i <= pool.length - slotsLeft; i++) {
        if (evaluated >= MAX_EVAL) break;
        const cand = pool[i];
        if (!isTimeCompatible(chosen, cand)) continue;
        const nextOdds = currentCombinedOdds * cand.backOdds;
        // Pruning upper bound
        if (nextOdds > maxCombinedOdds) continue;
        chosen.push(cand);
        dfs(i + 1, nextOdds);
        chosen.pop();
      }
    };

    const initOdds = lockedRows.reduce((acc, r) => acc * r.backOdds, 1);
    dfs(0, initOdds);
  }

  // Deduplicate and sort by highest rating, then highest guaranteed profit
  const seen = new Set<string>();
  const unique = allPlans.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  unique.sort((a, b) => b.rating - a.rating || b.guaranteedProfit - a.guaranteedProfit);
  return unique.slice(0, maxResults);
}

export interface DutcherCalcResult {
  stakes: number[];
  returns: number[];
  profits: number[];
  totalOutlay: number;
  guaranteedProfit: number;
  rating: number;
}

/**
 * Computes exact Dutching stake split for 2-way or 3-way bookmaker hedging.
 * If anchorMode === 'total', distributes `stake` across all legs to guarantee equal payout.
 * If anchorMode === 'leg0_normal' or 'leg0_snr', fixes leg 0 stake = `stake` and hedges all remaining legs.
 */
export function calculateDutcher(params: {
  row: DutcherRow;
  stake: number;
  anchorMode: 'total' | 'leg0_normal' | 'leg0_snr';
}): DutcherCalcResult {
  const { row, stake, anchorMode } = params;
  const odds = row.legs.map((l) => l.odds);
  const k = odds.length;
  if (k < 2 || stake <= 0 || odds.some((o) => o <= 1)) {
    return {
      stakes: odds.map(() => 0),
      returns: odds.map(() => 0),
      profits: odds.map(() => 0),
      totalOutlay: 0,
      guaranteedProfit: 0,
      rating: 0,
    };
  }

  const invSum = odds.reduce((acc, o) => acc + 1 / o, 0);

  if (anchorMode === 'total') {
    const targetReturn = stake / invSum;
    const stakes = odds.map((o) => round2(targetReturn / o));
    const totalOutlay = round2(stakes.reduce((a, b) => a + b, 0));
    const returns = odds.map((o, i) => round2(stakes[i] * o));
    const profits = returns.map((r) => round2(r - totalOutlay));
    const avgProfit = round2(profits.reduce((a, b) => a + b, 0) / k);
    return {
      stakes,
      returns,
      profits,
      totalOutlay,
      guaranteedProfit: avgProfit,
      rating: round2((1 / invSum) * 100),
    };
  }

  if (anchorMode === 'leg0_normal') {
    const targetReturn = stake * odds[0];
    const stakes = odds.map((o, idx) => (idx === 0 ? round2(stake) : round2(targetReturn / o)));
    const totalOutlay = round2(stakes.reduce((a, b) => a + b, 0));
    const returns = odds.map((o, i) => round2(stakes[i] * o));
    const profits = returns.map((r) => round2(r - totalOutlay));
    const avgProfit = round2(profits.reduce((a, b) => a + b, 0) / k);
    return {
      stakes,
      returns,
      profits,
      totalOutlay,
      guaranteedProfit: avgProfit,
      rating: round2((1 / invSum) * 100),
    };
  }

  // leg0_snr: Leg 0 is a Freebet (Stake Not Returned), Legs 1..k-1 are hedged with real cash
  const targetReturn = stake * (odds[0] - 1);
  const stakes = odds.map((o, idx) => (idx === 0 ? round2(stake) : round2(targetReturn / o)));
  const cashOutlay = round2(stakes.slice(1).reduce((a, b) => a + b, 0));
  const returns = odds.map((o, i) => (i === 0 ? round2(stake * (o - 1)) : round2(stakes[i] * o)));
  const profits = returns.map((r) => round2(r - cashOutlay));
  const avgProfit = round2(profits.reduce((a, b) => a + b, 0) / k);
  return {
    stakes,
    returns,
    profits,
    totalOutlay: cashOutlay,
    guaranteedProfit: avgProfit,
    rating: round2((avgProfit / stake) * 100),
  };
}

export interface PuntaPuntaCalcInput {
  mode: BetMode; // 'normal' | 'snr' | 'sr' | 'rf'
  stake: number; // Stake on leg 0 (or total budget when mode==='normal' && anchorMode==='total')
  odds: number[]; // length 2..4, odds[0] = primary/promo bookmaker, odds[1..k-1] = hedge bookmakers
  anchorMode?: 'leg0' | 'total'; // 'total' only applies when mode === 'normal'
  refundAmount?: number; // RF mode: bonus refunded if leg 0 loses (any leg i>=1 wins)
  refundRetention?: number; // RF mode: 0..100%
}

export interface PuntaPuntaCalcResult {
  stakes: number[]; // rounded to 2 decimals; stakes[0] is promo stake, stakes[1..] are real cash hedges
  returns: number[]; // gross payout on each outcome (excludes refund)
  profits: number[]; // net real-cash profit on each outcome (includes effectiveRefund on i>=1 for RF)
  hedgeTotal: number; // sum(stakes[1..])
  totalCashOutlay: number; // stakes[0] + hedgeTotal for normal/rf; hedgeTotal for snr/sr
  effectiveRefund: number; // refundAmount * (refundRetention/100) for rf, else 0
  guaranteedProfit: number; // average net profit across outcomes
  rating: number; // normal: (1/invSum)*100; snr/sr: (profit/stake)*100; rf: (profit/(refundAmount||stake))*100
  impliedProbSum: number; // sum(1 / odds[i])
}

/**
 * Standalone Punta-Punta (Bookmaker vs Bookmaker / Dutching) calculator across
 * Normale, Freebet SNR, Bonus SR, and Rimborso RF for 2..4 outcomes.
 */
export function calculatePuntaPunta(input: PuntaPuntaCalcInput): PuntaPuntaCalcResult {
  const {
    mode,
    stake,
    odds,
    anchorMode = 'leg0',
    refundAmount = 0,
    refundRetention = 70,
  } = input;

  const k = odds.length;
  if (k < 2 || stake <= 0 || odds.some((o) => o <= 1)) {
    return {
      stakes: odds.map(() => 0),
      returns: odds.map(() => 0),
      profits: odds.map(() => 0),
      hedgeTotal: 0,
      totalCashOutlay: 0,
      effectiveRefund: 0,
      guaranteedProfit: 0,
      rating: 0,
      impliedProbSum: 0,
    };
  }

  const invSum = odds.reduce((acc, o) => acc + 1 / o, 0);

  if (mode === 'normal') {
    const useTotalAnchor = anchorMode === 'total';
    const targetReturn = useTotalAnchor ? stake / invSum : stake * odds[0];
    const stakes = odds.map((o, i) =>
      i === 0 && !useTotalAnchor ? round2(stake) : round2(targetReturn / o)
    );
    const hedgeTotal = round2(stakes.slice(1).reduce((a, b) => a + b, 0));
    const totalCashOutlay = round2(stakes.reduce((a, b) => a + b, 0));
    const returns = odds.map((o, i) => round2(stakes[i] * o));
    const profits = returns.map((r) => round2(r - totalCashOutlay));
    const guaranteedProfit = round2(profits.reduce((a, b) => a + b, 0) / k);
    return {
      stakes,
      returns,
      profits,
      hedgeTotal,
      totalCashOutlay,
      effectiveRefund: 0,
      guaranteedProfit,
      rating: round2((1 / invSum) * 100),
      impliedProbSum: round3(invSum),
    };
  }

  if (mode === 'snr' || mode === 'sr') {
    const targetReturn = mode === 'snr' ? stake * (odds[0] - 1) : stake * odds[0];
    const stakes = odds.map((o, i) => (i === 0 ? round2(stake) : round2(targetReturn / o)));
    const hedgeTotal = round2(stakes.slice(1).reduce((a, b) => a + b, 0));
    const returns = odds.map((o, i) =>
      i === 0 && mode === 'snr' ? round2(stakes[0] * (o - 1)) : round2(stakes[i] * o)
    );
    const profits = returns.map((r) => round2(r - hedgeTotal));
    const guaranteedProfit = round2(profits.reduce((a, b) => a + b, 0) / k);
    return {
      stakes,
      returns,
      profits,
      hedgeTotal,
      totalCashOutlay: hedgeTotal,
      effectiveRefund: 0,
      guaranteedProfit,
      rating: round2((guaranteedProfit / stake) * 100),
      impliedProbSum: round3(invSum),
    };
  }

  // Rimborso RF: Leg 0 backed with real cash; if any hedge leg wins (leg 0 loses), refund triggers
  const effectiveRefund = Math.max(0, refundAmount) * (Math.max(0, refundRetention) / 100);
  const targetHedgeReturn = Math.max(0, stake * odds[0] - effectiveRefund);
  const stakes = odds.map((o, i) => (i === 0 ? round2(stake) : round2(targetHedgeReturn / o)));
  const hedgeTotal = round2(stakes.slice(1).reduce((a, b) => a + b, 0));
  const totalCashOutlay = round2(stakes[0] + hedgeTotal);
  const returns = odds.map((o, i) => round2(stakes[i] * o));
  const profits = returns.map((r, i) =>
    round2(i === 0 ? r - totalCashOutlay : r + effectiveRefund - totalCashOutlay)
  );
  const guaranteedProfit = round2(profits.reduce((a, b) => a + b, 0) / k);
  const base = refundAmount > 0 ? refundAmount : stake;

  return {
    stakes,
    returns,
    profits,
    hedgeTotal,
    totalCashOutlay,
    effectiveRefund: round2(effectiveRefund),
    guaranteedProfit,
    rating: round2((guaranteedProfit / base) * 100),
    impliedProbSum: round3(invSum),
  };
}

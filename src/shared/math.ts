import { matchesDateRange, type DateRangeValue } from './dateRange';
import type {
  BetMode,
  DutcherRow,
  MarketType,
  MultioddsPlan,
  MultioddsStep,
  OddsmatcherRow,
  RolloverCalcDetails,
  RolloverWalletRule,
  SingleCalcInput,
  SingleCalcResult,
  SportKey,
} from './types';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

export interface AutoRolloverRatingInput {
  rows?: OddsmatcherRow[];
  minBackOdds?: number;
  minLiquidity?: number;
  currentBackOdds?: number;
  currentLayOdds?: number;
  currentCommission?: number;
}

export interface AutoRolloverRatingResult {
  estimatedRating: number;
  source: 'oddsmatcher' | 'current_quote' | 'default';
  sampleCount: number;
}

function clampAutoRating(val: number): number {
  if (!Number.isFinite(val)) return 96;
  return round2(Math.max(70, Math.min(99.8, val)));
}

function median(sortedAsc: number[]): number {
  if (sortedAsc.length === 0) return 96;
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 === 1
    ? sortedAsc[mid]
    : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

/**
 * Estimates the expected future rollover rating (%) automatically from live Oddsmatcher rows
 * (filtering realistic liquid non-surebet matches >= minBackOdds) with clean fallback to the
 * active quote's normal rating or 96% default.
 */
export function computeAutoRolloverRating(
  input: AutoRolloverRatingInput
): AutoRolloverRatingResult {
  const {
    rows = [],
    minBackOdds = 1.5,
    minLiquidity = 15,
    currentBackOdds,
    currentLayOdds,
    currentCommission = 0.045,
  } = input;

  const pickRatings = (oddsFloor: number, liqFloor: number): number[] => {
    const ratings: number[] = [];
    for (const r of rows) {
      if (r.backOdds < oddsFloor) continue;
      if (r.liquidity < liqFloor) continue;
      // Exclude surebet spikes (>=100.5%) so future rollover cost isn't artificially optimistic
      if (r.ratingNormal > 65 && r.ratingNormal < 100.5) {
        ratings.push(Math.min(99.8, r.ratingNormal));
      }
    }
    ratings.sort((a, b) => b - a);
    return ratings;
  };

  let candidates = pickRatings(minBackOdds, minLiquidity);
  if (candidates.length < 5) {
    candidates = pickRatings(1.2, 5);
  }

  if (candidates.length >= 3) {
    const topSlice = candidates.slice(0, 20).sort((a, b) => a - b);
    return {
      estimatedRating: clampAutoRating(median(topSlice)),
      source: 'oddsmatcher',
      sampleCount: topSlice.length,
    };
  }

  if (
    currentBackOdds !== undefined &&
    currentLayOdds !== undefined &&
    currentBackOdds > 1 &&
    currentLayOdds > 1 &&
    currentLayOdds > currentCommission
  ) {
    const qRating =
      ((currentBackOdds * (1 - Math.max(0, currentCommission))) /
        (currentLayOdds - Math.max(0, currentCommission))) *
      100;
    return {
      estimatedRating: clampAutoRating(qRating),
      source: 'current_quote',
      sampleCount: 1,
    };
  }

  return {
    estimatedRating: 96,
    source: 'default',
    sampleCount: 0,
  };
}

/**
 * Estimates future rollover rating (%) for Punta-Punta from live Dutcher rows
 * or the currently entered bookmaker odds.
 */
export function computeAutoPuntaPuntaRolloverRating(params: {
  dutcherRows?: DutcherRow[];
  currentOdds?: number[];
}): AutoRolloverRatingResult {
  const { dutcherRows = [], currentOdds = [] } = params;
  const candidates = dutcherRows
    .map((d) => d.rating)
    .filter((r) => Number.isFinite(r) && r > 65 && r < 100.5)
    .sort((a, b) => b - a);

  if (candidates.length >= 3) {
    const topSlice = candidates.slice(0, 15).sort((a, b) => a - b);
    return {
      estimatedRating: clampAutoRating(median(topSlice)),
      source: 'oddsmatcher',
      sampleCount: topSlice.length,
    };
  }

  if (currentOdds.length >= 2 && currentOdds.every((o) => o > 1)) {
    const invSum = currentOdds.reduce((acc, o) => acc + 1 / o, 0);
    if (invSum > 0) {
      return {
        estimatedRating: clampAutoRating((1 / invSum) * 100),
        source: 'current_quote',
        sampleCount: 1,
      };
    }
  }

  return {
    estimatedRating: 95,
    source: 'default',
    sampleCount: 0,
  };
}

interface RolloverInternalContext {
  stake: number;
  realBalance: number;
  bonusBalance: number;
  extraRealUsed: number;
  effectiveReal: number;
  totalBalanceBefore: number;
  rolloverBefore: number;
  rolloverAfter: number;
  estimatedRating: number;
  walletRule: RolloverWalletRule;
  bookieBalanceIfWin: number;
  bookieBalanceIfLose: number;
  futureRolloverCostIfWin: number;
  futureRolloverCostIfLose: number;
  clearsRolloverOnLose: boolean;
  completesRolloverOnThisBet: boolean;
  baselineExpectedValue: number;
}

function computeRolloverContext(params: {
  stake: number;
  backOdds: number;
  realBalance?: number;
  bonusBalance?: number;
  rolloverRemaining?: number;
  estimatedRating?: number;
  rolloverWalletRule?: RolloverWalletRule;
}): RolloverInternalContext {
  const stake = Math.max(0, Number.isFinite(params.stake) ? params.stake : 0);
  const realInput = Math.max(0, Number.isFinite(params.realBalance) ? (params.realBalance ?? 0) : 0);
  const bonusBalance = Math.max(
    0,
    Number.isFinite(params.bonusBalance) ? (params.bonusBalance ?? 0) : 0
  );
  const rolloverBefore = Math.max(
    0,
    Number.isFinite(params.rolloverRemaining) ? (params.rolloverRemaining ?? 0) : 0
  );
  const estimatedRating = Math.max(
    0,
    Number.isFinite(params.estimatedRating) ? (params.estimatedRating ?? 96) : 96
  );
  const walletRule: RolloverWalletRule =
    params.rolloverWalletRule === 'bonus_first' ? 'bonus_first' : 'mixed';

  const rawTotal = realInput + bonusBalance;
  const extraRealUsed = Math.max(0, stake - rawTotal);
  const effectiveReal = realInput + extraRealUsed;
  const totalBalanceBefore = rawTotal + extraRealUsed;

  const rolloverAfter = Math.max(0, rolloverBefore - stake);
  const completesRolloverOnThisBet = rolloverAfter <= 1e-9;

  const bookieBalanceIfWin = totalBalanceBefore + stake * (params.backOdds - 1);
  const bookieBalanceIfLose = Math.max(0, totalBalanceBefore - stake);

  const futureFrictionRate = 1 - estimatedRating / 100;
  const futureRolloverCostIfWin = completesRolloverOnThisBet
    ? 0
    : rolloverAfter * futureFrictionRate;

  // Losing on bookmaker clears remaining rollover immediately if bookie balance hits 0
  // (bust-out) or, in bonus_first mode, when the entire bonus wallet was staked & lost.
  const bonusExhaustedOnLose =
    walletRule === 'bonus_first' && bonusBalance > 0 && stake >= bonusBalance - 1e-9;
  const clearsRolloverOnLose =
    completesRolloverOnThisBet || bookieBalanceIfLose <= 1e-9 || bonusExhaustedOnLose;

  const futureRolloverCostIfLose = clearsRolloverOnLose
    ? 0
    : rolloverAfter * futureFrictionRate;

  const baselineExpectedValue = bonusBalance - rolloverBefore * futureFrictionRate;

  return {
    stake,
    realBalance: realInput,
    bonusBalance,
    extraRealUsed,
    effectiveReal,
    totalBalanceBefore,
    rolloverBefore,
    rolloverAfter,
    estimatedRating,
    walletRule,
    bookieBalanceIfWin,
    bookieBalanceIfLose,
    futureRolloverCostIfWin,
    futureRolloverCostIfLose,
    clearsRolloverOnLose,
    completesRolloverOnThisBet,
    baselineExpectedValue,
  };
}

export interface MultioddsModeParams {
  winPayout: number;
  initialOutlay: number;
  effectiveRefund: number;
  rolloverCtx: RolloverInternalContext | null;
}

/**
 * Computes mode-specific sequential multipla payoff boundary constants
 * (winPayout, initialOutlay, effectiveRefund) shared by Multiodds & Saved Multiples.
 */
export function computeMultioddsModeParams(params: {
  mode: BetMode;
  stake: number;
  combinedBackOdds: number;
  boostedBackOdds: number;
  bonusBoostPct: number;
  refundAmount?: number;
  refundRetention?: number;
  realBalance?: number;
  bonusBalance?: number;
  rolloverRemaining?: number;
  estimatedRating?: number;
  rolloverWalletRule?: RolloverWalletRule;
}): MultioddsModeParams {
  const {
    mode,
    stake,
    combinedBackOdds,
    boostedBackOdds,
    bonusBoostPct,
    refundAmount = 0,
    refundRetention = 70,
    realBalance,
    bonusBalance,
    rolloverRemaining,
    estimatedRating,
    rolloverWalletRule,
  } = params;
  const boostFactor = 1 + Math.max(0, bonusBoostPct) / 100;

  if (mode === 'rollover') {
    const rolloverCtx = computeRolloverContext({
      stake,
      backOdds: boostedBackOdds,
      realBalance,
      bonusBalance,
      rolloverRemaining,
      estimatedRating,
      rolloverWalletRule,
    });
    return {
      winPayout: stake * boostedBackOdds - rolloverCtx.futureRolloverCostIfWin,
      initialOutlay: stake - rolloverCtx.bonusBalance,
      effectiveRefund: -rolloverCtx.futureRolloverCostIfLose,
      rolloverCtx,
    };
  }

  const winPayout =
    mode === 'snr'
      ? stake * (combinedBackOdds - 1) * boostFactor
      : stake * boostedBackOdds;
  const initialOutlay = mode === 'normal' || mode === 'rf' ? stake : 0;
  const effectiveRefund =
    mode === 'rf' ? Math.max(0, refundAmount) * (Math.max(0, refundRetention) / 100) : 0;

  return {
    winPayout,
    initialOutlay,
    effectiveRefund,
    rolloverCtx: null,
  };
}

export function computeMultioddsRating(params: {
  mode: BetMode;
  stake: number;
  refundAmount: number;
  guaranteedProfit: number;
  bonusBalance?: number;
}): number {
  const { mode, stake, refundAmount, guaranteedProfit, bonusBalance = 0 } = params;
  if (mode === 'normal') {
    return stake > 0 ? round2((1 + guaranteedProfit / stake) * 100) : 0;
  }
  if (mode === 'rollover') {
    if (bonusBalance > 0) {
      return round2((guaranteedProfit / bonusBalance) * 100);
    }
    return stake > 0 ? round2((1 + guaranteedProfit / stake) * 100) : 0;
  }
  if (mode === 'snr' || mode === 'sr') {
    return stake > 0 ? round2((guaranteedProfit / stake) * 100) : 0;
  }
  const base = refundAmount > 0 ? refundAmount : stake;
  return base > 0 ? round2((guaranteedProfit / base) * 100) : 0;
}

/**
 * Computes exact Matched Betting lay stake, liability, payoffs, and rating
 * for Normale, SNR (Freebet), SR (Bonus Reale), RF (Rimborso/Cashback),
 * and Rollover (Real + Bonus + Remaining Rollover + Estimated Rating),
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
    realBalance = 0,
    bonusBalance = 0,
    rolloverRemaining = 0,
    estimatedRating = 96,
    rolloverWalletRule = 'mixed',
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
  const rolloverCtx =
    mode === 'rollover'
      ? computeRolloverContext({
          stake,
          backOdds,
          realBalance,
          bonusBalance,
          rolloverRemaining,
          estimatedRating,
          rolloverWalletRule,
        })
      : null;

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
  } else if (mode === 'rf') {
    // RF (Rimborso / Risk-Free)
    balancedLayStake = Math.max(0, (stake * backOdds - effectiveRefund) / denom);
    underlayStake = Math.max(0, Math.min(balancedLayStake, (stake * (backOdds - 1)) / (layOdds - 1)));
    overlayStake = Math.max(balancedLayStake, Math.max(0, (stake - effectiveRefund) / (1 - commission)));
  } else if (rolloverCtx) {
    // Rollover: balance final campaign profit net of future rollover cost across both outcomes
    const costDelta =
      rolloverCtx.futureRolloverCostIfWin - rolloverCtx.futureRolloverCostIfLose;
    balancedLayStake = Math.max(0, (stake * backOdds - costDelta) / denom);

    const balLiab = balancedLayStake * (layOdds - 1);
    const balProfit =
      rolloverCtx.bonusBalance +
      stake * (backOdds - 1) -
      balLiab -
      rolloverCtx.futureRolloverCostIfWin;

    const zeroBookieLay = Math.max(
      0,
      (rolloverCtx.bonusBalance +
        stake * (backOdds - 1) -
        rolloverCtx.futureRolloverCostIfWin) /
        Math.max(0.01, layOdds - 1)
    );
    const zeroExchLay = Math.max(
      0,
      (stake - rolloverCtx.bonusBalance + rolloverCtx.futureRolloverCostIfLose) /
        Math.max(0.01, 1 - commission)
    );

    if (balProfit >= 0) {
      if (rolloverCtx.effectiveReal > 0) {
        underlayStake = Math.min(
          balancedLayStake,
          Math.max(balancedLayStake * 0.5, zeroExchLay)
        );
        overlayStake = Math.max(
          balancedLayStake,
          Math.min(balancedLayStake * 1.35, zeroBookieLay)
        );
      } else {
        underlayStake = balancedLayStake * 0.85;
        overlayStake = balancedLayStake * 1.15;
      }
    } else {
      underlayStake = Math.min(balancedLayStake, zeroBookieLay);
      overlayStake = Math.max(balancedLayStake, zeroExchLay);
    }
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
  } else if (mode === 'rf') {
    // RF
    bookieWinProfit = stake * (backOdds - 1) - liability;
    exchangeWinProfit = layStake * (1 - commission) - stake + effectiveRefund;
  } else if (rolloverCtx) {
    bookieWinProfit =
      rolloverCtx.bonusBalance +
      stake * (backOdds - 1) -
      liability -
      rolloverCtx.futureRolloverCostIfWin;
    exchangeWinProfit =
      rolloverCtx.bonusBalance -
      stake +
      layStake * (1 - commission) -
      rolloverCtx.futureRolloverCostIfLose;
  }

  const expectedProfit = (bookieWinProfit + exchangeWinProfit) / 2;
  const rawRating = (backOdds / layOdds) * 100;
  const matchRating = ((backOdds * (1 - commission)) / denom) * 100;

  let rating = 0;
  if (mode === 'normal') {
    // Standard Italian Matched Betting rating (100 + Profit/Stake*100)
    rating = matchRating;
  } else if (mode === 'snr') {
    rating = (((backOdds - 1) * (1 - commission)) / denom) * 100;
  } else if (mode === 'sr') {
    rating = matchRating;
  } else if (mode === 'rf') {
    // RF rating: profit as % of refundAmount (or stake if refundAmount=0)
    const base = refundAmount > 0 ? refundAmount : stake;
    rating = (expectedProfit / base) * 100;
  } else if (rolloverCtx) {
    if (rolloverCtx.bonusBalance > 0) {
      rating = (expectedProfit / rolloverCtx.bonusBalance) * 100;
    } else {
      rating = (1 + expectedProfit / stake) * 100;
    }
  }

  const rolloverDetails: RolloverCalcDetails | undefined = rolloverCtx
    ? {
        stake: round2(rolloverCtx.stake),
        realBalance: round2(rolloverCtx.realBalance),
        bonusBalance: round2(rolloverCtx.bonusBalance),
        extraRealUsed: round2(rolloverCtx.extraRealUsed),
        totalBalanceBefore: round2(rolloverCtx.totalBalanceBefore),
        rolloverBefore: round2(rolloverCtx.rolloverBefore),
        rolloverAfter: round2(rolloverCtx.rolloverAfter),
        estimatedRating: round2(rolloverCtx.estimatedRating),
        walletRule: rolloverCtx.walletRule,
        bookieBalanceIfWin: round2(rolloverCtx.bookieBalanceIfWin),
        bookieBalanceIfLose: round2(rolloverCtx.bookieBalanceIfLose),
        futureRolloverCostIfWin: round2(rolloverCtx.futureRolloverCostIfWin),
        futureRolloverCostIfLose: round2(rolloverCtx.futureRolloverCostIfLose),
        singleBetBookieProfit: round2(stake * (backOdds - 1) - liability),
        singleBetExchangeProfit: round2(layStake * (1 - commission) - stake),
        matchRating: round2(matchRating),
        clearsRolloverOnLose: rolloverCtx.clearsRolloverOnLose,
        completesRolloverOnThisBet: rolloverCtx.completesRolloverOnThisBet,
        baselineExpectedValue: round2(rolloverCtx.baselineExpectedValue),
      }
    : undefined;

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
    ...(rolloverDetails ? { rollover: rolloverDetails } : {}),
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
  realBalance?: number;
  bonusBalance?: number;
  rolloverRemaining?: number;
  estimatedRating?: number;
  rolloverWalletRule?: RolloverWalletRule;
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
    realBalance,
    bonusBalance,
    rolloverRemaining,
    estimatedRating,
    rolloverWalletRule,
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
  const boostedBackOdds = 1 + (combinedBackOdds - 1) * boostFactor;

  const { winPayout, initialOutlay, effectiveRefund, rolloverCtx } =
    computeMultioddsModeParams({
      mode,
      stake,
      combinedBackOdds,
      boostedBackOdds,
      bonusBoostPct,
      refundAmount,
      refundRetention,
      realBalance,
      bonusBalance,
      rolloverRemaining,
      estimatedRating,
      rolloverWalletRule,
    });

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

  const rating = computeMultioddsRating({
    mode,
    stake,
    refundAmount,
    guaranteedProfit,
    bonusBalance: rolloverCtx?.bonusBalance ?? 0,
  });

  const minLiquidity = Math.min(...sorted.map((r) => r.liquidity));
  const safeMinGap = Number.isFinite(minGapMinutes) ? minGapMinutes : 999;

  const matchRating =
    effectiveCombinedLayOdds > 0 ? (boostedBackOdds / effectiveCombinedLayOdds) * 100 : 0;

  const rolloverDetails: RolloverCalcDetails | undefined = rolloverCtx
    ? {
        stake: round2(rolloverCtx.stake),
        realBalance: round2(rolloverCtx.realBalance),
        bonusBalance: round2(rolloverCtx.bonusBalance),
        extraRealUsed: round2(rolloverCtx.extraRealUsed),
        totalBalanceBefore: round2(rolloverCtx.totalBalanceBefore),
        rolloverBefore: round2(rolloverCtx.rolloverBefore),
        rolloverAfter: round2(rolloverCtx.rolloverAfter),
        estimatedRating: round2(rolloverCtx.estimatedRating),
        walletRule: rolloverCtx.walletRule,
        bookieBalanceIfWin: round2(rolloverCtx.bookieBalanceIfWin),
        bookieBalanceIfLose: round2(rolloverCtx.bookieBalanceIfLose),
        futureRolloverCostIfWin: round2(rolloverCtx.futureRolloverCostIfWin),
        futureRolloverCostIfLose: round2(rolloverCtx.futureRolloverCostIfLose),
        singleBetBookieProfit: round2(stake * (boostedBackOdds - 1) - cumLiab),
        singleBetExchangeProfit: round2(
          (layStakes[0] ?? 0) * (1 - (commissions[0] ?? 0)) - stake
        ),
        matchRating: round2(matchRating),
        clearsRolloverOnLose: rolloverCtx.clearsRolloverOnLose,
        completesRolloverOnThisBet: rolloverCtx.completesRolloverOnThisBet,
        baselineExpectedValue: round2(rolloverCtx.baselineExpectedValue),
      }
    : undefined;

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
    rollover: rolloverDetails,
  };
}

export interface MultioddsSearchConfig {
  rows: OddsmatcherRow[];
  bookmakerId?: string; // 'ALL' or specific bookmakerId (legacy single filter)
  bookmakerIds?: string[]; // Optional multi-select bookmaker filter ([] = all)
  exchangeId?: string; // 'ALL' or specific exchangeId (legacy single filter)
  exchangeIds?: string[]; // Optional multi-select exchange filter ([] = all)
  sport?: SportKey | 'ALL';
  market?: MarketType | 'ALL';
  leaguePredicate?: (row: OddsmatcherRow) => boolean;
  dateRange?: DateRangeValue;
  search?: string;
  minRating?: number;
  onlySurebets?: boolean;
  noSurebets?: boolean;
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
  realBalance?: number;
  bonusBalance?: number;
  rolloverRemaining?: number;
  estimatedRating?: number;
  rolloverWalletRule?: RolloverWalletRule;
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
    sport = 'ALL',
    market = 'ALL',
    leaguePredicate,
    dateRange,
    search,
    minRating = 0,
    onlySurebets = false,
    noSurebets = false,
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
    realBalance,
    bonusBalance,
    rolloverRemaining,
    estimatedRating,
    rolloverWalletRule,
    commissionOverride,
    lockedRowIds = [],
    maxResults = 40,
  } = cfg;

  const targetLegs = Math.max(2, Math.min(5, Math.floor(legsCount)));
  const q = search?.trim().toLowerCase() ?? '';
  const nowMs = Date.now();

  // Filter candidate rows
  const filtered = rows.filter((r) => {
    if (sport !== 'ALL' && r.sport !== sport) return false;
    if (leaguePredicate && !leaguePredicate(r)) return false;
    if (market !== 'ALL' && r.marketType !== market) return false;
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
    if (dateRange && dateRange.mode !== 'all' && !matchesDateRange(r.startTime, dateRange, nowMs)) {
      return false;
    }
    if (noSurebets && (r.isSurebet || quickRatings(r.backOdds, r.layOdds, r.commission).isSurebet)) {
      return false;
    }
    if (q) {
      const hay = `${r.eventName} ${r.league} ${r.selectionLabel} ${r.bookmakerName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
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
          realBalance,
          bonusBalance,
          rolloverRemaining,
          estimatedRating,
          rolloverWalletRule,
          minGapRequiredMinutes: minGapMinutes,
        });
        if (minRating > 0 && plan.rating < minRating) return;
        if (onlySurebets && (plan.rollover ? plan.rollover.matchRating < 100 : plan.rating < 100)) {
          return;
        }
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
  mode: BetMode; // 'normal' | 'snr' | 'sr' | 'rf' | 'rollover'
  stake: number; // Stake on leg 0 (or total budget when mode==='normal' && anchorMode==='total')
  odds: number[]; // length 2..4, odds[0] = primary/promo bookmaker, odds[1..k-1] = hedge bookmakers
  anchorMode?: 'leg0' | 'total'; // 'total' only applies when mode === 'normal'
  refundAmount?: number; // RF mode: bonus refunded if leg 0 loses (any leg i>=1 wins)
  refundRetention?: number; // RF mode: 0..100%
  /** Rollover mode inputs (leg 0 = rollover bookmaker) */
  realBalance?: number;
  bonusBalance?: number;
  rolloverRemaining?: number;
  estimatedRating?: number;
  rolloverWalletRule?: RolloverWalletRule;
  /** -1 = full underlay (favor leg 0), 0 = balanced, +1 = full overlay (favor hedge legs) */
  balanceBias?: number;
}

export interface PuntaPuntaCalcResult {
  stakes: number[]; // rounded to 2 decimals; stakes[0] is promo stake, stakes[1..] are real cash hedges
  returns: number[]; // gross payout on each outcome (excludes refund)
  profits: number[]; // net real-cash profit on each outcome (includes effectiveRefund on i>=1 for RF)
  hedgeTotal: number; // sum(stakes[1..])
  balancedHedgeTotal: number; // sum(stakes[1..]) at balanceBias = 0
  underlayHedgeTotal: number; // sum(stakes[1..]) at balanceBias = -1
  overlayHedgeTotal: number; // sum(stakes[1..]) at balanceBias = +1
  totalCashOutlay: number; // stakes[0] + hedgeTotal for normal/rf; hedgeTotal for snr/sr; effectiveReal + hedgeTotal for rollover
  effectiveRefund: number; // refundAmount * (refundRetention/100) for rf, else 0
  guaranteedProfit: number; // average net profit across outcomes
  rating: number; // normal: (1/invSum)*100; snr/sr: (profit/stake)*100; rf: (profit/(refundAmount||stake))*100; rollover: (profit/bonusBalance)*100
  impliedProbSum: number; // sum(1 / odds[i])
  rollover?: RolloverCalcDetails;
}

/**
 * Standalone Punta-Punta (Bookmaker vs Bookmaker / Dutching) calculator across
 * Normale, Freebet SNR, Bonus SR, Rimborso RF, and Rollover for 2..4 outcomes,
 * with optional Underlay (-1) / Balanced (0) / Overlay (+1) shift.
 */
export function calculatePuntaPunta(input: PuntaPuntaCalcInput): PuntaPuntaCalcResult {
  const {
    mode,
    stake,
    odds,
    anchorMode = 'leg0',
    refundAmount = 0,
    refundRetention = 70,
    realBalance = 0,
    bonusBalance = 0,
    rolloverRemaining = 0,
    estimatedRating = 95,
    rolloverWalletRule = 'mixed',
    balanceBias = 0,
  } = input;

  const k = odds.length;
  if (k < 2 || stake <= 0 || odds.some((o) => o <= 1)) {
    return {
      stakes: odds.map(() => 0),
      returns: odds.map(() => 0),
      profits: odds.map(() => 0),
      hedgeTotal: 0,
      balancedHedgeTotal: 0,
      underlayHedgeTotal: 0,
      overlayHedgeTotal: 0,
      totalCashOutlay: 0,
      effectiveRefund: 0,
      guaranteedProfit: 0,
      rating: 0,
      impliedProbSum: 0,
    };
  }

  const invSum = odds.reduce((acc, o) => acc + 1 / o, 0);
  const hedgeInvSum = odds.slice(1).reduce((acc, o) => acc + 1 / o, 0);
  const clampedBias = Math.max(-1, Math.min(1, balanceBias));

  const interpolateHedge = (balanced: number, underlay: number, overlay: number): number => {
    if (clampedBias < 0) {
      return Math.max(0, balanced + (balanced - underlay) * clampedBias);
    }
    if (clampedBias > 0) {
      return Math.max(0, balanced + (overlay - balanced) * clampedBias);
    }
    return Math.max(0, balanced);
  };

  if (mode === 'normal') {
    const useTotalAnchor = anchorMode === 'total';
    const targetReturnBal = useTotalAnchor ? stake / invSum : stake * odds[0];
    const balancedHedge = targetReturnBal * hedgeInvSum;

    let underlayHedge = balancedHedge;
    let overlayHedge = balancedHedge;

    if (useTotalAnchor) {
      const zeroP0Hedge = stake * (1 - 1 / odds[0]);
      if (hedgeInvSum < 1) {
        const zeroHedge = stake * hedgeInvSum;
        underlayHedge = Math.max(0, Math.min(balancedHedge, zeroP0Hedge, zeroHedge));
        overlayHedge = Math.min(stake, Math.max(balancedHedge, zeroP0Hedge, zeroHedge));
      } else {
        underlayHedge = Math.max(0, Math.min(balancedHedge, zeroP0Hedge));
        overlayHedge = Math.min(stake, balancedHedge * 1.15);
      }
    } else {
      const zeroP0Hedge = stake * (odds[0] - 1);
      if (hedgeInvSum < 1) {
        const zeroHedge = stake / (1 / hedgeInvSum - 1);
        underlayHedge = Math.max(0, Math.min(balancedHedge, zeroP0Hedge, zeroHedge));
        overlayHedge = Math.max(balancedHedge, zeroP0Hedge, zeroHedge);
      } else {
        underlayHedge = Math.max(0, Math.min(balancedHedge, zeroP0Hedge));
        overlayHedge = balancedHedge * 1.15;
      }
    }

    const hedgeTargetRaw = interpolateHedge(balancedHedge, underlayHedge, overlayHedge);
    const hedgeTarget = useTotalAnchor ? Math.min(stake, hedgeTargetRaw) : hedgeTargetRaw;

    let stakes: number[];
    if (Math.abs(clampedBias) < 1e-9) {
      stakes = odds.map((o, i) =>
        i === 0 && !useTotalAnchor ? round2(stake) : round2(targetReturnBal / o)
      );
    } else if (useTotalAnchor) {
      const targetHedgeReturn = hedgeTarget / hedgeInvSum;
      const hedgeStakes = odds.slice(1).map((o) => round2(targetHedgeReturn / o));
      const actualHedgeSum = round2(hedgeStakes.reduce((a, b) => a + b, 0));
      const leg0Stake = round2(Math.max(0, stake - actualHedgeSum));
      stakes = [leg0Stake, ...hedgeStakes];
    } else {
      const targetHedgeReturn = hedgeTarget / hedgeInvSum;
      stakes = odds.map((o, i) => (i === 0 ? round2(stake) : round2(targetHedgeReturn / o)));
    }

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
      balancedHedgeTotal: round2(balancedHedge),
      underlayHedgeTotal: round2(underlayHedge),
      overlayHedgeTotal: round2(overlayHedge),
      totalCashOutlay,
      effectiveRefund: 0,
      guaranteedProfit,
      rating: round2((1 / invSum) * 100),
      impliedProbSum: round3(invSum),
    };
  }

  if (mode === 'snr' || mode === 'sr') {
    const targetReturnBal = mode === 'snr' ? stake * (odds[0] - 1) : stake * odds[0];
    const balancedHedge = targetReturnBal * hedgeInvSum;
    const underlayHedge = balancedHedge * 0.85;
    const overlayHedge = balancedHedge * 1.15;
    const hedgeTarget = interpolateHedge(balancedHedge, underlayHedge, overlayHedge);
    const targetHedgeReturn = hedgeTarget / hedgeInvSum;

    const stakes = odds.map((o, i) =>
      i === 0 ? round2(stake) : round2(targetHedgeReturn / o)
    );
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
      balancedHedgeTotal: round2(balancedHedge),
      underlayHedgeTotal: round2(underlayHedge),
      overlayHedgeTotal: round2(overlayHedge),
      totalCashOutlay: hedgeTotal,
      effectiveRefund: 0,
      guaranteedProfit,
      rating: round2((guaranteedProfit / stake) * 100),
      impliedProbSum: round3(invSum),
    };
  }

  if (mode === 'rollover') {
    const rolloverCtx = computeRolloverContext({
      stake,
      backOdds: odds[0],
      realBalance,
      bonusBalance,
      rolloverRemaining,
      estimatedRating,
      rolloverWalletRule,
    });
    const costDelta =
      rolloverCtx.futureRolloverCostIfWin - rolloverCtx.futureRolloverCostIfLose;
    const targetHedgeReturnBal = Math.max(0, stake * odds[0] - costDelta);
    const balancedHedge = targetHedgeReturnBal * hedgeInvSum;

    const balProfit =
      rolloverCtx.bonusBalance +
      stake * (odds[0] - 1) -
      balancedHedge -
      rolloverCtx.futureRolloverCostIfWin;

    const zeroP0Hedge = Math.max(
      0,
      rolloverCtx.bonusBalance + stake * (odds[0] - 1) - rolloverCtx.futureRolloverCostIfWin
    );

    let underlayHedge = balancedHedge;
    let overlayHedge = balancedHedge;

    if (balProfit >= 0) {
      if (rolloverCtx.effectiveReal > 0 && hedgeInvSum < 1) {
        const zeroExchHedge = Math.max(
          0,
          (stake - rolloverCtx.bonusBalance + rolloverCtx.futureRolloverCostIfLose) /
            (1 / hedgeInvSum - 1)
        );
        underlayHedge = Math.min(balancedHedge, Math.max(balancedHedge * 0.5, zeroExchHedge));
        overlayHedge = Math.max(balancedHedge, Math.min(balancedHedge * 1.35, zeroP0Hedge));
      } else {
        underlayHedge = balancedHedge * 0.85;
        overlayHedge = balancedHedge * 1.15;
      }
    } else {
      if (hedgeInvSum < 1) {
        const zeroExchHedge = Math.max(
          0,
          (stake - rolloverCtx.bonusBalance + rolloverCtx.futureRolloverCostIfLose) /
            (1 / hedgeInvSum - 1)
        );
        underlayHedge = Math.min(balancedHedge, zeroP0Hedge);
        overlayHedge = Math.max(balancedHedge, zeroExchHedge);
      } else {
        underlayHedge = Math.min(balancedHedge, zeroP0Hedge);
        overlayHedge = balancedHedge * 1.15;
      }
    }

    const hedgeTarget = interpolateHedge(balancedHedge, underlayHedge, overlayHedge);
    const targetHedgeReturn = hedgeTarget / hedgeInvSum;
    const stakes = odds.map((o, i) =>
      i === 0 ? round2(stake) : round2(targetHedgeReturn / o)
    );
    const hedgeTotal = round2(stakes.slice(1).reduce((a, b) => a + b, 0));
    const totalCashOutlay = round2(rolloverCtx.effectiveReal + hedgeTotal);
    const returns = odds.map((o, i) => round2(stakes[i] * o));
    const profits = returns.map((r, i) =>
      round2(
        i === 0
          ? rolloverCtx.bonusBalance +
              stakes[0] * (odds[0] - 1) -
              hedgeTotal -
              rolloverCtx.futureRolloverCostIfWin
          : rolloverCtx.bonusBalance -
              stakes[0] +
              r -
              hedgeTotal -
              rolloverCtx.futureRolloverCostIfLose
      )
    );
    const guaranteedProfit = round2(profits.reduce((a, b) => a + b, 0) / k);
    const matchRating = round2((1 / invSum) * 100);
    const rating =
      rolloverCtx.bonusBalance > 0
        ? round2((guaranteedProfit / rolloverCtx.bonusBalance) * 100)
        : round2((1 + guaranteedProfit / stake) * 100);

    return {
      stakes,
      returns,
      profits,
      hedgeTotal,
      balancedHedgeTotal: round2(balancedHedge),
      underlayHedgeTotal: round2(underlayHedge),
      overlayHedgeTotal: round2(overlayHedge),
      totalCashOutlay,
      effectiveRefund: 0,
      guaranteedProfit,
      rating,
      impliedProbSum: round3(invSum),
      rollover: {
        stake: round2(rolloverCtx.stake),
        realBalance: round2(rolloverCtx.realBalance),
        bonusBalance: round2(rolloverCtx.bonusBalance),
        extraRealUsed: round2(rolloverCtx.extraRealUsed),
        totalBalanceBefore: round2(rolloverCtx.totalBalanceBefore),
        rolloverBefore: round2(rolloverCtx.rolloverBefore),
        rolloverAfter: round2(rolloverCtx.rolloverAfter),
        estimatedRating: round2(rolloverCtx.estimatedRating),
        walletRule: rolloverCtx.walletRule,
        bookieBalanceIfWin: round2(rolloverCtx.bookieBalanceIfWin),
        bookieBalanceIfLose: round2(rolloverCtx.bookieBalanceIfLose),
        futureRolloverCostIfWin: round2(rolloverCtx.futureRolloverCostIfWin),
        futureRolloverCostIfLose: round2(rolloverCtx.futureRolloverCostIfLose),
        singleBetBookieProfit: round2(stakes[0] * (odds[0] - 1) - hedgeTotal),
        singleBetExchangeProfit: round2((returns[1] ?? 0) - hedgeTotal - stakes[0]),
        matchRating,
        clearsRolloverOnLose: rolloverCtx.clearsRolloverOnLose,
        completesRolloverOnThisBet: rolloverCtx.completesRolloverOnThisBet,
        baselineExpectedValue: round2(rolloverCtx.baselineExpectedValue),
      },
    };
  }

  // Rimborso RF: Leg 0 backed with real cash; if any hedge leg wins (leg 0 loses), refund triggers
  const effectiveRefund = Math.max(0, refundAmount) * (Math.max(0, refundRetention) / 100);
  const targetHedgeReturnBal = Math.max(0, stake * odds[0] - effectiveRefund);
  const balancedHedge = targetHedgeReturnBal * hedgeInvSum;
  const zeroP0Hedge = stake * (odds[0] - 1);

  let underlayHedge = balancedHedge;
  let overlayHedge = balancedHedge;
  if (hedgeInvSum < 1) {
    const zeroHedge = Math.max(0, (stake - effectiveRefund) / (1 / hedgeInvSum - 1));
    underlayHedge = Math.max(0, Math.min(balancedHedge, zeroP0Hedge, zeroHedge));
    overlayHedge = Math.max(balancedHedge, zeroP0Hedge, zeroHedge);
  } else {
    underlayHedge = Math.max(0, Math.min(balancedHedge, zeroP0Hedge));
    overlayHedge = balancedHedge * 1.15;
  }

  const hedgeTarget = interpolateHedge(balancedHedge, underlayHedge, overlayHedge);
  const targetHedgeReturn = hedgeTarget / hedgeInvSum;

  const stakes = odds.map((o, i) =>
    i === 0 ? round2(stake) : round2(targetHedgeReturn / o)
  );
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
    balancedHedgeTotal: round2(balancedHedge),
    underlayHedgeTotal: round2(underlayHedge),
    overlayHedgeTotal: round2(overlayHedge),
    totalCashOutlay,
    effectiveRefund: round2(effectiveRefund),
    guaranteedProfit,
    rating: round2((guaranteedProfit / base) * 100),
    impliedProbSum: round3(invSum),
  };
}

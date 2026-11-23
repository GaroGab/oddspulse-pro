import type {
  BetMode,
  MultioddsPlan,
  OddsmatcherRow,
  SavedMultipleLeg,
  SavedMultiplePlan,
  SavedMultiplePlanInput,
} from './types';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface EvaluatedSavedMultipleStep {
  legIndex: number;
  leg: SavedMultipleLeg;
  /** Recommended optimal lay stake computed by backward induction */
  recommendedLayStake: number;
  /** Effective lay stake used in accounting (lockedLayStake if laid/settled, else recommended) */
  layStake: number;
  liability: number;
  cumulativeLiability: number;
  profitIfLostHere: number;
  gapMinutesFromPrev: number | null;
  /** True when an earlier leg was already lost on the bookmaker, so this leg does not need to be laid */
  skipped: boolean;
  /** True when this leg is locked (laid, won_bookie, or lost_bookie) */
  isLocked: boolean;
}

export interface EvaluatedSavedMultiplePlan {
  steps: EvaluatedSavedMultipleStep[];
  combinedBackOdds: number;
  boostedBackOdds: number;
  winPayout: number;
  initialOutlay: number;
  effectiveRefund: number;
  /** Total cumulative liability across all active (non-skipped) legs */
  maxCumulativeLiability: number;
  /** Liability already incurred on laid / won_bookie legs */
  committedLiability: number;
  profitIfAllWin: number;
  /** Current projected equalized profit (or final realized profit if settled) */
  projectedProfit: number;
  /** Live updated rating (%) */
  rating: number;
  /** Baseline rating (%) using initialBackOdds & initialLayOdds at save time */
  initialRating: number;
  ratingDelta: number;
  minGapMinutes: number;
  nonOverlapping: boolean;
  /** 0-based index of the next pending step to lay, or -1 if none */
  nextPendingIndex: number;
  /** Index of the leg where multipla ended via lost_bookie, or -1 */
  lostAtIndex: number;
  settledOutcome: 'in_progress' | 'won_all' | 'lost_at_leg';
  completedLegsCount: number;
  laidLegsCount: number;
}

function computeRating(
  mode: BetMode,
  stake: number,
  refundAmount: number,
  profit: number
): number {
  if (mode === 'normal') {
    return stake > 0 ? round2((1 + profit / stake) * 100) : 0;
  }
  if (mode === 'snr' || mode === 'sr') {
    return stake > 0 ? round2((profit / stake) * 100) : 0;
  }
  const base = refundAmount > 0 ? refundAmount : stake;
  return base > 0 ? round2((profit / base) * 100) : 0;
}

function computeBaselineRating(plan: SavedMultiplePlan): number {
  const sorted = [...plan.legs].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  if (sorted.length === 0) return 0;

  const combinedBack = sorted.reduce(
    (acc, l) => acc * Math.max(1.01, l.initialBackOdds || l.backOdds),
    1
  );
  const boostFactor = 1 + Math.max(0, plan.bonusBoostPct) / 100;
  const boostedBack = 1 + (combinedBack - 1) * boostFactor;
  const winPayout =
    plan.mode === 'snr'
      ? plan.stake * (combinedBack - 1) * boostFactor
      : plan.stake * boostedBack;
  const initialOutlay = plan.mode === 'normal' || plan.mode === 'rf' ? plan.stake : 0;
  const effectiveRefund =
    plan.mode === 'rf'
      ? Math.max(0, plan.refundAmount) * (Math.max(0, plan.refundRetention) / 100)
      : 0;

  let nextValue = winPayout;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const L = Math.max(1.01, sorted[i].initialLayOdds || sorted[i].layOdds);
    const c = Math.max(0, Math.min(0.25, sorted[i].commission));
    const denom = Math.max(0.01, L - c);
    const y = Math.max(0, (nextValue - effectiveRefund) / denom);
    nextValue = y * (1 - c) + effectiveRefund;
  }

  return computeRating(
    plan.mode,
    plan.stake,
    plan.refundAmount,
    round2(nextValue - initialOutlay)
  );
}

/**
 * Progressive sequential multipla evaluator.
 *
 * Preserves actual locked lay stakes/liabilities on already-laid or won_bookie steps,
 * recalculates optimal sequential lay stakes via backward induction for all remaining
 * pending steps whenever lay/back odds change, and short-circuits cleanly if a leg
 * loses on the bookmaker (multipla settled on Exchange).
 */
export function evaluateSavedMultiplePlan(plan: SavedMultiplePlan): EvaluatedSavedMultiplePlan {
  const sorted = [...plan.legs].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const n = sorted.length;

  const stake = Math.max(0, Number.isFinite(plan.stake) ? plan.stake : 0);
  const bonusBoostPct = Math.max(0, Number.isFinite(plan.bonusBoostPct) ? plan.bonusBoostPct : 0);
  const refundAmount = Math.max(0, Number.isFinite(plan.refundAmount) ? plan.refundAmount : 0);
  const refundRetention = Math.max(
    0,
    Math.min(100, Number.isFinite(plan.refundRetention) ? plan.refundRetention : 70)
  );

  const combinedBackOdds = sorted.reduce(
    (acc, l) => acc * Math.max(1.01, Number.isFinite(l.backOdds) ? l.backOdds : 1.01),
    1
  );
  const boostFactor = 1 + bonusBoostPct / 100;
  const boostedBackOdds = 1 + (combinedBackOdds - 1) * boostFactor;
  const winPayout =
    plan.mode === 'snr'
      ? stake * (combinedBackOdds - 1) * boostFactor
      : stake * boostedBackOdds;
  const initialOutlay = plan.mode === 'normal' || plan.mode === 'rf' ? stake : 0;
  const effectiveRefund = plan.mode === 'rf' ? refundAmount * (refundRetention / 100) : 0;

  const lostAtIndex = sorted.findIndex((l) => l.status === 'lost_bookie');
  const activeLimit = lostAtIndex >= 0 ? lostAtIndex + 1 : n;

  // Backward induction for recommended optimal lay stakes across all active legs
  const recommendedStakes = new Array<number>(n).fill(0);
  const effectiveStakes = new Array<number>(n).fill(0);
  const liabilities = new Array<number>(n).fill(0);

  let nextValue = winPayout;
  for (let i = n - 1; i >= 0; i--) {
    if (i >= activeLimit) {
      recommendedStakes[i] = 0;
      effectiveStakes[i] = 0;
      liabilities[i] = 0;
      continue;
    }

    const leg = sorted[i];
    const L = Math.max(1.01, Number.isFinite(leg.layOdds) ? leg.layOdds : 1.01);
    const c = Math.max(0, Math.min(0.25, Number.isFinite(leg.commission) ? leg.commission : 0));
    const denom = Math.max(0.01, L - c);
    const rec = Math.max(0, (nextValue - effectiveRefund) / denom);
    recommendedStakes[i] = rec;

    const isLocked = leg.status !== 'pending';
    const hasCustomLocked =
      isLocked &&
      typeof leg.lockedLayStake === 'number' &&
      Number.isFinite(leg.lockedLayStake) &&
      leg.lockedLayStake >= 0;

    const actual = hasCustomLocked ? leg.lockedLayStake! : rec;
    effectiveStakes[i] = actual;
    liabilities[i] = actual * (L - 1);

    // Carry backward value so any earlier pending leg equalizes cleanly
    nextValue = actual * (1 - c) + effectiveRefund;
  }

  let cumLiab = 0;
  let committedLiability = 0;
  let minGapMinutes = Infinity;
  let nextPendingIndex = -1;
  let completedLegsCount = 0;
  let laidLegsCount = 0;

  const steps: EvaluatedSavedMultipleStep[] = [];

  for (let i = 0; i < n; i++) {
    const leg = sorted[i];
    const skipped = i >= activeLimit;
    const isLocked = leg.status !== 'pending';

    if (leg.status === 'won_bookie' || leg.status === 'lost_bookie') {
      completedLegsCount++;
    }
    if (leg.status === 'laid' || leg.status === 'won_bookie' || leg.status === 'lost_bookie') {
      laidLegsCount++;
    }
    if (!skipped && leg.status === 'pending' && nextPendingIndex === -1) {
      nextPendingIndex = i;
    }

    let gapMin: number | null = null;
    if (i > 0) {
      const diffMs =
        new Date(sorted[i].startTime).getTime() - new Date(sorted[i - 1].startTime).getTime();
      gapMin = Math.round(diffMs / 60000);
      if (gapMin < minGapMinutes) minGapMinutes = gapMin;
    }

    const prevLiab = cumLiab;
    if (!skipped) {
      cumLiab += liabilities[i];
      if (leg.status === 'laid' || leg.status === 'won_bookie') {
        committedLiability += liabilities[i];
      }
    }

    const c = Math.max(0, Math.min(0.25, Number.isFinite(leg.commission) ? leg.commission : 0));
    const profitIfLostHere = skipped
      ? 0
      : effectiveStakes[i] * (1 - c) + effectiveRefund - prevLiab - initialOutlay;

    steps.push({
      legIndex: i + 1,
      leg,
      recommendedLayStake: round2(recommendedStakes[i]),
      layStake: round2(effectiveStakes[i]),
      liability: round2(liabilities[i]),
      cumulativeLiability: round2(cumLiab),
      profitIfLostHere: round2(profitIfLostHere),
      gapMinutesFromPrev: gapMin,
      skipped,
      isLocked,
    });
  }

  const profitIfAllWin = round2(winPayout - cumLiab - initialOutlay);
  const allWonBookie = n > 0 && sorted.every((l) => l.status === 'won_bookie');

  let settledOutcome: EvaluatedSavedMultiplePlan['settledOutcome'] = 'in_progress';
  let projectedProfit = profitIfAllWin;

  if (lostAtIndex >= 0) {
    settledOutcome = 'lost_at_leg';
    projectedProfit = steps[lostAtIndex].profitIfLostHere;
  } else if (allWonBookie) {
    settledOutcome = 'won_all';
    projectedProfit = profitIfAllWin;
  } else if (nextPendingIndex >= 0) {
    projectedProfit = steps[nextPendingIndex].profitIfLostHere;
  } else if (n > 0) {
    projectedProfit = profitIfAllWin;
  }

  const rating = computeRating(plan.mode, stake, refundAmount, projectedProfit);
  const initialRating = computeBaselineRating(plan);
  const safeMinGap = Number.isFinite(minGapMinutes) ? minGapMinutes : 999;

  return {
    steps,
    combinedBackOdds: round2(combinedBackOdds),
    boostedBackOdds: round2(boostedBackOdds),
    winPayout: round2(winPayout),
    initialOutlay: round2(initialOutlay),
    effectiveRefund: round2(effectiveRefund),
    maxCumulativeLiability: round2(cumLiab),
    committedLiability: round2(committedLiability),
    profitIfAllWin,
    projectedProfit: round2(projectedProfit),
    rating,
    initialRating,
    ratingDelta: round2(rating - initialRating),
    minGapMinutes: safeMinGap,
    nonOverlapping: n <= 1 || safeMinGap >= (plan.minGapMinutes || 120),
    nextPendingIndex,
    lostAtIndex,
    settledOutcome,
    completedLegsCount,
    laidLegsCount,
  };
}

/**
 * Converts a computed MultioddsPlan (from Manual Builder or Auto Optimizer) into a
 * persistable SavedMultiplePlanInput with initial quote snapshots for delta tracking.
 */
export function buildSavedMultipleInputFromPlan(params: {
  plan: MultioddsPlan;
  mode: BetMode;
  stake: number;
  bonusBoostPct: number;
  refundAmount: number;
  refundRetention: number;
  minGapMinutes: number;
  customName?: string;
}): SavedMultiplePlanInput {
  const {
    plan,
    mode,
    stake,
    bonusBoostPct,
    refundAmount,
    refundRetention,
    minGapMinutes,
    customName,
  } = params;

  const defaultName =
    customName?.trim() ||
    `Multipla ${plan.legs.length} Eventi · ${plan.bookmakerName}`;

  const legs: SavedMultipleLeg[] = plan.legs.map((step) => ({
    id: step.row.id,
    eventKey: step.row.eventKey,
    sport: step.row.sport,
    league: step.row.league,
    eventName: step.row.eventName,
    homeTeam: step.row.homeTeam,
    awayTeam: step.row.awayTeam,
    startTime: step.row.startTime,
    marketType: step.row.marketType,
    marketLabel: step.row.marketLabel,
    selectionKey: step.row.selectionKey,
    selectionLabel: step.row.selectionLabel,
    bookmakerId: step.row.bookmakerId,
    bookmakerName: step.row.bookmakerName,
    bookmakerColor: step.row.bookmakerColor,
    exchangeId: step.row.exchangeId,
    exchangeName: step.row.exchangeName,
    exchangeColor: step.row.exchangeColor,
    initialBackOdds: step.backOdds,
    backOdds: step.backOdds,
    initialLayOdds: step.layOdds,
    layOdds: step.layOdds,
    liquidity: step.row.liquidity,
    commission: step.commission,
    status: 'pending',
  }));

  return {
    name: defaultName,
    status: 'active',
    mode,
    stake,
    bonusBoostPct,
    refundAmount,
    refundRetention,
    minGapMinutes,
    bookmakerId: plan.bookmakerId,
    bookmakerName: plan.bookmakerName,
    bookmakerColor: plan.bookmakerColor,
    legs,
  };
}

/**
 * Matches a saved leg against live scraper rows (exact id first, then canonical event+market+selection+exchange).
 */
export function findLiveRowForSavedLeg(
  leg: SavedMultipleLeg,
  liveRows: OddsmatcherRow[]
): OddsmatcherRow | undefined {
  const byId = liveRows.find((r) => r.id === leg.id);
  if (byId) return byId;

  const exactPair = liveRows.find(
    (r) =>
      r.eventKey === leg.eventKey &&
      r.marketType === leg.marketType &&
      r.selectionKey === leg.selectionKey &&
      r.exchangeId === leg.exchangeId
  );
  if (exactPair) return exactPair;

  return liveRows.find(
    (r) =>
      r.eventName.toLowerCase() === leg.eventName.toLowerCase() &&
      r.marketType === leg.marketType &&
      r.selectionKey === leg.selectionKey &&
      r.exchangeId === leg.exchangeId
  );
}

/**
 * Pulls live Exchange lay odds & liquidity from the current scraper snapshot for all pending legs.
 */
export function syncLiveOddsForSavedPlan(
  plan: SavedMultiplePlan,
  liveRows: OddsmatcherRow[]
): { nextPlan: SavedMultiplePlan; updatedCount: number } {
  let updatedCount = 0;
  const nextLegs = plan.legs.map((leg) => {
    if (leg.status !== 'pending') return leg;
    const live = findLiveRowForSavedLeg(leg, liveRows);
    if (!live) return leg;
    const layChanged = Math.abs(live.layOdds - leg.layOdds) >= 0.005;
    const liqChanged = Math.abs(live.liquidity - leg.liquidity) >= 1;
    if (!layChanged && !liqChanged) return leg;
    updatedCount++;
    return {
      ...leg,
      layOdds: live.layOdds,
      liquidity: live.liquidity,
    };
  });

  return {
    nextPlan: updatedCount > 0 ? { ...plan, legs: nextLegs } : plan,
    updatedCount,
  };
}

import { round2 } from './math';

export type SimulationScenarioKey = 'conservative' | 'realistic' | 'optimal';

export interface SimulationScenarioParams {
  key: SimulationScenarioKey;
  label: string;
  /** Rating % su scommessa singola (es. 96.5) */
  singleRatingPct: number;
  /** Rating % medio per singola gamba di una multipla sequenziale (es. 96.5) */
  multiLegRatingPct: number;
  /** Commissione exchange % (es. 4.5) — usata per stima liquidità/SNR e trasparenza */
  exchangeCommissionPct: number;
  /** Moltiplicatore prudenziale per strategie casinò (0.75 conservativo, 1.0 realistico, 1.2 ottimale) */
  casinoVarianceScale: number;
}

export const DEFAULT_SIMULATION_SCENARIOS: Record<SimulationScenarioKey, SimulationScenarioParams> = {
  conservative: {
    key: 'conservative',
    label: 'Conservativo',
    singleRatingPct: 94.5,
    multiLegRatingPct: 95.0,
    exchangeCommissionPct: 5.0,
    casinoVarianceScale: 0.78,
  },
  realistic: {
    key: 'realistic',
    label: 'Realistico',
    singleRatingPct: 96.5,
    multiLegRatingPct: 96.5,
    exchangeCommissionPct: 4.5,
    casinoVarianceScale: 1.0,
  },
  optimal: {
    key: 'optimal',
    label: 'Ottimale',
    singleRatingPct: 98.0,
    multiLegRatingPct: 97.8,
    exchangeCommissionPct: 2.0,
    casinoVarianceScale: 1.18,
  },
};

export type BonusSimulationComponent =
  | {
      kind: 'qualifying_bet';
      label: string;
      /** Importo fisso o multiplo del deposito se scalesWithDeposit = true */
      stake?: number;
      /** Se definito con scalesWithDeposit, turnover = deposit * depositMultiplier */
      depositMultiplier?: number;
      scalesWithDeposit?: boolean;
      legs: number;
      avgLegOdds: number;
      multiBoostPct?: number;
      count?: number;
    }
  | {
      kind: 'real_bonus_sr';
      label: string;
      /** Importo fisso del bonus oppure % del deposito con cap maxAmount */
      fixedAmount?: number;
      pctOfDeposit?: number;
      maxAmount?: number;
      legs: number;
      avgLegOdds: number;
      multiBoostPct?: number;
      count?: number;
      /** Rollover extra (default 1 = rigioco 1x classico) */
      rolloverMultiplier?: number;
    }
  | {
      kind: 'freebet_snr';
      label: string;
      fixedAmount: number;
      legs: number;
      avgLegOdds: number;
      count?: number;
    }
  | {
      kind: 'rollover_bustout';
      label: string;
      fixedAmount?: number;
      pctOfDeposit?: number;
      maxAmount?: number;
      rolloverMultiplier: number;
      /** Permette all'utente di modificare il moltiplicatore rollover nel simulatore (es. SNAI 3x–6x) */
      rolloverRange?: [number, number];
      legs: number;
      avgLegOdds: number;
      maxStakePerBet?: number;
      /** Se presente e <= bonus*1.5, applica la penalità di cap di conversione */
      conversionCap?: number;
      /** Se 1, dopo il rollover il saldo diventa Real Bonus da rigiocare 1x */
      finalRealBonusWagering?: number;
      finalRealLegs?: number;
    }
  | {
      kind: 'exchange_cashback';
      label: string;
      maxRefundPerPeriod: number;
      periods: number;
      /** Volume medio di copertura a periodo necessario per incassare il rimborso sull'Exchange */
      qualifyingVolumePerPeriod: number;
      bonusLegs: number;
      bonusAvgLegOdds: number;
    }
  | {
      kind: 'casino_free_spins';
      label: string;
      spinsCount: number;
      spinValue: number;
      rtp: number;
      /** 1 = vincite direttamente in Real Bonus 1x; >1 = Fun Bonus con wagering Mx */
      wageringMultiplier: number;
      conversionCapPerTranche?: number;
      tranches?: number;
      seed?: number;
    }
  | {
      kind: 'casino_fun_bonus';
      label: string;
      bonusPerTranche: number;
      tranches: number;
      wageringMultiplier: number;
      conversionCapPerTranche: number;
      rtpPhase1: number;
      rtpPhase2: number;
      maxBetPerSpin: number;
      /** Percentuale di contribuzione delle slot al wagering (default 100) */
      contributionPct?: number;
      seed: number;
    };

export interface WelcomeBonusSimulationModel {
  defaultDeposit: number;
  minDeposit: number;
  maxDeposit: number;
  scalableDeposit: boolean;
  /** Bankroll Exchange base consigliato al deposito predefinito (scala con il deposito se scalabile) */
  baseRecommendedBankroll: number;
  /** Se true, il simulatore mostra il selettore rollover personalizzabile */
  variableRollover?: {
    label: string;
    defaultValue: number;
    min: number;
    max: number;
  };
  /** Se true, l'offerta riguarda principalmente il Casinò (nasconde slider rating sport se non usati) */
  isPureCasino?: boolean;
  components: BonusSimulationComponent[];
}

export interface SimulationOverrides {
  deposit?: number;
  singleRatingPct?: number;
  multiLegRatingPct?: number;
  exchangeCommissionPct?: number;
  rolloverMultiplier?: number;
  casinoVarianceScale?: number;
}

export interface SimulationBreakdownItem {
  label: string;
  delta: number;
  detail: string;
}

export interface WelcomeBonusSimulationResult {
  depositUsed: number;
  netProfit: number;
  /** Profitto netto nel caso peggiore lineare (senza bust-out nei rollover) */
  worstCaseProfit: number;
  hasBustOutUpside: boolean;
  qualifyingCost: number;
  grossExtraction: number;
  roiPct: number | null; // null quando deposito = 0 (rischio zero)
  estimatedBankroll: number;
  /** Rating minimo per gamba (%) sopra cui il bonus rimane in profitto, se rilevante */
  breakEvenLegRatingPct: number | null;
  isProfitable: boolean;
  breakdown: SimulationBreakdownItem[];
}

export interface ThreeScenarioSimulation {
  conservative: WelcomeBonusSimulationResult;
  realistic: WelcomeBonusSimulationResult;
  optimal: WelcomeBonusSimulationResult;
}

// Cache deterministica per simulazioni Monte Carlo casinò (evita ricalcoli inutili durante il render)
const casinoMcCache = new Map<string, { evTotal: number; evPerTranche: number; convProbPct: number }>();

/**
 * Simulazione Monte Carlo deterministica (Mulberry32) calibrata in modo prudente per Fun Bonus Casinò
 * con strategia 2-Fasi (Fase 1 alta volatilità con puntata rispettosa del max bet -> Fase 2 bassa
 * volatilità / alto RTP per completare il rollover fino al cap convertibile).
 */
export function simulateCasinoFunBonusDeterministic(params: {
  bonusPerTranche: number;
  tranches: number;
  wageringMultiplier: number;
  conversionCapPerTranche: number;
  rtpPhase1: number;
  rtpPhase2: number;
  maxBetPerSpin: number;
  contributionPct?: number;
  seed: number;
  trials?: number;
}): { evTotal: number; evPerTranche: number; convProbPct: number } {
  const {
    bonusPerTranche,
    tranches,
    wageringMultiplier,
    conversionCapPerTranche,
    rtpPhase1,
    rtpPhase2,
    maxBetPerSpin,
    contributionPct = 100,
    seed,
    trials = 2500,
  } = params;

  const cacheKey = [
    bonusPerTranche,
    tranches,
    wageringMultiplier,
    conversionCapPerTranche,
    rtpPhase1.toFixed(4),
    rtpPhase2.toFixed(4),
    maxBetPerSpin,
    contributionPct,
    seed,
    trials,
  ].join('|');

  const cached = casinoMcCache.get(cacheKey);
  if (cached) return cached;

  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Distribuzione realistica video slot ADM alta volatilità (media normalizzata = rtpPhase1)
  // Base mean: 0.25*0.35 + 0.095*1.5 + 0.028*6 + 0.009*22 + 0.0022*85 + 0.0005*200 + 0.00015*550
  // = 0.0875 + 0.1425 + 0.168 + 0.198 + 0.187 + 0.10 + 0.0825 = 0.9655
  const spinHighVol = (bet: number): number => {
    const u = rand();
    const scale = rtpPhase1 / 0.9655;
    if (u < 0.61515) return 0;
    if (u < 0.86515) return bet * 0.35 * scale;
    if (u < 0.96015) return bet * 1.5 * scale;
    if (u < 0.98815) return bet * 6.0 * scale;
    if (u < 0.99715) return bet * 22.0 * scale;
    if (u < 0.99935) return bet * 85.0 * scale;
    if (u < 0.99985) return bet * 200.0 * scale;
    return bet * 550.0 * scale;
  };

  const effContribution = Math.max(0.25, Math.min(1, contributionPct / 100));
  const effectiveWager = (bonusPerTranche * wageringMultiplier) / effContribution;
  const expectedGrindLoss = effectiveWager * (1 - rtpPhase2);
  const desiredEnd = Math.min(conversionCapPerTranche, bonusPerTranche * 1.6);
  // Soglia realistica per passare da Fase 1 (alta volatilità) a Fase 2 (grind basso rischio)
  const switchThreshold = Math.min(
    bonusPerTranche * 7.5,
    expectedGrindLoss + desiredEnd * 1.25
  );

  // Puntata prudente rispettosa dei max bet reali dei Fun Bonus ADM
  const highBet = Math.max(0.2, Math.min(maxBetPerSpin, bonusPerTranche * 0.015));

  let totalConverted = 0;
  let conversions = 0;

  for (let i = 0; i < trials; i++) {
    let bal = bonusPerTranche;
    let wagered = 0;

    // Fase 1: Alta volatilità fino a bust o raggiungimento soglia di sicurezza
    let spinGuard = 0;
    while (bal >= highBet && wagered < effectiveWager && bal < switchThreshold && spinGuard < 4000) {
      bal -= highBet;
      wagered += highBet;
      bal += spinHighVol(highBet);
      spinGuard++;
    }

    // Fase 2: Grind bassa volatilità / alto RTP per completare il rollover residuo
    if (bal > 0 && wagered < effectiveWager) {
      const remW = effectiveWager - wagered;
      const smallBet = Math.max(0.1, Math.min(0.5, bal * 0.0035));
      const nSpins = remW / smallBet;
      const meanLoss = remW * (1 - rtpPhase2);
      const sd = 3.2 * smallBet * Math.sqrt(nSpins);
      const u1 = Math.max(1e-9, rand());
      const u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      bal = bal - meanLoss + z * sd;
    }

    if (bal > 0.5) {
      const cappedReal = Math.min(bal, conversionCapPerTranche);
      // 1x rigioco finale sul Real Bonus convertito
      const finalCash = cappedReal * rtpPhase2;
      totalConverted += finalCash;
      conversions++;
    }
  }

  const evPerTranche = totalConverted / trials;
  const res = {
    evTotal: round2(evPerTranche * tranches),
    evPerTranche: round2(evPerTranche),
    convProbPct: round2((conversions / trials) * 100),
  };
  casinoMcCache.set(cacheKey, res);
  return res;
}

function clampDeposit(model: WelcomeBonusSimulationModel, raw?: number): number {
  const base = raw !== undefined && Number.isFinite(raw) ? raw : model.defaultDeposit;
  if (!model.scalableDeposit) return model.defaultDeposit;
  return Math.max(model.minDeposit, Math.min(model.maxDeposit, base));
}

function computeCombinedRating(
  legs: number,
  singleRating: number,
  multiLegRating: number,
  multiBoostPct = 0
): number {
  const baseR = legs <= 1 ? singleRating : Math.pow(multiLegRating, legs);
  const boosted = baseR * (1 + Math.max(0, multiBoostPct) / 100);
  return Math.min(1.03, Math.max(0.3, boosted));
}

/**
 * Motore principale di simulazione per un singolo WelcomeBonusSimulationModel.
 */
export function simulateWelcomeBonus(
  model: WelcomeBonusSimulationModel,
  scenario: SimulationScenarioParams = DEFAULT_SIMULATION_SCENARIOS.realistic,
  overrides: SimulationOverrides = {}
): WelcomeBonusSimulationResult {
  const deposit = clampDeposit(model, overrides.deposit);
  const singleRatingPct = overrides.singleRatingPct ?? scenario.singleRatingPct;
  const multiLegRatingPct = overrides.multiLegRatingPct ?? scenario.multiLegRatingPct;
  const casinoScale = overrides.casinoVarianceScale ?? scenario.casinoVarianceScale;

  const rSingle = Math.max(0.7, Math.min(1.02, singleRatingPct / 100));
  const rLeg = Math.max(0.7, Math.min(1.02, multiLegRatingPct / 100));

  let qualifyingCost = 0;
  let grossExtraction = 0;
  let worstCaseDeltaAdjust = 0;
  let hasBustOutUpside = false;
  const breakdown: SimulationBreakdownItem[] = [];

  for (const comp of model.components) {
    if (comp.kind === 'qualifying_bet') {
      const count = comp.count ?? 1;
      const mult =
        comp.scalesWithDeposit && comp.depositMultiplier !== undefined
          ? overrides.rolloverMultiplier ?? comp.depositMultiplier
          : comp.depositMultiplier ?? 1;
      const totalStake = comp.scalesWithDeposit
        ? deposit * mult * count
        : (comp.stake ?? deposit) * count;
      const combR = computeCombinedRating(comp.legs, rSingle, rLeg, comp.multiBoostPct ?? 0);
      const loss = totalStake * Math.max(0, 1 - combR);
      qualifyingCost += loss;
      breakdown.push({
        label: comp.label,
        delta: round2(-loss),
        detail: `${round2(totalStake)}€ su ${comp.legs === 1 ? 'singole' : `multiple ${comp.legs} eventi`} (rating ${(combR * 100).toFixed(1)}%)`,
      });
    } else if (comp.kind === 'real_bonus_sr') {
      const count = comp.count ?? 1;
      const rawBonus =
        comp.fixedAmount !== undefined
          ? comp.fixedAmount * count
          : Math.min(comp.maxAmount ?? Infinity, (deposit * (comp.pctOfDeposit ?? 100)) / 100) *
            count;
      const combR = computeCombinedRating(comp.legs, rSingle, rLeg, comp.multiBoostPct ?? 0);
      const roll = comp.rolloverMultiplier ?? 1;
      // 1x = bonus * combR; >1x = bonus - extraRoll * (1 - combR)
      const val =
        roll <= 1
          ? rawBonus * combR
          : Math.max(0, rawBonus - rawBonus * roll * Math.max(0, 1 - combR));
      grossExtraction += val;
      breakdown.push({
        label: comp.label,
        delta: round2(val),
        detail: `Bonus ${round2(rawBonus)}€ (${roll}x su ${comp.legs === 1 ? 'singole' : `${comp.legs} eventi`}, estrazione ${(combR * 100).toFixed(1)}%)`,
      });
    } else if (comp.kind === 'freebet_snr') {
      const count = comp.count ?? 1;
      const totalFb = comp.fixedAmount * count;
      const combR = computeCombinedRating(comp.legs, rSingle, rLeg, 0);
      const Q = Math.pow(Math.max(1.2, comp.avgLegOdds), comp.legs);
      const extractionPct = ((Q - 1) / Q) * combR;
      const val = totalFb * extractionPct;
      grossExtraction += val;
      breakdown.push({
        label: comp.label,
        delta: round2(val),
        detail: `Freebet SNR ${round2(totalFb)}€ @${Q.toFixed(2)} (estrazione ${(extractionPct * 100).toFixed(1)}%)`,
      });
    } else if (comp.kind === 'rollover_bustout') {
      const rawBonus =
        comp.fixedAmount !== undefined
          ? comp.fixedAmount
          : Math.min(comp.maxAmount ?? Infinity, (deposit * (comp.pctOfDeposit ?? 100)) / 100);
      const rollMult =
        comp.rolloverRange && overrides.rolloverMultiplier !== undefined
          ? Math.max(comp.rolloverRange[0], Math.min(comp.rolloverRange[1], overrides.rolloverMultiplier))
          : comp.rolloverMultiplier;

      const combR = computeCombinedRating(comp.legs, rSingle, rLeg, 0);
      const friction = Math.max(0, 1 - combR);
      const Q = Math.pow(Math.max(1.2, comp.avgLegOdds), comp.legs);
      const pWin = 1 / Q;
      const pLose = 1 - pWin;

      // Realistico: 1° blocco bancato pieno (bust-out prob = pLose); se vince, residuo completato linearmente
      const maxPerBet = comp.maxStakePerBet ?? rawBonus;
      const numChunks = maxPerBet < rawBonus ? Math.ceil(rawBonus / maxPerBet) : 1;
      const chunkBonus = rawBonus / numChunks;
      const chunkRoll = (rawBonus * rollMult) / numChunks;

      const step1Bet = Math.min(chunkBonus, chunkRoll);
      const remAfterStep1 = Math.max(0, chunkRoll - step1Bet);
      const expectedTurnoverChunk = step1Bet + pWin * remAfterStep1;
      const totalExpectedTurnover = expectedTurnoverChunk * numChunks;
      const linearTurnover = rawBonus * rollMult;

      let capPenalty = 0;
      if (comp.conversionCap !== undefined && Number.isFinite(comp.conversionCap)) {
        const chunkCap = comp.conversionCap / numChunks;
        if (chunkBonus * Q > chunkCap) {
          capPenalty = Math.max(0, (chunkBonus - chunkCap / Q) * combR * numChunks);
        }
      }

      let ev = rawBonus - totalExpectedTurnover * friction - capPenalty;
      let linearEv = rawBonus - linearTurnover * friction - capPenalty;

      if (comp.finalRealBonusWagering && comp.finalRealBonusWagering > 0) {
        const finalR = computeCombinedRating(comp.finalRealLegs ?? 1, rSingle, rLeg, 0);
        if (ev > 0) ev *= finalR;
        if (linearEv > 0) linearEv *= finalR;
      }

      if (totalExpectedTurnover < linearTurnover - 1) {
        hasBustOutUpside = true;
        worstCaseDeltaAdjust += linearEv - ev;
      }

      grossExtraction += ev;
      breakdown.push({
        label: comp.label,
        delta: round2(ev),
        detail: `Bonus ${round2(rawBonus)}€ (${rollMult}x, bust-out al 1° colpo ${(pLose * 100).toFixed(0)}%, vol. atteso ${round2(totalExpectedTurnover)}€ vs ${round2(linearTurnover)}€ lineare)`,
      });
    } else if (comp.kind === 'exchange_cashback') {
      const qualPerPeriod = comp.qualifyingVolumePerPeriod * Math.max(0, 1 - rSingle);
      const totalQual = qualPerPeriod * comp.periods;
      const bonusR = computeCombinedRating(comp.bonusLegs, rSingle, rLeg, 0);
      const totalRefundVal = comp.maxRefundPerPeriod * comp.periods * bonusR;

      qualifyingCost += totalQual;
      grossExtraction += totalRefundVal;
      breakdown.push({
        label: `${comp.label} (coperture Exchange)`,
        delta: round2(-totalQual),
        detail: `${comp.periods} cicli × ~${comp.qualifyingVolumePerPeriod}€ volume @${(rSingle * 100).toFixed(1)}%`,
      });
      breakdown.push({
        label: `${comp.label} (rimborsi Bonus Sport)`,
        delta: round2(totalRefundVal),
        detail: `${comp.periods} × ${comp.maxRefundPerPeriod}€ rigiocati 1x @${(bonusR * 100).toFixed(1)}%`,
      });
    } else if (comp.kind === 'casino_free_spins') {
      const tranches = comp.tranches ?? 1;
      const rawWinPerTranche = (comp.spinsCount / tranches) * comp.spinValue * comp.rtp;
      if (comp.wageringMultiplier <= 1) {
        // Vincite direttamente in Real Bonus 1x
        const cashVal = rawWinPerTranche * tranches * comp.rtp * (0.9 + 0.1 * casinoScale);
        grossExtraction += cashVal;
        breakdown.push({
          label: comp.label,
          delta: round2(cashVal),
          detail: `${comp.spinsCount} FS × ${comp.spinValue.toFixed(2)}€ (RTP ${(comp.rtp * 100).toFixed(1)}%, Real Bonus 1x — rischio 0€)`,
        });
      } else {
        const mc = simulateCasinoFunBonusDeterministic({
          bonusPerTranche: rawWinPerTranche,
          tranches,
          wageringMultiplier: comp.wageringMultiplier,
          conversionCapPerTranche: comp.conversionCapPerTranche ?? rawWinPerTranche * 2,
          rtpPhase1: comp.rtp,
          rtpPhase2: comp.rtp,
          maxBetPerSpin: Math.min(2, Math.max(0.2, rawWinPerTranche * 0.1)),
          seed: comp.seed ?? 777,
        });
        const scaledEv = mc.evTotal * casinoScale;
        grossExtraction += scaledEv;
        breakdown.push({
          label: comp.label,
          delta: round2(scaledEv),
          detail: `${comp.spinsCount} FS in ${tranches} tranche (wagering ${comp.wageringMultiplier}x, prob. sblocco ${mc.convProbPct.toFixed(1)}% — rischio 0€)`,
        });
      }
    } else if (comp.kind === 'casino_fun_bonus') {
      const mc = simulateCasinoFunBonusDeterministic({
        bonusPerTranche: comp.bonusPerTranche,
        tranches: comp.tranches,
        wageringMultiplier: comp.wageringMultiplier,
        conversionCapPerTranche: comp.conversionCapPerTranche,
        rtpPhase1: comp.rtpPhase1,
        rtpPhase2: comp.rtpPhase2,
        maxBetPerSpin: comp.maxBetPerSpin,
        contributionPct: comp.contributionPct ?? 100,
        seed: comp.seed,
      });
      const scaledEv = mc.evTotal * casinoScale;
      grossExtraction += scaledEv;
      breakdown.push({
        label: comp.label,
        delta: round2(scaledEv),
        detail: `${comp.tranches}×${comp.bonusPerTranche}€ Fun Bonus (${comp.wageringMultiplier}x, cap ${comp.conversionCapPerTranche}€/tranche, conv. ~${mc.convProbPct.toFixed(1)}% — rischio 0€)`,
      });
    }
  }

  const netProfit = round2(grossExtraction - qualifyingCost);
  const worstCaseProfit = round2(netProfit + worstCaseDeltaAdjust);
  const roiPct = deposit > 0 ? round2((netProfit / deposit) * 100) : null;

  const bankrollScale =
    model.scalableDeposit && model.defaultDeposit > 0 ? deposit / model.defaultDeposit : 1;
  const estimatedBankroll = round2(model.baseRecommendedBankroll * bankrollScale);

  // Calcola il break-even rating per gamba se ci sono componenti sportivi multi-leg o qualificanti elevati
  let breakEvenLegRatingPct: number | null = null;
  if (!model.isPureCasino && qualifyingCost > 0) {
    // Bisection between 85% and 99.5% on both single and leg rating
    const evalAt = (pct: number) => {
      const r = pct / 100;
      let q = 0;
      let g = 0;
      for (const comp of model.components) {
        if (comp.kind === 'qualifying_bet') {
          const count = comp.count ?? 1;
          const mult =
            comp.scalesWithDeposit && comp.depositMultiplier !== undefined
              ? overrides.rolloverMultiplier ?? comp.depositMultiplier
              : comp.depositMultiplier ?? 1;
          const st = comp.scalesWithDeposit ? deposit * mult * count : (comp.stake ?? deposit) * count;
          const cr = computeCombinedRating(comp.legs, r, r, comp.multiBoostPct ?? 0);
          q += st * Math.max(0, 1 - cr);
        } else if (comp.kind === 'real_bonus_sr') {
          const count = comp.count ?? 1;
          const b =
            comp.fixedAmount !== undefined
              ? comp.fixedAmount * count
              : Math.min(comp.maxAmount ?? Infinity, (deposit * (comp.pctOfDeposit ?? 100)) / 100) * count;
          const cr = computeCombinedRating(comp.legs, r, r, comp.multiBoostPct ?? 0);
          const roll = comp.rolloverMultiplier ?? 1;
          g += roll <= 1 ? b * cr : Math.max(0, b - b * roll * Math.max(0, 1 - cr));
        } else if (comp.kind === 'freebet_snr') {
          const count = comp.count ?? 1;
          const cr = computeCombinedRating(comp.legs, r, r, 0);
          const Q = Math.pow(Math.max(1.2, comp.avgLegOdds), comp.legs);
          g += comp.fixedAmount * count * ((Q - 1) / Q) * cr;
        } else if (comp.kind === 'rollover_bustout') {
          const b =
            comp.fixedAmount !== undefined
              ? comp.fixedAmount
              : Math.min(comp.maxAmount ?? Infinity, (deposit * (comp.pctOfDeposit ?? 100)) / 100);
          const rm =
            comp.rolloverRange && overrides.rolloverMultiplier !== undefined
              ? overrides.rolloverMultiplier
              : comp.rolloverMultiplier;
          const cr = computeCombinedRating(comp.legs, r, r, 0);
          const Q = Math.pow(Math.max(1.2, comp.avgLegOdds), comp.legs);
          const pW = 1 / Q;
          const maxP = comp.maxStakePerBet ?? b;
          const nc = maxP < b ? Math.ceil(b / maxP) : 1;
          const cb = b / nc;
          const cRoll = (b * rm) / nc;
          const s1 = Math.min(cb, cRoll);
          const expT = (s1 + pW * Math.max(0, cRoll - s1)) * nc;
          g += b - expT * Math.max(0, 1 - cr);
        } else if (comp.kind === 'exchange_cashback') {
          q += comp.qualifyingVolumePerPeriod * Math.max(0, 1 - r) * comp.periods;
          g += comp.maxRefundPerPeriod * comp.periods * computeCombinedRating(comp.bonusLegs, r, r, 0);
        }
      }
      return g - q;
    };

    if (evalAt(85) < 0 && evalAt(99.5) > 0) {
      let lo = 85;
      let hi = 99.5;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (evalAt(mid) < 0) lo = mid;
        else hi = mid;
      }
      breakEvenLegRatingPct = round2(hi);
    }
  }

  return {
    depositUsed: round2(deposit),
    netProfit,
    worstCaseProfit,
    hasBustOutUpside,
    qualifyingCost: round2(qualifyingCost),
    grossExtraction: round2(grossExtraction),
    roiPct,
    estimatedBankroll,
    breakEvenLegRatingPct,
    isProfitable: netProfit > 0,
    breakdown,
  };
}

/**
 * Calcola automaticamente i 3 scenari standard (Conservativo, Realistico, Ottimale) per una guida.
 */
export function simulateThreeScenarios(
  model: WelcomeBonusSimulationModel,
  overrides: Pick<SimulationOverrides, 'deposit' | 'rolloverMultiplier'> = {}
): ThreeScenarioSimulation {
  return {
    conservative: simulateWelcomeBonus(model, DEFAULT_SIMULATION_SCENARIOS.conservative, overrides),
    realistic: simulateWelcomeBonus(model, DEFAULT_SIMULATION_SCENARIOS.realistic, overrides),
    optimal: simulateWelcomeBonus(model, DEFAULT_SIMULATION_SCENARIOS.optimal, overrides),
  };
}

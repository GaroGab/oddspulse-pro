import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookmarkPlus,
  Calculator,
  Check,
  ChevronDown,
  ClipboardCheck,
  Copy,
  Gift,
  Minus,
  Plus,
  RotateCcw,
  Scale,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import {
  calculatePuntaPunta,
  calculateSingleMatch,
  computeAutoPuntaPuntaRolloverRating,
  computeAutoRolloverRating,
} from '../../shared/math';
import type {
  BetMode,
  RolloverWalletRule,
  ScrapeSnapshot,
  TrackedBet,
} from '../../shared/types';
import { formatEuro, formatOdds, formatPct } from '../utils/format';
import { playCopyTick } from '../utils/sound';
import { AnimatedNumber } from './AnimatedNumber';
import { NumericInput } from './NumericInput';
import { RolloverParamsPanel } from './RolloverParamsPanel';
import { SlidingPillTrack } from './SlidingPillTrack';

interface CalculatorViewProps {
  defaultStake: number;
  defaultCommission: number;
  soundEnabled: boolean;
  snapshot?: ScrapeSnapshot;
  onSaveTrackedBet: (bet: Omit<TrackedBet, 'id' | 'createdAt'>) => void;
}

const MODES: Array<{
  id: BetMode;
  label: string;
  badge: string;
  description: string;
}> = [
  {
    id: 'normal',
    label: 'Normale',
    badge: 'Qualificante',
    description: 'Puntata con denaro reale (scommessa qualificante o surebet).',
  },
  {
    id: 'snr',
    label: 'Freebet SNR',
    badge: 'Stake Not Returned',
    description: 'Freebet o Fun Bonus dove la puntata NON viene restituita in caso di vincita.',
  },
  {
    id: 'sr',
    label: 'Bonus SR',
    badge: 'Stake Returned',
    description: 'Real Bonus o credito bonus dove anche l’importo della puntata viene restituito.',
  },
  {
    id: 'rf',
    label: 'Rimborso RF',
    badge: 'Risk-Free / Cashback',
    description: 'Scommessa con soldi reali che rimborsa un bonus o cashback in caso di perdita.',
  },
  {
    id: 'rollover',
    label: 'Rollover',
    badge: 'Sblocco Bonus',
    description:
      'Bonus a requisiti di rigioco: bilancia la copertura considerando Saldo Reale, Saldo Bonus, Rollover Rimanente e Rating Stimato futuro.',
  },
];

const QUICK_STAKES = [10, 20, 25, 50, 100, 200, 500];

const COMMISSION_PRESETS = [
  { label: '0%', value: 0, hint: 'Promo 0%' },
  { label: '2%', value: 2, hint: 'Smarkets / Promo' },
  { label: '4.5%', value: 4.5, hint: 'Betfair EX IT' },
  { label: '5%', value: 5, hint: 'Betflag EX IT' },
];

const RETENTION_PRESETS = [
  { label: '65%', value: 65 },
  { label: '70%', value: 70 },
  { label: '75%', value: 75 },
  { label: '80%', value: 80 },
  { label: '100% Cash', value: 100 },
];

const BALANCE_PRESETS = [
  { label: 'Underlay', val: -1 },
  { label: 'Bilanciato', val: 0 },
  { label: 'Overlay', val: 1 },
] as const;

interface BalanceBiasCardProps {
  balanceBias: number;
  onChange: (bias: number) => void;
  subtitle: string;
  underlayHint: string;
  overlayHint: string;
  testIdPrefix?: string;
}

const BalanceBiasCard: React.FC<BalanceBiasCardProps> = ({
  balanceBias,
  onChange,
  subtitle,
  underlayHint,
  overlayHint,
  testIdPrefix = 'balance',
}) => (
  <div className="glass-panel rounded-2xl p-3.5">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div>
        <div className="text-xs font-bold text-white">
          Bilanciamento (Underlay / Overlay)
        </div>
        <div className="text-[10px] text-slate-400">{subtitle}</div>
      </div>
      <div className="flex shrink-0 gap-1">
        {BALANCE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            data-testid={`${testIdPrefix}-preset-${preset.label.toLowerCase()}`}
            onClick={() => onChange(preset.val)}
            className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold transition ${
              Math.abs(balanceBias - preset.val) < 0.05
                ? 'border-brand-400/50 bg-brand-400/20 text-brand-200'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>

    <input
      type="range"
      min={-1}
      max={1}
      step={0.05}
      value={balanceBias}
      data-testid={`${testIdPrefix}-slider`}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="pulse-slider mt-1 w-full"
    />
    <div className="mt-1.5 flex justify-between text-[10px] text-slate-500">
      <span>{underlayHint}</span>
      <span className="font-mono text-brand-300">
        {balanceBias === 0
          ? 'Bilanciato (0%)'
          : balanceBias < 0
          ? `Underlay ${Math.round(Math.abs(balanceBias) * 100)}%`
          : `Overlay ${Math.round(balanceBias * 100)}%`}
      </span>
      <span>{overlayHint}</span>
    </div>
  </div>
);

interface StrategyComparisonAccordionProps {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const StrategyComparisonAccordion: React.FC<StrategyComparisonAccordionProps> = ({
  open,
  onToggle,
  children,
}) => (
  <div>
    <button
      type="button"
      data-testid="strategy-comparison-toggle"
      aria-expanded={open}
      onClick={onToggle}
      className="glass-panel flex w-full items-center justify-between rounded-2xl p-3.5 text-left transition hover:border-brand-400/40"
    >
      <span className="flex items-center gap-1.5 text-xs font-bold text-white">
        <TrendingUp className="h-3.5 w-3.5 text-accent-300" />
        Confronto Strategie
      </span>
      <ChevronDown
        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
          open ? 'rotate-180 text-brand-300' : ''
        }`}
      />
    </button>

    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="strategy-comparison-content"
          data-testid="strategy-comparison-content"
          initial={{ opacity: 0, height: 0, y: -8 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={{ opacity: 0, height: 0, y: -8 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="space-y-3 pt-3">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

interface PpStrategyRowItem {
  id: string;
  label: string;
  bias: number;
  res: ReturnType<typeof calculatePuntaPunta>;
}

interface PpStrategyComparisonCardProps {
  rows: PpStrategyRowItem[];
  balanceBias: number;
  onSelectBias: (bias: number) => void;
}

const PpStrategyComparisonCard: React.FC<PpStrategyComparisonCardProps> = ({
  rows,
  balanceBias,
  onSelectBias,
}) => (
  <div className="glass-panel overflow-hidden rounded-2xl p-3.5">
    <div className="mb-2 flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-xs font-bold text-white">
        <TrendingUp className="h-3.5 w-3.5 text-accent-300" />
        Confronto Strategie (clicca per applicare)
      </span>
    </div>

    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-800/80 text-[10px] uppercase tracking-wider text-slate-500">
            <th className="pb-2 pr-2">Strategia</th>
            <th className="pb-2 px-2 text-right">Punta 1</th>
            <th className="pb-2 px-2 text-right">Coperture</th>
            <th className="pb-2 px-2 text-right">Vince P1</th>
            <th className="pb-2 pl-2 text-right">Vince Cop.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {rows.map((row) => {
            const isActive = Math.abs(balanceBias - row.bias) < 0.05;
            const p1Profit = row.res.profits[0] ?? 0;
            const hedgeProfit = row.res.profits[1] ?? 0;
            return (
              <tr
                key={row.id}
                data-testid={`pp-strategy-row-${row.id}`}
                onClick={() => onSelectBias(row.bias)}
                className={`cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-brand-500/15 text-white'
                    : 'text-slate-300 hover:bg-slate-800/40'
                }`}
              >
                <td className="py-1.5 pr-2">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isActive ? 'bg-brand-300' : 'bg-slate-600'
                      }`}
                    />
                    {row.label}
                  </div>
                </td>
                <td className="px-2 py-2 text-right font-mono font-bold text-blue-200">
                  {formatEuro(row.res.stakes[0] ?? 0)}
                </td>
                <td className="px-2 py-2 text-right font-mono font-bold text-white">
                  {formatEuro(row.res.hedgeTotal)}
                </td>
                <td
                  className={`px-2 py-2 text-right font-mono font-bold ${
                    p1Profit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatEuro(p1Profit, true)}
                </td>
                <td
                  className={`pl-2 py-2 text-right font-mono font-bold ${
                    hedgeProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatEuro(hedgeProfit, true)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

export const CalculatorView: React.FC<CalculatorViewProps> = React.memo(
  ({ defaultStake, defaultCommission, soundEnabled, snapshot, onSaveTrackedBet }) => {
    const initialCommPct = Math.round(defaultCommission * 1000) / 10;
    const baseStake = defaultStake || 50;

    const [calcType, setCalcType] = useState<'punta-banca' | 'punta-punta'>('punta-banca');
    const [mode, setMode] = useState<BetMode>('normal');
    const [stake, setStake] = useState<number>(baseStake);
    const [backOdds, setBackOdds] = useState<number>(2.0);
    const [layOdds, setLayOdds] = useState<number>(2.04);
    const [commissionPct, setCommissionPct] = useState<number>(initialCommPct || 4.5);
    const [refundAmount, setRefundAmount] = useState<number>(baseStake);
    const [refundRetention, setRefundRetention] = useState<number>(70);
    const [balanceBias, setBalanceBias] = useState<number>(0);

    // Rollover state
    const [realBalance, setRealBalance] = useState<number>(baseStake);
    const [bonusBalance, setBonusBalance] = useState<number>(baseStake);
    const [rolloverRemaining, setRolloverRemaining] = useState<number>(baseStake * 6);
    const [autoEstimatedRating, setAutoEstimatedRating] = useState<boolean>(true);
    const [manualEstimatedRating, setManualEstimatedRating] = useState<number>(96);
    const [rolloverWalletRule, setRolloverWalletRule] = useState<RolloverWalletRule>('mixed');

    // Punta-Punta state
    const [ppOutcomesCount, setPpOutcomesCount] = useState<2 | 3 | 4>(2);
    const [ppAnchorMode, setPpAnchorMode] = useState<'leg0' | 'total'>('leg0');
    const [ppOdds, setPpOdds] = useState<[number, number, number, number]>([2.0, 2.05, 3.4, 4.5]);
    const [copiedLegIdx, setCopiedLegIdx] = useState<number | null>(null);

    const [customLabel, setCustomLabel] = useState<string>('');
    const [copiedLay, setCopiedLay] = useState(false);
    const [copiedSummary, setCopiedSummary] = useState(false);
    const [savedFeedback, setSavedFeedback] = useState(false);
    const [showStrategies, setShowStrategies] = useState(false);

    const activeModeMeta = MODES.find((m) => m.id === mode) ?? MODES[0];

    const activePpOdds = useMemo(
      () => ppOdds.slice(0, ppOutcomesCount),
      [ppOdds, ppOutcomesCount]
    );

    const pbAutoRatingInfo = useMemo(
      () =>
        computeAutoRolloverRating({
          rows: snapshot?.rows,
          currentBackOdds: backOdds,
          currentLayOdds: layOdds,
          currentCommission: commissionPct / 100,
        }),
      [snapshot?.rows, backOdds, layOdds, commissionPct]
    );

    const ppAutoRatingInfo = useMemo(
      () =>
        computeAutoPuntaPuntaRolloverRating({
          dutcherRows: snapshot?.dutcherRows,
          currentOdds: activePpOdds,
        }),
      [snapshot?.dutcherRows, activePpOdds]
    );

    const effectivePbRating = autoEstimatedRating
      ? pbAutoRatingInfo.estimatedRating
      : manualEstimatedRating;
    const effectivePpRating = autoEstimatedRating
      ? ppAutoRatingInfo.estimatedRating
      : manualEstimatedRating;

    const calc = useMemo(
      () =>
        calculateSingleMatch({
          mode,
          stake,
          backOdds,
          layOdds,
          commission: commissionPct / 100,
          refundAmount,
          refundRetention,
          realBalance,
          bonusBalance,
          rolloverRemaining,
          estimatedRating: effectivePbRating,
          rolloverWalletRule,
          balanceBias,
        }),
      [
        mode,
        stake,
        backOdds,
        layOdds,
        commissionPct,
        refundAmount,
        refundRetention,
        realBalance,
        bonusBalance,
        rolloverRemaining,
        effectivePbRating,
        rolloverWalletRule,
        balanceBias,
      ]
    );

    const ppCalc = useMemo(
      () =>
        calculatePuntaPunta({
          mode,
          stake,
          odds: activePpOdds,
          anchorMode: mode === 'normal' ? ppAnchorMode : 'leg0',
          refundAmount,
          refundRetention,
          realBalance,
          bonusBalance,
          rolloverRemaining,
          estimatedRating: effectivePpRating,
          rolloverWalletRule,
          balanceBias,
        }),
      [
        mode,
        stake,
        activePpOdds,
        ppAnchorMode,
        refundAmount,
        refundRetention,
        realBalance,
        bonusBalance,
        rolloverRemaining,
        effectivePpRating,
        rolloverWalletRule,
        balanceBias,
      ]
    );

    const updatePpOdds = (idx: number, val: number) => {
      setPpOdds((prev) => {
        const next = [...prev] as [number, number, number, number];
        next[idx] = val;
        return next;
      });
    };

    // Precompute Underlay / Balanced / Overlay comparison rows
    const strategyRows = useMemo(() => {
      const strategies = [
        { id: 'underlay', label: 'Underlay', bias: -1 },
        { id: 'balanced', label: 'Bilanciato', bias: 0 },
        { id: 'overlay', label: 'Overlay', bias: 1 },
      ];
      return strategies.map((s) => ({
        ...s,
        res: calculateSingleMatch({
          mode,
          stake,
          backOdds,
          layOdds,
          commission: commissionPct / 100,
          refundAmount,
          refundRetention,
          realBalance,
          bonusBalance,
          rolloverRemaining,
          estimatedRating: effectivePbRating,
          rolloverWalletRule,
          balanceBias: s.bias,
        }),
      }));
    }, [
      mode,
      stake,
      backOdds,
      layOdds,
      commissionPct,
      refundAmount,
      refundRetention,
      realBalance,
      bonusBalance,
      rolloverRemaining,
      effectivePbRating,
      rolloverWalletRule,
    ]);

    const ppStrategyRows = useMemo(() => {
      const strategies = [
        { id: 'underlay', label: 'Underlay', bias: -1 },
        { id: 'balanced', label: 'Bilanciato', bias: 0 },
        { id: 'overlay', label: 'Overlay', bias: 1 },
      ];
      return strategies.map((s) => ({
        ...s,
        res: calculatePuntaPunta({
          mode,
          stake,
          odds: activePpOdds,
          anchorMode: mode === 'normal' ? ppAnchorMode : 'leg0',
          refundAmount,
          refundRetention,
          realBalance,
          bonusBalance,
          rolloverRemaining,
          estimatedRating: effectivePpRating,
          rolloverWalletRule,
          balanceBias: s.bias,
        }),
      }));
    }, [
      mode,
      stake,
      activePpOdds,
      ppAnchorMode,
      refundAmount,
      refundRetention,
      realBalance,
      bonusBalance,
      rolloverRemaining,
      effectivePpRating,
      rolloverWalletRule,
    ]);

    const effectiveRefundValue = useMemo(
      () => (mode === 'rf' ? (Math.max(0, refundAmount) * Math.max(0, refundRetention)) / 100 : 0),
      [mode, refundAmount, refundRetention]
    );

    // Cashflow breakdown components matching calculateSingleMatch
    const bookieReturnPart = useMemo(() => {
      if (stake <= 0 || backOdds <= 1) return 0;
      return mode === 'sr' ? stake * backOdds : stake * (backOdds - 1);
    }, [mode, stake, backOdds]);

    const exchangeNetWinPart = useMemo(() => {
      return calc.layStake * (1 - commissionPct / 100);
    }, [calc.layStake, commissionPct]);

    const maxBar = Math.max(
      1,
      Math.abs(calc.bookieWinProfit),
      Math.abs(calc.exchangeWinProfit)
    );

    const maxPpBar = useMemo(
      () => Math.max(1, ...ppCalc.profits.map((p) => Math.abs(p))),
      [ppCalc.profits]
    );

    const stepOdds = (current: number, delta: number, setter: (v: number) => void) => {
      const next = Math.max(1.01, Math.round((current + delta) * 100) / 100);
      setter(next);
    };

    const handleReset = () => {
      setMode('normal');
      setStake(baseStake);
      setBackOdds(2.0);
      setLayOdds(2.04);
      setCommissionPct(initialCommPct || 4.5);
      setRefundAmount(baseStake);
      setRefundRetention(70);
      setRealBalance(baseStake);
      setBonusBalance(baseStake);
      setRolloverRemaining(baseStake * 6);
      setAutoEstimatedRating(true);
      setManualEstimatedRating(96);
      setRolloverWalletRule('mixed');
      setBalanceBias(0);
      setPpOutcomesCount(2);
      setPpAnchorMode('leg0');
      setPpOdds([2.0, 2.05, 3.4, 4.5]);
      setCustomLabel('');
      setSavedFeedback(false);
    };

    const handleCopyLegStake = async (idx: number, amount: number) => {
      try {
        await navigator.clipboard.writeText(amount.toFixed(2));
        setCopiedLegIdx(idx);
        if (soundEnabled) playCopyTick();
        setTimeout(() => setCopiedLegIdx((cur) => (cur === idx ? null : cur)), 1500);
      } catch {
        // Ignore clipboard permission errors
      }
    };

    const handleCopyLay = async () => {
      try {
        await navigator.clipboard.writeText(calc.layStake.toFixed(2));
        setCopiedLay(true);
        if (soundEnabled) playCopyTick();
        setTimeout(() => setCopiedLay(false), 1600);
      } catch {
        // Ignore clipboard permission errors
      }
    };

    const handleCopySummary = async () => {
      const rolloverSuffix =
        mode === 'rollover'
          ? ` | Real €${realBalance.toFixed(2)} + Bonus €${bonusBalance.toFixed(2)} | Rollover €${rolloverRemaining.toFixed(2)}→€${(calc.rollover?.rolloverAfter ?? Math.max(0, rolloverRemaining - stake)).toFixed(2)} @ ${(calcType === 'punta-punta' ? effectivePpRating : effectivePbRating).toFixed(1)}%`
          : '';
      const summary =
        calcType === 'punta-punta'
          ? `[Punta-Punta • ${activeModeMeta.label}] ${activePpOdds
              .map((o, i) => `P${i + 1}: €${(ppCalc.stakes[i] ?? 0).toFixed(2)} @ ${o.toFixed(2)}`)
              .join(' | ')}${rolloverSuffix} | Esborso €${ppCalc.totalCashOutlay.toFixed(
              2
            )} | Rating ${ppCalc.rating.toFixed(2)}% | Profitto ${formatEuro(
              ppCalc.guaranteedProfit,
              true
            )}`
          : `[Punta-Banca • ${activeModeMeta.label}] Puntata €${stake.toFixed(
              2
            )} @ ${backOdds.toFixed(2)} | Banca €${calc.layStake.toFixed(
              2
            )} @ ${layOdds.toFixed(2)} (Comm ${commissionPct}%)${rolloverSuffix} | Resp €${calc.liability.toFixed(
              2
            )} | Rating ${calc.rating.toFixed(2)}% | Profitto ${formatEuro(
              calc.expectedProfit,
              true
            )}`;
      try {
        await navigator.clipboard.writeText(summary);
        setCopiedSummary(true);
        if (soundEnabled) playCopyTick();
        setTimeout(() => setCopiedSummary(false), 1800);
      } catch {
        // Ignore clipboard permission errors
      }
    };

    const handleSave = () => {
      if (calcType === 'punta-punta') {
        if (stake <= 0 || activePpOdds.some((o) => o <= 1)) return;
        onSaveTrackedBet({
          eventName:
            customLabel.trim() || `Punta-Punta (${activeModeMeta.label} • ${ppOutcomesCount} Esiti)`,
          league: 'Calcolatore Punta-Punta',
          sport: 'football',
          marketLabel: `${ppOutcomesCount} Esiti • ${activeModeMeta.label}`,
          selectionLabel:
            mode === 'rollover'
              ? `Rollover €${rolloverRemaining.toFixed(0)}→€${(ppCalc.rollover?.rolloverAfter ?? 0).toFixed(0)} • Real €${realBalance} + Bonus €${bonusBalance}`
              : activePpOdds.map((o, i) => `P${i + 1} @${o.toFixed(2)}`).join(' / '),
          type: 'dutcher',
          mode,
          bookmakerName: 'Bookmaker 1',
          exchangeName: `${ppOutcomesCount - 1} Book Copertura`,
          stake: ppCalc.stakes[0] ?? stake,
          backOdds: ppOdds[0],
          layOdds: ppOdds[1],
          layStake: ppCalc.hedgeTotal,
          liability: ppCalc.totalCashOutlay,
          commission: 0,
          expectedProfit: ppCalc.guaranteedProfit,
          rating: ppCalc.rating,
          status: 'pending',
          realizedProfit: ppCalc.guaranteedProfit,
        });
      } else {
        if (stake <= 0 || backOdds <= 1 || layOdds <= 1) return;
        onSaveTrackedBet({
          eventName: customLabel.trim() || `Calcolo Libero (${activeModeMeta.label})`,
          league: 'Calcolatore Bonus',
          sport: 'football',
          marketLabel: activeModeMeta.label,
          selectionLabel:
            mode === 'rf'
              ? `Rimborso €${refundAmount} (${refundRetention}%)`
              : mode === 'rollover'
              ? `Rollover €${rolloverRemaining.toFixed(0)}→€${(calc.rollover?.rolloverAfter ?? 0).toFixed(0)} • Real €${realBalance} + Bonus €${bonusBalance}`
              : `Punta @${backOdds.toFixed(2)} / Banca @${layOdds.toFixed(2)}`,
          type: 'single',
          mode,
          bookmakerName: 'Bookmaker',
          exchangeName: `Exchange (${commissionPct}%)`,
          stake,
          backOdds,
          layOdds,
          layStake: calc.layStake,
          liability: calc.liability,
          commission: commissionPct / 100,
          expectedProfit: calc.expectedProfit,
          rating: calc.rating,
          status: 'pending',
          realizedProfit: calc.expectedProfit,
        });
      }
      setSavedFeedback(true);
      if (soundEnabled) playCopyTick();
      setTimeout(() => setSavedFeedback(false), 2200);
    };

    return (
      <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
        {/* Top Header Card + Mode Selector */}
        <div className="glass-panel rounded-2xl p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-300 to-accent-400 text-slate-950 shadow-glow">
                {calcType === 'punta-punta' ? (
                  <Scale className="h-4 w-4" />
                ) : (
                  <Calculator className="h-4 w-4" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-base font-bold text-white">
                    Calcolatore Bonus & Quote Libere
                  </h1>
                  <span className="rounded-md border border-brand-400/35 bg-brand-400/15 px-2 py-0.5 font-mono text-[10px] font-bold text-brand-200">
                    {calcType === 'punta-punta' ? 'PUNTA-PUNTA' : 'PUNTA-BANCA'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  {calcType === 'punta-punta'
                    ? 'Calcola le puntate di copertura tra 2, 3 o 4 bookmaker senza Exchange per qualsiasi tipologia di bonus.'
                    : 'Calcola istantaneamente puntata, bancata, responsabilità e profitti su qualsiasi quota per Normale, Freebet SNR, Bonus SR, Rimborso RF e Rollover.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Calculator Type Toggle: Punta-Banca vs Punta-Punta */}
              <SlidingPillTrack
                activeKey={calcType}
                pillClassName="rounded-lg bg-gradient-to-r from-brand-300 to-accent-400 shadow-glow"
                className="flex items-center rounded-xl border border-slate-800 bg-slate-950/95 p-1"
              >
                <button
                  type="button"
                  data-pill-key="punta-banca"
                  data-testid="calc-type-punta-banca"
                  onClick={() => setCalcType('punta-banca')}
                  className={`relative z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    calcType === 'punta-banca' ? 'text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Calculator className="h-3.5 w-3.5" />
                  Punta - Banca
                </button>
                <button
                  type="button"
                  data-pill-key="punta-punta"
                  data-testid="calc-type-punta-punta"
                  onClick={() => setCalcType('punta-punta')}
                  className={`relative z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    calcType === 'punta-punta' ? 'text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Scale className="h-3.5 w-3.5" />
                  Punta - Punta
                </button>
              </SlidingPillTrack>

              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-brand-400/40 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Ripristina
              </button>
            </div>
          </div>

          {/* Bonus Mode Segmented Selector */}
          <SlidingPillTrack
            activeKey={mode}
            pillClassName="rounded-lg bg-gradient-to-r from-brand-300 to-accent-400 shadow-glow"
            className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-xl border border-slate-800/90 bg-slate-950/90 p-1 sm:grid-cols-5"
          >
            {MODES.map((m) => {
              const isSelected = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  data-pill-key={m.id}
                  data-testid={`standalone-mode-${m.id}`}
                  onClick={() => setMode(m.id)}
                  className={`relative z-10 flex flex-col items-center justify-center rounded-lg px-3 py-1.5 text-center transition ${
                    isSelected
                      ? 'text-slate-950'
                      : 'text-slate-400 hover:bg-slate-900/90 hover:text-slate-100'
                  }`}
                >
                  <span className="text-xs font-extrabold">{m.label}</span>
                  <span
                    className={`mt-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                      isSelected ? 'text-slate-900/80' : 'text-slate-500'
                    }`}
                  >
                    {m.badge}
                  </span>
                </button>
              );
            })}
          </SlidingPillTrack>

          {/* Contextual Mode Info Bar */}
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-800/70 bg-slate-950/50 px-3 py-1 text-[11px] text-slate-300">
            <Gift className="h-3.5 w-3.5 shrink-0 text-brand-300" />
            <span>
              <strong className="text-brand-200">{activeModeMeta.label}:</strong>{' '}
              {activeModeMeta.description}{' '}
              {calcType === 'punta-punta' && (
                <span className="text-emerald-300 font-medium">
                  — Modalità Punta-Punta senza Exchange (copertura su {ppOutcomesCount} bookmaker).
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Main 2-Column Calculator Grid */}
        {calcType === 'punta-banca' ? (
        <div
          key="punta-banca"
          className="view-enter grid grid-cols-1 gap-3 lg:grid-cols-12"
        >
          {/* LEFT COLUMN: Parameters & Strategy Controls */}
          <div className="space-y-3 lg:col-span-6">
            {/* Stake + Quick Presets */}
            <div className="glass-panel rounded-2xl p-3.5 space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="standalone-stake"
                    className="text-xs font-semibold text-slate-200"
                  >
                    {mode === 'snr'
                      ? 'Valore Freebet SNR (€)'
                      : mode === 'sr'
                      ? 'Valore Bonus SR (€)'
                      : mode === 'rollover'
                      ? 'Puntata Rollover (€)'
                      : 'Puntata Bookmaker (€)'}
                  </label>
                  <span className="text-[10px] text-slate-500">Importi rapidi</span>
                </div>

                <div className="mt-1.5 flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm font-bold text-brand-300">
                      €
                    </span>
                    <NumericInput
                      id="standalone-stake"
                      data-testid="standalone-stake-input"
                      min={0}
                      value={stake}
                      onChange={setStake}
                      placeholder="50"
                      className="w-full rounded-xl border border-slate-700/80 bg-slate-950/90 py-2 pl-8 pr-3 font-mono text-base font-extrabold text-white focus:border-brand-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {QUICK_STAKES.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        setStake(amt);
                        if (mode === 'rf') setRefundAmount(amt);
                      }}
                      className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold transition ${
                        Math.abs(stake - amt) < 0.01
                          ? 'border-brand-400/50 bg-brand-400/20 text-brand-200'
                          : 'border-slate-800 bg-slate-900/80 text-slate-400 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      €{amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Back & Lay Odds with micro-steppers */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-3">
                  <label
                    htmlFor="standalone-back-odds"
                    className="flex items-center justify-between text-xs font-semibold text-blue-300"
                  >
                    <span>Quota Punta (Bookmaker)</span>
                    <span className="font-mono text-[10px] text-blue-400/80">BACK</span>
                  </label>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Diminuisci quota punta"
                      onClick={() => stepOdds(backOdds, -0.05, setBackOdds)}
                      className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-500/30 bg-slate-950/80 text-blue-300 transition hover:bg-blue-500/20"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <NumericInput
                      id="standalone-back-odds"
                      data-testid="standalone-back-input"
                      min={1.01}
                      value={backOdds}
                      onChange={setBackOdds}
                      placeholder="2.00"
                      className="w-full rounded-lg border border-blue-500/35 bg-slate-950/90 px-2.5 py-1.5 text-center font-mono text-base font-extrabold text-blue-100 focus:border-blue-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      aria-label="Aumenta quota punta"
                      onClick={() => stepOdds(backOdds, 0.05, setBackOdds)}
                      className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-500/30 bg-slate-950/80 text-blue-300 transition hover:bg-blue-500/20"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3">
                  <label
                    htmlFor="standalone-lay-odds"
                    className="flex items-center justify-between text-xs font-semibold text-rose-300"
                  >
                    <span>Quota Banca (Exchange)</span>
                    <span className="font-mono text-[10px] text-rose-400/80">LAY</span>
                  </label>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label="Diminuisci quota banca"
                      onClick={() => stepOdds(layOdds, -0.05, setLayOdds)}
                      className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 bg-slate-950/80 text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <NumericInput
                      id="standalone-lay-odds"
                      data-testid="standalone-lay-input"
                      min={1.01}
                      value={layOdds}
                      onChange={setLayOdds}
                      placeholder="2.04"
                      className="w-full rounded-lg border border-rose-500/35 bg-slate-950/90 px-2.5 py-1.5 text-center font-mono text-base font-extrabold text-rose-100 focus:border-rose-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      aria-label="Aumenta quota banca"
                      onClick={() => stepOdds(layOdds, 0.05, setLayOdds)}
                      className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 bg-slate-950/80 text-rose-300 transition hover:bg-rose-500/20"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Exchange Commission */}
              <div className="rounded-xl border border-slate-800/90 bg-slate-950/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="standalone-comm"
                    className="text-xs font-semibold text-slate-300"
                  >
                    Commissione Exchange (%)
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {COMMISSION_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        title={p.hint}
                        onClick={() => setCommissionPct(p.value)}
                        className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold transition ${
                          Math.abs(commissionPct - p.value) < 0.05
                            ? 'border-amber-400/45 bg-amber-400/20 text-amber-200'
                            : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <NumericInput
                    id="standalone-comm"
                    data-testid="standalone-comm-input"
                    min={0}
                    max={20}
                    value={commissionPct}
                    onChange={setCommissionPct}
                    placeholder="4.5"
                    className="w-28 rounded-lg border border-slate-700/80 bg-slate-950 px-3 py-1.5 font-mono text-sm font-bold text-amber-300 focus:border-brand-400 focus:outline-none"
                  />
                  <span className="text-[11px] text-slate-500">
                    Applicata solo in caso di vincita sull&apos;Exchange
                  </span>
                </div>
              </div>

              {/* Extra Rimborso RF Parameters */}
              <AnimatePresence initial={false}>
                {mode === 'rf' && (
                  <motion.div
                    key="standalone-pb-rf"
                    data-testid="standalone-rf-panel"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl border border-accent-500/35 bg-accent-500/10 p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-accent-200">
                          <ShieldCheck className="h-4 w-4 text-accent-300" />
                          Parametri Rimborso / Cashback (RF)
                        </span>
                        <span className="rounded-md border border-accent-400/35 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                          Valore reale: {formatEuro(effectiveRefundValue)}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <div className="flex items-center justify-between">
                            <label
                              htmlFor="standalone-refund"
                              className="text-[11px] font-medium text-accent-200"
                            >
                              Importo Rimborso (€)
                            </label>
                            <button
                              type="button"
                              onClick={() => setRefundAmount(stake)}
                              className="text-[10px] font-semibold text-brand-300 hover:underline"
                            >
                              = Puntata
                            </button>
                          </div>
                          <NumericInput
                            id="standalone-refund"
                            data-testid="standalone-refund-input"
                            min={0}
                            value={refundAmount}
                            onChange={setRefundAmount}
                            placeholder="50"
                            className="mt-1 w-full rounded-lg border border-accent-500/35 bg-slate-950/90 px-3 py-1.5 font-mono text-sm font-bold text-white focus:border-accent-400 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="standalone-retention"
                            className="text-[11px] font-medium text-accent-200"
                          >
                            Ritenzione / Conversione Bonus (%)
                          </label>
                          <NumericInput
                            id="standalone-retention"
                            data-testid="standalone-retention-input"
                            min={0}
                            max={100}
                            value={refundRetention}
                            onChange={setRefundRetention}
                            placeholder="70"
                            className="mt-1 w-full rounded-lg border border-accent-500/35 bg-slate-950/90 px-3 py-1.5 font-mono text-sm font-bold text-white focus:border-accent-400 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {RETENTION_PRESETS.map((rp) => (
                          <button
                            key={rp.label}
                            type="button"
                            onClick={() => setRefundRetention(rp.value)}
                            className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold transition ${
                              Math.abs(refundRetention - rp.value) < 0.05
                                ? 'border-accent-400/60 bg-accent-400/25 text-white'
                                : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:text-white'
                            }`}
                          >
                            {rp.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Extra Rollover Parameters */}
              <AnimatePresence initial={false}>
                {mode === 'rollover' && (
                  <motion.div
                    key="standalone-pb-rollover"
                    data-testid="standalone-rollover-panel"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <RolloverParamsPanel
                      stake={stake}
                      realBalance={realBalance}
                      bonusBalance={bonusBalance}
                      rolloverRemaining={rolloverRemaining}
                      estimatedRating={effectivePbRating}
                      autoEstimatedRating={autoEstimatedRating}
                      autoRatingInfo={pbAutoRatingInfo}
                      walletRule={rolloverWalletRule}
                      rolloverDetails={calc.rollover}
                      onChangeStake={setStake}
                      onChangeRealBalance={setRealBalance}
                      onChangeBonusBalance={setBonusBalance}
                      onChangeRolloverRemaining={setRolloverRemaining}
                      onChangeEstimatedRating={setManualEstimatedRating}
                      onToggleAutoRating={setAutoEstimatedRating}
                      onChangeWalletRule={setRolloverWalletRule}
                      testIdPrefix="pb-rollover"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Underlay / Balanced / Overlay Slider */}
            <BalanceBiasCard
              balanceBias={balanceBias}
              onChange={setBalanceBias}
              subtitle="Sposta il profitto verso Bookmaker o Exchange modificando la bancata."
              underlayHint="Underlay (Banca meno)"
              overlayHint="Overlay (Banca di più)"
              testIdPrefix="pb-balance"
            />

            {/* Optional Note for Tracker */}
            <div className="glass-panel rounded-2xl p-3">
              <label
                htmlFor="standalone-note"
                className="text-[11px] font-semibold text-slate-400"
              >
                Etichetta opzionale (per salvare nel Tracker Profitti)
              </label>
              <input
                id="standalone-note"
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Es. Promo Benvenuto Sisal, Freebet 20€, Rimborso Casinò..."
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-brand-400 focus:outline-none"
              />
            </div>
          </div>

          {/* RIGHT COLUMN: Hero Results, Payoff Breakdown & Comparison Table */}
          <div className="space-y-3 lg:col-span-6">
            {/* Hero Result Banner */}
            <div className="relative overflow-hidden rounded-2xl border border-brand-400/40 bg-gradient-to-br from-brand-500/15 via-[var(--bg-modal-solid)] to-accent-500/15 p-4 shadow-glow">
              <div className="aurora-bar absolute inset-x-0 top-0 h-[2px]" />

              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand-300">
                      Importo da Bancare sull&apos;Exchange
                    </span>
                    {calc.rating >= 100 && mode === 'normal' && (
                      <span className="surebet-badge rounded-full px-2 py-0.5 font-mono text-[10px] font-extrabold text-brand-100">
                        SUREBET
                      </span>
                    )}
                    {calc.rating >= 70 && mode === 'snr' && (
                      <span className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-200">
                        ALTA CONVERSIONE
                      </span>
                    )}
                    {mode === 'rollover' && calc.rollover?.completesRolloverOnThisBet && (
                      <span className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-200">
                        SBLOCCO DIRETTO
                      </span>
                    )}
                    {mode === 'rollover' &&
                      !calc.rollover?.completesRolloverOnThisBet &&
                      calc.expectedProfit > 0 && (
                        <span className="rounded-full border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-200">
                          EV POSITIVO
                        </span>
                      )}
                  </div>

                  <div className="mt-1 flex items-baseline gap-3">
                    <AnimatedNumber
                      value={calc.layStake}
                      durationMs={200}
                      formatter={(v) => formatEuro(v)}
                      className="font-mono text-3xl font-extrabold text-white"
                    />
                    <span className="font-mono text-sm font-semibold text-rose-300">
                      @ {formatOdds(layOdds)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCopyLay}
                  className="flex items-center gap-1.5 rounded-xl border border-brand-400/45 bg-brand-400/20 px-3.5 py-2 text-xs font-bold text-brand-100 transition hover:bg-brand-400/30 active:scale-95"
                >
                  {copiedLay ? (
                    <Check className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copiedLay ? 'Copiato!' : 'Copia Bancata'}
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-800/80 pt-3 sm:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Responsabilità
                  </div>
                  <AnimatedNumber
                    value={calc.liability}
                    durationMs={200}
                    formatter={(v) => formatEuro(v)}
                    className="mt-0.5 block font-mono text-base font-extrabold text-rose-300"
                  />
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    {mode === 'rollover' ? 'Profitto Finale Stimato' : 'Profitto Medio'}
                  </div>
                  <AnimatedNumber
                    value={calc.expectedProfit}
                    durationMs={200}
                    formatter={(v) => formatEuro(v, true)}
                    className={`mt-0.5 block font-mono text-base font-extrabold ${
                      calc.expectedProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  />
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    {mode === 'rollover'
                      ? bonusBalance > 0
                        ? 'Estrazione Bonus'
                        : 'Rating Rollover'
                      : 'Rating Netto'}
                  </div>
                  <AnimatedNumber
                    value={calc.rating}
                    durationMs={200}
                    formatter={(v) => formatPct(v)}
                    className={`mt-0.5 block font-mono text-base font-extrabold ${
                      calc.rating >= 100
                        ? 'text-brand-300'
                        : calc.rating >= 95 ||
                          (mode === 'snr' && calc.rating >= 70) ||
                          (mode === 'rollover' && calc.rating >= 60)
                        ? 'text-emerald-400'
                        : 'text-amber-300'
                    }`}
                  />
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    {mode === 'rollover' ? 'Rating Singola' : 'Rating Lordo'}
                  </div>
                  <div className="mt-0.5 font-mono text-base font-bold text-slate-300">
                    {formatPct(
                      mode === 'rollover'
                        ? calc.rollover?.matchRating ?? calc.rawRating
                        : calc.rawRating
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Dual Outcome Breakdown Cards */}
            <div className="glass-panel rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Sparkles className="h-3.5 w-3.5 text-brand-400" />
                  Simulazione Esito Finale & Flusso di Cassa
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  Comm. {commissionPct}%
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Bookmaker Wins Card */}
                <div className="rounded-xl border border-blue-500/25 bg-slate-950/75 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-300">Se vince Bookmaker</span>
                    <AnimatedNumber
                      value={calc.bookieWinProfit}
                      durationMs={200}
                      formatter={(v) => formatEuro(v, true)}
                      className={`font-mono text-sm font-extrabold ${
                        calc.bookieWinProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    />
                  </div>
                  <div className="mt-2 space-y-1 text-[11px]">
                    <div className="flex justify-between text-slate-400">
                      <span>{mode === 'sr' ? 'Ritorno Bonus SR' : 'Vincita Bookmaker'}</span>
                      <span className="font-mono text-emerald-300">
                        +{formatEuro(bookieReturnPart)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Responsabilità Exchange</span>
                      <span className="font-mono text-rose-300">
                        -{formatEuro(calc.liability)}
                      </span>
                    </div>
                    {mode === 'rollover' && calc.rollover && (
                      <>
                        <div className="flex items-center justify-between gap-2 whitespace-nowrap text-slate-400">
                          <span className="truncate">
                            Rollover ({formatEuro(calc.rollover.rolloverAfter)} @ {calc.rollover.estimatedRating}%)
                          </span>
                          <span className="shrink-0 font-mono text-amber-300">
                            {calc.rollover.futureRolloverCostIfWin > 0.005
                              ? `-${formatEuro(calc.rollover.futureRolloverCostIfWin)}`
                              : '€0,00 (Chiuso)'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 whitespace-nowrap text-slate-400">
                          <span>Saldo Bookmaker</span>
                          <span className="font-mono text-slate-200">
                            {formatEuro(calc.rollover.bookieBalanceIfWin)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-900">
                    <div
                      style={{
                        width: `${Math.max(8, (Math.abs(calc.bookieWinProfit) / maxBar) * 100)}%`,
                      }}
                      className={`h-full rounded-full transition-all duration-200 ${
                        calc.bookieWinProfit >= -0.005
                          ? 'bg-gradient-to-r from-emerald-500 to-brand-400'
                          : 'bg-gradient-to-r from-rose-600 to-amber-500'
                      }`}
                    />
                  </div>
                </div>

                {/* Exchange Wins Card */}
                <div className="rounded-xl border border-rose-500/25 bg-slate-950/75 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-300">Se vince Exchange</span>
                    <AnimatedNumber
                      value={calc.exchangeWinProfit}
                      durationMs={200}
                      formatter={(v) => formatEuro(v, true)}
                      className={`font-mono text-sm font-extrabold ${
                        calc.exchangeWinProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    />
                  </div>
                  <div className="mt-2 space-y-1 text-[11px]">
                    <div className="flex justify-between text-slate-400">
                      <span>Bancata netta (-{commissionPct}%)</span>
                      <span className="font-mono text-emerald-300">
                        +{formatEuro(exchangeNetWinPart)}
                      </span>
                    </div>
                    {(mode === 'normal' || mode === 'rf') && (
                      <div className="flex justify-between text-slate-400">
                        <span>Puntata Bookmaker</span>
                        <span className="font-mono text-rose-300">-{formatEuro(stake)}</span>
                      </div>
                    )}
                    {mode === 'rollover' && calc.rollover && (
                      <>
                        <div className="flex items-center justify-between gap-2 whitespace-nowrap text-slate-400">
                          <span>Puntata Bookmaker</span>
                          <span className="font-mono text-rose-300">-{formatEuro(stake)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 whitespace-nowrap text-slate-400">
                          <span>Rollover residuo</span>
                          <span className="font-mono text-emerald-300">
                            {calc.rollover.clearsRolloverOnLose
                              ? '€0,00 (Sbloccato!)'
                              : `-${formatEuro(calc.rollover.futureRolloverCostIfLose)}`}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 whitespace-nowrap text-slate-400">
                          <span>Saldo Bookmaker</span>
                          <span className="font-mono text-slate-200">
                            {formatEuro(calc.rollover.bookieBalanceIfLose)}
                          </span>
                        </div>
                      </>
                    )}
                    {mode === 'rf' && (
                      <div className="flex justify-between text-slate-400">
                        <span>Rimborso stimato ({refundRetention}%)</span>
                        <span className="font-mono text-accent-300">
                          +{formatEuro(effectiveRefundValue)}
                        </span>
                      </div>
                    )}
                    {(mode === 'snr' || mode === 'sr') && (
                      <div className="flex justify-between text-slate-400">
                        <span>Costo puntata bonus</span>
                        <span className="font-mono text-slate-400">€0,00</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-900">
                    <div
                      style={{
                        width: `${Math.max(8, (Math.abs(calc.exchangeWinProfit) / maxBar) * 100)}%`,
                      }}
                      className={`h-full rounded-full transition-all duration-200 ${
                        calc.exchangeWinProfit >= -0.005
                          ? 'bg-gradient-to-r from-emerald-500 to-brand-400'
                          : 'bg-gradient-to-r from-rose-600 to-amber-500'
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Strategy Comparison Tables (Hidden behind collapsible toggle) */}
            <StrategyComparisonAccordion
              open={showStrategies}
              onToggle={() => setShowStrategies((prev) => !prev)}
            >
              <div className="glass-panel overflow-hidden rounded-2xl p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                    <TrendingUp className="h-3.5 w-3.5 text-accent-300" />
                    Confronto Strategie (clicca per applicare)
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800/80 text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="pb-2 pr-2">Strategia</th>
                        <th className="pb-2 px-2 text-right">Bancata</th>
                        <th className="pb-2 px-2 text-right">Resp.</th>
                        <th className="pb-2 px-2 text-right">Vince Book</th>
                        <th className="pb-2 pl-2 text-right">Vince Exch</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {strategyRows.map((row) => {
                        const isActive = Math.abs(balanceBias - row.bias) < 0.05;
                        return (
                          <tr
                            key={row.id}
                            onClick={() => setBalanceBias(row.bias)}
                            className={`cursor-pointer transition-colors ${
                              isActive
                                ? 'bg-brand-500/15 text-white'
                                : 'text-slate-300 hover:bg-slate-800/40'
                            }`}
                          >
                            <td className="py-1.5 pr-2">
                              <div className="flex items-center gap-1.5 font-semibold">
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    isActive ? 'bg-brand-300' : 'bg-slate-600'
                                  }`}
                                />
                                {row.label}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right font-mono font-bold text-white">
                              {formatEuro(row.res.layStake)}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-rose-300">
                              {formatEuro(row.res.liability)}
                            </td>
                            <td
                              className={`px-2 py-2 text-right font-mono font-bold ${
                                row.res.bookieWinProfit >= -0.005
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {formatEuro(row.res.bookieWinProfit, true)}
                            </td>
                            <td
                              className={`pl-2 py-2 text-right font-mono font-bold ${
                                row.res.exchangeWinProfit >= -0.005
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {formatEuro(row.res.exchangeWinProfit, true)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <PpStrategyComparisonCard
                rows={ppStrategyRows}
                balanceBias={balanceBias}
                onSelectBias={setBalanceBias}
              />
            </StrategyComparisonAccordion>

            {/* Action Buttons */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                data-testid="standalone-save-tracker"
                onClick={handleSave}
                disabled={stake <= 0 || backOdds <= 1 || layOdds <= 1}
                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition disabled:opacity-50 ${
                  savedFeedback
                    ? 'border border-emerald-400/45 bg-emerald-500/20 text-emerald-200'
                    : 'bg-gradient-to-r from-brand-300 to-accent-400 text-slate-950 shadow-glow hover:brightness-110 active:scale-[0.99]'
                }`}
              >
                {savedFeedback ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <BookmarkPlus className="h-4 w-4" />
                )}
                {savedFeedback ? 'Salvato nel Tracker!' : 'Salva nel Tracker Profitti'}
              </button>

              <button
                type="button"
                onClick={handleCopySummary}
                className="flex items-center justify-center gap-2 rounded-xl border border-slate-700/90 bg-slate-900/90 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:border-brand-400/45 hover:text-white active:scale-[0.99]"
              >
                {copiedSummary ? (
                  <ClipboardCheck className="h-4 w-4 text-emerald-300" />
                ) : (
                  <Copy className="h-4 w-4 text-brand-300" />
                )}
                {copiedSummary ? 'Riepilogo Copiato!' : 'Copia Riepilogo Completo'}
              </button>
            </div>
          </div>
        </div>
        ) : (
        /* ==================== PUNTA - PUNTA MODE ==================== */
        <div
          key="punta-punta"
          className="view-enter grid grid-cols-1 gap-3 lg:grid-cols-12"
        >
          {/* LEFT COLUMN: Outcomes, Stake, Bookmaker Odds & RF Config */}
          <div className="space-y-3 lg:col-span-6">
            <div className="glass-panel rounded-2xl p-3.5 space-y-3">
              {/* Top Bar: Outcomes Count + Anchor Mode */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Numero Esiti (Coperture)
                  </div>
                  <SlidingPillTrack
                    activeKey={String(ppOutcomesCount)}
                    pillClassName="rounded-lg bg-gradient-to-r from-brand-300 to-accent-400 shadow-glow"
                    className="mt-1 flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/90 p-0.5"
                  >
                    {([2, 3, 4] as const).map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        data-pill-key={String(cnt)}
                        data-testid={`pp-outcomes-${cnt}`}
                        onClick={() => setPpOutcomesCount(cnt)}
                        className={`relative z-10 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                          ppOutcomesCount === cnt
                            ? 'text-slate-950'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {cnt} Esiti
                      </button>
                    ))}
                  </SlidingPillTrack>
                </div>

                <AnimatePresence initial={false}>
                  {mode === 'normal' && (
                    <motion.div
                      key="pp-anchor-wrap"
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Ancora Puntata
                      </div>
                      <SlidingPillTrack
                        activeKey={ppAnchorMode}
                        pillClassName="rounded-lg border border-brand-400/50 bg-brand-400/20"
                        className="mt-1 flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/90 p-0.5"
                      >
                        <button
                          type="button"
                          data-pill-key="leg0"
                          data-testid="pp-anchor-leg0"
                          onClick={() => setPpAnchorMode('leg0')}
                          className={`relative z-10 rounded-lg border border-transparent px-2.5 py-1 text-[11px] font-bold transition ${
                            ppAnchorMode === 'leg0'
                              ? 'text-brand-200'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Fissa Punta 1
                        </button>
                        <button
                          type="button"
                          data-pill-key="total"
                          data-testid="pp-anchor-total"
                          onClick={() => setPpAnchorMode('total')}
                          className={`relative z-10 rounded-lg border border-transparent px-2.5 py-1 text-[11px] font-bold transition ${
                            ppAnchorMode === 'total'
                              ? 'text-brand-200'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Budget Totale
                        </button>
                      </SlidingPillTrack>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Primary Stake Input + Quick Presets */}
              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="pp-stake"
                    className="text-xs font-semibold text-slate-200"
                  >
                    {mode === 'normal' && ppAnchorMode === 'total'
                      ? 'Budget Totale (€)'
                      : mode === 'snr'
                      ? 'Valore Freebet SNR — Punta 1 (€)'
                      : mode === 'sr'
                      ? 'Valore Bonus SR — Punta 1 (€)'
                      : mode === 'rollover'
                      ? 'Puntata Rollover — Punta 1 (€)'
                      : 'Puntata 1 — Bookmaker Promo (€)'}
                  </label>
                  <span className="text-[10px] text-slate-500">Importi rapidi</span>
                </div>

                <div className="mt-1.5 relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm font-bold text-brand-300">
                    €
                  </span>
                  <NumericInput
                    id="pp-stake"
                    data-testid="standalone-stake-input"
                    min={0}
                    value={stake}
                    onChange={setStake}
                    placeholder="50"
                    className="w-full rounded-xl border border-slate-700/80 bg-slate-950/90 py-2 pl-8 pr-3 font-mono text-base font-extrabold text-white focus:border-brand-400 focus:outline-none"
                  />
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {QUICK_STAKES.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        setStake(amt);
                        if (mode === 'rf') setRefundAmount(amt);
                      }}
                      className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold transition ${
                        Math.abs(stake - amt) < 0.01
                          ? 'border-brand-400/50 bg-brand-400/20 text-brand-200'
                          : 'border-slate-800 bg-slate-900/80 text-slate-400 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      €{amt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Odds Inputs Grid (2..4 Outcomes) */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <AnimatePresence initial={false}>
                  {activePpOdds.map((oddsVal, idx) => {
                    const palette =
                      idx === 0
                        ? {
                            title:
                              mode === 'normal' && ppAnchorMode === 'total'
                                ? 'Quota Punta 1'
                                : 'Quota Punta 1 (Principale)',
                            box: 'border-blue-500/35 bg-blue-950/20',
                            label: 'text-blue-300',
                            tag: 'text-blue-400/80',
                            btn: 'border-blue-500/30 text-blue-300 hover:bg-blue-500/20',
                            input: 'border-blue-500/35 text-blue-100 focus:border-blue-400',
                          }
                        : idx === 1
                        ? {
                            title: 'Quota Punta 2 (Copertura)',
                            box: 'border-emerald-500/35 bg-emerald-950/20',
                            label: 'text-emerald-300',
                            tag: 'text-emerald-400/80',
                            btn: 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20',
                            input: 'border-emerald-500/35 text-emerald-100 focus:border-emerald-400',
                          }
                        : idx === 2
                        ? {
                            title: 'Quota Punta 3 (Copertura)',
                            box: 'border-amber-500/35 bg-amber-950/20',
                            label: 'text-amber-300',
                            tag: 'text-amber-400/80',
                            btn: 'border-amber-500/30 text-amber-300 hover:bg-amber-500/20',
                            input: 'border-amber-500/35 text-amber-100 focus:border-amber-400',
                          }
                        : {
                            title: 'Quota Punta 4 (Copertura)',
                            box: 'border-rose-500/35 bg-rose-950/20',
                            label: 'text-rose-300',
                            tag: 'text-rose-400/80',
                            btn: 'border-rose-500/30 text-rose-300 hover:bg-rose-500/20',
                            input: 'border-rose-500/35 text-rose-100 focus:border-rose-400',
                          };

                    return (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        className={`rounded-xl border p-2.5 ${palette.box}`}
                      >
                        <label
                          htmlFor={`pp-odds-input-${idx}`}
                          className={`flex items-center justify-between text-[11px] font-semibold ${palette.label}`}
                        >
                          <span className="truncate">{palette.title}</span>
                          <span className={`font-mono text-[10px] ${palette.tag}`}>P{idx + 1}</span>
                        </label>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Diminuisci quota punta ${idx + 1}`}
                            onClick={() =>
                              stepOdds(oddsVal, -0.05, (next) => updatePpOdds(idx, next))
                            }
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-slate-950/80 transition ${palette.btn}`}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <NumericInput
                            id={`pp-odds-input-${idx}`}
                            data-testid={`pp-odds-${idx}`}
                            min={1.01}
                            value={oddsVal}
                            onChange={(val) => updatePpOdds(idx, val)}
                            placeholder="2.00"
                            className={`w-full rounded-lg border bg-slate-950/90 px-2 py-1 text-center font-mono text-sm font-extrabold focus:outline-none ${palette.input}`}
                          />
                          <button
                            type="button"
                            aria-label={`Aumenta quota punta ${idx + 1}`}
                            onClick={() =>
                              stepOdds(oddsVal, 0.05, (next) => updatePpOdds(idx, next))
                            }
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-slate-950/80 transition ${palette.btn}`}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* Extra Rimborso RF Parameters */}
              <AnimatePresence initial={false}>
                {mode === 'rf' && (
                  <motion.div
                    key="standalone-pp-rf"
                    data-testid="standalone-rf-panel"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl border border-accent-500/35 bg-accent-500/10 p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-accent-200">
                          <ShieldCheck className="h-4 w-4 text-accent-300" />
                          Rimborso se Punta 1 è Perdente (RF)
                        </span>
                        <span className="rounded-md border border-accent-400/35 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                          Valore reale: {formatEuro(effectiveRefundValue)}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <div>
                          <div className="flex items-center justify-between">
                            <label
                              htmlFor="pp-refund"
                              className="text-[11px] font-medium text-accent-200"
                            >
                              Importo Rimborso (€)
                            </label>
                            <button
                              type="button"
                              onClick={() => setRefundAmount(stake)}
                              className="text-[10px] font-semibold text-brand-300 hover:underline"
                            >
                              = Punta 1
                            </button>
                          </div>
                          <NumericInput
                            id="pp-refund"
                            data-testid="standalone-refund-input"
                            min={0}
                            value={refundAmount}
                            onChange={setRefundAmount}
                            placeholder="50"
                            className="mt-1 w-full rounded-lg border border-accent-500/35 bg-slate-950/90 px-3 py-1.5 font-mono text-sm font-bold text-white focus:border-accent-400 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="pp-retention"
                            className="text-[11px] font-medium text-accent-200"
                          >
                            Ritenzione / Conversione Bonus (%)
                          </label>
                          <NumericInput
                            id="pp-retention"
                            data-testid="standalone-retention-input"
                            min={0}
                            max={100}
                            value={refundRetention}
                            onChange={setRefundRetention}
                            placeholder="70"
                            className="mt-1 w-full rounded-lg border border-accent-500/35 bg-slate-950/90 px-3 py-1.5 font-mono text-sm font-bold text-white focus:border-accent-400 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {RETENTION_PRESETS.map((rp) => (
                          <button
                            key={rp.label}
                            type="button"
                            onClick={() => setRefundRetention(rp.value)}
                            className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold transition ${
                              Math.abs(refundRetention - rp.value) < 0.05
                                ? 'border-accent-400/60 bg-accent-400/25 text-white'
                                : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:text-white'
                            }`}
                          >
                            {rp.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Extra Rollover Parameters (Punta-Punta) */}
              <AnimatePresence initial={false}>
                {mode === 'rollover' && (
                  <motion.div
                    key="standalone-pp-rollover"
                    data-testid="standalone-pp-rollover-panel"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <RolloverParamsPanel
                      stake={stake}
                      realBalance={realBalance}
                      bonusBalance={bonusBalance}
                      rolloverRemaining={rolloverRemaining}
                      estimatedRating={effectivePpRating}
                      autoEstimatedRating={autoEstimatedRating}
                      autoRatingInfo={ppAutoRatingInfo}
                      walletRule={rolloverWalletRule}
                      rolloverDetails={ppCalc.rollover}
                      onChangeStake={setStake}
                      onChangeRealBalance={setRealBalance}
                      onChangeBonusBalance={setBonusBalance}
                      onChangeRolloverRemaining={setRolloverRemaining}
                      onChangeEstimatedRating={setManualEstimatedRating}
                      onToggleAutoRating={setAutoEstimatedRating}
                      onChangeWalletRule={setRolloverWalletRule}
                      testIdPrefix="pp-rollover"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Underlay / Balanced / Overlay Slider */}
            <BalanceBiasCard
              balanceBias={balanceBias}
              onChange={setBalanceBias}
              subtitle="Sposta il profitto verso Punta 1 o Coperture modificando gli importi di copertura."
              underlayHint="Underlay (Copri meno)"
              overlayHint="Overlay (Copri di più)"
              testIdPrefix="pp-balance"
            />

            {/* Optional Note for Tracker */}
            <div className="glass-panel rounded-2xl p-3">
              <label
                htmlFor="pp-note"
                className="text-[11px] font-semibold text-slate-400"
              >
                Etichetta opzionale (per salvare nel Tracker Profitti)
              </label>
              <input
                id="pp-note"
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Es. Dutcher Snai/Betflag, Freebet P1 vs P2, RF Rimborso..."
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-brand-400 focus:outline-none"
              />
            </div>
          </div>

          {/* RIGHT COLUMN: Hero Hedge Stakes, Outcome Simulation & Actions */}
          <div className="space-y-3 lg:col-span-6">
            {/* Hero Stakes Banner */}
            <div className="relative overflow-hidden rounded-2xl border border-brand-400/40 bg-gradient-to-br from-brand-500/15 via-[var(--bg-modal-solid)] to-accent-500/15 p-4 shadow-glow">
              <div className="aurora-bar absolute inset-x-0 top-0 h-[2px]" />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brand-300">
                    Importi da Puntare (Copertura Punta-Punta)
                  </span>
                  {ppCalc.rating >= 100 && mode === 'normal' && (
                    <span className="surebet-badge rounded-full px-2 py-0.5 font-mono text-[10px] font-extrabold text-brand-100">
                      SUREBET
                    </span>
                  )}
                  {ppCalc.rating >= 70 && mode === 'snr' && (
                    <span className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-200">
                      ALTA CONVERSIONE
                    </span>
                  )}
                  {mode === 'rollover' && ppCalc.rollover?.completesRolloverOnThisBet && (
                    <span className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-200">
                      SBLOCCO DIRETTO
                    </span>
                  )}
                  {mode === 'rollover' &&
                    !ppCalc.rollover?.completesRolloverOnThisBet &&
                    ppCalc.guaranteedProfit > 0 && (
                      <span className="rounded-full border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-200">
                        EV POSITIVO
                      </span>
                    )}
                </div>
              </div>

              {/* Individual Legs List */}
              <div className="mt-2.5 space-y-2">
                {activePpOdds.map((o, idx) => {
                  const legStake = ppCalc.stakes[idx] ?? 0;
                  const isPromoLeg = idx === 0 && (mode === 'snr' || mode === 'sr');
                  return (
                    <div
                      key={idx}
                      data-testid={`pp-result-leg-${idx}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-slate-950/75 px-3 py-2"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${
                            idx === 0
                              ? 'bg-blue-500/20 text-blue-200 border border-blue-400/40'
                              : idx === 1
                              ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                              : idx === 2
                              ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                              : 'bg-rose-500/20 text-rose-200 border border-rose-400/40'
                          }`}
                        >
                          Punta {idx + 1}
                        </span>
                        <span className="font-mono text-xs font-semibold text-slate-300">
                          @ {formatOdds(o)}
                        </span>
                        {isPromoLeg && (
                          <span className="rounded border border-accent-400/40 bg-accent-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-accent-200">
                            {mode === 'snr' ? 'FREEBET' : 'BONUS SR'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5">
                        <AnimatedNumber
                          value={legStake}
                          durationMs={200}
                          formatter={(v) => formatEuro(v)}
                          className="font-mono text-lg font-extrabold text-white"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCopyLegStake(idx, legStake)}
                          className="flex items-center gap-1 rounded-lg border border-brand-400/35 bg-brand-400/15 px-2.5 py-1 text-[11px] font-bold text-brand-100 transition hover:bg-brand-400/25 active:scale-95"
                        >
                          {copiedLegIdx === idx ? (
                            <Check className="h-3 w-3 text-emerald-300" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          {copiedLegIdx === idx ? 'Copiato' : 'Copia'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 4 Summary Metrics */}
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-800/80 pt-3 sm:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Esborso Reale
                  </div>
                  <AnimatedNumber
                    value={ppCalc.totalCashOutlay}
                    durationMs={200}
                    formatter={(v) => formatEuro(v)}
                    className="mt-0.5 block font-mono text-base font-extrabold text-white"
                  />
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    {mode === 'rollover' ? 'Profitto Finale Stimato' : 'Profitto Medio'}
                  </div>
                  <AnimatedNumber
                    value={ppCalc.guaranteedProfit}
                    durationMs={200}
                    formatter={(v) => formatEuro(v, true)}
                    className={`mt-0.5 block font-mono text-base font-extrabold ${
                      ppCalc.guaranteedProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  />
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    {mode === 'rollover'
                      ? bonusBalance > 0
                        ? 'Estrazione Bonus'
                        : 'Rating Rollover'
                      : 'Rating Netto'}
                  </div>
                  <AnimatedNumber
                    value={ppCalc.rating}
                    durationMs={200}
                    formatter={(v) => formatPct(v)}
                    className={`mt-0.5 block font-mono text-base font-extrabold ${
                      ppCalc.rating >= 100
                        ? 'text-brand-300'
                        : ppCalc.rating >= 95 ||
                          (mode === 'snr' && ppCalc.rating >= 70) ||
                          (mode === 'rollover' && ppCalc.rating >= 60)
                        ? 'text-emerald-400'
                        : 'text-amber-300'
                    }`}
                  />
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Lavagna
                  </div>
                  <div
                    className={`mt-0.5 font-mono text-base font-bold ${
                      ppCalc.impliedProbSum > 0 && ppCalc.impliedProbSum < 1
                        ? 'text-emerald-400'
                        : 'text-slate-300'
                    }`}
                  >
                    {formatPct(ppCalc.impliedProbSum * 100)}
                  </div>
                </div>
              </div>
            </div>

            {/* Per-Outcome Profit Breakdown */}
            <div className="glass-panel rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                  <Sparkles className="h-3.5 w-3.5 text-brand-400" />
                  Simulazione Esito Finale per Bookmaker
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  {ppOutcomesCount} Esiti
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {activePpOdds.map((_, idx) => {
                  const netProfit = ppCalc.profits[idx] ?? 0;
                  const grossReturn = ppCalc.returns[idx] ?? 0;
                  const isRfBonusLeg = mode === 'rf' && idx > 0;
                  return (
                    <div
                      key={idx}
                      data-testid={`pp-outcome-card-${idx}`}
                      className="rounded-xl border border-slate-800/90 bg-slate-950/75 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 whitespace-nowrap">
                        <span className="text-xs font-bold text-slate-200">
                          Se vince Punta {idx + 1}
                        </span>
                        <AnimatedNumber
                          value={netProfit}
                          durationMs={200}
                          formatter={(v) => formatEuro(v, true)}
                          className={`font-mono text-sm font-extrabold ${
                            netProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        />
                      </div>

                      <div className="mt-1.5 space-y-0.5 text-[11px]">
                        <div className="flex items-center justify-between gap-2 whitespace-nowrap text-slate-400">
                          <span>Ritorno Bookmaker</span>
                          <span className="font-mono text-emerald-300">
                            +{formatEuro(grossReturn)}
                          </span>
                        </div>
                        {isRfBonusLeg && (
                          <div className="flex items-center justify-between gap-2 whitespace-nowrap text-slate-400">
                            <span>Rimborso ({refundRetention}%)</span>
                            <span className="font-mono text-accent-300">
                              +{formatEuro(ppCalc.effectiveRefund)}
                            </span>
                          </div>
                        )}
                        {mode === 'rollover' && ppCalc.rollover ? (
                          <>
                            <div className="flex items-center justify-between gap-2 whitespace-nowrap text-slate-400">
                              <span>Coperture esterne</span>
                              <span className="font-mono text-rose-300">
                                -{formatEuro(ppCalc.hedgeTotal)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 whitespace-nowrap text-slate-400">
                              <span>Rollover residuo</span>
                              <span className="font-mono text-amber-300">
                                {idx === 0
                                  ? ppCalc.rollover.futureRolloverCostIfWin > 0.005
                                    ? `-${formatEuro(ppCalc.rollover.futureRolloverCostIfWin)}`
                                    : '€0,00 (Chiuso)'
                                  : ppCalc.rollover.clearsRolloverOnLose
                                  ? '€0,00 (Sbloccato!)'
                                  : `-${formatEuro(ppCalc.rollover.futureRolloverCostIfLose)}`}
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-between gap-2 whitespace-nowrap text-slate-400">
                            <span>Spesa Reale Totale</span>
                            <span className="font-mono text-rose-300">
                              -{formatEuro(ppCalc.totalCashOutlay)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-900">
                        <div
                          style={{
                            width: `${Math.max(8, (Math.abs(netProfit) / maxPpBar) * 100)}%`,
                          }}
                          className={`h-full rounded-full transition-all duration-200 ${
                            netProfit >= -0.005
                              ? 'bg-gradient-to-r from-emerald-500 to-brand-400'
                              : 'bg-gradient-to-r from-rose-600 to-amber-500'
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Strategy Comparison Table (Hidden behind collapsible toggle) */}
            <StrategyComparisonAccordion
              open={showStrategies}
              onToggle={() => setShowStrategies((prev) => !prev)}
            >
              <PpStrategyComparisonCard
                rows={ppStrategyRows}
                balanceBias={balanceBias}
                onSelectBias={setBalanceBias}
              />
            </StrategyComparisonAccordion>

            {/* Action Buttons */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                data-testid="standalone-save-tracker"
                onClick={handleSave}
                disabled={stake <= 0 || activePpOdds.some((o) => o <= 1)}
                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition disabled:opacity-50 ${
                  savedFeedback
                    ? 'border border-emerald-400/45 bg-emerald-500/20 text-emerald-200'
                    : 'bg-gradient-to-r from-brand-300 to-accent-400 text-slate-950 shadow-glow hover:brightness-110 active:scale-[0.99]'
                }`}
              >
                {savedFeedback ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <BookmarkPlus className="h-4 w-4" />
                )}
                {savedFeedback ? 'Salvato nel Tracker!' : 'Salva nel Tracker Profitti'}
              </button>

              <button
                type="button"
                onClick={handleCopySummary}
                className="flex items-center justify-center gap-2 rounded-xl border border-slate-700/90 bg-slate-900/90 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:border-brand-400/45 hover:text-white active:scale-[0.99]"
              >
                {copiedSummary ? (
                  <ClipboardCheck className="h-4 w-4 text-emerald-300" />
                ) : (
                  <Copy className="h-4 w-4 text-brand-300" />
                )}
                {copiedSummary ? 'Riepilogo Copiato!' : 'Copia Riepilogo Completo'}
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    );
  }
);

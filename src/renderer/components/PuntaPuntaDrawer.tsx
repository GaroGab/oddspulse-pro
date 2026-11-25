import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  calculatePuntaPunta,
  computeAutoPuntaPuntaRolloverRating,
  round2,
  type PuntaPuntaCalcInput,
} from '../../shared/math';
import type { PuntaPuntaCandidateRow } from '../../shared/puntaPuntaMatcher';
import type {
  BetMode,
  DutcherRow,
  LiveVerifySideResult,
  RolloverWalletRule,
  SourceId,
  TrackedBet,
  VerifyPuntaPuntaResult,
} from '../../shared/types';
import { formatEuro, formatEventTime, formatOdds, formatPct, ratingTone, sportLabel } from '../utils/format';
import { playCopyTick } from '../utils/sound';
import { AnimatedNumber } from './AnimatedNumber';
import { BookmakerIcon } from './BookmakerIcon';
import { CustomSelect, type SelectOption } from './CustomSelect';
import { NumericInput } from './NumericInput';
import { RolloverParamsPanel } from './RolloverParamsPanel';
import { SlidingPillTrack } from './SlidingPillTrack';

interface PuntaPuntaDrawerProps {
  row: PuntaPuntaCandidateRow | null;
  initialMode: BetMode;
  initialStake: number;
  initialAnchorMode: NonNullable<PuntaPuntaCalcInput['anchorMode']>;
  initialRefundAmount: number;
  initialRefundRetention: number;
  soundEnabled: boolean;
  dutcherRows?: DutcherRow[];
  onClose: () => void;
  onSaveTrackedBet: (bet: Omit<TrackedBet, 'id' | 'createdAt'>) => void;
}

interface EditableLeg {
  selectionKey: string;
  selectionLabel: string;
  bookmakerId: SourceId;
  bookmakerName: string;
  odds: number;
  eventUrl?: string;
  eventId?: string;
  marketId?: string;
  sourceMetadata?: Record<string, string>;
  swapped?: boolean;
}

const MODE_LABELS: { id: BetMode; label: string; hint: string }[] = [
  { id: 'normal', label: 'Normale', hint: 'Qualificante / Surebet' },
  { id: 'snr', label: 'Freebet SNR', hint: 'Stake non restituito' },
  { id: 'sr', label: 'Bonus SR', hint: 'Stake restituito' },
  { id: 'rf', label: 'Rimborso RF', hint: 'Rimborso se perdente' },
  { id: 'rollover', label: 'Rollover', hint: 'Sblocco bonus a rigioco' },
];

export const PuntaPuntaDrawer: React.FC<PuntaPuntaDrawerProps> = ({
  row,
  initialMode,
  initialStake,
  initialAnchorMode,
  initialRefundAmount,
  initialRefundRetention,
  soundEnabled,
  dutcherRows,
  onClose,
  onSaveTrackedBet,
}) => {
  const [mode, setMode] = useState<BetMode>(initialMode);
  const [stake, setStake] = useState<number>(initialStake);
  const [anchorMode, setAnchorMode] =
    useState<NonNullable<PuntaPuntaCalcInput['anchorMode']>>(initialAnchorMode);
  const [refundAmount, setRefundAmount] = useState<number>(initialRefundAmount);
  const [refundRetention, setRefundRetention] = useState<number>(initialRefundRetention);
  const [realBalance, setRealBalance] = useState<number>(initialStake || 50);
  const [bonusBalance, setBonusBalance] = useState<number>(initialStake || 50);
  const [rolloverRemaining, setRolloverRemaining] = useState<number>((initialStake || 50) * 6);
  const [autoEstimatedRating, setAutoEstimatedRating] = useState<boolean>(true);
  const [manualEstimatedRating, setManualEstimatedRating] = useState<number>(95);
  const [rolloverWalletRule, setRolloverWalletRule] = useState<RolloverWalletRule>('mixed');
  const [balanceBias, setBalanceBias] = useState<number>(0);
  const [legs, setLegs] = useState<EditableLeg[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyPuntaPuntaResult | null>(null);
  const manualEditedLegRef = useRef<Set<number>>(new Set());
  const verifySeqRef = useRef(0);

  const runLiveVerifyLegs = useCallback(
    async (targetRow: PuntaPuntaCandidateRow, targetLegs: EditableLeg[], forceApply = false) => {
      const api = window.oddspulse?.verifyPuntaPunta;
      if (!api || targetLegs.length === 0) return;
      const seq = ++verifySeqRef.current;
      setVerifying(true);
      try {
        const res = await api({
          groupId: targetRow.groupId,
          eventKey: targetRow.eventKey,
          sport: targetRow.sport,
          eventName: targetRow.eventName,
          homeTeam: targetRow.homeTeam,
          awayTeam: targetRow.awayTeam,
          startTime: targetRow.startTime,
          marketType: targetRow.marketType,
          legs: targetLegs.map((l) => ({
            selectionKey: l.selectionKey,
            bookmakerId: l.bookmakerId,
            bookmakerName: l.bookmakerName,
            eventId: l.eventId,
            marketId: l.marketId,
            sourceMetadata: l.sourceMetadata,
            swapped: l.swapped,
            previousOdds: l.odds,
          })),
        });
        if (verifySeqRef.current !== seq) return;
        setVerifyResult(res);
        setLegs((prev) =>
          prev.map((leg, idx) => {
            if (!forceApply && manualEditedLegRef.current.has(idx)) return leg;
            const matched = res.legs.find(
              (r) => r.selectionKey === leg.selectionKey && r.bookmakerId === leg.bookmakerId
            );
            if (matched?.result.liveOdds && matched.result.liveOdds > 1.005) {
              return { ...leg, odds: matched.result.liveOdds };
            }
            return leg;
          })
        );
        if (forceApply) manualEditedLegRef.current.clear();
      } catch {
        // Ignore single verification error
      } finally {
        if (verifySeqRef.current === seq) setVerifying(false);
      }
    },
    []
  );

  const rowKey = row?.id ?? null;

  useEffect(() => {
    if (!row) {
      verifySeqRef.current++;
      setVerifying(false);
      setVerifyResult(null);
      return;
    }
    manualEditedLegRef.current.clear();
    setMode(initialMode);
    setStake(initialStake);
    setAnchorMode(initialAnchorMode);
    setRefundAmount(initialRefundAmount);
    setRefundRetention(initialRefundRetention);
    setBalanceBias(0);
    const initialLegs: EditableLeg[] = row.legs.map((l) => ({
      selectionKey: l.selectionKey,
      selectionLabel: l.selectionLabel,
      bookmakerId: l.bookmakerId,
      bookmakerName: l.bookmakerName,
      odds: l.odds,
      eventUrl: l.eventUrl,
      eventId: l.eventId,
      marketId: l.marketId,
      sourceMetadata: l.sourceMetadata,
      swapped: l.swapped,
    }));
    setLegs(initialLegs);
    setSavedBanner(false);
    setCopiedIdx(null);
    setVerifyResult(null);
    void runLiveVerifyLegs(row, initialLegs, false);
    // Reset only when opening a different Punta-Punta row
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey]);

  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  const autoRatingInfo = useMemo(
    () =>
      computeAutoPuntaPuntaRolloverRating({
        dutcherRows,
        currentOdds: legs.map((l) => Math.max(1.01, l.odds || 1.01)),
      }),
    [dutcherRows, legs]
  );

  const effectiveEstimatedRating = autoEstimatedRating
    ? autoRatingInfo.estimatedRating
    : manualEstimatedRating;

  const calc = useMemo(() => {
    if (legs.length < 2) return null;
    return calculatePuntaPunta({
      mode,
      stake: Math.max(1, stake || 100),
      odds: legs.map((l) => Math.max(1.01, l.odds || 1.01)),
      anchorMode,
      refundAmount: Math.max(0, refundAmount || 0),
      refundRetention: Math.max(0, Math.min(100, refundRetention || 0)),
      realBalance,
      bonusBalance,
      rolloverRemaining,
      estimatedRating: effectiveEstimatedRating,
      rolloverWalletRule,
      balanceBias,
    });
  }, [
    legs,
    mode,
    stake,
    anchorMode,
    refundAmount,
    refundRetention,
    realBalance,
    bonusBalance,
    rolloverRemaining,
    effectiveEstimatedRating,
    rolloverWalletRule,
    balanceBias,
  ]);

  const isModifiedFromLive = useMemo(() => {
    if (!row || legs.length !== row.legs.length) return false;
    return legs.some((l, idx) => {
      const orig = row.legs[idx];
      return l.bookmakerId !== orig.bookmakerId || Math.abs(l.odds - orig.odds) > 0.004;
    });
  }, [row, legs]);

  const sameBookieConflict = useMemo(() => {
    if (legs.length < 2) return false;
    const primaryBook = legs[0].bookmakerId;
    return legs.slice(1).some((l) => l.bookmakerId === primaryBook);
  }, [legs]);

  const handleResetLive = () => {
    if (!row) return;
    manualEditedLegRef.current.clear();
    setLegs(
      row.legs.map((l) => ({
        selectionKey: l.selectionKey,
        selectionLabel: l.selectionLabel,
        bookmakerId: l.bookmakerId,
        bookmakerName: l.bookmakerName,
        odds: l.odds,
        eventUrl: l.eventUrl,
        eventId: l.eventId,
        marketId: l.marketId,
        sourceMetadata: l.sourceMetadata,
        swapped: l.swapped,
      }))
    );
    setSavedBanner(false);
  };

  const handleSelectBookmakerForLeg = (legIdx: number, bookmakerId: SourceId) => {
    if (!row) return;
    const targetLeg = legs[legIdx];
    const quotes = row.groupQuotesBySelection[targetLeg.selectionKey] ?? [];
    const matched = quotes.find((q) => q.bookmakerId === bookmakerId);
    if (!matched) return;
    manualEditedLegRef.current.delete(legIdx);
    setLegs((prev) =>
      prev.map((l, idx) =>
        idx === legIdx
          ? {
              ...l,
              bookmakerId: matched.bookmakerId,
              bookmakerName: matched.bookmakerName,
              odds: matched.odds,
              eventUrl: matched.eventUrl ?? l.eventUrl,
              eventId: matched.eventId,
              marketId: matched.marketId,
              sourceMetadata: matched.sourceMetadata,
              swapped: matched.swapped,
            }
          : l
      )
    );
    setSavedBanner(false);
  };

  const handleChangeOddsForLeg = (legIdx: number, nextOdds: number) => {
    manualEditedLegRef.current.add(legIdx);
    setLegs((prev) =>
      prev.map((l, idx) => (idx === legIdx ? { ...l, odds: Math.max(1.01, nextOdds) } : l))
    );
    setSavedBanner(false);
  };

  const copyStake = (idx: number, amount: number) => {
    void navigator.clipboard.writeText(amount.toFixed(2));
    if (soundEnabled) playCopyTick();
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1300);
  };

  const handleSave = () => {
    if (!row || !calc || legs.length < 2) return;
    const pLeg = legs[0];
    const hedges = legs.slice(1);
    onSaveTrackedBet({
      eventName: row.eventName,
      league: row.league,
      sport: row.sport,
      marketLabel: row.marketLabel,
      selectionLabel: legs
        .map((l, idx) => `${l.selectionLabel} (${l.bookmakerName}) @${formatOdds(l.odds)} €${calc.stakes[idx].toFixed(2)}`)
        .join(' | '),
      type: 'dutcher',
      mode,
      bookmakerName: pLeg.bookmakerName,
      exchangeName: hedges.map((h) => h.bookmakerName).join(' + '),
      stake: calc.totalCashOutlay > 0 ? calc.totalCashOutlay : calc.stakes[0],
      backOdds: pLeg.odds,
      layOdds: hedges[0]?.odds ?? 1,
      layStake: calc.hedgeTotal,
      liability: calc.hedgeTotal,
      commission: 0,
      expectedProfit: calc.guaranteedProfit,
      rating: calc.rating,
      status: 'pending',
      realizedProfit: 0,
      notes:
        mode === 'rollover' && calc.rollover
          ? `Rollover €${calc.rollover.rolloverBefore}→€${calc.rollover.rolloverAfter} • Real €${calc.rollover.realBalance} + Bonus €${calc.rollover.bonusBalance} @ ${calc.rollover.estimatedRating}%`
          : `Punta-Punta (${mode.toUpperCase()}) • Lavagna ${round2(calc.impliedProbSum * 100).toFixed(2)}%`,
    });
    if (soundEnabled) playCopyTick();
    setSavedBanner(true);
  };

  return (
    <AnimatePresence>
      {row && calc && (
        <div
          className="fixed inset-0 top-12 z-50 flex items-center justify-center p-4 sm:p-6"
          data-testid="punta-punta-drawer"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="fixed inset-0 top-12 bg-black/75 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 flex max-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-[var(--bg-modal-solid)] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)]"
          >
            <div className="aurora-bar" />

            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 px-5 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <span className="rounded bg-slate-800/90 px-1.5 py-0.5 text-slate-300">
                    {sportLabel(row.sport)}
                  </span>
                  <span className="truncate">{row.league}</span>
                  <span>•</span>
                  <span className="text-brand-300">{row.marketLabel}</span>
                  <span>•</span>
                  <span className="tabular-nums text-slate-300">
                    {formatEventTime(row.startTime).date} {formatEventTime(row.startTime).time}
                  </span>
                </div>
                <h3 className="mt-1 truncate text-base font-bold text-white">{row.eventName}</h3>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-lg border px-2 py-1 text-[11px] font-bold tabular-nums ${
                    calc.impliedProbSum <= 1
                      ? 'border-brand-400/40 bg-brand-500/15 text-brand-200'
                      : 'border-slate-700 bg-slate-900/90 text-slate-300'
                  }`}
                >
                  Lavagna {round2(calc.impliedProbSum * 100).toFixed(2)}%
                </span>
                <span
                  className={`rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-1 text-xs font-extrabold tabular-nums ${ratingTone(
                    calc.rating,
                    mode
                  )}`}
                >
                  {formatPct(calc.rating)}
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Chiudi calcolatore"
                  data-testid="pp-drawer-close"
                  className="rounded-lg border border-slate-800 bg-slate-900/80 p-1.5 text-slate-400 transition hover:border-slate-700 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {/* Top Controls Row */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                <div className="md:col-span-7">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Modalità Operazione
                  </div>
                  <SlidingPillTrack
                    activeKey={mode}
                    pillClassName="rounded-md bg-brand-500 shadow-[0_0_12px_rgba(245,158,11,0.35)]"
                    className="grid grid-cols-3 gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1 sm:grid-cols-5"
                  >
                    {MODE_LABELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        data-pill-key={m.id}
                        data-testid={`pp-calc-mode-${m.id}`}
                        onClick={() => setMode(m.id)}
                        className={`relative z-10 rounded-md px-2 py-1.5 text-center text-[11px] font-semibold transition-colors ${
                          mode === m.id ? 'text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </SlidingPillTrack>
                </div>

                <div className="md:col-span-5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {mode === 'normal' && anchorMode === 'total'
                        ? 'Budget Totale (€)'
                        : mode === 'snr' || mode === 'sr'
                        ? 'Importo Bonus (€)'
                        : mode === 'rollover'
                        ? 'Puntata Rollover (€)'
                        : 'Puntata Punta 1 (€)'}
                    </span>
                    {mode === 'normal' && (
                      <SlidingPillTrack
                        activeKey={anchorMode}
                        pillClassName="rounded bg-slate-700"
                        className="flex items-center gap-0.5 rounded-md border border-slate-800 bg-slate-950 p-0.5 text-[10px]"
                      >
                        <button
                          type="button"
                          data-pill-key="leg0"
                          onClick={() => setAnchorMode('leg0')}
                          className={`relative z-10 rounded px-1.5 py-0.5 font-semibold ${
                            anchorMode === 'leg0' ? 'text-white' : 'text-slate-400'
                          }`}
                        >
                          Fissa P1
                        </button>
                        <button
                          type="button"
                          data-pill-key="total"
                          onClick={() => setAnchorMode('total')}
                          className={`relative z-10 rounded px-1.5 py-0.5 font-semibold ${
                            anchorMode === 'total' ? 'text-white' : 'text-slate-400'
                          }`}
                        >
                          Budget Tot
                        </button>
                      </SlidingPillTrack>
                    )}
                  </div>
                  <div className="relative mt-1">
                    <NumericInput
                      value={stake}
                      onChange={(v) => setStake(Math.max(1, v))}
                      min={1}
                      data-testid="pp-calc-stake"
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 pr-7 text-sm font-bold text-white focus:border-brand-400 focus:outline-none"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                      €
                    </span>
                  </div>
                </div>
              </div>

              {/* RF Parameters if mode === 'rf' */}
              {mode === 'rf' && (
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-amber-200/80">
                      Rimborso Massimo (€)
                    </label>
                    <NumericInput
                      value={refundAmount}
                      onChange={(v) => setRefundAmount(Math.max(0, v))}
                      min={0}
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-white focus:border-brand-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-amber-200/80">
                      Ritenzione Stimata Bonus (%)
                    </label>
                    <NumericInput
                      value={refundRetention}
                      onChange={(v) => setRefundRetention(Math.max(0, Math.min(100, v)))}
                      min={0}
                      max={100}
                      allowDecimal={false}
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs font-bold text-white focus:border-brand-400 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Rollover Parameters if mode === 'rollover' */}
              {mode === 'rollover' && (
                <RolloverParamsPanel
                  compact
                  stake={stake}
                  realBalance={realBalance}
                  bonusBalance={bonusBalance}
                  rolloverRemaining={rolloverRemaining}
                  estimatedRating={effectiveEstimatedRating}
                  autoEstimatedRating={autoEstimatedRating}
                  autoRatingInfo={autoRatingInfo}
                  walletRule={rolloverWalletRule}
                  rolloverDetails={calc.rollover}
                  onChangeStake={setStake}
                  onChangeRealBalance={setRealBalance}
                  onChangeBonusBalance={setBonusBalance}
                  onChangeRolloverRemaining={setRolloverRemaining}
                  onChangeEstimatedRating={setManualEstimatedRating}
                  onToggleAutoRating={setAutoEstimatedRating}
                  onChangeWalletRule={setRolloverWalletRule}
                  testIdPrefix="pp-drawer-rollover"
                />
              )}

              {sameBookieConflict && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  <span>
                    Attenzione: hai selezionato lo stesso bookmaker sia su Punta 1 sia su una copertura. Seleziona un bookmaker diverso per evitare puntate contrarie sullo stesso conto.
                  </span>
                </div>
              )}

              {/* Legs Breakdown & Manual Bookmaker Comparison */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300">
                    <ArrowRightLeft className="h-3.5 w-3.5 text-brand-400" />
                    Confronto Bookmaker e Puntate per Esito
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={verifying}
                      data-testid="pp-verify-live-btn"
                      onClick={() => void runLiveVerifyLegs(row, legs, true)}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
                      title="Verifica subito tutte le quote Punta direttamente sui bookmaker"
                    >
                      <RefreshCw className={`h-3 w-3 ${verifying ? 'animate-spin' : ''}`} />
                      {verifying ? 'Verifica live...' : 'Verifica Live'}
                    </button>
                    {isModifiedFromLive && (
                      <button
                        type="button"
                        onClick={handleResetLive}
                        data-testid="pp-calc-reset-live"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-300 transition hover:border-brand-400/50 hover:text-brand-200"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Ripristina quote live
                      </button>
                    )}
                  </div>
                </div>

                {legs.map((leg, idx) => {
                  const isPrimary = idx === 0;
                  const quotes = row.groupQuotesBySelection[leg.selectionKey] ?? [];
                  const legVerify: LiveVerifySideResult | undefined = verifyResult?.legs.find(
                    (lr) => lr.selectionKey === leg.selectionKey && lr.bookmakerId === leg.bookmakerId
                  )?.result;
                  const bookieOptions: SelectOption<SourceId>[] = quotes.map((q) => ({
                    value: q.bookmakerId,
                    label: q.bookmakerName,
                    hint: `@${formatOdds(q.odds)}`,
                    icon: <BookmakerIcon sourceId={q.bookmakerId} size={18} />,
                  }));
                  // Include manually active option if not present in quotes fallback
                  if (!bookieOptions.some((o) => o.value === leg.bookmakerId)) {
                    bookieOptions.unshift({
                      value: leg.bookmakerId,
                      label: leg.bookmakerName,
                      hint: `@${formatOdds(leg.odds)}`,
                      icon: <BookmakerIcon sourceId={leg.bookmakerId} size={18} />,
                    });
                  }

                  const legStake = calc.stakes[idx] ?? 0;
                  const legReturn = calc.returns[idx] ?? 0;

                  return (
                    <div
                      key={`${leg.selectionKey}-${idx}`}
                      data-testid={`pp-drawer-leg-${idx}`}
                      className={`rounded-xl border p-3.5 transition ${
                        isPrimary
                          ? 'border-brand-400/40 bg-brand-500/[0.06]'
                          : 'border-slate-800 bg-slate-900/70'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                              isPrimary
                                ? 'bg-brand-500/20 text-brand-300'
                                : 'bg-sky-500/15 text-sky-300'
                            }`}
                          >
                            {isPrimary ? 'PUNTA 1 • PRINCIPALE' : `COPERTURA ${idx} • PUNTA`}
                          </span>
                          <span className="text-sm font-bold text-white">{leg.selectionLabel}</span>
                          {legVerify && legVerify.status === 'confirmed' && (
                            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
                              Live ✓
                              {legVerify.cacheAgeSec && legVerify.cacheAgeSec >= 60
                                ? ` (cache ~${Math.round(legVerify.cacheAgeSec / 60)}m)`
                                : ''}
                            </span>
                          )}
                          {legVerify && legVerify.status === 'changed' && legVerify.liveOdds && (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-200">
                              Aggiornata {formatOdds(legVerify.previousOdds)}→{formatOdds(legVerify.liveOdds)}
                            </span>
                          )}
                          {legVerify && legVerify.status === 'suspended' && (
                            <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-rose-200">
                              Sospesa ⚠
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          <span>Vincita lorda:</span>
                          <span className="font-semibold tabular-nums text-slate-200">
                            {formatEuro(legReturn)}
                          </span>
                          {leg.eventUrl && (
                            <button
                              type="button"
                              onClick={() => void window.oddspulse?.openExternal(leg.eventUrl!)}
                              title={`Apri ${leg.bookmakerName}`}
                              className="ml-1 rounded-md border border-slate-800 bg-slate-950 p-1 text-slate-400 transition hover:border-slate-700 hover:text-white"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                        {/* Bookmaker chooser showing all bookies for this outcome */}
                        <div className="sm:col-span-5">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Bookmaker ({quotes.length} {quotes.length === 1 ? 'sito' : 'siti'})
                          </label>
                          <CustomSelect<SourceId>
                            value={leg.bookmakerId}
                            options={bookieOptions}
                            onChange={(val) => handleSelectBookmakerForLeg(idx, val)}
                            size="sm"
                            minMenuWidth={240}
                            data-testid={`pp-leg-bookie-${idx}`}
                            className="mt-1"
                          />
                        </div>

                        {/* Editable odds */}
                        <div className="sm:col-span-3">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Quota Punta
                          </label>
                          <NumericInput
                            value={leg.odds}
                            onChange={(v) => handleChangeOddsForLeg(idx, v)}
                            min={1.01}
                            data-testid={`pp-leg-odds-${idx}`}
                            className={`mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-center font-mono text-xs font-extrabold focus:border-brand-400 focus:outline-none ${
                              isPrimary ? 'text-brand-300' : 'text-sky-300'
                            }`}
                          />
                        </div>

                        {/* Calculated stake + Copy */}
                        <div className="sm:col-span-4">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Importo da Puntare
                          </label>
                          <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/90 px-2.5 py-1.5">
                            <span
                              className="text-sm font-extrabold tabular-nums text-white"
                              data-testid={`pp-leg-stake-${idx}`}
                            >
                              {formatEuro(legStake)}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyStake(idx, legStake)}
                              data-testid={`pp-leg-copy-${idx}`}
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold transition ${
                                copiedIdx === idx
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                              }`}
                            >
                              {copiedIdx === idx ? (
                                <>
                                  <Check className="h-3 w-3" /> Copiato
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" /> Copia
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Financial Summary Cards */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Copertura (P2+)
                  </div>
                  <div className="mt-1 text-sm font-extrabold tabular-nums text-sky-300">
                    <AnimatedNumber value={calc.hedgeTotal} formatter={(v) => formatEuro(v)} />
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Esborso Totale
                  </div>
                  <div className="mt-1 text-sm font-extrabold tabular-nums text-slate-100">
                    <AnimatedNumber value={calc.totalCashOutlay} formatter={(v) => formatEuro(v)} />
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
                    <TrendingUp className="h-3 w-3 text-emerald-400" />
                    {mode === 'rollover' ? 'Profitto Finale' : 'Profitto Netto'}
                  </div>
                  <div
                    data-testid="pp-calc-profit"
                    className={`mt-1 text-sm font-extrabold tabular-nums ${
                      calc.guaranteedProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    <AnimatedNumber
                      value={calc.guaranteedProfit}
                      formatter={(v) => formatEuro(v, true)}
                    />
                  </div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-400">
                    <Sparkles className="h-3 w-3 text-brand-400" />
                    Rating / Ritenzione
                  </div>
                  <div
                    data-testid="pp-calc-rating"
                    className={`mt-1 text-sm font-extrabold tabular-nums ${ratingTone(
                      calc.rating,
                      mode
                    )}`}
                  >
                    <AnimatedNumber value={calc.rating} formatter={(v) => formatPct(v)} />
                  </div>
                </div>
              </div>

              {/* Underlay / Balanced / Overlay Interactive Slider */}
              <div className="rounded-xl border border-slate-800/90 bg-slate-900/65 p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">
                    Bilanciamento (Underlay / Overlay)
                  </span>
                  <div className="flex gap-1">
                    {[
                      { label: 'Underlay', val: -1 },
                      { label: 'Bilanciato', val: 0 },
                      { label: 'Overlay', val: 1 },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        data-testid={`pp-drawer-balance-${preset.label.toLowerCase()}`}
                        onClick={() => setBalanceBias(preset.val)}
                        className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition ${
                          Math.abs(balanceBias - preset.val) < 0.05
                            ? 'border border-brand-400/40 bg-brand-400/25 text-brand-200'
                            : 'border border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
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
                  data-testid="pp-drawer-balance-slider"
                  onChange={(e) => setBalanceBias(parseFloat(e.target.value))}
                  className="pulse-slider w-full"
                />
                <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                  <span>Più profitto su Punta 1</span>
                  <span className="font-mono text-brand-300">
                    {balanceBias === 0
                      ? 'Equilibrato'
                      : balanceBias < 0
                      ? `Underlay ${Math.round(Math.abs(balanceBias) * 100)}%`
                      : `Overlay ${Math.round(balanceBias * 100)}%`}
                  </span>
                  <span>Più profitto su Coperture</span>
                </div>
              </div>

              {/* Outcome Payoff Simulation */}
              <div className="rounded-xl border border-slate-800/90 bg-slate-950/70 p-3.5">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  Simulazione Profitto Reale al Termine dell&apos;Evento
                </div>
                <div className="space-y-1.5">
                  {legs.map((leg, idx) => {
                    const netProfit = calc.profits[idx] ?? 0;
                    const maxAbs = Math.max(
                      1,
                      ...calc.profits.map((p) => Math.abs(p))
                    );
                    const pctWidth = Math.max(8, Math.round((Math.abs(netProfit) / maxAbs) * 100));
                    return (
                      <div
                        key={`sim-${leg.selectionKey}-${idx}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/60 bg-slate-900/50 px-3 py-2 text-xs"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <BookmakerIcon sourceId={leg.bookmakerId} size={18} />
                          <span className="truncate font-medium text-slate-200">
                            Se vince <strong className="text-white">{leg.selectionLabel}</strong>
                          </span>
                          <span className="hidden text-[10px] text-slate-500 sm:inline">
                            ({leg.bookmakerName})
                          </span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-800 sm:block">
                            <div
                              style={{ width: `${pctWidth}%` }}
                              className={`h-full rounded-full ${
                                netProfit >= 0 ? 'bg-emerald-400' : 'bg-rose-400'
                              }`}
                            />
                          </div>
                          <span
                            className={`w-20 text-right font-bold tabular-nums ${
                              netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {formatEuro(netProfit, true)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {mode === 'rollover' && calc.rollover && (
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-800/70 pt-2 text-[10px] text-slate-400">
                    <div className="flex justify-between gap-1">
                      <span>Rollover se vince P1:</span>
                      <span className="font-mono font-semibold text-amber-300">
                        {calc.rollover.futureRolloverCostIfWin > 0.005
                          ? `-${formatEuro(calc.rollover.futureRolloverCostIfWin)}`
                          : '€0,00'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-1">
                      <span>Rollover se vince Copertura:</span>
                      <span className="font-mono font-semibold text-emerald-300">
                        {calc.rollover.clearsRolloverOnLose
                          ? '€0,00 (Sblocco!)'
                          : `-${formatEuro(calc.rollover.futureRolloverCostIfLose)}`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-slate-800/80 bg-slate-950/80 px-5 py-3">
              <div className="text-[11px] text-slate-400">
                {savedBanner ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Operazione salvata nel Tracker Profitti!
                  </span>
                ) : (
                  <span>Cambia bookmaker o regola manualmente qualsiasi quota prima di puntare.</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-700 hover:text-white"
                >
                  Chiudi
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  data-testid="pp-calc-save"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 shadow-[0_0_16px_rgba(245,158,11,0.35)] transition hover:bg-brand-400"
                >
                  <Save className="h-3.5 w-3.5" />
                  Salva nel Tracker
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

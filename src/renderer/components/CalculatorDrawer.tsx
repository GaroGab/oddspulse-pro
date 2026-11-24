import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  BellPlus,
  BookmarkPlus,
  Calculator,
  Check,
  Copy,
  ExternalLink,
  Layers,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { calculateSingleMatch } from '../../shared/math';
import type {
  BetMode,
  OddsmatcherRow,
  TrackedBet,
  VerifyRowQuotesResult,
} from '../../shared/types';
import {
  formatEuro,
  formatEventTime,
  formatOdds,
  formatPct,
  formatQuoteAge,
} from '../utils/format';
import { playCopyTick } from '../utils/sound';
import { AnimatedNumber } from './AnimatedNumber';
import { BookmakerIcon } from './BookmakerIcon';
import { NumericInput } from './NumericInput';
import { SlidingPillTrack } from './SlidingPillTrack';

interface CalculatorDrawerProps {
  row: OddsmatcherRow | null;
  initialMode: BetMode;
  initialStake: number;
  drawerWidth: number;
  soundEnabled: boolean;
  onClose: () => void;
  onSaveBet: (bet: Omit<TrackedBet, 'id' | 'createdAt'>) => void;
  onLockToMultiodds: (row: OddsmatcherRow) => void;
  onCreateRatingWatch?: (row: OddsmatcherRow) => void;
}

const MODES: Array<{ id: BetMode; label: string; hint: string }> = [
  { id: 'normal', label: 'Normale', hint: 'Qualificante / Soldi Reali' },
  { id: 'snr', label: 'Freebet SNR', hint: 'Bonus Stake Not Returned' },
  { id: 'sr', label: 'Bonus SR', hint: 'Bonus Reale Stake Returned' },
  { id: 'rf', label: 'Rimborso RF', hint: 'Cashback se perdente' },
];

export const CalculatorDrawer: React.FC<CalculatorDrawerProps> = ({
  row,
  initialMode,
  initialStake,
  drawerWidth,
  soundEnabled,
  onClose,
  onSaveBet,
  onLockToMultiodds,
  onCreateRatingWatch,
}) => {
  const [mode, setMode] = useState<BetMode>(initialMode);
  const [stake, setStake] = useState(initialStake);
  const [backOdds, setBackOdds] = useState(row?.backOdds ?? 2.0);
  const [layOdds, setLayOdds] = useState(row?.layOdds ?? 2.04);
  const [commissionPct, setCommissionPct] = useState((row?.commission ?? 0.045) * 100);
  const [refundAmount, setRefundAmount] = useState(initialStake);
  const [refundRetention, setRefundRetention] = useState(70);
  const [balanceBias, setBalanceBias] = useState(0);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [liveLiquidity, setLiveLiquidity] = useState(row?.liquidity ?? 0);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyRowQuotesResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const userEditedBackRef = useRef(false);
  const userEditedLayRef = useRef(false);
  const verifySeqRef = useRef(0);
  const rowRef = useRef(row);
  rowRef.current = row;

  const rowId = row?.id ?? null;

  const runLiveVerify = useCallback(async (targetRow: OddsmatcherRow, forceApply = false) => {
    const api = window.oddspulse?.verifyRowQuotes;
    if (!api) return;
    const seq = ++verifySeqRef.current;
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await api({
        rowId: targetRow.id,
        eventKey: targetRow.eventKey,
        sport: targetRow.sport,
        eventName: targetRow.eventName,
        homeTeam: targetRow.homeTeam,
        awayTeam: targetRow.awayTeam,
        startTime: targetRow.startTime,
        marketType: targetRow.marketType,
        selectionKey: targetRow.selectionKey,
        bookmakerId: targetRow.bookmakerId,
        bookmakerName: targetRow.bookmakerName,
        bookmakerEventId: targetRow.bookmakerEventId,
        bookmakerMarketId: targetRow.bookmakerMarketId,
        bookmakerMetadata: targetRow.bookmakerMetadata,
        bookmakerSwapped: targetRow.bookmakerSwapped,
        previousBackOdds: targetRow.backOdds,
        exchangeId: targetRow.exchangeId,
        exchangeName: targetRow.exchangeName,
        exchangeEventId: targetRow.exchangeEventId,
        exchangeMarketId: targetRow.exchangeMarketId,
        exchangeMetadata: targetRow.exchangeMetadata,
        exchangeSwapped: targetRow.exchangeSwapped,
        previousLayOdds: targetRow.layOdds,
        previousLiquidity: targetRow.liquidity,
      });
      if (verifySeqRef.current !== seq) return;
      setVerifyResult(res);
      if (res.bookmaker.liveOdds && (forceApply || !userEditedBackRef.current)) {
        setBackOdds(res.bookmaker.liveOdds);
        if (forceApply) userEditedBackRef.current = false;
      }
      if (res.exchange.liveOdds && (forceApply || !userEditedLayRef.current)) {
        setLayOdds(res.exchange.liveOdds);
        if (forceApply) userEditedLayRef.current = false;
      }
      if (res.exchange.liveLiquidity !== undefined) {
        setLiveLiquidity(res.exchange.liveLiquidity);
      }
    } catch (err) {
      if (verifySeqRef.current !== seq) return;
      setVerifyError(err instanceof Error ? err.message : 'Verifica live non riuscita');
    } finally {
      if (verifySeqRef.current === seq) {
        setVerifying(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!row) {
      verifySeqRef.current++;
      setVerifying(false);
      setVerifyResult(null);
      setVerifyError(null);
      return;
    }
    userEditedBackRef.current = false;
    userEditedLayRef.current = false;
    setMode(initialMode);
    setStake(initialStake);
    setBackOdds(row.backOdds);
    setLayOdds(row.layOdds);
    setLiveLiquidity(row.liquidity);
    setCommissionPct(Math.round(row.commission * 1000) / 10);
    setRefundAmount(initialStake);
    setBalanceBias(0);
    setSaved(false);
    setVerifyResult(null);
    setVerifyError(null);
    // Immediately re-verify both bookmaker & exchange quotes live on open (~200-400ms)
    void runLiveVerify(row, false);
    // Reset only when opening a new row (or reopening after close), not on background scrape refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);

  useEffect(() => {
    if (!row) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [row, onClose]);

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
        balanceBias,
      }),
    [mode, stake, backOdds, layOdds, commissionPct, refundAmount, refundRetention, balanceBias]
  );

  const handleCopyLay = async () => {
    try {
      await navigator.clipboard.writeText(calc.layStake.toFixed(2));
      setCopied(true);
      if (soundEnabled) playCopyTick();
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const handleSave = () => {
    if (!row) return;
    onSaveBet({
      eventName: row.eventName,
      league: row.league,
      sport: row.sport,
      marketLabel: row.marketLabel,
      selectionLabel: row.selectionLabel,
      type: 'single',
      mode,
      bookmakerName: row.bookmakerName,
      exchangeName: row.exchangeName,
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
    setSaved(true);
    if (soundEnabled) playCopyTick();
  };

  const effectiveLiquidity = liveLiquidity > 0 ? liveLiquidity : row?.liquidity ?? 0;
  const liqInsufficient = row ? calc.layStake > effectiveLiquidity && effectiveLiquidity > 0 : false;
  const maxBar = Math.max(
    1,
    Math.abs(calc.bookieWinProfit),
    Math.abs(calc.exchangeWinProfit)
  );

  const verifySuspended = Boolean(
    verifyResult &&
      (verifyResult.bookmaker.status === 'suspended' || verifyResult.exchange.status === 'suspended')
  );
  const verifyChanged = Boolean(
    verifyResult &&
      !verifySuspended &&
      (verifyResult.bookmaker.status === 'changed' || verifyResult.exchange.status === 'changed')
  );
  const verifyConfirmed = Boolean(
    verifyResult &&
      !verifySuspended &&
      !verifyChanged &&
      (verifyResult.bookmaker.status === 'confirmed' || verifyResult.exchange.status === 'confirmed')
  );
  const verifyHasPendingManualSync = Boolean(
    verifyResult &&
      ((verifyResult.bookmaker.liveOdds &&
        Math.abs(verifyResult.bookmaker.liveOdds - backOdds) >= 0.005) ||
        (verifyResult.exchange.liveOdds &&
          Math.abs(verifyResult.exchange.liveOdds - layOdds) >= 0.005))
  );
  const effectiveCacheAgeSec = Math.max(
    verifyResult?.bookmaker.cacheAgeSec ?? row?.bookmakerCacheAgeSec ?? 0,
    verifyResult?.exchange.cacheAgeSec ?? row?.exchangeCacheAgeSec ?? 0
  );
  const rowFreshness = row ? formatQuoteAge(row.updatedAt) : null;

  const safeWidth = Number.isFinite(drawerWidth) ? drawerWidth : 520;
  const modalMaxWidth = Math.round(Math.max(460, Math.min(760, safeWidth)) / 2) * 2;

  return (
    <AnimatePresence>
      {row && (
        <>
          {/* Frosted Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            onClick={onClose}
            className="fixed inset-0 top-12 z-50 bg-slate-950/75 backdrop-blur-sm"
          />

          {/* Centered Floating Calculator Modal — crisp progressive tween that settles to transform: none at rest */}
          <div className="pointer-events-none fixed inset-0 top-12 z-50 flex items-center justify-center p-4">
            <motion.aside
              data-testid="calculator-modal"
              initial={{ opacity: 0, y: 16, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.985 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              style={{ maxWidth: `${modalMaxWidth}px` }}
              className="pointer-events-auto relative flex max-h-[calc(100vh-80px)] w-full flex-col overflow-hidden rounded-2xl border border-brand-400/35 bg-[var(--bg-modal-solid)] shadow-[0_24px_80px_rgba(0,0,0,0.88),0_0_40px_-14px_rgb(var(--brand-400)/0.3)]"
            >
              {/* Luminous top hairline */}
              <div className="aurora-bar h-[2px] w-full shrink-0" />
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-800/80 px-5 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-400/15 text-brand-300 border border-brand-400/30">
                    <Calculator className="h-4 w-4" />
                  </div>
                  <h2 className="font-display text-base font-bold text-white">
                    Calcolatore Punta-Banca Pro
                  </h2>
                  {calc.rating >= 100 && mode === 'normal' && (
                    <span className="surebet-badge rounded-full px-2 py-0.5 font-mono text-[10px] font-bold text-brand-200">
                      SUREBET
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs font-medium text-slate-300">{row.eventName}</p>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                  <span>{row.league}</span>
                  <span>•</span>
                  <span className="text-brand-300 font-medium">{row.marketLabel}</span>
                  <span>•</span>
                  <span>{formatEventTime(row.startTime).date} {formatEventTime(row.startTime).time}</span>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Chiudi calcolatore"
                data-testid="close-calculator"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-3.5">
              {/* Selection Spotlight */}
              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2.5">
                <div className="min-w-0 pr-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    Selezione Esito
                  </div>
                  <div className="truncate text-sm font-bold text-white">{row.selectionLabel}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-semibold text-white"
                    style={{ backgroundColor: `${row.bookmakerColor}28`, border: `1px solid ${row.bookmakerColor}66` }}
                  >
                    <BookmakerIcon sourceId={row.bookmakerId} size={20} className="rounded-[5px]" />
                    {row.bookmakerName}
                  </span>
                  <span className="text-slate-500">vs</span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-semibold text-white"
                    style={{ backgroundColor: `${row.exchangeColor}26`, border: `1px solid ${row.exchangeColor}66` }}
                  >
                    <BookmakerIcon sourceId={row.exchangeId} size={20} className="rounded-[5px]" />
                    {row.exchangeName}
                  </span>
                </div>
              </div>

              {/* Instant Live Verification Status Bar */}
              <div
                data-testid="calc-live-verify-bar"
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[11px] ${
                  verifySuspended
                    ? 'border-rose-500/45 bg-rose-500/15 text-rose-200'
                    : verifyChanged
                    ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
                    : verifyConfirmed
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                    : 'border-slate-800/90 bg-slate-900/60 text-slate-300'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {verifying ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-300" />
                      <span className="truncate font-medium text-brand-200">
                        Verifica quote live in corso su {row.bookmakerName} e {row.exchangeName}...
                      </span>
                    </>
                  ) : verifySuspended ? (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                      <span className="font-semibold">
                        Mercato sospeso o quota non più disponibile (
                        {verifyResult?.bookmaker.status === 'suspended' ? row.bookmakerName : ''}
                        {verifyResult?.bookmaker.status === 'suspended' &&
                        verifyResult?.exchange.status === 'suspended'
                          ? ' e '
                          : ''}
                        {verifyResult?.exchange.status === 'suspended' ? row.exchangeName : ''}) — controlla sul sito prima di puntare!
                      </span>
                    </>
                  ) : verifyChanged && verifyResult ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                      <span className="truncate">
                        <strong className="font-semibold">Quote aggiornate live</strong> (
                        {verifyResult.durationMs}ms):{' '}
                        {[
                          verifyResult.bookmaker.status === 'changed' &&
                          verifyResult.bookmaker.liveOdds &&
                          Math.abs(
                            verifyResult.bookmaker.liveOdds - verifyResult.bookmaker.previousOdds
                          ) >= 0.005
                            ? `Punta ${formatOdds(verifyResult.bookmaker.previousOdds)} → ${formatOdds(
                                verifyResult.bookmaker.liveOdds
                              )}`
                            : null,
                          verifyResult.exchange.status === 'changed' &&
                          verifyResult.exchange.liveOdds &&
                          Math.abs(
                            verifyResult.exchange.liveOdds - verifyResult.exchange.previousOdds
                          ) >= 0.005
                            ? `Banca ${formatOdds(verifyResult.exchange.previousOdds)} → ${formatOdds(
                                verifyResult.exchange.liveOdds
                              )}`
                            : verifyResult.exchange.status === 'changed' &&
                              verifyResult.exchange.liveLiquidity !== undefined &&
                              verifyResult.exchange.previousLiquidity !== undefined
                            ? `Liq ${formatEuro(verifyResult.exchange.previousLiquidity)} → ${formatEuro(
                                verifyResult.exchange.liveLiquidity
                              )}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </>
                  ) : verifyConfirmed && verifyResult ? (
                    <>
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="truncate">
                        <strong className="font-semibold">Quote confermate live</strong>{' '}
                        <span className="font-mono text-[10px] opacity-80">
                          ({verifyResult.durationMs}ms)
                        </span>
                        {effectiveCacheAgeSec >= 60 && (
                          <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                            Feed cache ~{Math.round(effectiveCacheAgeSec / 60)}m
                          </span>
                        )}
                        {effectiveCacheAgeSec < 60 && row.bookmakerIsAggregator && (
                          <span className="ml-1.5 text-[10px] text-slate-400">
                            • ADM aggregatore live
                          </span>
                        )}
                      </span>
                    </>
                  ) : verifyError ? (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span className="truncate text-amber-200">
                        Verifica live non disponibile ({verifyError})
                      </span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate text-slate-400">
                        Aggiornamento quota: {rowFreshness?.label ?? '--'}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {verifyHasPendingManualSync && verifyResult && (
                    <button
                      type="button"
                      data-testid="calc-apply-live-btn"
                      onClick={() => {
                        if (verifyResult.bookmaker.liveOdds) {
                          setBackOdds(verifyResult.bookmaker.liveOdds);
                          userEditedBackRef.current = false;
                        }
                        if (verifyResult.exchange.liveOdds) {
                          setLayOdds(verifyResult.exchange.liveOdds);
                          userEditedLayRef.current = false;
                        }
                      }}
                      className="rounded-lg border border-amber-400/50 bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-100 transition hover:bg-amber-400/35"
                    >
                      Applica live
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="calc-reverify-btn"
                    disabled={verifying}
                    onClick={() => {
                      const target = rowRef.current;
                      if (target) {
                        void runLiveVerify(
                          { ...target, backOdds, layOdds, liquidity: effectiveLiquidity },
                          true
                        );
                      }
                    }}
                    title="Ricontrolla subito le quote attuali su bookmaker ed exchange"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-950/75 px-2 py-0.5 text-[10px] font-semibold text-slate-200 transition hover:border-brand-400/50 hover:text-brand-200 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${verifying ? 'animate-spin' : ''}`} />
                    Ricontrolla
                  </button>
                </div>
              </div>

              {/* Mode Selector */}
              <SlidingPillTrack
                activeKey={mode}
                pillClassName="rounded-lg bg-gradient-to-r from-brand-300 to-accent-400 shadow-glow"
                className="grid grid-cols-4 gap-1 rounded-xl bg-slate-950/80 p-1 border border-slate-800/80"
              >
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    data-pill-key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`relative z-10 rounded-lg px-2 py-1.5 text-center text-xs font-semibold transition ${
                      mode === m.id ? 'text-slate-950' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title={m.hint}
                  >
                    {m.label}
                  </button>
                ))}
              </SlidingPillTrack>

              {/* Inputs Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-slate-800/90 bg-slate-900/65 p-2.5">
                  <label
                    htmlFor="calc-stake-input"
                    className="block truncate text-[11px] font-medium text-slate-400"
                  >
                    {mode === 'snr' ? 'Valore Freebet (€)' : 'Puntata Bookmaker (€)'}
                  </label>
                  <NumericInput
                    id="calc-stake-input"
                    data-testid="calc-stake-input"
                    min={0}
                    value={stake}
                    onChange={setStake}
                    placeholder="50"
                    className="mt-1 w-full rounded-lg border border-slate-700/80 bg-slate-950/90 px-2.5 py-1 font-mono text-sm font-bold text-white focus:border-brand-400 focus:outline-none"
                  />
                </div>

                <div className="rounded-xl border border-slate-800/90 bg-slate-900/65 p-2.5">
                  <div className="flex items-center justify-between gap-1">
                    <label
                      htmlFor="calc-comm-input"
                      className="block truncate text-[11px] font-medium text-slate-400"
                    >
                      Comm. (%)
                    </label>
                    <div className="flex shrink-0 gap-1">
                      {[
                        { l: '4.5%', v: 4.5, t: 'Betfair IT (4.5%)' },
                        { l: '5%', v: 5, t: 'Betflag EX (5%)' },
                        { l: '2%', v: 2, t: 'Smarkets / Promo (2%)' },
                      ].map((p) => (
                        <button
                          key={p.l}
                          type="button"
                          title={p.t}
                          onClick={() => setCommissionPct(p.v)}
                          className={`whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[9px] font-bold transition ${
                            Math.abs(commissionPct - p.v) < 0.05
                              ? 'bg-amber-400/25 text-amber-200 border border-amber-400/40'
                              : 'bg-slate-900 text-slate-500 hover:text-slate-200'
                          }`}
                        >
                          {p.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <NumericInput
                    id="calc-comm-input"
                    min={0}
                    max={20}
                    value={commissionPct}
                    onChange={setCommissionPct}
                    placeholder="4.5"
                    className="mt-1 w-full rounded-lg border border-slate-700/80 bg-slate-950/90 px-2.5 py-1 font-mono text-sm font-bold text-amber-300 focus:border-brand-400 focus:outline-none"
                  />
                </div>

                <div className="rounded-xl border border-slate-800/90 bg-slate-900/65 p-2.5">
                  <div className="flex items-center justify-between gap-1">
                    <label
                      htmlFor="calc-back-odds-input"
                      className="truncate text-[11px] font-medium text-blue-300"
                    >
                      Quota Punta
                    </label>
                    <span className="truncate text-[10px] text-slate-500">{row.bookmakerName}</span>
                  </div>
                  <NumericInput
                    id="calc-back-odds-input"
                    min={1.01}
                    value={backOdds}
                    onChange={(v) => {
                      userEditedBackRef.current = true;
                      setBackOdds(v);
                    }}
                    placeholder="2.00"
                    className="mt-1 w-full rounded-lg border border-blue-500/35 bg-blue-950/35 px-2.5 py-1 font-mono text-sm font-bold text-blue-200 focus:border-blue-400 focus:outline-none"
                  />
                </div>

                <div className="rounded-xl border border-slate-800/90 bg-slate-900/65 p-2.5">
                  <div className="flex items-center justify-between gap-1">
                    <label
                      htmlFor="calc-lay-odds-input"
                      className="truncate text-[11px] font-medium text-rose-300"
                    >
                      Quota Banca
                    </label>
                    <span className="shrink-0 font-mono text-[10px] text-slate-400">
                      Liq: {formatEuro(effectiveLiquidity)}
                    </span>
                  </div>
                  <NumericInput
                    id="calc-lay-odds-input"
                    min={1.01}
                    value={layOdds}
                    onChange={(v) => {
                      userEditedLayRef.current = true;
                      setLayOdds(v);
                    }}
                    placeholder="2.04"
                    className="mt-1 w-full rounded-lg border border-rose-500/35 bg-rose-950/35 px-2.5 py-1 font-mono text-sm font-bold text-rose-200 focus:border-rose-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* RF Mode Extra Parameters */}
              <AnimatePresence initial={false}>
                {mode === 'rf' && (
                  <motion.div
                    key="calc-drawer-rf"
                    data-testid="drawer-rf-panel"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-2 gap-3 rounded-xl border border-accent-500/30 bg-accent-600/20 p-3">
                      <div>
                        <label className="text-[11px] font-medium text-accent-300">
                          Bonus Rimborso (€)
                        </label>
                        <NumericInput
                          min={0}
                          value={refundAmount}
                          onChange={setRefundAmount}
                          placeholder="50"
                          className="mt-1 w-full rounded-lg border border-accent-500/35 bg-slate-950/90 px-3 py-1.5 font-mono text-sm font-bold text-white focus:border-accent-400 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-accent-300">
                          Ritenzione Bonus (%)
                        </label>
                        <NumericInput
                          min={0}
                          max={100}
                          value={refundRetention}
                          onChange={setRefundRetention}
                          placeholder="70"
                          className="mt-1 w-full rounded-lg border border-accent-500/35 bg-slate-950/90 px-3 py-1.5 font-mono text-sm font-bold text-white focus:border-accent-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* HERO RESULT: LAY STAKE & LIABILITY */}
              <div className="relative overflow-hidden rounded-2xl border border-brand-400/35 bg-gradient-to-br from-brand-500/14 via-slate-900/90 to-accent-500/14 p-3.5 shadow-glow">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-brand-300">
                      Importo da Bancare su {row.exchangeName}
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-2.5">
                      <AnimatedNumber
                        value={calc.layStake}
                        formatter={(v) => formatEuro(v)}
                        className="font-mono text-2xl font-extrabold text-white"
                      />
                      <span className="font-mono text-xs text-slate-400">
                        @ {formatOdds(layOdds)}
                      </span>
                    </div>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={handleCopyLay}
                    className="flex items-center gap-1.5 rounded-xl border border-brand-400/40 bg-brand-400/20 px-3 py-1.5 text-xs font-bold text-brand-100 transition hover:bg-brand-400/30"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copiato!' : 'Copia'}
                  </motion.button>
                </div>

                <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-2.5">
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Responsabilità</div>
                    <AnimatedNumber
                      value={calc.liability}
                      formatter={(v) => formatEuro(v)}
                      className="font-mono text-sm font-bold text-rose-300"
                    />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Rating Netto</div>
                    <AnimatedNumber
                      value={calc.rating}
                      formatter={(v) => formatPct(v)}
                      className={`font-mono text-sm font-bold ${
                        calc.rating >= 100
                          ? 'text-brand-300'
                          : calc.rating >= 95
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }`}
                    />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-slate-400">Rating Lordo</div>
                    <div className="font-mono text-sm font-bold text-slate-300">
                      {formatPct(calc.rawRating)}
                    </div>
                  </div>
                </div>

                <AnimatePresence initial={false}>
                  {liqInsufficient && (
                    <motion.div
                      key="calc-drawer-liq-warn"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-[11px] text-amber-200">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <span>
                          Attenzione: la liquidità immediata ({formatEuro(effectiveLiquidity)}) è inferiore alla bancata richiesta ({formatEuro(calc.layStake)}).
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Underlay / Balanced / Overlay Interactive Slider */}
              <div className="rounded-xl border border-slate-800/90 bg-slate-900/65 p-3">
                <div className="mb-1.5 flex items-center justify-between">
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
                        onClick={() => setBalanceBias(preset.val)}
                        className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition ${
                          Math.abs(balanceBias - preset.val) < 0.05
                            ? 'bg-brand-400/25 text-brand-200 border border-brand-400/40'
                            : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
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
                  onChange={(e) => setBalanceBias(parseFloat(e.target.value))}
                  className="pulse-slider w-full"
                />
                <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                  <span>Più profitto su Bookmaker</span>
                  <span>Equilibrato</span>
                  <span>Più profitto su Exchange</span>
                </div>
              </div>

              {/* Payoff Breakdown Visualization */}
              <div className="space-y-2.5 rounded-xl border border-slate-800/90 bg-slate-900/65 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">
                    Simulazione Esito Finale
                  </span>
                  <span className="flex items-center gap-1 font-mono text-xs font-bold text-slate-300">
                    <Sparkles className="h-3.5 w-3.5 text-brand-400" />
                    Media:{' '}
                    <span
                      className={
                        calc.expectedProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }
                    >
                      {formatEuro(calc.expectedProfit, true)}
                    </span>
                  </span>
                </div>

                {/* Bookmaker wins bar */}
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-slate-300">
                      Se vince <span className="font-semibold text-blue-300">{row.bookmakerName}</span>
                    </span>
                    <AnimatedNumber
                      value={calc.bookieWinProfit}
                      formatter={(v) => formatEuro(v, true)}
                      className={`font-mono font-bold ${
                        calc.bookieWinProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    />
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-900">
                    <motion.div
                      animate={{ width: `${Math.max(8, (Math.abs(calc.bookieWinProfit) / maxBar) * 100)}%` }}
                      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                      className={`h-full rounded-full ${
                        calc.bookieWinProfit >= -0.005
                          ? 'bg-gradient-to-r from-emerald-500 to-brand-400'
                          : 'bg-gradient-to-r from-rose-600 to-amber-500'
                      }`}
                    />
                  </div>
                </div>

                {/* Exchange wins bar */}
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-slate-300">
                      Se vince <span className="font-semibold text-amber-300">{row.exchangeName}</span>
                    </span>
                    <AnimatedNumber
                      value={calc.exchangeWinProfit}
                      formatter={(v) => formatEuro(v, true)}
                      className={`font-mono font-bold ${
                        calc.exchangeWinProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    />
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-900">
                    <motion.div
                      animate={{ width: `${Math.max(8, (Math.abs(calc.exchangeWinProfit) / maxBar) * 100)}%` }}
                      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                      className={`h-full rounded-full ${
                        calc.exchangeWinProfit >= -0.005
                          ? 'bg-gradient-to-r from-emerald-500 to-brand-400'
                          : 'bg-gradient-to-r from-rose-600 to-amber-500'
                      }`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="border-t border-slate-800/80 bg-slate-950/70 px-5 py-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSave}
                  disabled={saved}
                  className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
                    saved
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                      : 'bg-gradient-to-r from-brand-300 to-accent-400 text-slate-950 shadow-glow hover:brightness-110'
                  }`}
                >
                  {saved ? <Check className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
                  {saved ? 'Salvata nel Tracker!' : 'Salva nel Tracker'}
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    onLockToMultiodds(row);
                    onClose();
                  }}
                  className="flex items-center justify-center gap-2 rounded-xl border border-accent-400/40 bg-accent-500/15 px-4 py-2.5 text-xs font-bold text-accent-200 transition hover:bg-accent-500/25"
                >
                  <Layers className="h-4 w-4" />
                  Blocca in Multiodds
                </motion.button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {row.bookmakerUrl && (
                  <button
                    onClick={() => void window.oddspulse?.openExternal(row.bookmakerUrl!)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-700 hover:text-white"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Apri {row.bookmakerName}
                  </button>
                )}
                {row.exchangeUrl && (
                  <button
                    onClick={() => void window.oddspulse?.openExternal(row.exchangeUrl!)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-700 hover:text-white"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Apri {row.exchangeName}
                  </button>
                )}
                {onCreateRatingWatch && (
                  <button
                    type="button"
                    data-testid="calc-watch-rating-btn"
                    onClick={() => {
                      onCreateRatingWatch(row);
                      onClose();
                    }}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-brand-400/40 bg-brand-500/15 px-3 py-1.5 text-[11px] font-bold text-brand-200 transition hover:bg-brand-500/25"
                    title="Crea un alert automatico quando il rating raggiunge una soglia"
                  >
                    <BellPlus className="h-3.5 w-3.5" />
                    Monitora Rating
                  </button>
                )}
              </div>
            </div>
            </motion.aside>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

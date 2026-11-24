import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  ClipboardCheck,
  Clock,
  Copy,
  Filter,
  Layers,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { calculateSequentialMultiodds } from '../../shared/math';
import {
  sortMultipleLegs,
  validateManualMultipleCandidate,
  type ManualMultipleValidation,
} from '../../shared/multioddsValidation';
import { buildSavedMultipleInputFromPlan } from '../../shared/savedMultiples';
import {
  SOURCE_CATALOG,
  type BetMode,
  type OddsmatcherRow,
  type SavedMultiplePlan,
  type SavedMultiplePlanInput,
  type ScrapeSnapshot,
  type SportKey,
  type TrackedBet,
} from '../../shared/types';
import {
  formatEuro,
  formatEventTime,
  formatGap,
  formatOdds,
  formatPct,
  sportLabel,
} from '../utils/format';
import { playCopyTick } from '../utils/sound';
import { AnimatedNumber } from './AnimatedNumber';
import { BookmakerIcon } from './BookmakerIcon';
import { ConnectionAlert } from './ConnectionAlert';
import { CustomSelect } from './CustomSelect';
import { NumericInput } from './NumericInput';
import { SlidingPillTrack } from './SlidingPillTrack';
import { SourceMultiSelect } from './SourceSelect';

interface ManualMultioddsBuilderProps {
  snapshot: ScrapeSnapshot;
  isBrowserOnline: boolean;
  autoScrapeActive?: boolean;
  lockedRows: OddsmatcherRow[];
  soundEnabled: boolean;
  savedCount?: number;
  onSaveTrackedBet: (bet: Omit<TrackedBet, 'id' | 'createdAt'>) => void;
  onSaveMultiplePlan?: (
    plan: SavedMultiplePlan | SavedMultiplePlanInput
  ) => Promise<SavedMultiplePlan | null> | SavedMultiplePlan | null | void;
  onOpenSavedList?: (planId?: string) => void;
  onRetryScrape: () => void;
  onRestartAutoScrape?: () => void;
  onOpenScrapers: () => void;
}

const MAX_MANUAL_LEGS = 8;

export const ManualMultioddsBuilder: React.FC<ManualMultioddsBuilderProps> = React.memo(
  ({
    snapshot,
    isBrowserOnline,
    autoScrapeActive = true,
    lockedRows,
    soundEnabled,
    savedCount = 0,
    onSaveTrackedBet,
    onSaveMultiplePlan,
    onOpenSavedList,
    onRetryScrape,
    onRestartAutoScrape,
    onOpenScrapers,
  }) => {
    // Selected leg IDs + fallback row cache so background scrape refreshes update odds without losing picks
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const cachedRowsRef = useRef<Map<string, OddsmatcherRow>>(new Map());

    // Slip calculation parameters
    const [planName, setPlanName] = useState<string>('');
    const [mode, setMode] = useState<BetMode>('normal');
    const [stake, setStake] = useState<number>(50);
    const [bonusBoostPct, setBonusBoostPct] = useState<number>(0);
    const [minGapMinutes, setMinGapMinutes] = useState<number>(120);
    const [refundAmount, setRefundAmount] = useState<number>(25);
    const [refundRetention, setRefundRetention] = useState<number>(70);

    // Event browser filters
    const [search, setSearch] = useState<string>('');
    const [sport, setSport] = useState<SportKey | 'ALL'>('ALL');
    const [bookmakerFilters, setBookmakerFilters] = useState<string[]>([]);
    const [exchangeFilters, setExchangeFilters] = useState<string[]>([]);
    const [onlyEligible, setOnlyEligible] = useState<boolean>(false);
    const [pageSize, setPageSize] = useState<number>(60);

    // UI feedback
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [copiedPlan, setCopiedPlan] = useState<boolean>(false);
    const [savedSignature, setSavedSignature] = useState<string | null>(null);
    const [savedPlanState, setSavedPlanState] = useState<{ sig: string; id?: string } | null>(
      null
    );

    const rowMap = useMemo(() => {
      const m = new Map<string, OddsmatcherRow>();
      for (const r of snapshot.rows) {
        m.set(r.id, r);
      }
      return m;
    }, [snapshot.rows]);

    // Update cache with fresh ticks for selected legs
    for (const id of selectedIds) {
      const fresh = rowMap.get(id);
      if (fresh) cachedRowsRef.current.set(id, fresh);
    }

    const selectedLegs = useMemo(() => {
      const legs: OddsmatcherRow[] = [];
      for (const id of selectedIds) {
        const row = rowMap.get(id) ?? cachedRowsRef.current.get(id);
        if (row) legs.push(row);
      }
      return sortMultipleLegs(legs);
    }, [selectedIds, rowMap]);

    const lockedBookmakerId = selectedLegs[0]?.bookmakerId ?? null;
    const lockedBookmakerName = selectedLegs[0]?.bookmakerName ?? null;
    const effectiveBookmakerFilters = useMemo(
      () => (lockedBookmakerId ? [lockedBookmakerId] : bookmakerFilters),
      [lockedBookmakerId, bookmakerFilters]
    );

    const bookmakerOptions = useMemo(() => {
      const map = new Map<string, string>();
      for (const r of snapshot.rows) map.set(r.bookmakerId, r.bookmakerName);
      return Array.from(map.entries());
    }, [snapshot.rows]);

    const exchangeOptions = useMemo(
      () => SOURCE_CATALOG.filter((s) => s.kind === 'exchange'),
      []
    );

    const { visibleCatalog, totalMatchingFilters, eligibleCount, ineligibleCount } =
      useMemo(() => {
        const q = search.trim().toLowerCase();
        const nowMs = Date.now();
        const items: Array<{ row: OddsmatcherRow; validation: ManualMultipleValidation }> = [];

        let elig = 0;
        let inelig = 0;

        for (const row of snapshot.rows) {
          if (sport !== 'ALL' && row.sport !== sport) continue;
          if (exchangeFilters.length > 0 && !exchangeFilters.includes(row.exchangeId)) continue;

          // If user chose explicit bookmakers when slip is empty, filter by them
          if (
            !lockedBookmakerId &&
            bookmakerFilters.length > 0 &&
            !bookmakerFilters.includes(row.bookmakerId)
          ) {
            continue;
          }

          if (q) {
            const hay = `${row.eventName} ${row.league} ${row.selectionLabel} ${row.bookmakerName}`.toLowerCase();
            if (!hay.includes(q)) continue;
          }

          const validation = validateManualMultipleCandidate(row, selectedLegs, {
            minGapMinutes,
            maxLegs: MAX_MANUAL_LEGS,
            nowMs,
          });

          if (validation.eligible) elig++;
          else if (validation.reason !== 'already_selected') inelig++;

          if (onlyEligible && !validation.eligible && validation.reason !== 'already_selected') {
            continue;
          }

          items.push({ row, validation });
        }

        // Pin selected legs in step order at top; keep eligible & ineligible inline by Rating so "Solo Idonei" has immediate visual effect
        items.sort((a, b) => {
          const aSel = a.validation.reason === 'already_selected';
          const bSel = b.validation.reason === 'already_selected';
          if (aSel !== bSel) return aSel ? -1 : 1;
          if (aSel && bSel) {
            return (a.validation.conflictStepIndex ?? 0) - (b.validation.conflictStepIndex ?? 0);
          }
          return b.row.ratingNormal - a.row.ratingNormal;
        });

        return {
          visibleCatalog: items.slice(0, pageSize),
          totalMatchingFilters: items.length,
          eligibleCount: elig,
          ineligibleCount: inelig,
        };
      }, [
        snapshot.rows,
        search,
        sport,
        exchangeFilters,
        lockedBookmakerId,
        bookmakerFilters,
        selectedLegs,
        minGapMinutes,
        onlyEligible,
        pageSize,
      ]);

    const addLeg = (row: OddsmatcherRow, validation: ManualMultipleValidation) => {
      if (!validation.eligible) return;
      cachedRowsRef.current.set(row.id, row);
      setSelectedIds((prev) => (prev.includes(row.id) ? prev : [...prev, row.id]));
      if (soundEnabled) playCopyTick();
    };

    const removeLeg = (id: string) => {
      setSelectedIds((prev) => prev.filter((x) => x !== id));
    };

    const clearSlip = () => {
      setSelectedIds([]);
      setPlanName('');
      setSavedSignature(null);
      setSavedPlanState(null);
    };

    const importLockedRows = () => {
      const sorted = sortMultipleLegs(lockedRows);
      const next: OddsmatcherRow[] = [];
      for (const candidate of sorted) {
        const res = validateManualMultipleCandidate(candidate, next, {
          minGapMinutes,
          maxLegs: MAX_MANUAL_LEGS,
        });
        if (res.eligible) {
          cachedRowsRef.current.set(candidate.id, candidate);
          next.push(candidate);
        }
      }
      if (next.length > 0) {
        setSelectedIds(next.map((r) => r.id));
        if (soundEnabled) playCopyTick();
      }
    };

    // Compute exact sequential lay plan once at least 2 legs are chosen
    const plan = useMemo(() => {
      if (selectedLegs.length < 2 || stake <= 0) return null;
      return calculateSequentialMultiodds({
        rows: selectedLegs,
        mode,
        stake,
        bonusBoostPct,
        refundAmount,
        refundRetention,
        minGapRequiredMinutes: minGapMinutes,
      });
    }, [
      selectedLegs,
      mode,
      stake,
      bonusBoostPct,
      refundAmount,
      refundRetention,
      minGapMinutes,
    ]);

    const liquidityWarnings = useMemo(() => {
      if (!plan) return [];
      return plan.legs.filter(
        (step) => step.row.liquidity > 0 && step.layStake > step.row.liquidity
      );
    }, [plan]);

    const uniqueExchanges = useMemo(() => {
      const names = new Set(selectedLegs.map((l) => l.exchangeName));
      return Array.from(names);
    }, [selectedLegs]);

    const planSignature = plan
      ? `${plan.id}_${mode}_${stake}_${bonusBoostPct}_${refundAmount}_${refundRetention}`
      : '';
    const isSaved = Boolean(planSignature && savedSignature === planSignature);
    const isPlanSaved = Boolean(planSignature && savedPlanState?.sig === planSignature);

    const handleSaveInteractivePlan = async () => {
      if (!plan || !onSaveMultiplePlan) return;
      if (isPlanSaved && savedPlanState?.id) {
        onOpenSavedList?.(savedPlanState.id);
        return;
      }
      const input = buildSavedMultipleInputFromPlan({
        plan,
        mode,
        stake,
        bonusBoostPct,
        refundAmount,
        refundRetention,
        minGapMinutes,
        customName: planName,
      });
      const created = await onSaveMultiplePlan(input);
      setSavedPlanState({
        sig: planSignature,
        id: created && typeof created === 'object' ? created.id : undefined,
      });
      if (soundEnabled) playCopyTick();
    };

    const copyLayStake = async (key: string, amount: number) => {
      try {
        await navigator.clipboard.writeText(amount.toFixed(2));
        setCopiedKey(key);
        if (soundEnabled) playCopyTick();
        setTimeout(() => setCopiedKey(null), 1400);
      } catch {
        // Ignore clipboard errors
      }
    };

    const handleCopyFullPlan = async () => {
      if (!plan) return;
      const lines = [
        `[Multipla Manuale • ${plan.bookmakerName} • ${mode.toUpperCase()}] Puntata €${stake.toFixed(
          2
        )} | Quota Tot ${plan.boostedBackOdds.toFixed(2)} | Rating ${plan.rating.toFixed(
          2
        )}% | Profitto ${formatEuro(plan.guaranteedProfit, true)}`,
        ...plan.legs.map(
          (s) =>
            `STEP ${s.legIndex}: ${s.row.eventName} (${s.row.selectionLabel} @${s.backOdds.toFixed(
              2
            )}) -> Banca €${s.layStake.toFixed(2)} @${s.layOdds.toFixed(2)} su ${
              s.row.exchangeName
            } (Resp €${s.liability.toFixed(2)})`
        ),
      ];
      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        setCopiedPlan(true);
        if (soundEnabled) playCopyTick();
        setTimeout(() => setCopiedPlan(false), 1800);
      } catch {
        // Ignore clipboard errors
      }
    };

    const handleSavePlan = () => {
      if (!plan) return;
      onSaveTrackedBet({
        eventName: plan.legs.map((l) => l.row.eventName).join(' + '),
        league: `Multipla Manuale ${plan.legs.length} Eventi`,
        sport: plan.legs[0].row.sport,
        marketLabel: `Sequenziale (Gap ${formatGap(plan.minGapMinutes)})`,
        selectionLabel: plan.legs.map((l) => l.row.selectionLabel).join(' / '),
        type: 'multipla',
        mode,
        bookmakerName: plan.bookmakerName,
        exchangeName:
          uniqueExchanges.length > 1 ? `Multi-Exchange (${uniqueExchanges.length})` : plan.exchangeName,
        stake,
        backOdds: plan.boostedBackOdds,
        layOdds: plan.effectiveCombinedLayOdds,
        layStake: plan.legs[0].layStake,
        liability: plan.maxCumulativeLiability,
        commission: plan.legs[0].commission,
        expectedProfit: plan.guaranteedProfit,
        rating: plan.rating,
        status: 'pending',
        realizedProfit: plan.guaranteedProfit,
        notes: `Multipla Manuale ${plan.legs.length} leg | Bonus +${bonusBoostPct}%`,
      });
      setSavedSignature(planSignature);
      if (soundEnabled) playCopyTick();
    };

    return (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-12">
        {/* LEFT COLUMN: Live Events Catalog with Real-Time Validation */}
        <div className="flex min-h-0 flex-col gap-2.5 overflow-hidden lg:col-span-7">
          {/* Event Filters & Validation Counters */}
          <div className="glass-panel relative z-30 space-y-2.5 rounded-2xl p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative min-w-[190px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  data-testid="manual-search-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cerca evento, squadra, lega o esito..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/90 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-brand-400 focus:outline-none"
                />
              </div>

              <SlidingPillTrack
                activeKey={sport}
                pillClassName="rounded-lg bg-slate-800 shadow-inner"
                className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/80 p-0.5"
              >
                {(
                  [
                    { id: 'ALL', label: 'Tutti' },
                    { id: 'football', label: 'Calcio' },
                    { id: 'tennis', label: 'Tennis' },
                    { id: 'basketball', label: 'Basket' },
                  ] as Array<{ id: SportKey | 'ALL'; label: string }>
                ).map((sp) => (
                  <button
                    key={sp.id}
                    type="button"
                    data-pill-key={sp.id}
                    onClick={() => setSport(sp.id)}
                    className={`relative z-10 rounded-lg px-2 py-1 text-[11px] font-medium transition ${
                      sport === sp.id ? 'text-brand-300' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {sp.label}
                  </button>
                ))}
              </SlidingPillTrack>

              <button
                type="button"
                data-testid="manual-only-eligible"
                onClick={() => setOnlyEligible((v) => !v)}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  onlyEligible
                    ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                    : 'border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white'
                }`}
              >
                <Filter className="h-3 w-3" />
                Solo Idonei
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
                  <span>Bookmaker</span>
                  {lockedBookmakerName && (
                    <span className="flex items-center gap-1 text-brand-300 font-semibold">
                      <Lock className="h-2.5 w-2.5" /> Vincolato
                    </span>
                  )}
                </div>
                <SourceMultiSelect
                  data-testid="manual-bookmaker-select"
                  values={effectiveBookmakerFilters}
                  disabled={Boolean(lockedBookmakerId)}
                  allLabel="Tutti i bookmaker"
                  options={bookmakerOptions.map(([id, name]) => ({ id, name }))}
                  onChange={setBookmakerFilters}
                />
              </div>

              <div className="sm:col-span-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Exchange Copertura
                </div>
                <SourceMultiSelect
                  data-testid="manual-exchange-select"
                  values={exchangeFilters}
                  allLabel="Tutti gli Exchange"
                  options={exchangeOptions.map((ex) => ({ id: ex.id, name: ex.name }))}
                  onChange={setExchangeFilters}
                />
              </div>

              <div className="flex flex-col justify-end sm:col-span-4">
                {lockedRows.length > 0 && selectedLegs.length === 0 ? (
                  <button
                    type="button"
                    onClick={importLockedRows}
                    className="flex w-full items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-accent-400/40 bg-accent-500/15 px-2.5 py-1.5 text-[11px] font-bold text-accent-200 transition hover:bg-accent-500/25"
                  >
                    <Lock className="h-3 w-3" /> Importa ({lockedRows.length})
                  </button>
                ) : (
                  <div className="flex items-center justify-end gap-1.5 whitespace-nowrap py-1 text-[11px]">
                    <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono font-bold text-emerald-300">
                      {eligibleCount} idonei
                    </span>
                    {ineligibleCount > 0 && (
                      <span className="rounded-md bg-slate-800/90 px-2 py-0.5 font-mono text-slate-400">
                        {ineligibleCount} esclusi
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Live Validated Events Table */}
          <div className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
            {snapshot.rows.length === 0 &&
            !snapshot.stats.isRunning &&
            (!isBrowserOnline ||
              snapshot.connection.health === 'offline' ||
              snapshot.connection.failedSourcesCount > 0) ? (
              <ConnectionAlert
                snapshot={snapshot}
                isBrowserOnline={isBrowserOnline}
                variant="empty"
                onRetry={onRetryScrape}
                onOpenScrapers={onOpenScrapers}
              />
            ) : visibleCatalog.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <Layers className="h-8 w-8 text-slate-600" />
                <div className="text-sm font-semibold text-slate-300">
                  {snapshot.rows.length === 0
                    ? !autoScrapeActive && !snapshot.stats.isRunning
                      ? 'Aggiornamento automatico dello scraping fermo'
                      : 'In attesa delle quote live dallo scraper...'
                    : onlyEligible
                    ? 'Nessun evento idoneo compatibile con questi filtri'
                    : 'Nessun evento trovato con i filtri attuali'}
                </div>
                {snapshot.rows.length === 0 && !autoScrapeActive && !snapshot.stats.isRunning && (
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                    {onRestartAutoScrape && (
                      <button
                        type="button"
                        onClick={onRestartAutoScrape}
                        className="flex items-center gap-1.5 rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                        Riavvia Auto-Scraping
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onRetryScrape}
                      className="flex items-center gap-1.5 rounded-xl border border-brand-400/40 bg-brand-500/15 px-3 py-1.5 text-xs font-bold text-brand-200 hover:bg-brand-500/25"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Scansiona Ora
                    </button>
                  </div>
                )}
                {onlyEligible && ineligibleCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setOnlyEligible(false)}
                    className="mt-1 rounded-xl border border-brand-400/40 bg-brand-500/15 px-3 py-1.5 text-xs font-semibold text-brand-200 hover:bg-brand-500/25"
                  >
                    Mostra anche i {ineligibleCount} eventi esclusi
                  </button>
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-20 border-b border-slate-800 bg-[var(--bg-modal-solid)]">
                    <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-3 py-2.5">Data/Ora</th>
                      <th className="px-3 py-2.5">Evento & Esito</th>
                      <th className="px-2.5 py-2.5 text-right">Punta</th>
                      <th className="px-2.5 py-2.5 text-right">Banca</th>
                      <th className="px-2.5 py-2.5 text-right">Rating</th>
                      <th className="px-3 py-2.5 text-right">Multipla</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/55">
                    {visibleCatalog.map(({ row, validation }) => {
                      const tm = formatEventTime(row.startTime);
                      const isSelected = validation.reason === 'already_selected';
                      const isBlocked = !validation.eligible && !isSelected;

                      return (
                        <tr
                          key={row.id}
                          data-testid={`manual-event-row-${row.id}`}
                          data-eligible={String(validation.eligible)}
                          data-reason={validation.reason}
                          title={validation.detail ?? undefined}
                          className={`oddsmatcher-row transition-colors ${
                            isSelected
                              ? 'bg-brand-500/15'
                              : isBlocked
                              ? 'bg-slate-950/40 opacity-45'
                              : 'hover:bg-brand-500/10'
                          }`}
                        >
                          <td className="whitespace-nowrap px-3 py-2">
                            <div className="font-mono text-[11px] font-semibold text-slate-200">
                              {tm.date} <span className="text-brand-300">{tm.time}</span>
                            </div>
                            <div className="text-[10px] text-slate-500">{tm.relative}</div>
                          </td>

                          <td className="max-w-[220px] px-3 py-2">
                            <div className="truncate font-semibold text-white">{row.eventName}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                              <span className="rounded bg-slate-800 px-1 py-0.5 text-[9px] font-bold uppercase text-slate-300">
                                {sportLabel(row.sport)}
                              </span>
                              <span className="truncate font-medium text-brand-200">
                                {row.selectionLabel}
                              </span>
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-2.5 py-2 text-right">
                            <div className="inline-flex items-center justify-end gap-2">
                              <div className="flex flex-col items-end">
                                <div className="font-mono text-xs font-extrabold text-blue-300">
                                  {formatOdds(row.backOdds)}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {row.bookmakerName}
                                </div>
                              </div>
                              <BookmakerIcon sourceId={row.bookmakerId} size={22} className="rounded-[5px]" />
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-2.5 py-2 text-right">
                            <div className="font-mono text-xs font-extrabold text-rose-300">
                              {formatOdds(row.layOdds)}
                            </div>
                            <div className="font-mono text-[10px] text-slate-400">
                              Liq {formatEuro(row.liquidity)}
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-2.5 py-2 text-right">
                            <span
                              className={`font-mono text-xs font-bold ${
                                row.ratingNormal >= 100
                                  ? 'text-brand-300'
                                  : row.ratingNormal >= 95
                                  ? 'text-emerald-400'
                                  : 'text-amber-300'
                              }`}
                            >
                              {formatPct(row.ratingNormal)}
                            </span>
                          </td>

                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            {isSelected ? (
                              <div className="inline-flex items-center gap-1">
                                <span className="rounded-md border border-brand-400/50 bg-brand-400/20 px-2 py-1 font-mono text-[10px] font-bold text-brand-200">
                                  {validation.shortLabel}
                                </span>
                                <button
                                  type="button"
                                  data-testid={`manual-remove-${row.id}`}
                                  onClick={() => removeLeg(row.id)}
                                  aria-label={`Rimuovi ${row.eventName}`}
                                  className="rounded-md border border-rose-500/40 bg-rose-500/15 p-1 text-rose-300 transition hover:bg-rose-500/30"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ) : isBlocked ? (
                              <button
                                type="button"
                                disabled
                                data-testid={`manual-add-${row.id}`}
                                title={validation.detail ?? undefined}
                                className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-1 text-[10px] font-semibold text-slate-400"
                              >
                                <Clock className="h-3 w-3 shrink-0 text-amber-400/80" />
                                <span>{validation.shortLabel}</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-testid={`manual-add-${row.id}`}
                                onClick={() => addLeg(row, validation)}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-400 hover:text-slate-950"
                              >
                                <Plus className="h-3 w-3" />
                                Aggiungi
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {totalMatchingFilters > visibleCatalog.length && (
                  <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-950/80 px-3.5 py-2 text-[11px]">
                    <span className="text-slate-400">
                      Mostrati <strong className="text-white">{visibleCatalog.length}</strong> di{' '}
                      <strong className="text-brand-300">{totalMatchingFilters}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPageSize((s) => s + 60)}
                      className="rounded-lg border border-brand-400/35 bg-brand-500/10 px-2.5 py-1 font-semibold text-brand-200 hover:bg-brand-500/20"
                    >
                      Carica altri 60
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Multipla Builder Slip & Sequential Lay Calculator */}
        <div className="flex min-h-0 flex-col overflow-hidden lg:col-span-5">
          <div className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
            {/* Slip Header */}
            <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="font-display text-sm font-bold text-white truncate">
                  La Tua Multipla
                </h2>
                <span className="rounded-md border border-brand-400/40 bg-brand-400/15 px-2 py-0.5 font-mono text-[10px] font-extrabold text-brand-200">
                  {selectedLegs.length} / {MAX_MANUAL_LEGS}
                </span>
                {lockedBookmakerName && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-slate-200">
                    <BookmakerIcon sourceId={lockedBookmakerId!} size={18} />
                    <span className="truncate max-w-[90px]">{lockedBookmakerName}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                {savedCount > 0 && onOpenSavedList && (
                  <button
                    type="button"
                    data-testid="manual-open-saved-header"
                    onClick={() => onOpenSavedList()}
                    className="flex items-center gap-1 rounded-lg border border-brand-400/35 bg-brand-500/10 px-2 py-1 text-[10px] font-bold text-brand-200 transition hover:bg-brand-500/20"
                  >
                    <BookmarkCheck className="h-3 w-3" />
                    Salvati ({savedCount})
                  </button>
                )}
                {selectedLegs.length > 0 && (
                  <button
                    type="button"
                    data-testid="manual-clear-slip"
                    onClick={clearSlip}
                    className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-rose-300 transition hover:border-rose-500/40 hover:bg-rose-500/15"
                  >
                    <Trash2 className="h-3 w-3" />
                    Svuota
                  </button>
                )}
              </div>
            </div>

            {/* Slip Parameters Strip */}
            <div className="grid grid-cols-2 gap-2 border-b border-slate-800/80 bg-slate-950/50 px-4 py-2.5 sm:grid-cols-4">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500">
                  Modalità
                </label>
                <CustomSelect<BetMode>
                  data-testid="manual-mode-select"
                  size="sm"
                  className="mt-1"
                  minMenuWidth={155}
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'normal', label: 'Normale' },
                    { value: 'snr', label: 'Freebet SNR' },
                    { value: 'sr', label: 'Bonus SR' },
                    { value: 'rf', label: 'Rimborso RF' },
                  ]}
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500">
                  Puntata (€)
                </label>
                <NumericInput
                  data-testid="manual-stake-input"
                  min={1}
                  value={stake}
                  onChange={setStake}
                  placeholder="50"
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[11px] font-bold text-brand-200 focus:border-brand-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500">
                  Bonus (%)
                </label>
                <NumericInput
                  min={0}
                  max={100}
                  value={bonusBoostPct}
                  onChange={setBonusBoostPct}
                  placeholder="0"
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[11px] font-bold text-amber-300 focus:border-brand-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500">
                  Gap Minimo
                </label>
                <CustomSelect<number>
                  data-testid="manual-gap-select"
                  size="sm"
                  className="mt-1"
                  minMenuWidth={205}
                  value={minGapMinutes}
                  onChange={setMinGapMinutes}
                  triggerClassName="text-emerald-300"
                  options={[
                    { value: 120, label: 'Min 2h', hint: 'Consigliato', dotColor: 'bg-emerald-400' },
                    { value: 150, label: 'Min 2h 30m', hint: 'Sicuro', dotColor: 'bg-emerald-400' },
                    { value: 180, label: 'Min 3h', hint: 'Ampio', dotColor: 'bg-brand-300' },
                  ]}
                />
              </div>

              {mode === 'rf' && (
                <>
                  <div className="col-span-1 sm:col-span-2">
                    <label className="text-[10px] uppercase tracking-wider text-accent-300">
                      Rimborso Multipla (€)
                    </label>
                    <NumericInput
                      min={0}
                      value={refundAmount}
                      onChange={setRefundAmount}
                      placeholder="25"
                      className="mt-1 w-full rounded-lg border border-accent-500/40 bg-slate-950 px-2 py-1 font-mono text-[11px] font-bold text-white focus:border-accent-400 focus:outline-none"
                    />
                  </div>
                  <div className="col-span-1 sm:col-span-2">
                    <label className="text-[10px] uppercase tracking-wider text-accent-300">
                      Ritenzione Bonus (%)
                    </label>
                    <NumericInput
                      min={0}
                      max={100}
                      value={refundRetention}
                      onChange={setRefundRetention}
                      placeholder="70"
                      className="mt-1 w-full rounded-lg border border-accent-500/40 bg-slate-950 px-2 py-1 font-mono text-[11px] font-bold text-white focus:border-accent-400 focus:outline-none"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Scrollable Slip Body */}
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3.5">
              {selectedLegs.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-5 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-brand-400/35 bg-brand-400/15 text-brand-300">
                    <Layers className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">
                      Costruisci la tua Multipla Sequenziale
                    </div>
                    <p className="mt-1 max-w-xs text-[11px] text-slate-400">
                      Seleziona almeno <strong className="text-slate-200">2 eventi</strong> dalla lista a sinistra per calcolare le bancate passo-passo.
                    </p>
                  </div>
                  <div className="w-full space-y-1.5 rounded-xl border border-slate-800/80 bg-slate-900/60 p-3 text-left text-[11px] text-slate-300">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span>Stesso bookmaker automatico dopo il 1° evento</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 shrink-0 text-brand-300" />
                      <span>Almeno 2 ore di distanza tra partite consecutive</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span>Blocco automatico doppioni e match senza liquidità</span>
                    </div>
                  </div>
                </div>
              ) : selectedLegs.length === 1 ? (
                <div className="space-y-3">
                  {(() => {
                    const row = selectedLegs[0];
                    const tm = formatEventTime(row.startTime);
                    return (
                      <div className="rounded-xl border border-brand-400/35 bg-slate-900/80 p-3">
                        <div className="flex items-center justify-between">
                          <span className="rounded-md border border-accent-400/40 bg-accent-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-accent-200">
                            STEP 1
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-slate-400">
                              {tm.date} <strong className="text-brand-300">{tm.time}</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => removeLeg(row.id)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-rose-300"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="mt-1.5 text-xs font-bold text-white">{row.eventName}</div>
                        <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                          <span>{row.selectionLabel}</span>
                          <span className="font-mono font-bold text-blue-300">
                            Punta @{formatOdds(row.backOdds)}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-[11px] text-amber-200">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <span>
                      Seleziona almeno un altro evento idoneo (distante almeno{' '}
                      <strong>{formatGap(minGapMinutes)}</strong>) dalla lista a sinistra per generare il piano di bancate.
                    </span>
                  </div>
                </div>
              ) : (
                plan && (
                  <>
                    {/* Hero Plan Summary */}
                    <div className="relative overflow-hidden rounded-xl border border-brand-400/40 bg-gradient-to-br from-brand-500/15 via-[var(--bg-modal-solid)] to-accent-500/15 p-3">
                      <div className="aurora-bar absolute inset-x-0 top-0 h-[2px]" />

                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-slate-400">
                            Rating Netto
                          </div>
                          <AnimatedNumber
                            value={plan.rating}
                            durationMs={200}
                            formatter={(v) => formatPct(v)}
                            className={`font-mono text-base font-extrabold ${
                              plan.rating >= 100
                                ? 'text-brand-300'
                                : plan.rating >= 90
                                ? 'text-emerald-400'
                                : 'text-amber-300'
                            }`}
                          />
                        </div>

                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-slate-400">
                            Profitto
                          </div>
                          <AnimatedNumber
                            value={plan.guaranteedProfit}
                            durationMs={200}
                            formatter={(v) => formatEuro(v, true)}
                            className={`font-mono text-base font-extrabold ${
                              plan.guaranteedProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          />
                        </div>

                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-slate-400">
                            Quota Tot
                          </div>
                          <div className="font-mono text-base font-extrabold text-blue-300">
                            {formatOdds(plan.boostedBackOdds)}
                          </div>
                        </div>

                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-slate-400">
                            Resp. Max
                          </div>
                          <div className="font-mono text-base font-extrabold text-rose-300">
                            {formatEuro(plan.maxCumulativeLiability)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-800/80 pt-2 text-[10px]">
                        {plan.nonOverlapping ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
                            <ShieldCheck className="h-3 w-3" />
                            Sequenza valida • Gap min {formatGap(plan.minGapMinutes)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 font-semibold text-rose-200">
                            <AlertTriangle className="h-3 w-3" />
                            Gap attuale {formatGap(plan.minGapMinutes)} (&lt; {formatGap(minGapMinutes)})
                          </span>
                        )}

                        {uniqueExchanges.length > 1 && (
                          <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-300">
                            {uniqueExchanges.length} Exchange
                          </span>
                        )}
                      </div>

                      {liquidityWarnings.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-[10px] text-amber-200">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                          <span>
                            Liquidità inferiore alla bancata su Step{' '}
                            {liquidityWarnings.map((w) => w.legIndex).join(', ')}.
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Chronological Step Cards */}
                    <div className="space-y-2">
                      {plan.legs.map((step) => {
                        const tm = formatEventTime(step.row.startTime);
                        const copyId = `manual_${step.row.id}`;
                        const lowLiq =
                          step.row.liquidity > 0 && step.layStake > step.row.liquidity;

                        return (
                          <div
                            key={step.row.id}
                            data-testid={`manual-step-${step.legIndex}`}
                            className="rounded-xl border border-slate-800 bg-slate-900/75 p-2.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="rounded-md border border-accent-400/35 bg-accent-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent-200">
                                  STEP {step.legIndex}
                                </span>
                                <span className="font-mono text-[10px] text-slate-400">
                                  {tm.date} <strong className="text-brand-300">{tm.time}</strong>
                                </span>
                                {step.gapMinutesFromPrev !== null && (
                                  <span
                                    className={`font-mono text-[10px] font-bold ${
                                      step.gapMinutesFromPrev >= minGapMinutes
                                        ? 'text-emerald-400'
                                        : 'text-rose-400'
                                    }`}
                                  >
                                    (+{formatGap(step.gapMinutesFromPrev)})
                                  </span>
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={() => removeLeg(step.row.id)}
                                aria-label={`Rimuovi Step ${step.legIndex}`}
                                className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-rose-300"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <div className="mt-1 truncate text-xs font-bold text-white">
                              {step.row.eventName}
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-400">
                              <span className="truncate font-medium text-brand-200">
                                {step.row.selectionLabel}
                              </span>
                              <span className="shrink-0 font-mono text-blue-300">
                                Punta @{formatOdds(step.backOdds)}
                              </span>
                            </div>

                            <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-950/85 px-2.5 py-1.5">
                              <div>
                                <div className="text-[10px] text-slate-500">
                                  Banca su {step.row.exchangeName} @{formatOdds(step.layOdds)}
                                </div>
                                <div className="font-mono text-sm font-extrabold text-white">
                                  {formatEuro(step.layStake)}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void copyLayStake(copyId, step.layStake)}
                                className="flex items-center gap-1 rounded-lg border border-brand-400/35 bg-brand-500/15 px-2 py-1 text-[10px] font-bold text-brand-200 transition hover:bg-brand-400 hover:text-slate-950"
                              >
                                {copiedKey === copyId ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                                {copiedKey === copyId ? 'OK' : 'Copia'}
                              </button>
                            </div>

                            <div className="mt-1.5 flex items-center justify-between text-[10px]">
                              <span className="text-slate-400">
                                Resp:{' '}
                                <strong className="font-mono text-rose-300">
                                  {formatEuro(step.liability)}
                                </strong>
                              </span>
                              <span className={lowLiq ? 'font-bold text-amber-300' : 'text-slate-400'}>
                                Liq:{' '}
                                <strong className="font-mono">
                                  {formatEuro(step.row.liquidity)}
                                </strong>
                              </span>
                              <span className="text-slate-400">
                                Se perde:{' '}
                                <strong
                                  className={`font-mono ${
                                    step.profitIfLostHere >= -0.005
                                      ? 'text-emerald-400'
                                      : 'text-rose-400'
                                  }`}
                                >
                                  {formatEuro(step.profitIfLostHere, true)}
                                </strong>
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Neutrality Outcome Proof Strip */}
                    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-[10px] text-slate-300">
                      <div className="font-semibold text-emerald-300 mb-1">
                        Esiti Sequenziali Bilanciati:
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
                        {plan.legs.map((s) => (
                          <span key={s.legIndex}>
                            Persa S{s.legIndex}:{' '}
                            <strong
                              className={
                                s.profitIfLostHere >= -0.005 ? 'text-emerald-400' : 'text-rose-300'
                              }
                            >
                              {formatEuro(s.profitIfLostHere, true)}
                            </strong>
                          </span>
                        ))}
                        <span>
                          Tutte vinte:{' '}
                          <strong
                            className={
                              plan.profitIfAllWin >= -0.005 ? 'text-emerald-400' : 'text-rose-300'
                            }
                          >
                            {formatEuro(plan.profitIfAllWin, true)}
                          </strong>
                        </span>
                      </div>
                    </div>
                  </>
                )
              )}
            </div>

            {/* Sticky Slip Footer Actions */}
            {plan && (
              <div className="space-y-2 border-t border-slate-800/80 bg-slate-950/75 px-3.5 py-2.5">
                <input
                  type="text"
                  data-testid="manual-plan-name-input"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="Nome piano opzionale (es. Multipla Serie A)..."
                  className="w-full rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1 text-[11px] text-white placeholder-slate-500 focus:border-brand-400 focus:outline-none"
                />
                <div className="grid grid-cols-12 gap-1.5">
                  {onSaveMultiplePlan ? (
                    <button
                      type="button"
                      data-testid="manual-save-plan-btn"
                      onClick={() => void handleSaveInteractivePlan()}
                      className={`col-span-6 flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-extrabold transition ${
                        isPlanSaved
                          ? 'border border-emerald-400/45 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                          : 'bg-gradient-to-r from-brand-300 to-accent-400 text-slate-950 shadow-glow hover:brightness-110'
                      }`}
                    >
                      <BookmarkCheck className="h-3.5 w-3.5" />
                      {isPlanSaved ? 'Salvato · Apri' : 'Salva Piano'}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    data-testid="manual-save-plan"
                    onClick={handleSavePlan}
                    disabled={isSaved}
                    title="Registra nel Tracker Profitti"
                    className={`${
                      onSaveMultiplePlan ? 'col-span-3' : 'col-span-6'
                    } flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-bold transition ${
                      isSaved
                        ? 'border border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
                        : 'border border-slate-700 bg-slate-900 text-slate-200 hover:border-brand-400/45 hover:text-white'
                    }`}
                  >
                    {isSaved ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <BookmarkPlus className="h-3.5 w-3.5 text-brand-300" />
                    )}
                    {isSaved ? 'OK' : 'Tracker'}
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyFullPlan}
                    className={`${
                      onSaveMultiplePlan ? 'col-span-3' : 'col-span-6'
                    } flex items-center justify-center gap-1 rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 text-[11px] font-bold text-slate-200 transition hover:border-brand-400/45 hover:text-white`}
                  >
                    {copiedPlan ? (
                      <ClipboardCheck className="h-3.5 w-3.5 text-emerald-300" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-brand-300" />
                    )}
                    {copiedPlan ? 'OK' : 'Copia'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);

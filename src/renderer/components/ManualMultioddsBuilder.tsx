import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Ban,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  ClipboardCheck,
  Clock,
  Coins,
  Copy,
  Filter,
  Flame,
  Gift,
  Layers,
  Lock,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import {
  formatScrapeDateWindowLabel,
  needsFutureDateScrape,
  resolveScrapeDateWindow,
} from '../../shared/dateRange';
import { calculateSequentialMultiodds, computeAutoRolloverRating } from '../../shared/math';
import {
  filterManualMultioddsCatalog,
  sortMultipleLegs,
  validateManualMultipleCandidate,
  type ManualMultipleValidation,
} from '../../shared/multioddsValidation';
import {
  buildCompetitionOptions,
  getTopCompetitionValues,
} from '../../shared/ratingWatch';
import { buildSavedMultipleInputFromPlan } from '../../shared/savedMultiples';
import {
  type BetMode,
  type MarketType,
  type OddsmatcherRow,
  type RolloverWalletRule,
  type SavedMultiplePlan,
  type SavedMultiplePlanInput,
  type ScrapeSnapshot,
  type SourceId,
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
import { CustomMultiSelect, CustomSelect } from './CustomSelect';
import {
  DateRangeCalendar,
  EMPTY_DATE_RANGE,
  toLocalDateKey,
  type DateRangeValue,
} from './DateRangeCalendar';
import { NumericInput } from './NumericInput';
import { QuickPresetsMenu, type QuickPresetItem } from './QuickPresetsMenu';
import { RolloverParamsPanel } from './RolloverParamsPanel';
import { SlidingPillTrack } from './SlidingPillTrack';
import {
  buildBookmakerSourceOptions,
  buildExchangeSourceOptions,
  SourceMultiSelect,
} from './SourceSelect';

export interface ManualMultioddsState {
  selectedRows: OddsmatcherRow[];
  planName: string;
  mode: BetMode;
  stake: number;
  bonusBoostPct: number;
  minGapMinutes: number;
  refundAmount: number;
  refundRetention: number;
  realBalance: number;
  bonusBalance: number;
  rolloverRemaining: number;
  autoEstimatedRating: boolean;
  manualEstimatedRating: number;
  rolloverWalletRule: RolloverWalletRule;
  search: string;
  sport: SportKey | 'ALL';
  leagues: string[];
  market: MarketType | 'ALL';
  bookmakerFilters: string[];
  exchangeFilters: string[];
  minLegOdds: number;
  maxLegOdds: number;
  minRating: number;
  minLiquidity: number;
  dateRange: DateRangeValue;
  onlySurebets: boolean;
  noSurebets: boolean;
  onlyEligible: boolean;
  pageSize: number;
}

export function createDefaultManualMultioddsState(): ManualMultioddsState {
  return {
    selectedRows: [],
    planName: '',
    mode: 'normal',
    stake: 50,
    bonusBoostPct: 0,
    minGapMinutes: 120,
    refundAmount: 25,
    refundRetention: 70,
    realBalance: 100,
    bonusBalance: 100,
    rolloverRemaining: 500,
    autoEstimatedRating: true,
    manualEstimatedRating: 96,
    rolloverWalletRule: 'mixed',
    search: '',
    sport: 'ALL',
    leagues: [],
    market: 'ALL',
    bookmakerFilters: [],
    exchangeFilters: [],
    minLegOdds: 1.01,
    maxLegOdds: 25,
    minRating: 0,
    minLiquidity: 0,
    dateRange: EMPTY_DATE_RANGE,
    onlySurebets: false,
    noSurebets: false,
    onlyEligible: false,
    pageSize: 60,
  };
}

interface ManualMultioddsBuilderProps {
  snapshot: ScrapeSnapshot;
  enabledSources?: Partial<Record<SourceId, boolean>>;
  isBrowserOnline: boolean;
  autoScrapeActive?: boolean;
  lockedRows: OddsmatcherRow[];
  soundEnabled: boolean;
  savedCount?: number;
  persistedState?: ManualMultioddsState;
  onChangePersistedState?: React.Dispatch<React.SetStateAction<ManualMultioddsState>>;
  onSaveTrackedBet: (bet: Omit<TrackedBet, 'id' | 'createdAt'>) => void;
  onSaveMultiplePlan?: (
    plan: SavedMultiplePlan | SavedMultiplePlanInput
  ) => Promise<SavedMultiplePlan | null> | SavedMultiplePlan | null | void;
  onOpenSavedList?: (planId?: string) => void;
  onDateRangeFilterChange?: (
    next: DateRangeValue,
    opts?: { pendingEnd?: boolean; force?: boolean }
  ) => void;
  onRetryScrape: () => void;
  onRestartAutoScrape?: () => void;
  onOpenScrapers: () => void;
}

const MAX_MANUAL_LEGS = 8;

export const ManualMultioddsBuilder: React.FC<ManualMultioddsBuilderProps> = React.memo(
  ({
    snapshot,
    enabledSources,
    isBrowserOnline,
    autoScrapeActive = true,
    lockedRows,
    soundEnabled,
    savedCount = 0,
    persistedState,
    onChangePersistedState,
    onSaveTrackedBet,
    onSaveMultiplePlan,
    onOpenSavedList,
    onDateRangeFilterChange,
    onRetryScrape,
    onRestartAutoScrape,
    onOpenScrapers,
  }) => {
    const [localState, setLocalState] = useState<ManualMultioddsState>(() =>
      createDefaultManualMultioddsState()
    );
    const state = persistedState ?? localState;
    const setState = onChangePersistedState ?? setLocalState;

    const {
      selectedRows,
      planName,
      mode,
      stake,
      bonusBoostPct,
      minGapMinutes,
      refundAmount,
      refundRetention,
      realBalance,
      bonusBalance,
      rolloverRemaining,
      autoEstimatedRating,
      manualEstimatedRating,
      rolloverWalletRule,
      search,
      sport,
      leagues,
      market,
      bookmakerFilters,
      exchangeFilters,
      minLegOdds,
      maxLegOdds,
      minRating,
      minLiquidity,
      dateRange,
      onlySurebets,
      noSurebets,
      onlyEligible,
      pageSize,
    } = state;

    const setPlanName = useCallback(
      (v: string) => setState((prev) => ({ ...prev, planName: v })),
      [setState]
    );
    const setMode = useCallback(
      (v: BetMode) => setState((prev) => ({ ...prev, mode: v })),
      [setState]
    );
    const setStake = useCallback(
      (v: number) => setState((prev) => ({ ...prev, stake: v })),
      [setState]
    );
    const setBonusBoostPct = useCallback(
      (v: number) => setState((prev) => ({ ...prev, bonusBoostPct: v })),
      [setState]
    );
    const setMinGapMinutes = useCallback(
      (v: number) => setState((prev) => ({ ...prev, minGapMinutes: v })),
      [setState]
    );
    const setRefundAmount = useCallback(
      (v: number) => setState((prev) => ({ ...prev, refundAmount: v })),
      [setState]
    );
    const setRefundRetention = useCallback(
      (v: number) => setState((prev) => ({ ...prev, refundRetention: v })),
      [setState]
    );
    const setRealBalance = useCallback(
      (v: number) => setState((prev) => ({ ...prev, realBalance: v })),
      [setState]
    );
    const setBonusBalance = useCallback(
      (v: number) => setState((prev) => ({ ...prev, bonusBalance: v })),
      [setState]
    );
    const setRolloverRemaining = useCallback(
      (v: number) => setState((prev) => ({ ...prev, rolloverRemaining: v })),
      [setState]
    );
    const setAutoEstimatedRating = useCallback(
      (v: boolean) => setState((prev) => ({ ...prev, autoEstimatedRating: v })),
      [setState]
    );
    const setManualEstimatedRating = useCallback(
      (v: number) => setState((prev) => ({ ...prev, manualEstimatedRating: v })),
      [setState]
    );
    const setRolloverWalletRule = useCallback(
      (v: RolloverWalletRule) => setState((prev) => ({ ...prev, rolloverWalletRule: v })),
      [setState]
    );
    const setSearch = useCallback(
      (v: string) => setState((prev) => ({ ...prev, search: v })),
      [setState]
    );
    const setSport = useCallback(
      (v: SportKey | 'ALL') => setState((prev) => ({ ...prev, sport: v })),
      [setState]
    );
    const setLeagues = useCallback(
      (v: string[]) => setState((prev) => ({ ...prev, leagues: v })),
      [setState]
    );
    const setMarket = useCallback(
      (v: MarketType | 'ALL') => setState((prev) => ({ ...prev, market: v })),
      [setState]
    );
    const setBookmakerFilters = useCallback(
      (v: string[]) => setState((prev) => ({ ...prev, bookmakerFilters: v })),
      [setState]
    );
    const setExchangeFilters = useCallback(
      (v: string[]) => setState((prev) => ({ ...prev, exchangeFilters: v })),
      [setState]
    );
    const setMinLegOdds = useCallback(
      (v: number) => setState((prev) => ({ ...prev, minLegOdds: v })),
      [setState]
    );
    const setMaxLegOdds = useCallback(
      (v: number) => setState((prev) => ({ ...prev, maxLegOdds: v })),
      [setState]
    );
    const setMinRating = useCallback(
      (v: number) => setState((prev) => ({ ...prev, minRating: v })),
      [setState]
    );
    const setMinLiquidity = useCallback(
      (v: number) => setState((prev) => ({ ...prev, minLiquidity: v })),
      [setState]
    );
    const setOnlyEligible = useCallback(
      (v: boolean | ((prev: boolean) => boolean)) =>
        setState((prev) => ({
          ...prev,
          onlyEligible: typeof v === 'function' ? v(prev.onlyEligible) : v,
        })),
      [setState]
    );

    const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(false);

    useEffect(() => {
      if (!showAdvancedFilters) return;
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setShowAdvancedFilters(false);
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [showAdvancedFilters]);

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

    const selectedLegs = useMemo(() => {
      const legs = selectedRows.map((row) => rowMap.get(row.id) ?? row);
      return sortMultipleLegs(legs);
    }, [selectedRows, rowMap]);

    const lockedBookmakerId = selectedLegs[0]?.bookmakerId ?? null;
    const lockedBookmakerName = selectedLegs[0]?.bookmakerName ?? null;
    const effectiveBookmakerFilters = useMemo(
      () => (lockedBookmakerId ? [lockedBookmakerId] : bookmakerFilters),
      [lockedBookmakerId, bookmakerFilters]
    );

    const bookmakerOptions = useMemo(
      () => buildBookmakerSourceOptions(snapshot, enabledSources),
      [snapshot, enabledSources]
    );

    const exchangeOptions = useMemo(
      () => buildExchangeSourceOptions(snapshot, enabledSources),
      [snapshot, enabledSources]
    );

    const competitionOptions = useMemo(
      () => buildCompetitionOptions(snapshot.rows, sport === 'ALL' ? undefined : sport, leagues),
      [snapshot.rows, sport, leagues]
    );

    const topCompetitionsForSport = useMemo(() => getTopCompetitionValues(sport), [sport]);

    const isTopCompetitionsActive = useMemo(() => {
      if (topCompetitionsForSport.length === 0) return false;
      if (leagues.length !== topCompetitionsForSport.length) return false;
      const selected = new Set(leagues);
      return topCompetitionsForSport.every((comp) => selected.has(comp));
    }, [leagues, topCompetitionsForSport]);

    // Live event density map per local calendar day (YYYY-MM-DD) for calendar day dots
    const eventDateCounts = useMemo(() => {
      const counts: Record<string, number> = {};
      for (const r of snapshot.rows) {
        const d = new Date(r.startTime);
        if (!Number.isFinite(d.getTime())) continue;
        const key = toLocalDateKey(d);
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    }, [snapshot.rows]);

    const handleDateRangeChange = (next: DateRangeValue, meta?: { pendingEnd?: boolean }) => {
      setState((prev) => ({ ...prev, dateRange: next }));
      onDateRangeFilterChange?.(next, meta);
    };

    const isFutureDateSelected = useMemo(() => needsFutureDateScrape(dateRange), [dateRange]);
    const selectedDateWindow = useMemo(() => resolveScrapeDateWindow(dateRange), [dateRange]);
    const selectedDateLabel = selectedDateWindow
      ? formatScrapeDateWindowLabel(selectedDateWindow)
      : null;
    const isDateRangeScraping = Boolean(snapshot.stats.isDateRangeScraping);

    const autoRatingEstimate = useMemo(() => {
      const scopedRows = snapshot.rows.filter((r) => {
        if (
          effectiveBookmakerFilters.length > 0 &&
          !effectiveBookmakerFilters.includes(r.bookmakerId)
        ) {
          return false;
        }
        if (exchangeFilters.length > 0 && !exchangeFilters.includes(r.exchangeId)) return false;
        return true;
      });
      return computeAutoRolloverRating({
        rows: scopedRows.length > 0 ? scopedRows : snapshot.rows,
      });
    }, [snapshot.rows, effectiveBookmakerFilters, exchangeFilters]);

    const effectiveEstimatedRating = autoEstimatedRating
      ? autoRatingEstimate.estimatedRating
      : manualEstimatedRating;

    const resetAllCatalogFilters = () => {
      setState((prev) => ({
        ...prev,
        search: '',
        sport: 'ALL',
        leagues: [],
        market: 'ALL',
        bookmakerFilters: [],
        exchangeFilters: [],
        minLegOdds: 1.01,
        maxLegOdds: 25,
        minRating: 0,
        minLiquidity: 0,
        dateRange: EMPTY_DATE_RANGE,
        onlySurebets: false,
        noSurebets: false,
        onlyEligible: false,
      }));
      onDateRangeFilterChange?.(EMPTY_DATE_RANGE);
    };

    const activeAdvancedFilterCount = useMemo(() => {
      let count = 0;
      if (leagues.length > 0) count++;
      if (market !== 'ALL') count++;
      if (
        (minLegOdds > 0 && Math.abs(minLegOdds - 1.01) > 0.005) ||
        (maxLegOdds >= 1.05 && Math.abs(maxLegOdds - 25) > 0.005)
      ) {
        count++;
      }
      if (minRating > 0) count++;
      if (minLiquidity > 0) count++;
      if (dateRange.mode !== 'all') count++;
      if (onlySurebets) count++;
      if (noSurebets) count++;
      return count;
    }, [leagues, market, minLegOdds, maxLegOdds, minRating, minLiquidity, dateRange, onlySurebets, noSurebets]);

    const { visibleCatalog, totalMatchingFilters, eligibleCount, ineligibleCount } =
      useMemo(() => {
        const res = filterManualMultioddsCatalog({
          rows: snapshot.rows,
          selectedLegs,
          mode,
          search,
          sport,
          leagues,
          market,
          bookmakerIds: effectiveBookmakerFilters,
          exchangeIds: exchangeFilters,
          minLegOdds,
          maxLegOdds,
          minRating,
          minLiquidity,
          dateRange,
          onlySurebets,
          noSurebets,
          onlyEligible,
          minGapMinutes,
          maxLegs: MAX_MANUAL_LEGS,
        });

        return {
          visibleCatalog: res.items.slice(0, pageSize),
          totalMatchingFilters: res.items.length,
          eligibleCount: res.eligibleCount,
          ineligibleCount: res.ineligibleCount,
        };
      }, [
        snapshot.rows,
        selectedLegs,
        mode,
        search,
        sport,
        leagues,
        market,
        effectiveBookmakerFilters,
        exchangeFilters,
        minLegOdds,
        maxLegOdds,
        minRating,
        minLiquidity,
        dateRange,
        onlySurebets,
        noSurebets,
        onlyEligible,
        minGapMinutes,
        pageSize,
      ]);

    const addLeg = (row: OddsmatcherRow, validation: ManualMultipleValidation) => {
      if (!validation.eligible) return;
      setState((prev) =>
        prev.selectedRows.some((x) => x.id === row.id)
          ? prev
          : { ...prev, selectedRows: [...prev.selectedRows, row] }
      );
      if (soundEnabled) playCopyTick();
    };

    const removeLeg = (id: string) => {
      setState((prev) => ({
        ...prev,
        selectedRows: prev.selectedRows.filter((x) => x.id !== id),
      }));
    };

    const clearSlip = () => {
      setState((prev) => ({ ...prev, selectedRows: [], planName: '' }));
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
          next.push(candidate);
        }
      }
      if (next.length > 0) {
        setState((prev) => ({ ...prev, selectedRows: next }));
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
        realBalance,
        bonusBalance,
        rolloverRemaining,
        estimatedRating: effectiveEstimatedRating,
        rolloverWalletRule,
        minGapRequiredMinutes: minGapMinutes,
      });
    }, [
      selectedLegs,
      mode,
      stake,
      bonusBoostPct,
      refundAmount,
      refundRetention,
      realBalance,
      bonusBalance,
      rolloverRemaining,
      effectiveEstimatedRating,
      rolloverWalletRule,
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
      ? `${plan.id}_${mode}_${stake}_${bonusBoostPct}_${refundAmount}_${refundRetention}_${
          mode === 'rollover'
            ? `${realBalance}_${bonusBalance}_${rolloverRemaining}_${effectiveEstimatedRating}_${rolloverWalletRule}`
            : ''
        }`
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
        realBalance: mode === 'rollover' ? realBalance : undefined,
        bonusBalance: mode === 'rollover' ? bonusBalance : undefined,
        rolloverRemaining: mode === 'rollover' ? rolloverRemaining : undefined,
        estimatedRating: mode === 'rollover' ? effectiveEstimatedRating : undefined,
        rolloverWalletRule: mode === 'rollover' ? rolloverWalletRule : undefined,
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
        notes:
          `Multipla Manuale ${plan.legs.length} leg | Bonus +${bonusBoostPct}%` +
          (mode === 'rollover'
            ? ` | Rollover €${rolloverRemaining} @${effectiveEstimatedRating.toFixed(1)}%`
            : ''),
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
              <div className="relative min-w-[140px] flex-1">
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

              <button
                type="button"
                data-testid="manual-advanced-filters-btn"
                onClick={() => setShowAdvancedFilters((v) => !v)}
                className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                  showAdvancedFilters || activeAdvancedFilterCount > 0
                    ? 'border-brand-400/50 bg-brand-500/15 text-brand-200'
                    : 'border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white'
                }`}
              >
                <SlidersHorizontal className="h-3 w-3" />
                Filtri
                {activeAdvancedFilterCount > 0 && (
                  <span className="rounded bg-brand-400/25 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-200">
                    {activeAdvancedFilterCount}
                  </span>
                )}
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
                  searchPlaceholder="Cerca bookmaker per nome..."
                  options={bookmakerOptions}
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
                  searchPlaceholder="Cerca exchange..."
                  options={exchangeOptions}
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

          {typeof document !== 'undefined' &&
            createPortal(
              <AnimatePresence>
                {showAdvancedFilters && (
                  <div
                    className="fixed inset-0 top-12 z-50 flex items-center justify-center p-4 sm:p-6"
                    data-testid="manual-advanced-filters-panel"
                  >
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.16 }}
                      onClick={() => setShowAdvancedFilters(false)}
                      className="absolute inset-0 bg-black/75 backdrop-blur-sm"
                    />
                    <motion.div
                      initial={{ opacity: 0, scale: 0.96, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96, y: 10 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      role="dialog"
                      aria-modal="true"
                      aria-label="Filtri Costruttore Manuale"
                      className="relative z-10 flex max-h-[84vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-brand-400/35 bg-[var(--bg-modal-solid)] shadow-[0_24px_70px_rgba(0,0,0,0.9)]"
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-brand-400/40 bg-brand-500/15 text-brand-300">
                            <SlidersHorizontal className="h-4 w-4" />
                          </div>
                          <div>
                            <h2 className="font-display text-sm font-bold text-white">
                              Filtri Costruttore Manuale
                            </h2>
                            <p className="text-[11px] text-slate-400">
                              Preset rapidi, surebet, competizioni, mercati, quote singole, rating, liquidità e calendario
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="rounded-lg border border-brand-400/35 bg-brand-500/15 px-2.5 py-1 font-mono text-[11px] font-bold text-brand-200">
                            {totalMatchingFilters} esiti
                          </span>
                          <button
                            type="button"
                            data-testid="manual-reset-filters-btn"
                            onClick={resetAllCatalogFilters}
                            className="flex items-center gap-1 rounded-xl border border-slate-700/80 bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-rose-400/40 hover:text-rose-200"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Reset Filtri
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowAdvancedFilters(false)}
                            aria-label="Chiudi filtri"
                            className="rounded-xl border border-slate-800 bg-slate-900 p-1.5 text-slate-400 transition hover:text-white"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <QuickPresetsMenu
                            data-testid="manual-quick-presets-btn"
                            menuTestId="manual-quick-presets-menu"
                            activeCount={(isTopCompetitionsActive ? 1 : 0) + (onlySurebets ? 1 : 0)}
                            items={[
                              {
                                id: 'qualifier',
                                label: 'Qualificante (≥90%)',
                                description: 'Normale · Rating ≥90% · Q. Singola 1.40–4.50 · Liq ≥25€',
                                tone: 'brand',
                                icon: <Target className="h-3 w-3" />,
                                active:
                                  mode === 'normal' &&
                                  !onlySurebets &&
                                  Math.abs(minLegOdds - 1.4) < 0.005 &&
                                  Math.abs(maxLegOdds - 4.5) < 0.005 &&
                                  Math.abs(minRating - 90) < 0.005 &&
                                  Math.abs(minLiquidity - 25) < 0.005,
                                onSelect: () => {
                                  setState((prev) => ({
                                    ...prev,
                                    mode: 'normal',
                                    minLegOdds: 1.4,
                                    maxLegOdds: 4.5,
                                    minRating: 90,
                                    minLiquidity: 25,
                                    onlySurebets: false,
                                  }));
                                },
                              },
                              {
                                id: 'snr',
                                label: 'Freebet SNR (Q ≥ 1.60)',
                                description: 'Freebet SNR · Rating ≥55% · Q. Singola 1.60–6.00 · Liq ≥20€',
                                tone: 'accent',
                                icon: <Gift className="h-3 w-3" />,
                                active:
                                  mode === 'snr' &&
                                  !onlySurebets &&
                                  Math.abs(minLegOdds - 1.6) < 0.005 &&
                                  Math.abs(maxLegOdds - 6.0) < 0.005 &&
                                  Math.abs(minRating - 55) < 0.005 &&
                                  Math.abs(minLiquidity - 20) < 0.005,
                                onSelect: () => {
                                  setState((prev) => ({
                                    ...prev,
                                    mode: 'snr',
                                    minLegOdds: 1.6,
                                    maxLegOdds: 6.0,
                                    minRating: 55,
                                    minLiquidity: 20,
                                    onlySurebets: false,
                                  }));
                                },
                              },
                              {
                                id: 'surebet',
                                label: 'Solo Surebet (≥100%)',
                                description: 'Normale · Esiti singoli Surebet ≥100% · Q. 1.10–20.00 · Liq ≥10€',
                                tone: 'emerald',
                                icon: <Flame className="h-3 w-3" />,
                                active: onlySurebets,
                                onSelect: () => {
                                  setState((prev) => ({
                                    ...prev,
                                    mode: 'normal',
                                    minLegOdds: 1.1,
                                    maxLegOdds: 20,
                                    minRating: 100,
                                    minLiquidity: 10,
                                    onlySurebets: true,
                                    noSurebets: false,
                                  }));
                                },
                              },
                              {
                                id: 'high-liquidity',
                                label: 'Alta Liquidità (≥100€)',
                                description: 'Filtra solo mercati Exchange con almeno 100€ disponibili',
                                tone: 'amber',
                                icon: <Coins className="h-3 w-3" />,
                                active: !onlySurebets && minLiquidity >= 100,
                                onSelect: () => {
                                  setState((prev) => ({
                                    ...prev,
                                    minLiquidity: 100,
                                    onlySurebets: false,
                                  }));
                                },
                              },
                              {
                                id: 'top-competitions',
                                label: 'Top Competizioni',
                                description: 'Serie A/B, Premier, LaLiga, Bundesliga, UEFA, ATP/WTA, NBA',
                                tone: 'sky',
                                icon: <Trophy className="h-3 w-3" />,
                                active: isTopCompetitionsActive,
                                onSelect: () => {
                                  setLeagues(isTopCompetitionsActive ? [] : topCompetitionsForSport);
                                },
                              },
                            ] satisfies QuickPresetItem[]}
                            onReset={resetAllCatalogFilters}
                            resetLabel="Reset tutti i filtri"
                          />

                          <button
                            type="button"
                            data-testid="manual-only-surebet-toggle"
                            aria-pressed={onlySurebets}
                            onClick={() =>
                              setState((prev) => {
                                const next = !prev.onlySurebets;
                                return {
                                  ...prev,
                                  onlySurebets: next,
                                  noSurebets: next ? false : prev.noSurebets,
                                };
                              })
                            }
                            title="Mostra solo esiti singoli con Rating ≥ 100% (Surebet)"
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                              onlySurebets
                                ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100'
                                : 'border-slate-700/80 bg-slate-900/90 text-slate-300 hover:text-white'
                            }`}
                          >
                            <Flame className={`h-3.5 w-3.5 ${onlySurebets ? 'text-emerald-300' : 'text-slate-400'}`} />
                            <span>Solo Surebet</span>
                            <span
                              className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                                onlySurebets
                                  ? 'bg-emerald-400/25 text-emerald-200'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {onlySurebets ? 'ON' : 'OFF'}
                            </span>
                          </button>

                          <button
                            type="button"
                            data-testid="manual-no-surebet-toggle"
                            aria-pressed={noSurebets}
                            onClick={() =>
                              setState((prev) => {
                                const next = !prev.noSurebets;
                                return {
                                  ...prev,
                                  noSurebets: next,
                                  onlySurebets: next ? false : prev.onlySurebets,
                                };
                              })
                            }
                            title="Esclude automaticamente tutte le surebet singole (Rating Normale ≥ 100%)"
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                              noSurebets
                                ? 'border-rose-400/60 bg-rose-500/15 text-rose-100'
                                : 'border-slate-700/80 bg-slate-900/90 text-slate-300 hover:text-white'
                            }`}
                          >
                            <Ban className={`h-3.5 w-3.5 ${noSurebets ? 'text-rose-300' : 'text-slate-400'}`} />
                            <span>No Surebet</span>
                            <span
                              className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                                noSurebets
                                  ? 'bg-rose-400/25 text-rose-200'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {noSurebets ? 'ON' : 'OFF'}
                            </span>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-slate-400">
                              Competizioni ({leagues.length === 0 ? 'Tutte' : leagues.length})
                            </label>
                            <CustomMultiSelect<string>
                              data-testid="manual-league-select"
                              values={leagues}
                              allLabel="Tutte le competizioni"
                              minMenuWidth={240}
                              options={competitionOptions}
                              onChange={setLeagues}
                            />
                          </div>

                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-slate-400">
                              Mercato
                            </label>
                            <CustomSelect<MarketType | 'ALL'>
                              data-testid="manual-market-select"
                              className="mt-1"
                              value={market}
                              minMenuWidth={185}
                              onChange={setMarket}
                              options={[
                                { value: 'ALL', label: 'Tutti i mercati' },
                                { value: '1X2', label: 'Esito Finale 1X2' },
                                { value: 'OVER_UNDER_25', label: 'Under/Over 2.5' },
                                { value: 'BTTS', label: 'Goal / NoGoal' },
                                { value: 'H2H', label: 'Testa a Testa' },
                              ]}
                            />
                          </div>

                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-slate-400">
                              Data / Periodo
                            </label>
                            <DateRangeCalendar
                              value={dateRange}
                              onChange={handleDateRangeChange}
                              eventDateCounts={eventDateCounts}
                              isScraping={isDateRangeScraping && isFutureDateSelected}
                            />
                          </div>

                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-slate-400">
                              Quota Singola (Min / Max)
                            </label>
                            <div className="mt-1 flex items-center gap-1.5">
                              <NumericInput
                                data-testid="manual-min-leg-odds"
                                min={1.01}
                                value={minLegOdds}
                                onChange={setMinLegOdds}
                                placeholder="1.01"
                                className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                              />
                              <NumericInput
                                data-testid="manual-max-leg-odds"
                                min={1.05}
                                value={maxLegOdds}
                                onChange={setMaxLegOdds}
                                placeholder="25"
                                className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-slate-400">
                              Rating Min (%)
                            </label>
                            <NumericInput
                              data-testid="manual-min-rating-input"
                              min={0}
                              value={minRating}
                              onChange={(v) => setMinRating(Math.max(0, v))}
                              placeholder="0"
                              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-slate-400">
                              Liquidità Min (€)
                            </label>
                            <NumericInput
                              data-testid="manual-min-liquidity-input"
                              min={0}
                              value={minLiquidity}
                              onChange={(v) => setMinLiquidity(Math.max(0, v))}
                              placeholder="0"
                              className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 bg-slate-950/60 px-5 py-3">
                        <div className="text-xs text-slate-400">
                          <strong className="font-mono text-white">{totalMatchingFilters}</strong>{' '}
                          esiti trovati (<strong className="text-emerald-300">{eligibleCount}</strong>{' '}
                          idonei)
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAdvancedFilters(false)}
                          className="rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-glow transition hover:brightness-110"
                        >
                          Mostra {totalMatchingFilters} Esiti
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>,
              document.body
            )}

          {isDateRangeScraping && isFutureDateSelected && visibleCatalog.length > 0 && (
            <div
              data-testid="manual-date-scrape-banner"
              className="flex items-center justify-between gap-2 rounded-xl border border-brand-400/25 bg-brand-500/10 px-3.5 py-1.5 text-[11px] text-brand-200"
            >
              <div className="flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-300" />
                <span>
                  Ricerca quote future per{' '}
                  <strong className="font-mono text-white">{selectedDateLabel}</strong>...
                </span>
              </div>
              <span className="font-mono text-[10px] text-brand-300/90">
                {totalMatchingFilters} esiti pronti
              </span>
            </div>
          )}

          {/* Live Validated Events Table */}
          <div className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
            {visibleCatalog.length === 0 && isDateRangeScraping && isFutureDateSelected ? (
              <div
                data-testid="manual-date-scrape-loading"
                className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
              >
                <RefreshCw className="h-7 w-7 animate-spin text-brand-300" />
                <div className="text-sm font-semibold text-white">
                  Caricamento quote per {selectedDateLabel}...
                </div>
                <p className="max-w-xs text-xs text-slate-400">
                  Lo scraper sta interrogando bookmaker ed exchange sulle date selezionate.
                </p>
              </div>
            ) : snapshot.rows.length === 0 &&
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
              <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-20 border-b border-slate-800 bg-[var(--bg-modal-solid)]">
                    <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-2.5 py-2.5">Data/Ora</th>
                      <th className="px-2.5 py-2.5">Evento & Esito</th>
                      <th className="px-2 py-2.5 text-right">Punta</th>
                      <th className="px-2 py-2.5 text-right">Banca</th>
                      <th className="px-2 py-2.5 text-right">Rating</th>
                      <th className="px-2.5 py-2.5 text-right">Multipla</th>
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
                          <td className="whitespace-nowrap px-2.5 py-2">
                            <div className="font-mono text-[11px] font-semibold text-slate-200">
                              {tm.date} <span className="text-brand-300">{tm.time}</span>
                            </div>
                            <div className="text-[10px] text-slate-500">{tm.relative}</div>
                          </td>

                          <td className="max-w-[195px] px-2.5 py-2">
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

                          <td className="whitespace-nowrap px-2 py-2 text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <div className="flex min-w-0 flex-col items-end">
                                <div className="font-mono text-xs font-extrabold text-blue-300">
                                  {formatOdds(row.backOdds)}
                                </div>
                                <div className="max-w-[84px] truncate text-[10px] text-slate-400">
                                  {row.bookmakerName}
                                </div>
                              </div>
                              <BookmakerIcon sourceId={row.bookmakerId} size={20} className="shrink-0 rounded-[5px]" />
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-2 py-2 text-right" title={row.exchangeName}>
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <div className="flex min-w-0 flex-col items-end">
                                <div className="font-mono text-xs font-extrabold text-rose-300">
                                  {formatOdds(row.layOdds)}
                                </div>
                                <div className="font-mono text-[10px] text-slate-400">
                                  Liq {formatEuro(row.liquidity)}
                                </div>
                              </div>
                              <BookmakerIcon sourceId={row.exchangeId} size={20} className="shrink-0 rounded-[5px]" />
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-2 py-2 text-right">
                            {(() => {
                              const rowRating = mode === 'snr' ? row.ratingSnr : row.ratingNormal;
                              return (
                                <span
                                  className={`font-mono text-xs font-bold ${
                                    rowRating >= 100
                                      ? 'text-brand-300'
                                      : rowRating >= 95
                                      ? 'text-emerald-400'
                                      : 'text-amber-300'
                                  }`}
                                >
                                  {formatPct(rowRating)}
                                </span>
                              );
                            })()}
                          </td>

                          <td className="whitespace-nowrap px-2.5 py-2 text-right">
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
                      onClick={() =>
                        setState((prev) => ({ ...prev, pageSize: prev.pageSize + 60 }))
                      }
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
                      { value: 'rollover', label: 'Rollover' },
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
                      { value: 60, label: 'Min 1h', hint: 'Ridotto', dotColor: 'bg-amber-400' },
                      { value: 0, label: 'Sovrapposti OK', hint: 'Senza vincoli', dotColor: 'bg-slate-400' },
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

                {mode === 'rollover' && (
                  <div className="col-span-full mt-0.5">
                    <RolloverParamsPanel
                      compact
                      testIdPrefix="manual-rollover"
                      stake={stake}
                      realBalance={realBalance}
                      bonusBalance={bonusBalance}
                      rolloverRemaining={rolloverRemaining}
                      estimatedRating={effectiveEstimatedRating}
                      autoEstimatedRating={autoEstimatedRating}
                      autoRatingInfo={autoRatingEstimate}
                      walletRule={rolloverWalletRule}
                      rolloverDetails={plan?.rollover}
                      onChangeStake={setStake}
                      onChangeRealBalance={setRealBalance}
                      onChangeBonusBalance={setBonusBalance}
                      onChangeRolloverRemaining={setRolloverRemaining}
                      onChangeEstimatedRating={(v) => {
                        setAutoEstimatedRating(false);
                        setManualEstimatedRating(v);
                      }}
                      onToggleAutoRating={setAutoEstimatedRating}
                      onChangeWalletRule={setRolloverWalletRule}
                    />
                  </div>
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

                      {plan.rollover && (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-400/25 bg-brand-500/[0.06] px-2.5 py-1.5 text-[10px]">
                          <span className="font-semibold text-brand-200">
                            Rollover: €{plan.rollover.rolloverBefore.toFixed(0)} →{' '}
                            <strong className="text-white">
                              {plan.rollover.completesRolloverOnThisBet
                                ? 'Completato'
                                : `€${plan.rollover.rolloverAfter.toFixed(0)}`}
                            </strong>
                          </span>
                          <span className="text-slate-400">
                            Match Rating:{' '}
                            <strong className="font-mono text-emerald-300">
                              {plan.rollover.matchRating.toFixed(2)}%
                            </strong>
                          </span>
                          <span className="font-mono text-slate-400">
                            Costo V/P: -{formatEuro(plan.rollover.futureRolloverCostIfWin)} /{' '}
                            {plan.rollover.clearsRolloverOnLose
                              ? '€0'
                              : `-${formatEuro(plan.rollover.futureRolloverCostIfLose)}`}
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

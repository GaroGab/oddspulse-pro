import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Ban,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Copy,
  Filter,
  Flame,
  Gift,
  Layers,
  ListPlus,
  Lock,
  Percent,
  Play,
  Radar,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
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
import { computeAutoRolloverRating, findBestMultiodds } from '../../shared/math';
import {
  buildCompetitionOptions,
  getTopCompetitionValues,
  inferSportFromLeague,
  matchesWatchLeagues,
} from '../../shared/ratingWatch';
import { buildSavedMultipleInputFromPlan } from '../../shared/savedMultiples';
import {
  type BetMode,
  type MarketType,
  type MultioddsPlan,
  type OddsmatcherRow,
  type RolloverWalletRule,
  type SavedMultiplePlan,
  type SavedMultiplePlanInput,
  type ScrapeSnapshot,
  type SportKey,
  type TrackedBet,
} from '../../shared/types';
import { formatEuro, formatEventTime, formatGap, formatOdds, formatPct } from '../utils/format';
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
import { ManualMultioddsBuilder } from './ManualMultioddsBuilder';
import { NumericInput } from './NumericInput';
import { QuickPresetsMenu, type QuickPresetItem } from './QuickPresetsMenu';
import { RolloverParamsPanel } from './RolloverParamsPanel';
import { SavedMultiplesView } from './SavedMultiplesView';
import { SlidingPillTrack } from './SlidingPillTrack';
import {
  buildBookmakerSourceOptions,
  buildExchangeSourceOptions,
  SourceMultiSelect,
  type SourceOption,
} from './SourceSelect';

interface MultioddsViewProps {
  snapshot: ScrapeSnapshot;
  isBrowserOnline: boolean;
  autoScrapeActive?: boolean;
  lockedRows: OddsmatcherRow[];
  savedMultiples?: SavedMultiplePlan[];
  soundEnabled: boolean;
  onUnlockRow: (rowId: string) => void;
  onClearLocks: () => void;
  onSaveTrackedBet: (bet: Omit<TrackedBet, 'id' | 'createdAt'>) => void;
  onSaveMultiplePlan?: (
    plan: SavedMultiplePlan | SavedMultiplePlanInput
  ) => Promise<SavedMultiplePlan | null> | SavedMultiplePlan | null | void;
  onDeleteSavedMultiple?: (id: string) => void;
  onDateRangeFilterChange?: (
    next: DateRangeValue,
    opts?: { pendingEnd?: boolean; force?: boolean }
  ) => void;
  onRetryScrape: () => void;
  onRestartAutoScrape?: () => void;
  onOpenScrapers: () => void;
}

const MODE_LABELS: Record<BetMode, string> = {
  normal: 'Normale',
  snr: 'Freebet SNR',
  sr: 'Bonus SR',
  rf: 'Rimborso RF',
  rollover: 'Rollover',
};

const SPORT_LABELS: Record<SportKey | 'ALL', string> = {
  ALL: 'Tutti gli sport',
  football: 'Calcio',
  tennis: 'Tennis',
  basketball: 'Basket',
};

export const MultioddsView: React.FC<MultioddsViewProps> = ({
  snapshot,
  isBrowserOnline,
  autoScrapeActive = true,
  lockedRows,
  savedMultiples = [],
  soundEnabled,
  onUnlockRow,
  onClearLocks,
  onSaveTrackedBet,
  onSaveMultiplePlan,
  onDeleteSavedMultiple,
  onDateRangeFilterChange,
  onRetryScrape,
  onRestartAutoScrape,
  onOpenScrapers,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'manual' | 'saved' | 'auto'>('manual');
  const [focusSavedId, setFocusSavedId] = useState<string | null>(null);
  const [savedAutoIds, setSavedAutoIds] = useState<Set<string>>(new Set());

  // Multiodds-exclusive filters
  const [legsCount, setLegsCount] = useState<number>(3);
  const [minCombinedOdds, setMinCombinedOdds] = useState<number>(2.5);
  const [maxCombinedOdds, setMaxCombinedOdds] = useState<number>(25);
  const [minGapMinutes, setMinGapMinutes] = useState<number>(120);
  const [bonusBoostPct, setBonusBoostPct] = useState<number>(0);
  const [refundAmount, setRefundAmount] = useState<number>(25);
  const [refundRetention, setRefundRetention] = useState<number>(70);

  // Rollover parameters
  const [realBalance, setRealBalance] = useState<number>(100);
  const [bonusBalance, setBonusBalance] = useState<number>(100);
  const [rolloverRemaining, setRolloverRemaining] = useState<number>(500);
  const [autoEstimatedRating, setAutoEstimatedRating] = useState<boolean>(true);
  const [manualEstimatedRating, setManualEstimatedRating] = useState<number>(96);
  const [rolloverWalletRule, setRolloverWalletRule] = useState<RolloverWalletRule>('mixed');

  // Shared Oddsmatcher filters
  const [mode, setMode] = useState<BetMode>('normal');
  const [stake, setStake] = useState<number>(50);
  const [search, setSearch] = useState<string>('');
  const [sport, setSport] = useState<SportKey | 'ALL'>('ALL');
  const [leagues, setLeagues] = useState<string[]>([]);
  const [market, setMarket] = useState<MarketType | 'ALL'>('ALL');
  const [bookmakerIds, setBookmakerIds] = useState<string[]>([]);
  const [exchangeIds, setExchangeIds] = useState<string[]>([]);
  const [minLegOdds, setMinLegOdds] = useState<number>(1.25);
  const [maxLegOdds, setMaxLegOdds] = useState<number>(4.5);
  const [minRating, setMinRating] = useState<number>(0);
  const [minLiquidity, setMinLiquidity] = useState<number>(10);
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [onlySurebets, setOnlySurebets] = useState<boolean>(false);
  const [noSurebets, setNoSurebets] = useState<boolean>(false);

  // Modal & UI state
  const [showFiltersDialog, setShowFiltersDialog] = useState<boolean>(false);
  const [showBestPlanDialog, setShowBestPlanDialog] = useState<boolean>(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [savedPlanIds, setSavedPlanIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!showFiltersDialog && !showBestPlanDialog) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowFiltersDialog(false);
        setShowBestPlanDialog(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showFiltersDialog, showBestPlanDialog]);

  const effectiveBookmakers = useMemo(
    () => (lockedRows.length > 0 ? [lockedRows[0].bookmakerId] : bookmakerIds),
    [lockedRows, bookmakerIds]
  );

  const autoRatingEstimate = useMemo(() => {
    const scopedRows = snapshot.rows.filter((r) => {
      if (effectiveBookmakers.length > 0 && !effectiveBookmakers.includes(r.bookmakerId)) {
        return false;
      }
      if (exchangeIds.length > 0 && !exchangeIds.includes(r.exchangeId)) {
        return false;
      }
      return true;
    });
    return computeAutoRolloverRating({
      rows: scopedRows.length > 0 ? scopedRows : snapshot.rows,
    });
  }, [snapshot.rows, effectiveBookmakers, exchangeIds]);

  const effectiveEstimatedRating = autoEstimatedRating
    ? autoRatingEstimate.estimatedRating
    : manualEstimatedRating;

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

  // Prune selected competitions belonging to another sport when switching sport
  useEffect(() => {
    if (sport === 'ALL') return;
    setLeagues((prev) => {
      const next = prev.filter((lg) => {
        const inferred = inferSportFromLeague(lg);
        return !inferred || inferred === sport;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [sport]);

  const bookmakerOptions = useMemo<SourceOption[]>(
    () => buildBookmakerSourceOptions(snapshot),
    [snapshot]
  );

  const exchangeOptions = useMemo<SourceOption[]>(
    () => buildExchangeSourceOptions(snapshot),
    [snapshot]
  );

  // Prune previously selected bookmakers/exchanges if they enter error state
  useEffect(() => {
    const disabledBookIds = new Set(bookmakerOptions.filter((o) => o.disabled).map((o) => o.id));
    if (disabledBookIds.size > 0) {
      setBookmakerIds((prev) => {
        const next = prev.filter((id) => !disabledBookIds.has(id));
        return next.length === prev.length ? prev : next;
      });
    }
    const disabledExIds = new Set(exchangeOptions.filter((o) => o.disabled).map((o) => o.id));
    if (disabledExIds.size > 0) {
      setExchangeIds((prev) => {
        const next = prev.filter((id) => !disabledExIds.has(id));
        return next.length === prev.length ? prev : next;
      });
    }
  }, [bookmakerOptions, exchangeOptions]);

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
    setDateRange(next);
    onDateRangeFilterChange?.(next, meta);
  };

  const isFutureDateSelected = useMemo(() => needsFutureDateScrape(dateRange), [dateRange]);
  const selectedDateWindow = useMemo(() => resolveScrapeDateWindow(dateRange), [dateRange]);
  const selectedDateLabel = selectedDateWindow
    ? formatScrapeDateWindowLabel(selectedDateWindow)
    : null;
  const isDateRangeScraping = Boolean(snapshot.stats.isDateRangeScraping);

  const resetAllAutoFilters = () => {
    setLegsCount(3);
    setMinCombinedOdds(2.5);
    setMaxCombinedOdds(25);
    setMinGapMinutes(120);
    setBonusBoostPct(0);
    setRefundAmount(25);
    setRefundRetention(70);
    setRealBalance(100);
    setBonusBalance(100);
    setRolloverRemaining(500);
    setAutoEstimatedRating(true);
    setManualEstimatedRating(96);
    setRolloverWalletRule('mixed');
    setMode('normal');
    setStake(50);
    setSearch('');
    setSport('ALL');
    setLeagues([]);
    setMarket('ALL');
    setBookmakerIds([]);
    setExchangeIds([]);
    setMinLegOdds(1.25);
    setMaxLegOdds(4.5);
    setMinRating(0);
    setMinLiquidity(10);
    handleDateRangeChange(EMPTY_DATE_RANGE);
    setOnlySurebets(false);
    setNoSurebets(false);
  };

  const activeAutoFilterCount = useMemo(() => {
    let count = 0;
    if (legsCount !== 3) count++;
    if (Math.abs(minCombinedOdds - 2.5) > 0.005 || Math.abs(maxCombinedOdds - 25) > 0.005) count++;
    if (minGapMinutes !== 120) count++;
    if (bonusBoostPct > 0) count++;
    if (mode !== 'normal') count++;
    if (Math.abs(stake - 50) > 0.005) count++;
    if (search.trim().length > 0) count++;
    if (sport !== 'ALL') count++;
    if (leagues.length > 0) count++;
    if (market !== 'ALL') count++;
    if (bookmakerIds.length > 0) count++;
    if (exchangeIds.length > 0) count++;
    if (Math.abs(minLegOdds - 1.25) > 0.005 || Math.abs(maxLegOdds - 4.5) > 0.005) count++;
    if (minRating > 0) count++;
    if (Math.abs(minLiquidity - 10) > 0.005) count++;
    if (dateRange.mode !== 'all') count++;
    if (onlySurebets) count++;
    if (noSurebets) count++;
    return count;
  }, [
    legsCount,
    minCombinedOdds,
    maxCombinedOdds,
    minGapMinutes,
    bonusBoostPct,
    mode,
    stake,
    search,
    sport,
    leagues,
    market,
    bookmakerIds,
    exchangeIds,
    minLegOdds,
    maxLegOdds,
    minRating,
    minLiquidity,
    dateRange,
    onlySurebets,
    noSurebets,
  ]);

  const plans = useMemo(() => {
    if (snapshot.rows.length === 0) return [];
    return findBestMultiodds({
      rows: snapshot.rows,
      bookmakerIds: effectiveBookmakers,
      exchangeIds,
      sport,
      market,
      leaguePredicate:
        leagues.length > 0
          ? (r) => matchesWatchLeagues(leagues, r.league, r.sport)
          : undefined,
      dateRange,
      search,
      minRating,
      onlySurebets,
      noSurebets,
      legsCount: Math.max(legsCount, lockedRows.length),
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
      estimatedRating: effectiveEstimatedRating,
      rolloverWalletRule,
      lockedRowIds: lockedRows.map((r) => r.id),
      maxResults: 35,
    });
  }, [
    snapshot.rows,
    effectiveBookmakers,
    exchangeIds,
    sport,
    market,
    leagues,
    dateRange,
    search,
    minRating,
    onlySurebets,
    noSurebets,
    legsCount,
    lockedRows,
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
    effectiveEstimatedRating,
    rolloverWalletRule,
  ]);

  const copyLayStake = async (key: string, amount: number) => {
    try {
      await navigator.clipboard.writeText(amount.toFixed(2));
      setCopiedKey(key);
      if (soundEnabled) playCopyTick();
      setTimeout(() => setCopiedKey(null), 1400);
    } catch {
      // Ignore
    }
  };

  const handleSavePlan = (plan: MultioddsPlan) => {
    onSaveTrackedBet({
      eventName: plan.legs.map((l) => l.row.eventName).join(' + '),
      league: `Multipla ${plan.legs.length} Eventi`,
      sport: plan.legs[0].row.sport,
      marketLabel: `Sequenziale (Gap ${formatGap(plan.minGapMinutes)})`,
      selectionLabel: plan.legs.map((l) => l.row.selectionLabel).join(' / '),
      type: 'multipla',
      mode,
      bookmakerName: plan.bookmakerName,
      exchangeName: plan.exchangeName,
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
        `Multipla ${plan.legs.length} leg | Bonus +${bonusBoostPct}%` +
        (mode === 'rollover'
          ? ` | Rollover €${rolloverRemaining} @${effectiveEstimatedRating.toFixed(1)}%`
          : ''),
    });
    setSavedPlanIds((prev) => new Set(prev).add(plan.id));
    if (soundEnabled) playCopyTick();
  };

  const handleSaveAutoInteractivePlan = async (plan: MultioddsPlan) => {
    if (!onSaveMultiplePlan) return;
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
    });
    const created = await onSaveMultiplePlan(input);
    setSavedAutoIds((prev) => new Set(prev).add(plan.id));
    if (created && typeof created === 'object' && 'id' in created) {
      setFocusSavedId(created.id);
    }
    if (soundEnabled) playCopyTick();
  };

  const handleOpenSavedPlan = (planId?: string) => {
    if (planId) setFocusSavedId(planId);
    setActiveSubTab('saved');
  };

  const activeSavedCount = useMemo(
    () => savedMultiples.filter((p) => p.status !== 'completed').length,
    [savedMultiples]
  );

  const topPlan = plans[0];

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* Multiodds Subsection Switcher */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-brand-400 text-slate-950 shadow-glow-accent">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h1 className="font-display text-sm font-bold text-white">
              Multiodds Pro — Multiple & Bancata Sequenziale
            </h1>
            <p className="text-[10px] text-slate-400">
              Costruisci la tua multipla manualmente, salva e aggiorna progressivamente le quote o avvia la ricerca automatica.
            </p>
          </div>
        </div>

        <SlidingPillTrack
          activeKey={activeSubTab}
          measureDep={`${savedMultiples.length}_${activeSavedCount}_${plans.length}`}
          pillClassName="rounded-lg bg-gradient-to-r from-brand-300 to-accent-400 shadow-glow"
          className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/90 p-1"
        >
          <button
            type="button"
            data-pill-key="manual"
            data-testid="multiodds-subtab-manual"
            onClick={() => setActiveSubTab('manual')}
            className={`relative z-10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              activeSubTab === 'manual' ? 'text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            <ListPlus className="h-3.5 w-3.5" />
            Costruttore Manuale
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                activeSubTab === 'manual'
                  ? 'bg-slate-950/20 text-slate-950'
                  : 'bg-brand-400/15 text-brand-300'
              }`}
            >
              MANUALE
            </span>
          </button>

          <button
            type="button"
            data-pill-key="saved"
            data-testid="multiodds-subtab-saved"
            onClick={() => setActiveSubTab('saved')}
            className={`relative z-10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              activeSubTab === 'saved' ? 'text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            <BookmarkCheck className="h-3.5 w-3.5" />
            Multiple Salvate
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                activeSubTab === 'saved'
                  ? 'bg-slate-950/20 text-slate-950'
                  : activeSavedCount > 0
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {savedMultiples.length}
            </span>
          </button>

          <button
            type="button"
            data-pill-key="auto"
            data-testid="multiodds-subtab-auto"
            onClick={() => setActiveSubTab('auto')}
            className={`relative z-10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              activeSubTab === 'auto' ? 'text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Ottimizzatore Automatico
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                activeSubTab === 'auto'
                  ? 'bg-slate-950/20 text-slate-950'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {plans.length}
            </span>
          </button>
        </SlidingPillTrack>
      </div>

      {activeSubTab === 'manual' ? (
        <ManualMultioddsBuilder
          snapshot={snapshot}
          isBrowserOnline={isBrowserOnline}
          autoScrapeActive={autoScrapeActive}
          lockedRows={lockedRows}
          soundEnabled={soundEnabled}
          savedCount={savedMultiples.length}
          onSaveTrackedBet={onSaveTrackedBet}
          onSaveMultiplePlan={onSaveMultiplePlan}
          onOpenSavedList={handleOpenSavedPlan}
          onDateRangeFilterChange={onDateRangeFilterChange}
          onRetryScrape={onRetryScrape}
          onRestartAutoScrape={onRestartAutoScrape}
          onOpenScrapers={onOpenScrapers}
        />
      ) : activeSubTab === 'saved' ? (
        <SavedMultiplesView
          savedMultiples={savedMultiples}
          liveRows={snapshot.rows}
          soundEnabled={soundEnabled}
          initialSelectedId={focusSavedId}
          onSaveMultiplePlan={(p) => onSaveMultiplePlan?.(p)}
          onDeleteSavedMultiple={(id) => onDeleteSavedMultiple?.(id)}
          onSaveTrackedBet={onSaveTrackedBet}
          onCreateNew={() => setActiveSubTab('manual')}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          {/* Compact Action Bar: all filters and Miglior Multipla Live hidden inside dedicated animated dialogs */}
          <div className="glass-panel rounded-2xl px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="text-xs font-bold text-white">
                  Combinazioni Automatiche
                </div>
                <span
                  data-testid="multi-auto-count-badge"
                  className="rounded-lg border border-brand-400/35 bg-brand-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-brand-200"
                >
                  {plans.length} trovate
                </span>
                <div className="hidden flex-wrap items-center gap-1.5 text-[11px] text-slate-400 sm:flex">
                  <span className="rounded-md border border-slate-800 bg-slate-950/75 px-2 py-0.5 font-mono text-slate-300">
                    {Math.max(legsCount, lockedRows.length)} Eventi
                  </span>
                  <span className="rounded-md border border-slate-800 bg-slate-950/75 px-2 py-0.5 text-slate-300">
                    {MODE_LABELS[mode]} · €{stake}
                  </span>
                  <span className="rounded-md border border-slate-800 bg-slate-950/75 px-2 py-0.5 font-mono text-emerald-300">
                    Gap {formatGap(minGapMinutes)}
                  </span>
                  {sport !== 'ALL' && (
                    <span className="rounded-md border border-slate-800 bg-slate-950/75 px-2 py-0.5 text-brand-200">
                      {SPORT_LABELS[sport]}
                    </span>
                  )}
                  {bonusBoostPct > 0 && (
                    <span className="rounded-md border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 font-mono text-amber-200">
                      +{bonusBoostPct}% Boost
                    </span>
                  )}
                  {mode === 'rollover' && (
                    <span className="rounded-md border border-brand-400/35 bg-brand-500/10 px-2 py-0.5 font-mono text-brand-200">
                      Roll €{rolloverRemaining} · {effectiveEstimatedRating.toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="multi-auto-best-btn"
                  onClick={() => setShowBestPlanDialog(true)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                    topPlan
                      ? 'border-accent-400/50 bg-accent-500/15 text-accent-100 shadow-[0_0_16px_-4px_rgb(var(--accent-500)/0.45)] hover:border-accent-400/70 hover:bg-accent-500/25'
                      : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <Trophy className="h-3.5 w-3.5 text-brand-300" />
                  <span>Miglior Multipla Live</span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-extrabold ${
                      topPlan
                        ? topPlan.rating >= 100
                          ? 'bg-emerald-500/25 text-emerald-200'
                          : 'bg-brand-400/20 text-brand-200'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {topPlan ? formatPct(topPlan.rating) : '—'}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="multi-auto-filters-btn"
                  onClick={() => setShowFiltersDialog(true)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                    activeAutoFilterCount > 0
                      ? 'border-brand-400/55 bg-brand-500/15 text-brand-100 shadow-[0_0_14px_-4px_rgb(var(--brand-400)/0.45)] hover:border-brand-400/75 hover:bg-brand-500/25'
                      : 'border-slate-800 bg-slate-900 text-slate-200 hover:border-brand-400/45 hover:text-white'
                  }`}
                >
                  <SlidersHorizontal
                    className={`h-3.5 w-3.5 ${
                      activeAutoFilterCount > 0 ? 'text-brand-300' : 'text-slate-400'
                    }`}
                  />
                  <span>Filtri</span>
                  {activeAutoFilterCount > 0 && (
                    <span className="rounded-full bg-brand-400/25 px-1.5 py-0.2 font-mono text-[10px] font-bold text-brand-200">
                      {activeAutoFilterCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Locked Legs Strip (active selections from Oddsmatcher/Calculator) */}
            {lockedRows.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-accent-400/35 bg-accent-500/10 px-3 py-2">
                <span className="flex items-center gap-1 text-[11px] font-bold text-accent-200">
                  <Lock className="h-3.5 w-3.5" /> Eventi Bloccati ({lockedRows.length}):
                </span>
                {lockedRows.map((lr) => (
                  <span
                    key={lr.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-accent-400/40 bg-slate-950/80 px-2 py-0.5 text-[11px] text-slate-200"
                  >
                    <span>{lr.eventName}</span>
                    <span className="font-mono text-brand-300">@{formatOdds(lr.backOdds)}</span>
                    <button
                      type="button"
                      onClick={() => onUnlockRow(lr.id)}
                      className="text-slate-400 hover:text-rose-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={onClearLocks}
                  className="ml-auto flex items-center gap-1 text-[11px] text-rose-300 hover:text-rose-200"
                >
                  <Trash2 className="h-3 w-3" /> Sblocca tutti
                </button>
              </div>
            )}
          </div>

          {isDateRangeScraping && isFutureDateSelected && plans.length > 0 && (
            <div
              data-testid="multi-auto-date-scrape-banner"
              className="flex items-center justify-between gap-2 rounded-xl border border-brand-400/25 bg-brand-500/10 px-4 py-2 text-xs text-brand-200"
            >
              <div className="flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-300" />
                <span>
                  Ricerca competizioni e quote aggiuntive per il periodo{' '}
                  <strong className="font-mono text-white">{selectedDateLabel}</strong> in corso...
                </span>
              </div>
              <span className="font-mono text-[11px] text-brand-300/90">
                {plans.length} combinazioni già disponibili
              </span>
            </div>
          )}

      {/* Results List */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {plans.length === 0 && isDateRangeScraping && isFutureDateSelected ? (
          <div
            data-testid="multi-auto-date-scrape-loading"
            className="glass-panel flex h-full flex-col items-center justify-center gap-4 rounded-2xl p-10 text-center"
          >
            <div className="relative flex h-16 w-16 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400/30" />
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-400/40 bg-brand-500/15 text-brand-300 shadow-glow">
                <Radar className="h-6 w-6 animate-spin" />
              </div>
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-white">
                Ricerca Quote Future in Corso...
              </h3>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                Scansione di Exchange e Bookmaker per trovare le competizioni e le quote nel periodo{' '}
                <strong className="font-mono text-brand-200">{selectedDateLabel}</strong>.
              </p>
            </div>
          </div>
        ) : snapshot.rows.length === 0 &&
        !snapshot.stats.isRunning &&
        (!isBrowserOnline ||
          snapshot.connection.health === 'offline' ||
          snapshot.connection.failedSourcesCount > 0) ? (
          <div className="glass-panel h-full rounded-2xl">
            <ConnectionAlert
              snapshot={snapshot}
              isBrowserOnline={isBrowserOnline}
              variant="empty"
              onRetry={onRetryScrape}
              onOpenScrapers={onOpenScrapers}
            />
          </div>
        ) : plans.length === 0 ? (
          <div className="glass-panel flex h-full flex-col items-center justify-center gap-2 rounded-2xl p-10 text-center">
            <Layers className="h-9 w-9 text-slate-600" />
            <div className="text-sm font-semibold text-slate-300">
              {snapshot.rows.length === 0
                ? !autoScrapeActive && !snapshot.stats.isRunning
                  ? 'Aggiornamento automatico dello scraping fermo'
                  : 'In attesa delle quote live dallo scraper...'
                : 'Nessuna combinazione trovata con questi parametri'}
            </div>
            {snapshot.rows.length === 0 && !autoScrapeActive && !snapshot.stats.isRunning ? (
              <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                {onRestartAutoScrape && (
                  <button
                    type="button"
                    onClick={onRestartAutoScrape}
                    className="flex items-center gap-1.5 rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-3.5 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Riavvia Auto-Scraping
                  </button>
                )}
                <button
                  type="button"
                  onClick={onRetryScrape}
                  className="flex items-center gap-1.5 rounded-xl border border-brand-400/40 bg-brand-500/15 px-3.5 py-1.5 text-xs font-bold text-brand-200 hover:bg-brand-500/25"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Scansiona Ora
                </button>
              </div>
            ) : (
              <>
                <p className="max-w-md text-xs text-slate-500">
                  Suggerimento: prova ad abbassare la Quota Singola Minima (es. 1.20), ridurre la Quota Totale Minima o impostare Gap Sequenziale su 60m / Sovrapposti OK.
                </p>
                {snapshot.rows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowFiltersDialog(true)}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-xl border border-brand-400/40 bg-brand-500/15 px-3.5 py-1.5 text-xs font-bold text-brand-200 hover:bg-brand-500/25"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Modifica Filtri
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          plans.map((plan, idx) => {
            const isExpanded = expandedId === plan.id || (expandedId === null && idx === 0);
            const isSaved = savedPlanIds.has(plan.id);
            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.03, 0.25) }}
                className={`glass-card overflow-hidden rounded-2xl border transition-colors ${
                  isExpanded
                    ? 'border-accent-400/45 shadow-[0_0_32px_-12px_rgb(var(--accent-500)/0.4)]'
                    : 'border-slate-800/80 hover:border-brand-400/30'
                }`}
              >
                {/* Plan Summary Header */}
                <div
                  onClick={() => setExpandedId(isExpanded ? '__none__' : plan.id)}
                  className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3.5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div
                      className={`flex h-11 min-w-[74px] shrink-0 flex-col items-center justify-center rounded-xl border px-2.5 font-mono ${
                        plan.rating >= 100
                          ? 'surebet-badge text-brand-100'
                          : plan.rating >= 90
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-amber-500/35 bg-amber-500/10 text-amber-300'
                      }`}
                    >
                      <span className="text-sm font-extrabold">{formatPct(plan.rating)}</span>
                      <span className="text-[9px] uppercase opacity-75">Rating</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold text-white"
                          style={{
                            backgroundColor: `${plan.bookmakerColor}28`,
                            border: `1px solid ${plan.bookmakerColor}66`,
                          }}
                        >
                          <BookmakerIcon sourceId={plan.bookmakerId} size={22} className="rounded-[5px]" />
                          {plan.bookmakerName}
                        </span>
                        <span className="font-mono text-xs font-bold text-brand-200">
                          Quota Tot: {formatOdds(plan.boostedBackOdds)}
                          {bonusBoostPct > 0 && (
                            <span className="ml-1 text-[10px] text-amber-300">
                              (base {formatOdds(plan.combinedBackOdds)} +{bonusBoostPct}%)
                            </span>
                          )}
                        </span>
                        <span className="text-slate-600">•</span>
                        <span className="font-mono text-xs text-rose-300">
                          Banca Eff.: {formatOdds(plan.effectiveCombinedLayOdds)}
                        </span>
                        {plan.nonOverlapping && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                            <ShieldCheck className="h-3 w-3" />
                            Non Sovrapposti • Gap min {formatGap(plan.minGapMinutes)}
                          </span>
                        )}
                      </div>

                      {/* Compact Leg Pills */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300">
                        {plan.legs.map((step, sIdx) => (
                          <React.Fragment key={step.row.id}>
                            <span className="rounded-md border border-slate-800 bg-slate-950/80 px-2 py-0.5">
                              <span className="text-slate-400">#{step.legIndex}</span>{' '}
                              <span className="font-semibold text-white">{step.row.eventName}</span>{' '}
                              <span className="text-brand-300">({step.row.selectionLabel})</span>{' '}
                              <span className="font-mono text-blue-300">@{formatOdds(step.backOdds)}</span>
                            </span>
                            {sIdx < plan.legs.length - 1 && (
                              <span className="text-[10px] text-slate-500">→</span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right KPIs */}
                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <div className="text-[10px] uppercase text-slate-500">Profitto Garantito</div>
                      <div
                        className={`font-mono text-base font-extrabold tabular-nums ${
                          plan.guaranteedProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatEuro(plan.guaranteedProfit, true)}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] uppercase text-slate-500">Max Resp. Exchange</div>
                      <div className="font-mono text-xs font-bold text-slate-200 tabular-nums">
                        {formatEuro(plan.maxCumulativeLiability)}
                      </div>
                    </div>

                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400">
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </div>
                </div>

                {/* Expanded Sequential Lay Schedule & Scenario Matrix */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-t border-slate-800/80 bg-black/35 p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-brand-200">
                          <Clock className="h-4 w-4 text-accent-400" />
                          Piano di Bancata Sequenziale (Banca l&apos;evento successivo solo se il precedente vince!)
                        </div>
                        <div className="flex items-center gap-2">
                          {onSaveMultiplePlan && (
                            <button
                              type="button"
                              onClick={() => {
                                if (savedAutoIds.has(plan.id)) {
                                  setActiveSubTab('saved');
                                } else {
                                  void handleSaveAutoInteractivePlan(plan);
                                }
                              }}
                              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                                savedAutoIds.has(plan.id)
                                  ? 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                                  : 'bg-gradient-to-r from-brand-300 to-accent-400 text-slate-950 hover:brightness-110'
                              }`}
                            >
                              <BookmarkCheck className="h-3.5 w-3.5" />
                              {savedAutoIds.has(plan.id) ? 'Salvato · Apri' : 'Salva Piano'}
                            </button>
                          )}
                          <button
                            onClick={() => handleSavePlan(plan)}
                            disabled={isSaved}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                              isSaved
                                ? 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                                : 'border border-slate-700 bg-slate-900 text-slate-200 hover:border-brand-400/50 hover:text-white'
                            }`}
                          >
                            {isSaved ? <Check className="h-3.5 w-3.5" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
                            {isSaved ? 'Nel Tracker' : 'Salva nel Tracker'}
                          </button>
                        </div>
                      </div>

                      {/* Chronological Step Cards */}
                      {plan.rollover && (
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-400/25 bg-brand-500/[0.06] px-3 py-2 text-[11px]">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="font-semibold text-brand-200">
                              Rollover: €{plan.rollover.rolloverBefore.toFixed(0)} →{' '}
                              <strong className="text-white">
                                {plan.rollover.completesRolloverOnThisBet
                                  ? 'Completato'
                                  : `€${plan.rollover.rolloverAfter.toFixed(0)}`}
                              </strong>
                            </span>
                            <span className="text-slate-400">
                              Rating stimato:{' '}
                              <strong className="font-mono text-slate-200">
                                {plan.rollover.estimatedRating.toFixed(1)}%
                              </strong>
                            </span>
                            <span className="text-slate-400">
                              Match Rating:{' '}
                              <strong className="font-mono text-emerald-300">
                                {plan.rollover.matchRating.toFixed(2)}%
                              </strong>
                            </span>
                          </div>
                          <span className="font-mono text-[10px] text-slate-400">
                            Costo futuro V/P: -{formatEuro(plan.rollover.futureRolloverCostIfWin)} /{' '}
                            {plan.rollover.clearsRolloverOnLose
                              ? 'Azzera (€0)'
                              : `-${formatEuro(plan.rollover.futureRolloverCostIfLose)}`}
                          </span>
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                        {plan.legs.map((step) => {
                          const tm = formatEventTime(step.row.startTime);
                          const copyId = `${plan.id}_${step.legIndex}`;
                          return (
                            <div
                              key={copyId}
                              className="relative rounded-xl border border-slate-800 bg-slate-900/75 p-3"
                            >
                              <div className="flex items-center justify-between">
                                <span className="rounded-md bg-accent-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-accent-200 border border-accent-400/35">
                                  STEP {step.legIndex}
                                </span>
                                <span className="font-mono text-[11px] text-slate-400">
                                  {tm.date} <strong className="text-brand-300">{tm.time}</strong>
                                  {step.gapMinutesFromPrev !== null && (
                                    <span className="ml-1.5 text-emerald-400">
                                      (+{formatGap(step.gapMinutesFromPrev)})
                                    </span>
                                  )}
                                </span>
                              </div>

                              <div className="mt-2 truncate text-xs font-bold text-white">
                                {step.row.eventName}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {step.row.marketLabel} •{' '}
                                <span className="font-semibold text-brand-200">
                                  {step.row.selectionLabel}
                                </span>
                              </div>

                              <div className="mt-2.5 flex items-center justify-between rounded-lg bg-slate-950/80 px-2.5 py-2">
                                <div>
                                  <div className="text-[10px] text-slate-500">
                                    Banca su {step.row.exchangeName} @{formatOdds(step.layOdds)}
                                  </div>
                                  <div className="font-mono text-base font-extrabold text-white">
                                    {formatEuro(step.layStake)}
                                  </div>
                                </div>
                                <button
                                  onClick={() => void copyLayStake(copyId, step.layStake)}
                                  className="flex items-center gap-1 rounded-lg border border-brand-400/35 bg-brand-500/15 px-2.5 py-1 text-[10px] font-bold text-brand-200 hover:bg-brand-400 hover:text-slate-950"
                                >
                                  {copiedKey === copyId ? (
                                    <Check className="h-3 w-3" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                  {copiedKey === copyId ? 'OK' : 'Copia'}
                                </button>
                              </div>

                              <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
                                <div>
                                  <div className="text-slate-500">Resp. Step</div>
                                  <div className="font-mono font-semibold text-rose-300">
                                    {formatEuro(step.liability)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-slate-500">Liquidità</div>
                                  <div className="font-mono font-semibold text-slate-300">
                                    {formatEuro(step.row.liquidity)}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-slate-500">Se perde qui</div>
                                  <div
                                    className={`font-mono font-bold ${
                                      step.profitIfLostHere >= -0.005
                                        ? 'text-emerald-400'
                                        : 'text-rose-400'
                                    }`}
                                  >
                                    {formatEuro(step.profitIfLostHere, true)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Outcome Neutrality Proof Bar */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
                          <span className="font-semibold text-emerald-300">
                            Matrice Esiti Neutrale:
                          </span>
                          {plan.legs.map((s) => (
                            <span key={s.legIndex} className="font-mono">
                              Persa Step {s.legIndex}:{' '}
                              <strong
                                className={
                                  s.profitIfLostHere >= -0.005 ? 'text-emerald-400' : 'text-rose-300'
                                }
                              >
                                {formatEuro(s.profitIfLostHere, true)}
                              </strong>
                            </span>
                          ))}
                          <span className="font-mono">
                            Tutte Vinte:{' '}
                            <strong
                              className={
                                plan.profitIfAllWin >= -0.005 ? 'text-emerald-400' : 'text-rose-300'
                              }
                            >
                              {formatEuro(plan.profitIfAllWin, true)}
                            </strong>
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-slate-400">
                          Bankroll Exchange max: <strong className="text-white">{formatEuro(plan.maxCumulativeLiability)}</strong>
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>
        </div>
      )}

      {/* Animated Filters Modal Dialog (Logically divided: Multiodds-only vs Oddsmatcher-common) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {showFiltersDialog && (
              <div
                className="fixed inset-0 top-12 z-50 flex items-center justify-center p-4 sm:p-6"
                data-testid="multi-auto-filters-dialog"
              >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={() => setShowFiltersDialog(false)}
              className="fixed inset-0 top-12 bg-black/75 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 flex max-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-[var(--bg-modal-solid)] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)]"
            >
              <div className="aurora-bar" />

              {/* Dialog Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-brand-400/35 bg-brand-500/15 text-brand-300">
                    <SlidersHorizontal className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="font-display text-sm font-bold text-white">
                      Filtri Ottimizzatore Multipla
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Parametri esclusivi della multipla sequenziale e filtri di mercato condivisi con Oddsmatcher
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-brand-400/30 bg-brand-500/10 px-2.5 py-1 font-mono text-[11px] font-bold text-brand-200">
                    {plans.length} combinazioni
                  </span>
                  <button
                    type="button"
                    data-testid="multi-auto-reset-filters-btn"
                    onClick={resetAllAutoFilters}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-200"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset Filtri
                  </button>
                  <button
                    type="button"
                    data-testid="multi-auto-close-filters-btn"
                    onClick={() => setShowFiltersDialog(false)}
                    aria-label="Chiudi dialog filtri"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900 text-slate-400 transition hover:border-slate-600 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Dialog Scrollable Body */}
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                {/* SECTION 1: Exclusive Multiodds Filters */}
                <section
                  data-testid="multi-auto-section-exclusive"
                  className="rounded-2xl border border-accent-400/25 bg-accent-500/[0.04] p-4"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-accent-400/15 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-accent-300" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-accent-200">
                        Filtri Struttura Multipla
                      </h3>
                      <span className="rounded-md border border-accent-400/35 bg-accent-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent-200">
                        Solo Multipla
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Numero eventi, preset promo, quote totali, gap sequenziale e bonus multipla
                    </span>
                  </div>

                  {/* Legs Count & Promo Presets */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Numero di Eventi (Gambe)
                        </label>
                        {lockedRows.length > 0 && (
                          <span className="text-[10px] text-accent-300">
                            Minimo {lockedRows.length} eventi bloccati attivi
                          </span>
                        )}
                      </div>
                      <SlidingPillTrack
                        activeKey={String(legsCount)}
                        pillClassName="rounded-lg bg-gradient-to-r from-accent-400 to-brand-400"
                        className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/90 p-1"
                      >
                        {[2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            data-pill-key={String(n)}
                            data-testid={`multi-auto-legs-${n}`}
                            onClick={() => setLegsCount(n)}
                            className={`relative z-10 rounded-lg px-3 py-1 text-xs font-bold transition ${
                              legsCount === n ? 'text-slate-950' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {n} Eventi
                          </button>
                        ))}
                      </SlidingPillTrack>
                    </div>

                    {/* Quick Promo Multiple Presets */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Preset Promo Multiple:
                      </span>
                      <button
                        type="button"
                        data-testid="multi-promo-tripla"
                        onClick={() => {
                          setLegsCount(3);
                          setMode('normal');
                          setMinLegOdds(1.4);
                          setMaxLegOdds(4.0);
                          setMinCombinedOdds(3.0);
                          setMinGapMinutes(120);
                          setBonusBoostPct(0);
                        }}
                        className="rounded-lg border border-accent-400/30 bg-accent-500/10 px-2.5 py-1 text-[10px] font-semibold text-accent-200 transition hover:bg-accent-500/20"
                      >
                        Tripla Promo (3x Q&ge;1.40)
                      </button>
                      <button
                        type="button"
                        data-testid="multi-promo-quadrupla"
                        onClick={() => {
                          setLegsCount(4);
                          setMode('normal');
                          setMinLegOdds(1.3);
                          setMaxLegOdds(3.5);
                          setMinCombinedOdds(3.5);
                          setMinGapMinutes(120);
                          setBonusBoostPct(5);
                        }}
                        className="rounded-lg border border-brand-400/30 bg-brand-500/10 px-2.5 py-1 text-[10px] font-semibold text-brand-200 transition hover:bg-brand-500/20"
                      >
                        Quadrupla +5% Boost
                      </button>
                      <button
                        type="button"
                        data-testid="multi-promo-raddoppio"
                        onClick={() => {
                          setLegsCount(2);
                          setMode('normal');
                          setMinLegOdds(1.5);
                          setMaxLegOdds(4.0);
                          setMinCombinedOdds(2.25);
                          setMinGapMinutes(120);
                          setBonusBoostPct(0);
                        }}
                        className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
                      >
                        Raddoppio 2 Eventi
                      </button>
                      <button
                        type="button"
                        data-testid="multi-promo-snr"
                        onClick={() => {
                          setLegsCount(3);
                          setMode('snr');
                          setMinLegOdds(1.6);
                          setMaxLegOdds(5.0);
                          setMinCombinedOdds(5.0);
                          setMinGapMinutes(120);
                          setBonusBoostPct(0);
                        }}
                        className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-200 transition hover:bg-amber-500/20"
                      >
                        Freebet Multipla SNR
                      </button>
                    </div>

                    {/* Exclusive Numeric / Sequential Controls */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-slate-400">
                          Q. Totale Min / Max
                        </label>
                        <div className="mt-1 flex gap-1.5">
                          <input
                            type="number"
                            step={0.25}
                            value={minCombinedOdds}
                            onChange={(e) => setMinCombinedOdds(parseFloat(e.target.value) || 1.5)}
                            className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                          />
                          <input
                            type="number"
                            step={1}
                            value={maxCombinedOdds}
                            onChange={(e) => setMaxCombinedOdds(parseFloat(e.target.value) || 50)}
                            className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-slate-400">
                          Gap Sequenziale
                        </label>
                        <CustomSelect<number>
                          data-testid="multi-gap-select"
                          className="mt-1"
                          value={minGapMinutes}
                          minMenuWidth={185}
                          onChange={setMinGapMinutes}
                          triggerClassName="text-emerald-300"
                          options={[
                            { value: 120, label: 'Min 2h (Consigliato)', dotColor: 'bg-emerald-400' },
                            { value: 150, label: 'Min 2h 30m (Sicuro)', dotColor: 'bg-emerald-400' },
                            { value: 180, label: 'Min 3h (Ampio)', dotColor: 'bg-brand-300' },
                            { value: 60, label: 'Min 1h', dotColor: 'bg-amber-400' },
                            { value: 0, label: 'Sovrapposti OK', dotColor: 'bg-slate-400' },
                          ]}
                        />
                      </div>

                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-slate-400">
                          Bonus Multipla %
                        </label>
                        <div className="relative mt-1">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={bonusBoostPct}
                            onChange={(e) =>
                              setBonusBoostPct(Math.max(0, parseFloat(e.target.value) || 0))
                            }
                            className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-amber-300 focus:border-brand-400 focus:outline-none"
                          />
                          <Percent className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
                        </div>
                      </div>

                      {mode === 'rf' && (
                        <>
                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-accent-300">
                              Rimborso Multipla (€)
                            </label>
                            <input
                              type="number"
                              min={0}
                              step={5}
                              value={refundAmount}
                              onChange={(e) =>
                                setRefundAmount(Math.max(0, parseFloat(e.target.value) || 0))
                              }
                              className="mt-1 w-full rounded-lg border border-accent-500/40 bg-accent-600/30 px-2.5 py-1.5 font-mono text-xs text-white focus:border-accent-400 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase tracking-wider text-accent-300">
                              Ritenzione Bonus (%)
                            </label>
                            <input
                              type="number"
                              min={10}
                              max={100}
                              step={5}
                              value={refundRetention}
                              onChange={(e) =>
                                setRefundRetention(Math.max(0, parseFloat(e.target.value) || 0))
                              }
                              className="mt-1 w-full rounded-lg border border-accent-500/40 bg-accent-600/30 px-2.5 py-1.5 font-mono text-xs text-white focus:border-accent-400 focus:outline-none"
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {mode === 'rollover' && (
                      <div className="mt-3">
                        <RolloverParamsPanel
                          compact
                          testIdPrefix="multi-auto-rollover"
                          stake={stake}
                          realBalance={realBalance}
                          bonusBalance={bonusBalance}
                          rolloverRemaining={rolloverRemaining}
                          estimatedRating={effectiveEstimatedRating}
                          autoEstimatedRating={autoEstimatedRating}
                          autoRatingInfo={autoRatingEstimate}
                          walletRule={rolloverWalletRule}
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
                </section>

                {/* SECTION 2: Common Oddsmatcher Filters */}
                <section
                  data-testid="multi-auto-section-oddsmatcher"
                  className="rounded-2xl border border-brand-400/25 bg-brand-500/[0.04] p-4"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-brand-400/15 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-brand-300" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-brand-200">
                        Filtri eventi
                      </h3>
                      <span className="rounded-md border border-brand-400/35 bg-brand-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand-200">
                        Mercati & Quote
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Preset rapidi, modalità, puntata, sport, competizioni, bookmaker, quote singole e calendario
                    </span>
                  </div>

                  {/* Quick Presets + Surebet / No Surebet Toolbar */}
                  <div className="mb-3.5 flex flex-wrap items-center gap-2">
                    <QuickPresetsMenu
                      data-testid="multi-auto-quick-presets-btn"
                      menuTestId="multi-auto-quick-presets-menu"
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
                            setMode('normal');
                            setMinLegOdds(1.4);
                            setMaxLegOdds(4.5);
                            setMinRating(90);
                            setMinLiquidity(25);
                            setOnlySurebets(false);
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
                            setMode('snr');
                            setMinLegOdds(1.6);
                            setMaxLegOdds(6.0);
                            setMinRating(55);
                            setMinLiquidity(20);
                            setOnlySurebets(false);
                          },
                        },
                        {
                          id: 'surebet',
                          label: 'Solo Surebet (≥100%)',
                          description: 'Normale · Rating Multipla ≥100% · Q. Singola 1.10–20.00 · Liq ≥10€',
                          tone: 'emerald',
                          icon: <Flame className="h-3 w-3" />,
                          active: onlySurebets,
                          onSelect: () => {
                            setMode('normal');
                            setMinLegOdds(1.1);
                            setMaxLegOdds(20);
                            setMinRating(100);
                            setMinLiquidity(10);
                            setOnlySurebets(true);
                            setNoSurebets(false);
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
                            setMinLiquidity(100);
                            setOnlySurebets(false);
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
                      onReset={resetAllAutoFilters}
                      resetLabel="Reset tutti i filtri"
                    />

                    <button
                      type="button"
                      data-testid="multi-auto-only-surebet-toggle"
                      aria-pressed={onlySurebets}
                      onClick={() =>
                        setOnlySurebets((v) => {
                          const next = !v;
                          if (next) setNoSurebets(false);
                          return next;
                        })
                      }
                      title="Mostra solo multiple con Rating complessivo ≥ 100%"
                      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                        onlySurebets
                          ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100 shadow-[0_0_12px_-4px_rgba(16,185,129,0.45)]'
                          : 'border-slate-700/80 bg-slate-900/90 text-slate-300 hover:border-slate-600 hover:text-white'
                      }`}
                    >
                      <Flame className={`h-3.5 w-3.5 ${onlySurebets ? 'text-emerald-300' : 'text-slate-400'}`} />
                      <span>Solo Surebet</span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
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
                      data-testid="multi-auto-no-surebet-toggle"
                      aria-pressed={noSurebets}
                      onClick={() =>
                        setNoSurebets((v) => {
                          const next = !v;
                          if (next) setOnlySurebets(false);
                          return next;
                        })
                      }
                      title="Esclude automaticamente tutte le surebet singole recuperate (Rating Normale ≥ 100%)"
                      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                        noSurebets
                          ? 'border-rose-400/60 bg-rose-500/15 text-rose-100 shadow-[0_0_12px_-4px_rgba(244,63,94,0.45)]'
                          : 'border-slate-700/80 bg-slate-900/90 text-slate-300 hover:border-slate-600 hover:text-white'
                      }`}
                    >
                      <Ban className={`h-3.5 w-3.5 ${noSurebets ? 'text-rose-300' : 'text-slate-400'}`} />
                      <span>No Surebet</span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
                          noSurebets
                            ? 'bg-rose-400/25 text-rose-200'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {noSurebets ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  </div>

                  {/* Mode, Stake, Sport & Search Row */}
                  <div className="mb-3 flex flex-wrap items-center gap-2.5">
                    <SlidingPillTrack
                      activeKey={mode}
                      pillClassName="rounded-lg bg-gradient-to-r from-brand-300 to-accent-400"
                      className="flex rounded-xl border border-slate-800 bg-slate-950/80 p-0.5"
                    >
                      {(
                        [
                          { id: 'normal', label: 'Normale' },
                          { id: 'snr', label: 'Freebet SNR' },
                          { id: 'sr', label: 'Bonus SR' },
                          { id: 'rf', label: 'Rimborso RF' },
                          { id: 'rollover', label: 'Rollover' },
                        ] as Array<{ id: BetMode; label: string }>
                      ).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          data-pill-key={m.id}
                          data-testid={`multi-auto-mode-${m.id}`}
                          onClick={() => setMode(m.id)}
                          className={`relative z-10 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                            mode === m.id ? 'text-slate-950' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </SlidingPillTrack>

                    <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-1">
                      <span className="text-[11px] text-slate-400">Puntata €</span>
                      <NumericInput
                        min={1}
                        value={stake}
                        onChange={setStake}
                        placeholder="50"
                        data-testid="multi-auto-stake-input"
                        className="w-16 bg-transparent font-mono text-xs font-bold text-brand-200 focus:outline-none"
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
                          data-testid={`multi-auto-sport-${sp.id}`}
                          onClick={() => setSport(sp.id)}
                          className={`relative z-10 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                            sport === sp.id ? 'text-brand-300' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {sp.label}
                        </button>
                      ))}
                    </SlidingPillTrack>

                    <div className="relative min-w-[200px] flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        data-testid="multi-auto-search-input"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Cerca squadra, lega, esito..."
                        className="w-full rounded-xl border border-slate-800 bg-slate-950/85 py-1.5 pl-8 pr-7 text-xs text-white placeholder-slate-500 focus:border-brand-400/60 focus:outline-none"
                      />
                      {search && (
                        <button
                          type="button"
                          onClick={() => setSearch('')}
                          aria-label="Cancella ricerca"
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 hover:text-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 8-Filter Oddsmatcher Grid */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-slate-400">
                        Competizioni ({leagues.length === 0 ? 'Tutte' : leagues.length})
                      </label>
                      <CustomMultiSelect<string>
                        data-testid="multi-auto-league-select"
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
                        data-testid="multi-auto-market-select"
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
                        Bookmaker
                      </label>
                      <SourceMultiSelect
                        data-testid="multi-bookmaker-select"
                        values={effectiveBookmakers}
                        disabled={lockedRows.length > 0}
                        allLabel="Tutti (stesso book)"
                        searchPlaceholder="Cerca bookmaker per nome..."
                        options={bookmakerOptions}
                        onChange={setBookmakerIds}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-slate-400">
                        Exchange
                      </label>
                      <SourceMultiSelect
                        data-testid="multi-exchange-select"
                        values={exchangeIds}
                        allLabel="Tutti gli Exchange"
                        options={exchangeOptions}
                        onChange={setExchangeIds}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-slate-400">
                        Quota Singola (Min / Max)
                      </label>
                      <div className="mt-1 flex items-center gap-1.5">
                        <input
                          type="number"
                          step={0.05}
                          min={1.01}
                          value={minLegOdds}
                          onChange={(e) => setMinLegOdds(parseFloat(e.target.value) || 1.05)}
                          className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                        />
                        <input
                          type="number"
                          step={0.5}
                          min={1.05}
                          value={maxLegOdds}
                          onChange={(e) => setMaxLegOdds(parseFloat(e.target.value) || 10)}
                          className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-slate-400">
                        Rating Min (%)
                      </label>
                      <input
                        type="number"
                        step={1}
                        min={0}
                        data-testid="multi-auto-min-rating-input"
                        value={minRating}
                        onChange={(e) => setMinRating(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-slate-400">
                        Liquidità Min (€)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={5}
                        value={minLiquidity}
                        onChange={(e) =>
                          setMinLiquidity(Math.max(0, parseFloat(e.target.value) || 0))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
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
                  </div>
                </section>
              </div>

              {/* Dialog Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 bg-slate-950/60 px-5 py-3">
                <div className="text-xs text-slate-400">
                  <strong className="font-mono text-white">{plans.length}</strong> combinazioni
                  valide trovate
                  {activeAutoFilterCount > 0 && (
                    <span className="ml-2 text-brand-300">
                      ({activeAutoFilterCount}{' '}
                      {activeAutoFilterCount === 1 ? 'filtro attivo' : 'filtri attivi'})
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  data-testid="multi-auto-apply-filters-btn"
                  onClick={() => setShowFiltersDialog(false)}
                  className="rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-glow transition hover:brightness-110"
                >
                  Mostra {plans.length} Combinazioni
                </button>
              </div>
            </motion.div>
          </div>
        )}
          </AnimatePresence>,
          document.body
        )}

      {/* Animated 'Miglior Multipla Live' Modal Dialog */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {showBestPlanDialog && (
              <div
                className="fixed inset-0 top-12 z-50 flex items-center justify-center p-4 sm:p-6"
                data-testid="multi-auto-best-dialog"
              >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={() => setShowBestPlanDialog(false)}
              className="fixed inset-0 top-12 bg-black/75 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 flex max-h-[calc(100vh-5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-accent-400/35 bg-[var(--bg-modal-solid)] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.85)]"
            >
              <div className="aurora-bar" />

              <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-accent-400/35 bg-accent-500/15 text-brand-300">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-300">
                      Spotlight Combinazione Top
                    </span>
                    <h2 className="font-display text-sm font-bold text-white">
                      Miglior Multipla Live
                    </h2>
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="multi-auto-close-best-btn"
                  onClick={() => setShowBestPlanDialog(false)}
                  aria-label="Chiudi dialog miglior multipla"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900 text-slate-400 transition hover:border-slate-600 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {topPlan ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-accent-400/30 bg-gradient-to-br from-accent-500/10 via-slate-900/80 to-brand-500/10 p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <div className="flex items-baseline gap-3">
                          <AnimatedNumber
                            value={topPlan.rating}
                            formatter={(v) => formatPct(v)}
                            className="font-display text-4xl font-extrabold text-white"
                          />
                          <AnimatedNumber
                            value={topPlan.guaranteedProfit}
                            formatter={(v) => formatEuro(v, true)}
                            className={`font-mono text-base font-bold ${
                              topPlan.guaranteedProfit >= -0.005
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          />
                        </div>
                        <span className="rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-1 font-mono text-xs font-bold text-emerald-300">
                          {plans.length} comb. trovate
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-300">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold text-white"
                          style={{
                            backgroundColor: `${topPlan.bookmakerColor}28`,
                            border: `1px solid ${topPlan.bookmakerColor}66`,
                          }}
                        >
                          <BookmakerIcon
                            sourceId={topPlan.bookmakerId}
                            size={20}
                            className="rounded-[4px]"
                          />
                          {topPlan.bookmakerName}
                        </span>
                        <span>
                          Quota Tot:{' '}
                          <strong className="font-mono text-brand-300">
                            {formatOdds(topPlan.boostedBackOdds)}
                          </strong>
                          {bonusBoostPct > 0 && (
                            <span className="ml-1 text-[10px] text-amber-300">
                              (base {formatOdds(topPlan.combinedBackOdds)} +{bonusBoostPct}%)
                            </span>
                          )}
                        </span>
                        <span>•</span>
                        <span>
                          Banca Eff.:{' '}
                          <strong className="font-mono text-rose-300">
                            {formatOdds(topPlan.effectiveCombinedLayOdds)}
                          </strong>
                        </span>
                        <span>•</span>
                        <span>
                          Max Resp.:{' '}
                          <strong className="font-mono text-white">
                            {formatEuro(topPlan.maxCumulativeLiability)}
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* Chronological Legs List */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        <span>Sequenza Eventi ({topPlan.legs.length} Step)</span>
                        {topPlan.nonOverlapping && (
                          <span className="inline-flex items-center gap-1 text-emerald-300">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Gap min {formatGap(topPlan.minGapMinutes)}
                          </span>
                        )}
                      </div>

                      {topPlan.legs.map((step) => {
                        const tm = formatEventTime(step.row.startTime);
                        const copyId = `best_${topPlan.id}_${step.legIndex}`;
                        return (
                          <div
                            key={copyId}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/75 px-3.5 py-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 text-[11px]">
                                <span className="rounded bg-accent-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent-200">
                                  STEP {step.legIndex}
                                </span>
                                <span className="font-mono text-slate-400">
                                  {tm.date} <strong className="text-brand-300">{tm.time}</strong>
                                </span>
                                {step.gapMinutesFromPrev !== null && (
                                  <span className="font-mono text-[10px] text-emerald-400">
                                    (+{formatGap(step.gapMinutesFromPrev)})
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 truncate text-xs font-bold text-white">
                                {step.row.eventName}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {step.row.marketLabel} •{' '}
                                <span className="font-semibold text-brand-200">
                                  {step.row.selectionLabel}
                                </span>{' '}
                                <span className="font-mono text-blue-300">
                                  @{formatOdds(step.backOdds)}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2.5">
                              <div className="text-right">
                                <div className="text-[10px] text-slate-500">
                                  Banca {step.row.exchangeName} @{formatOdds(step.layOdds)}
                                </div>
                                <div className="font-mono text-sm font-extrabold text-white">
                                  {formatEuro(step.layStake)}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void copyLayStake(copyId, step.layStake)}
                                className="flex items-center gap-1 rounded-lg border border-brand-400/35 bg-brand-500/15 px-2 py-1 text-[10px] font-bold text-brand-200 hover:bg-brand-400 hover:text-slate-950"
                              >
                                {copiedKey === copyId ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                                {copiedKey === copyId ? 'OK' : 'Copia'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                    <Sparkles className="h-8 w-8 text-slate-600" />
                    <div className="text-sm font-semibold text-slate-300">
                      Nessuna combinazione valida al momento
                    </div>
                    <p className="max-w-sm text-xs text-slate-400">
                      Regola i filtri (es. quota minima, gap orario o rating minimo) per trovare la miglior multipla live.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowBestPlanDialog(false);
                        setShowFiltersDialog(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-brand-400/40 bg-brand-500/15 px-4 py-2 text-xs font-bold text-brand-200 hover:bg-brand-500/25"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Apri Filtri
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 bg-slate-950/60 px-5 py-3">
                {topPlan ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedId(topPlan.id);
                        setShowBestPlanDialog(false);
                      }}
                      className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-brand-400/50 hover:text-white"
                    >
                      Espandi nella Lista
                    </button>
                    {onSaveMultiplePlan && (
                      <button
                        type="button"
                        onClick={() => {
                          if (savedAutoIds.has(topPlan.id)) {
                            setShowBestPlanDialog(false);
                            setActiveSubTab('saved');
                          } else {
                            void handleSaveAutoInteractivePlan(topPlan);
                          }
                        }}
                        className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                          savedAutoIds.has(topPlan.id)
                            ? 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                            : 'bg-gradient-to-r from-brand-300 to-accent-400 text-slate-950 hover:brightness-110'
                        }`}
                      >
                        <BookmarkCheck className="h-3.5 w-3.5" />
                        {savedAutoIds.has(topPlan.id) ? 'Salvato · Apri' : 'Salva Piano'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSavePlan(topPlan)}
                      disabled={savedPlanIds.has(topPlan.id)}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                        savedPlanIds.has(topPlan.id)
                          ? 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                          : 'border border-slate-700 bg-slate-900 text-slate-200 hover:border-brand-400/50 hover:text-white'
                      }`}
                    >
                      {savedPlanIds.has(topPlan.id) ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <BookmarkPlus className="h-3.5 w-3.5" />
                      )}
                      {savedPlanIds.has(topPlan.id) ? 'Nel Tracker' : 'Salva nel Tracker'}
                    </button>
                  </div>
                ) : (
                  <div />
                )}
                <button
                  type="button"
                  onClick={() => setShowBestPlanDialog(false)}
                  className="rounded-xl border border-slate-700/80 bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Chiudi
                </button>
              </div>
            </motion.div>
          </div>
        )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
};

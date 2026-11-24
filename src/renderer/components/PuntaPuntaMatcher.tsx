import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calculator,
  Filter,
  Flame,
  LayoutGrid,
  Radar,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  EMPTY_DATE_RANGE,
  formatScrapeDateWindowLabel,
  needsFutureDateScrape,
  resolveScrapeDateWindow,
  toLocalDateKey,
  type DateRangeValue,
} from '../../shared/dateRange';
import type { PuntaPuntaCalcInput } from '../../shared/math';
import {
  extractBackMarketGroupsFromSnapshot,
  findPuntaPuntaMatches,
  type OutcomesFilterMode,
  type PuntaPuntaCandidateRow,
  type PuntaPuntaSortKey,
} from '../../shared/puntaPuntaMatcher';
import {
  buildCompetitionOptions,
  formatFittingListSummary,
  inferSportFromLeague,
} from '../../shared/ratingWatch';
import type {
  BetMode,
  MarketType,
  ScrapeSnapshot,
  SportKey,
  TableDensity,
} from '../../shared/types';
import {
  formatEuro,
  formatEventTime,
  formatOdds,
  formatPct,
  ratingTone,
  sportLabel,
} from '../utils/format';
import { AnimatedNumber } from './AnimatedNumber';
import { AutoScrapePausedState } from './AutoScrapePausedState';
import { BookmakerIcon } from './BookmakerIcon';
import { ConnectionAlert } from './ConnectionAlert';
import { CustomMultiSelect, CustomSelect } from './CustomSelect';
import { DateRangeCalendar } from './DateRangeCalendar';
import { NumericInput } from './NumericInput';
import { SlidingPillTrack } from './SlidingPillTrack';
import { buildBookmakerSourceOptions, SourceMultiSelect } from './SourceSelect';

interface PuntaPuntaMatcherProps {
  snapshot: ScrapeSnapshot;
  isBrowserOnline: boolean;
  autoScrapeActive?: boolean;
  mode: BetMode;
  stake: number;
  anchorMode: NonNullable<PuntaPuntaCalcInput['anchorMode']>;
  refundAmount: number;
  refundRetention: number;
  tableDensity: TableDensity;
  showKpis: boolean;
  onChangeMode: (m: BetMode) => void;
  onChangeStake: (s: number) => void;
  onChangeAnchorMode: (a: NonNullable<PuntaPuntaCalcInput['anchorMode']>) => void;
  onChangeRefundAmount: (v: number) => void;
  onChangeRefundRetention: (v: number) => void;
  onSelectRow: (row: PuntaPuntaCandidateRow) => void;
  onToggleKpis: () => void;
  onDateRangeFilterChange?: (
    next: DateRangeValue,
    opts?: { pendingEnd?: boolean; force?: boolean }
  ) => void;
  onRetryScrape: () => void;
  onRestartAutoScrape?: () => void;
  onOpenScrapers: () => void;
}

const MARKET_OPTIONS: Array<{ value: MarketType | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Tutti i mercati' },
  { value: '1X2', label: 'Esito Finale 1X2' },
  { value: 'OVER_UNDER_25', label: 'Under / Over 2.5' },
  { value: 'BTTS', label: 'Goal / NoGoal' },
  { value: 'H2H', label: 'Testa a Testa (2 esiti)' },
];

const OUTCOMES_MODE_OPTIONS: Array<{ value: OutcomesFilterMode; label: string; hint?: string }> = [
  { value: 'diverse_all', label: 'Bookmaker diversi (Tutti)', hint: 'Consigliato' },
  { value: 'diverse_2way', label: 'Solo 2 Esiti (Book diversi)', hint: '1v1 rapido' },
  { value: 'diverse_3way', label: 'Solo 3 Esiti 1X2', hint: 'Copertura doppia' },
  { value: 'any_bookie', label: 'Consenti stesso Bookmaker', hint: 'Anche interno' },
];

export const PuntaPuntaMatcher: React.FC<PuntaPuntaMatcherProps> = ({
  snapshot,
  isBrowserOnline,
  autoScrapeActive = true,
  mode,
  stake,
  anchorMode,
  refundAmount,
  refundRetention,
  tableDensity,
  showKpis,
  onChangeMode,
  onChangeStake,
  onChangeAnchorMode,
  onChangeRefundAmount,
  onChangeRefundRetention,
  onSelectRow,
  onToggleKpis,
  onDateRangeFilterChange,
  onRetryScrape,
  onRestartAutoScrape,
  onOpenScrapers,
}) => {
  const rowPad =
    tableDensity === 'compact' ? 'py-1.5' : tableDensity === 'spacious' ? 'py-3.5' : 'py-2.5';
  const logoSize =
    tableDensity === 'compact' ? 22 : tableDensity === 'spacious' ? 30 : 26;
  const hedgeLogoSize = Math.max(18, logoSize - 4);

  const [search, setSearch] = useState('');
  const [sport, setSport] = useState<SportKey | 'ALL'>('ALL');
  const [leagues, setLeagues] = useState<string[]>([]);
  const [market, setMarket] = useState<MarketType | 'ALL'>('ALL');
  const [outcomesMode, setOutcomesMode] = useState<OutcomesFilterMode>('diverse_all');
  const [primaryBookmakers, setPrimaryBookmakers] = useState<string[]>([]);
  const [hedgeBookmakers, setHedgeBookmakers] = useState<string[]>([]);
  const [minBack, setMinBack] = useState<number>(1.15);
  const [maxBack, setMaxBack] = useState<number>(15);
  const [minRating, setMinRating] = useState<number>(0);
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [onlySurebets, setOnlySurebets] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [sortBy, setSortBy] = useState<PuntaPuntaSortKey>('rating');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [pageSize, setPageSize] = useState(80);

  const bookmakerOptions = useMemo(
    () => buildBookmakerSourceOptions(snapshot),
    [snapshot]
  );

  // Prune any previously selected bookmaker if it enters error state
  useEffect(() => {
    const disabledIds = new Set(bookmakerOptions.filter((o) => o.disabled).map((o) => o.id));
    if (disabledIds.size === 0) return;
    setPrimaryBookmakers((prev) => {
      const next = prev.filter((id) => !disabledIds.has(id));
      return next.length === prev.length ? prev : next;
    });
    setHedgeBookmakers((prev) => {
      const next = prev.filter((id) => !disabledIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [bookmakerOptions]);

  // Reset pagination when filters change
  useEffect(() => {
    setPageSize(80);
  }, [
    search,
    sport,
    leagues,
    market,
    outcomesMode,
    primaryBookmakers,
    hedgeBookmakers,
    minBack,
    maxBack,
    minRating,
    dateRange,
    onlySurebets,
    mode,
  ]);

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

  const rawGroups = useMemo(() => extractBackMarketGroupsFromSnapshot(snapshot), [snapshot]);

  const competitionOptions = useMemo(
    () => buildCompetitionOptions(rawGroups, sport === 'ALL' ? undefined : sport, leagues),
    [rawGroups, sport, leagues]
  );

  const eventDateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const g of rawGroups) {
      const d = new Date(g.startTime);
      if (!Number.isFinite(d.getTime())) continue;
      const key = toLocalDateKey(d);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [rawGroups]);

  const { rows: matchedRows, stats } = useMemo(
    () =>
      findPuntaPuntaMatches(snapshot, {
        mode,
        stake,
        anchorMode,
        refundAmount,
        refundRetention,
        sport,
        leagues,
        market,
        outcomesMode,
        primaryBookmakers,
        hedgeBookmakers,
        minBack,
        maxBack,
        minRating,
        onlySurebets,
        dateRange,
        search,
        sortBy,
        sortDir,
      }),
    [
      snapshot,
      mode,
      stake,
      anchorMode,
      refundAmount,
      refundRetention,
      sport,
      leagues,
      market,
      outcomesMode,
      primaryBookmakers,
      hedgeBookmakers,
      minBack,
      maxBack,
      minRating,
      onlySurebets,
      dateRange,
      search,
      sortBy,
      sortDir,
    ]
  );

  const visibleRows = useMemo(() => matchedRows.slice(0, pageSize), [matchedRows, pageSize]);

  const handleSort = (col: PuntaPuntaSortKey) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(col);
      setSortDir(col === 'impliedProb' || col === 'startTime' ? 'asc' : 'desc');
    }
  };

  const sortHeader = (label: string, col: PuntaPuntaSortKey) => {
    const active = sortBy === col;
    return (
      <button
        type="button"
        onClick={() => handleSort(col)}
        className={`inline-flex items-center gap-1 text-left text-[11px] font-semibold uppercase tracking-wider transition ${
          active ? 'text-brand-300' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <span>{label}</span>
        {active ? (
          sortDir === 'desc' ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    );
  };

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

  const applyPreset = (
    preset: 'qualifier' | 'snr' | 'surebet' | 'twoway' | 'reset'
  ) => {
    if (preset === 'reset') {
      onChangeMode('normal');
      setSport('ALL');
      setLeagues([]);
      setMarket('ALL');
      setOutcomesMode('diverse_all');
      setPrimaryBookmakers([]);
      setHedgeBookmakers([]);
      setMinBack(1.15);
      setMaxBack(15);
      setMinRating(0);
      handleDateRangeChange(EMPTY_DATE_RANGE);
      setOnlySurebets(false);
      setSearch('');
      setSortBy('rating');
      setSortDir('desc');
      return;
    }
    if (preset === 'qualifier') {
      onChangeMode('normal');
      setMinBack(1.5);
      setMaxBack(5);
      setMinRating(95);
      setOnlySurebets(false);
      setSortBy('rating');
      setSortDir('desc');
    } else if (preset === 'snr') {
      onChangeMode('snr');
      setMinBack(3.5);
      setMaxBack(12);
      setMinRating(60);
      setOnlySurebets(false);
      setSortBy('rating');
      setSortDir('desc');
    } else if (preset === 'surebet') {
      onChangeMode('normal');
      setMinBack(1.15);
      setMaxBack(15);
      setMinRating(100);
      setOnlySurebets(true);
      setSortBy('rating');
      setSortDir('desc');
    } else if (preset === 'twoway') {
      setOutcomesMode('diverse_2way');
      setOnlySurebets(false);
      setSortBy('rating');
      setSortDir('desc');
    }
  };

  const hasActiveFilters =
    search.trim().length > 0 ||
    sport !== 'ALL' ||
    leagues.length > 0 ||
    market !== 'ALL' ||
    outcomesMode !== 'diverse_all' ||
    primaryBookmakers.length > 0 ||
    hedgeBookmakers.length > 0 ||
    minBack !== 1.15 ||
    maxBack !== 15 ||
    minRating > 0 ||
    onlySurebets ||
    dateRange.mode !== 'all';

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; onClear: () => void }> = [];

    if (leagues.length > 0) {
      chips.push({
        id: 'leagues',
        label: formatFittingListSummary(leagues, 26),
        onClear: () => setLeagues([]),
      });
    }

    if (market !== 'ALL') {
      const marketShort: Record<MarketType, string> = {
        '1X2': '1X2',
        OVER_UNDER_25: 'U/O 2.5',
        BTTS: 'Goal/NoGoal',
        H2H: 'Testa a Testa',
      };
      chips.push({
        id: 'market',
        label: marketShort[market] ?? market,
        onClear: () => setMarket('ALL'),
      });
    }

    if (outcomesMode !== 'diverse_all') {
      chips.push({
        id: 'outcomesMode',
        label:
          outcomesMode === 'diverse_2way'
            ? 'Solo 2 Esiti'
            : outcomesMode === 'diverse_3way'
            ? 'Solo 3 Esiti'
            : 'Anche stesso book',
        onClear: () => setOutcomesMode('diverse_all'),
      });
    }

    if (primaryBookmakers.length > 0) {
      const firstName =
        bookmakerOptions.find((b) => b.id === primaryBookmakers[0])?.name ?? primaryBookmakers[0];
      chips.push({
        id: 'primaryBookmakers',
        label:
          primaryBookmakers.length === 1
            ? `P1: ${firstName}`
            : `P1: ${firstName} +${primaryBookmakers.length - 1}`,
        onClear: () => setPrimaryBookmakers([]),
      });
    }

    if (hedgeBookmakers.length > 0) {
      const firstName =
        bookmakerOptions.find((b) => b.id === hedgeBookmakers[0])?.name ?? hedgeBookmakers[0];
      chips.push({
        id: 'hedgeBookmakers',
        label:
          hedgeBookmakers.length === 1
            ? `Cop: ${firstName}`
            : `Cop: ${firstName} +${hedgeBookmakers.length - 1}`,
        onClear: () => setHedgeBookmakers([]),
      });
    }

    if (Math.abs(minBack - 1.15) > 0.005 || Math.abs(maxBack - 15) > 0.005) {
      chips.push({
        id: 'odds',
        label: `Q ${minBack}–${maxBack}`,
        onClear: () => {
          setMinBack(1.15);
          setMaxBack(15);
        },
      });
    }

    if (minRating > 0) {
      chips.push({
        id: 'rating',
        label: `Rating ≥${minRating}%`,
        onClear: () => setMinRating(0),
      });
    }

    if (dateRange.mode !== 'all') {
      const fmtDay = (iso: string | null) =>
        iso ? iso.slice(5).split('-').reverse().join('/') : '';
      const dateLabel =
        dateRange.mode === 'hours'
          ? `Entro ${dateRange.hours}h`
          : dateRange.startDate && dateRange.endDate && dateRange.startDate === dateRange.endDate
          ? fmtDay(dateRange.startDate)
          : `${fmtDay(dateRange.startDate)}–${fmtDay(dateRange.endDate)}`;
      chips.push({
        id: 'date',
        label: dateLabel,
        onClear: () => handleDateRangeChange(EMPTY_DATE_RANGE),
      });
    }

    if (onlySurebets) {
      chips.push({
        id: 'surebet',
        label: 'Solo Surebet',
        onClear: () => setOnlySurebets(false),
      });
    }

    return chips;
  }, [
    leagues,
    market,
    outcomesMode,
    primaryBookmakers,
    hedgeBookmakers,
    bookmakerOptions,
    minBack,
    maxBack,
    minRating,
    dateRange,
    onlySurebets,
  ]);

  return (
    <div className="space-y-4">
      {/* Collapsible KPI Hero Cards */}
      <AnimatePresence initial={false}>
        {showKpis && (
          <motion.div
            key="pp-kpi-bar"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-brand-400/30 bg-gradient-to-br from-brand-500/15 via-slate-900/90 to-slate-950 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-200/80">
                    Miglior Rating ({mode.toUpperCase()})
                  </span>
                  <Sparkles className="h-4 w-4 text-brand-400" />
                </div>
                <div
                  className="mt-2 text-2xl font-extrabold tabular-nums text-brand-300"
                  data-testid="pp-kpi-best-rating"
                >
                  <AnimatedNumber value={stats.bestRating} formatter={(v) => formatPct(v)} />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Su {rawGroups.length} mercati multi-bookmaker
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Match Punta / Punta
                  </span>
                  <Scale className="h-4 w-4 text-sky-400" />
                </div>
                <div
                  className="mt-2 text-2xl font-extrabold tabular-nums text-white"
                  data-testid="pp-kpi-total-matched"
                >
                  <AnimatedNumber value={stats.totalMatched} formatter={(v) => Math.round(v).toString()} />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Combinazioni filtrate attive
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOnlySurebets((v) => !v)}
                data-testid="pp-kpi-surebets"
                className={`rounded-2xl border p-4 text-left transition ${
                  onlySurebets
                    ? 'border-amber-400/70 bg-amber-500/15 shadow-[0_0_24px_-8px_rgba(245,158,11,0.5)]'
                    : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Surebet (&ge; 100%)
                  </span>
                  <Flame className={`h-4 w-4 ${onlySurebets ? 'text-amber-300' : 'text-amber-500/80'}`} />
                </div>
                <div className="mt-2 text-2xl font-extrabold tabular-nums text-amber-300">
                  <AnimatedNumber value={stats.surebetsCount} formatter={(v) => Math.round(v).toString()} />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {onlySurebets ? 'Filtro surebet attivo (clicca per togliere)' : 'Clicca per mostrare solo surebet'}
                </p>
              </button>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Lavagna Media Top 20
                  </span>
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="mt-2 text-2xl font-extrabold tabular-nums text-emerald-300">
                  <AnimatedNumber
                    value={stats.avgLavagnaTop20}
                    formatter={(v) => (v > 0 ? `${v.toFixed(2)}%` : '—')}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Sotto 100% = margine matematico
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Controls Bar */}
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/75 p-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          {/* Mode segmented control */}
          <SlidingPillTrack
            activeKey={mode}
            pillClassName="rounded-md bg-brand-500 shadow-[0_0_12px_rgba(245,158,11,0.35)]"
            className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-1"
          >
            {(
              [
                { id: 'normal', label: 'Normale' },
                { id: 'snr', label: 'Freebet SNR' },
                { id: 'sr', label: 'Bonus SR' },
                { id: 'rf', label: 'Rimborso RF' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                data-pill-key={m.id}
                data-testid={`pp-mode-${m.id}`}
                onClick={() => onChangeMode(m.id)}
                className={`relative z-10 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  mode === m.id ? 'font-bold text-slate-950' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </SlidingPillTrack>

          {/* Stake + Anchor / RF */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1">
            <span className="text-[11px] font-medium text-slate-400">
              {mode === 'normal' && anchorMode === 'total' ? 'Budget' : 'Puntata'}
            </span>
            <NumericInput
              value={stake}
              onChange={(v) => onChangeStake(Math.max(1, v))}
              min={1}
              data-testid="pp-stake-input"
              className="w-16 bg-transparent text-xs font-bold text-white focus:outline-none"
            />
            <span className="text-xs text-slate-500">€</span>

            {mode === 'normal' && (
              <SlidingPillTrack
                activeKey={anchorMode}
                pillClassName="rounded bg-slate-700"
                className="ml-1 flex items-center rounded-md border border-slate-800 bg-slate-900 p-0.5 text-[10px]"
              >
                <button
                  type="button"
                  data-pill-key="leg0"
                  onClick={() => onChangeAnchorMode('leg0')}
                  className={`relative z-10 rounded px-1.5 py-0.5 font-semibold ${
                    anchorMode === 'leg0' ? 'text-white' : 'text-slate-400'
                  }`}
                >
                  Punta 1
                </button>
                <button
                  type="button"
                  data-pill-key="total"
                  onClick={() => onChangeAnchorMode('total')}
                  className={`relative z-10 rounded px-1.5 py-0.5 font-semibold ${
                    anchorMode === 'total' ? 'text-white' : 'text-slate-400'
                  }`}
                >
                  Budget Tot
                </button>
              </SlidingPillTrack>
            )}

            {mode === 'rf' && (
              <div className="ml-1 flex items-center gap-2 border-l border-slate-800 pl-2 text-[11px]">
                <span className="text-amber-300/80">Rimb.</span>
                <NumericInput
                  value={refundAmount}
                  onChange={(v) => onChangeRefundAmount(Math.max(0, v))}
                  min={0}
                  className="w-12 bg-transparent font-bold text-white focus:outline-none"
                />
                <span className="text-slate-500">€ • Rit.</span>
                <NumericInput
                  value={refundRetention}
                  onChange={(v) => onChangeRefundRetention(Math.max(0, Math.min(100, v)))}
                  min={0}
                  max={100}
                  allowDecimal={false}
                  className="w-9 bg-transparent font-bold text-white focus:outline-none"
                />
                <span className="text-slate-500">%</span>
              </div>
            )}
          </div>

          {/* Sport pills */}
          <SlidingPillTrack
            activeKey={sport}
            pillClassName="rounded-md bg-slate-700 shadow-sm"
            className="flex items-center rounded-lg border border-slate-800 bg-slate-950 p-1"
          >
            {(
              [
                { id: 'ALL', label: 'Tutti' },
                { id: 'football', label: 'Calcio' },
                { id: 'tennis', label: 'Tennis' },
                { id: 'basketball', label: 'Basket' },
              ] as const
            ).map((sp) => (
              <button
                key={sp.id}
                type="button"
                data-pill-key={sp.id}
                data-testid={`pp-sport-${sp.id}`}
                onClick={() => setSport(sp.id)}
                className={`relative z-10 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  sport === sp.id ? 'font-bold text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sp.label}
              </button>
            ))}
          </SlidingPillTrack>

          {/* Search */}
          <div className="relative min-w-[210px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca squadra, lega, esito, bookmaker..."
              data-testid="pp-search-input"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-brand-400 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={onToggleKpis}
            data-testid="pp-toggle-kpis"
            title={showKpis ? 'Nascondi riepilogo KPI' : 'Mostra riepilogo KPI'}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              showKpis
                ? 'border-brand-400/50 bg-brand-500/10 text-brand-200'
                : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Riepilogo
          </button>

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            data-testid="pp-toggle-filters"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
              showFilters
                ? 'border-brand-400/50 bg-brand-500/10 text-brand-200'
                : activeFilterChips.length > 0
                ? 'border-brand-400/50 bg-brand-500/15 text-brand-100 shadow-[0_0_14px_-4px_rgb(var(--brand-400)/0.45)] hover:border-brand-400/70 hover:bg-brand-500/20'
                : 'border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900'
            }`}
          >
            <Filter
              className={`h-3.5 w-3.5 ${
                !showFilters && activeFilterChips.length > 0 ? 'text-brand-300' : ''
              }`}
            />
            <span>Filtri</span>
          </button>
        </div>

        {/* Compact Active Filters Strip when banner is closed */}
        <AnimatePresence initial={false}>
          {!showFilters && activeFilterChips.length > 0 && (
            <motion.div
              key="pp-collapsed-filters-bar"
              data-testid="pp-collapsed-filters-bar"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Filtri attivi:
                  </span>
                  {activeFilterChips.map((chip) => (
                    <span
                      key={chip.id}
                      data-testid={`pp-filter-chip-${chip.id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-brand-400/30 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-200"
                    >
                      <span className="max-w-[220px] truncate">{chip.label}</span>
                      <button
                        type="button"
                        onClick={chip.onClear}
                        aria-label={`Rimuovi filtro ${chip.label}`}
                        className="rounded-full p-0.5 text-brand-300/75 transition hover:bg-brand-400/20 hover:text-white"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>

                <button
                  type="button"
                  data-testid="pp-collapsed-reset-filters"
                  onClick={() => applyPreset('reset')}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-0.5 text-[10px] font-semibold text-slate-300 transition hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-200"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  Reset Filtri
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapsible 7-filter drawer + quick presets */}
        <AnimatePresence initial={false}>
          {showFilters && (
            <motion.div
              key="pp-filters-drawer"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-3 border-t border-slate-800/80 pt-3">
                {/* Matched Betting Quick Presets */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Preset Rapidi:
                  </span>
                  <button
                    type="button"
                    data-testid="pp-preset-qualifier"
                    onClick={() => applyPreset('qualifier')}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                  >
                    Qualificante (&ge;95%)
                  </button>
                  <button
                    type="button"
                    data-testid="pp-preset-snr"
                    onClick={() => applyPreset('snr')}
                    className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-300 transition hover:bg-sky-500/20"
                  >
                    Freebet SNR (Q &ge; 3.5)
                  </button>
                  <button
                    type="button"
                    data-testid="pp-preset-surebet"
                    onClick={() => applyPreset('surebet')}
                    className="rounded-lg border border-brand-400/35 bg-brand-500/15 px-2.5 py-1 text-[11px] font-medium text-brand-200 transition hover:bg-brand-500/25"
                  >
                    Solo Surebet (&ge;100%)
                  </button>
                  <button
                    type="button"
                    data-testid="pp-preset-twoway"
                    onClick={() => applyPreset('twoway')}
                    className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-[11px] font-medium text-purple-200 transition hover:bg-purple-500/20"
                  >
                    Solo 2 Esiti (1v1)
                  </button>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      data-testid="pp-preset-reset"
                      onClick={() => applyPreset('reset')}
                      className="ml-auto rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      Reset Filtri
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Competizioni ({leagues.length === 0 ? 'Tutte' : leagues.length})
                    </label>
                    <CustomMultiSelect<string>
                      values={leagues}
                      options={competitionOptions}
                      allLabel="Tutte le competizioni"
                      minMenuWidth={230}
                      onChange={setLeagues}
                      data-testid="pp-filter-leagues"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Mercato
                    </label>
                    <CustomSelect<MarketType | 'ALL'>
                      value={market}
                      options={MARKET_OPTIONS}
                      onChange={setMarket}
                      size="sm"
                      minMenuWidth={200}
                      data-testid="pp-filter-market"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Bookmaker Punta 1
                    </label>
                    <SourceMultiSelect
                      values={primaryBookmakers}
                      options={bookmakerOptions}
                      allLabel="Tutti i Bookmaker"
                      minMenuWidth={230}
                      onChange={setPrimaryBookmakers}
                      data-testid="pp-filter-primary-bookies"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Bookmaker Copertura
                    </label>
                    <SourceMultiSelect
                      values={hedgeBookmakers}
                      options={bookmakerOptions}
                      allLabel="Tutti i Bookmaker"
                      minMenuWidth={230}
                      onChange={setHedgeBookmakers}
                      data-testid="pp-filter-hedge-bookies"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Quota Min
                      </label>
                      <NumericInput
                        value={minBack}
                        onChange={(v) => setMinBack(Math.max(1.01, v))}
                        min={1.01}
                        data-testid="pp-filter-min-back"
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-brand-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Quota Max
                      </label>
                      <NumericInput
                        value={maxBack}
                        onChange={(v) => setMaxBack(Math.max(1.1, v))}
                        min={1.1}
                        data-testid="pp-filter-max-back"
                        className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-brand-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Rating Min (%)
                    </label>
                    <NumericInput
                      value={minRating}
                      onChange={(v) => setMinRating(Math.max(0, v))}
                      min={0}
                      max={200}
                      data-testid="pp-filter-min-rating"
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-brand-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Esiti / Copertura
                    </label>
                    <CustomSelect<OutcomesFilterMode>
                      value={outcomesMode}
                      options={OUTCOMES_MODE_OPTIONS}
                      onChange={setOutcomesMode}
                      size="sm"
                      minMenuWidth={230}
                      data-testid="pp-filter-outcomes-mode"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Data / Periodo
                    </label>
                    <div className="mt-1">
                      <DateRangeCalendar
                        value={dateRange}
                        onChange={handleDateRangeChange}
                        eventDateCounts={eventDateCounts}
                        isScraping={isDateRangeScraping && isFutureDateSelected}
                        data-testid="pp-filter-date-range"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Results Table or Connection Alert */}
      {matchedRows.length === 0 ? (
        isDateRangeScraping && isFutureDateSelected ? (
          <div
            data-testid="pp-date-scrape-loading"
            className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-10 text-center"
          >
            <div className="relative flex h-14 w-14 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400/30" />
              <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-brand-400/40 bg-brand-500/15 text-brand-300 shadow-glow">
                <Radar className="h-5 w-5 animate-spin" />
              </div>
            </div>
            <div>
              <h3 className="font-display text-sm font-bold text-white">
                Ricerca Quote Future in Corso...
              </h3>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
                Scansione di tutti i Bookmaker per trovare le competizioni e le quote Punta-Punta nel periodo{' '}
                <strong className="font-mono text-brand-200">{selectedDateLabel}</strong>.
              </p>
            </div>
          </div>
        ) : snapshot.rows.length === 0 && (snapshot.backMarketGroups?.length ?? 0) === 0 ? (
          !autoScrapeActive &&
          !snapshot.stats.isRunning &&
          isBrowserOnline &&
          snapshot.connection.health !== 'offline' &&
          snapshot.connection.failedSourcesCount === 0 ? (
            <div className="glass-panel rounded-2xl">
              <AutoScrapePausedState
                description="Riavvia l'aggiornamento automatico o avvia una scansione manuale per generare gli abbinamenti Punta-Punta."
                onRetryScrape={onRetryScrape}
                onRestartAutoScrape={onRestartAutoScrape}
              />
            </div>
          ) : (
            <div className="glass-panel rounded-2xl">
              <ConnectionAlert
                snapshot={snapshot}
                isBrowserOnline={isBrowserOnline}
                variant="empty"
                onRetry={onRetryScrape}
                onOpenScrapers={onOpenScrapers}
              />
            </div>
          )
        ) : (
          <div
            data-testid="pp-empty-state"
            className="rounded-2xl border border-slate-800 bg-slate-900/50 p-10 text-center"
          >
            <Scale className="mx-auto h-9 w-9 text-slate-600" />
            <h3 className="mt-3 text-sm font-bold text-slate-200">
              Nessun confronto Punta-Punta con questi filtri
            </h3>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
              {isFutureDateSelected
                ? `Nessun confronto trovato nel periodo ${selectedDateLabel} con i filtri attuali. Puoi rilanciare la scansione sul periodo o allargare i filtri.`
                : 'Prova ad allargare i filtri di quota, abbassare il rating minimo o selezionare più bookmaker per Punta 1 / Copertura.'}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {isFutureDateSelected && onDateRangeFilterChange && (
                <button
                  type="button"
                  data-testid="pp-rescan-date-btn"
                  onClick={() => onDateRangeFilterChange(dateRange, { force: true })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3.5 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Riscansiona periodo {selectedDateLabel}
                </button>
              )}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => applyPreset('reset')}
                  className="rounded-lg border border-brand-400/40 bg-brand-500/15 px-3.5 py-1.5 text-xs font-semibold text-brand-200 hover:bg-brand-500/25"
                >
                  Ripristina tutti i filtri
                </button>
              )}
            </div>
          </div>
        )
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/70 shadow-xl">
          {isDateRangeScraping && isFutureDateSelected && (
            <div
              data-testid="pp-date-scrape-banner"
              className="flex items-center justify-between gap-2 border-b border-brand-400/25 bg-brand-500/10 px-4 py-2 text-xs text-brand-200"
            >
              <div className="flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-300" />
                <span>
                  Ricerca competizioni e quote Punta-Punta per il periodo{' '}
                  <strong className="font-mono text-white">{selectedDateLabel}</strong> in corso...
                </span>
              </div>
              <span className="font-mono text-[11px] text-brand-300/90">
                {matchedRows.length} abbinamenti già disponibili
              </span>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/90 bg-slate-950/75">
                  <th className="px-3.5 py-3">{sortHeader('Data/Ora', 'startTime')}</th>
                  <th className="px-3.5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Evento &amp; Campionato
                  </th>
                  <th className="px-3.5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Mercato / Esito 1
                  </th>
                  <th className="px-3.5 py-3">{sortHeader('Rating', 'rating')}</th>
                  <th className="px-3.5 py-3">{sortHeader('Punta 1 (Book)', 'backOdds')}</th>
                  <th className="px-3.5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Copertura (Punta)
                  </th>
                  <th className="px-3.5 py-3">{sortHeader('Lavagna', 'impliedProb')}</th>
                  <th className="px-3.5 py-3">{sortHeader('Esito (€)', 'profit')}</th>
                  <th className="px-3.5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Azioni
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {visibleRows.map((row) => {
                  const tm = formatEventTime(row.startTime);
                  const rClass = ratingTone(row.rating, mode);
                  return (
                    <tr
                      key={row.id}
                      data-testid="pp-matcher-row"
                      onClick={() => onSelectRow(row)}
                      className={`group cursor-pointer transition-colors hover:bg-slate-800/50 ${
                        row.isSurebet ? 'bg-brand-500/[0.03]' : ''
                      }`}
                    >
                      <td className={`whitespace-nowrap px-3.5 ${rowPad} tabular-nums`}>
                        <div className="font-semibold text-slate-200">{tm.date}</div>
                        <div className="text-[11px] text-slate-400">
                          {tm.time} {tm.relative && <span className="text-slate-500">({tm.relative})</span>}
                        </div>
                      </td>

                      <td className={`max-w-[230px] px-3.5 ${rowPad}`}>
                        <div className="truncate font-bold text-white transition group-hover:text-brand-200">
                          {row.eventName}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-semibold text-slate-300">
                            {sportLabel(row.sport)}
                          </span>
                          <span className="truncate">{row.league}</span>
                        </div>
                      </td>

                      <td className={`px-3.5 ${rowPad}`}>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-400">{row.marketLabel}</span>
                          <span className="rounded bg-slate-800/90 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-300">
                            {row.outcomeCount} esiti
                          </span>
                        </div>
                        <div className="mt-0.5 font-bold text-brand-300">
                          {row.primaryLeg.selectionLabel}
                        </div>
                      </td>

                      <td className={`whitespace-nowrap px-3.5 ${rowPad}`}>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`rounded-lg border px-2 py-1 text-xs font-extrabold tabular-nums ${
                              row.isSurebet
                                ? 'border-brand-400/50 bg-brand-500/15 shadow-[0_0_12px_-4px_rgba(245,158,11,0.5)]'
                                : 'border-slate-800 bg-slate-950/70'
                            } ${rClass}`}
                          >
                            {formatPct(row.rating)}
                          </span>
                          {row.isSurebet && (
                            <span title="Surebet Punta-Punta (>= 100%)">
                              <Flame className="h-3.5 w-3.5 text-amber-400" />
                            </span>
                          )}
                        </div>
                      </td>

                      <td className={`whitespace-nowrap px-3.5 ${rowPad}`}>
                        <div className="flex items-center gap-2.5">
                          <BookmakerIcon sourceId={row.primaryLeg.bookmakerId} size={logoSize} />
                          <div>
                            <div className="font-semibold text-slate-200">
                              {row.primaryLeg.bookmakerName}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="font-mono text-xs font-extrabold text-brand-300">
                                @{formatOdds(row.primaryLeg.odds)}
                              </span>
                              <span className="text-[10px] tabular-nums text-slate-400">
                                {formatEuro(row.primaryLeg.stake)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className={`px-3.5 ${rowPad}`}>
                        <div className="flex flex-col gap-1">
                          {row.hedgeLegs.map((h) => (
                            <div
                              key={`${h.selectionKey}-${h.bookmakerId}`}
                              className="flex items-center gap-2 rounded-lg border border-slate-800/80 bg-slate-950/60 px-2 py-1"
                            >
                              <BookmakerIcon sourceId={h.bookmakerId} size={hedgeLogoSize} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className="truncate font-semibold text-slate-200">
                                    {h.bookmakerName}
                                  </span>
                                  <span className="font-mono font-extrabold text-sky-300">
                                    @{formatOdds(h.odds)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                                  <span className="truncate">{h.selectionLabel}</span>
                                  <span className="tabular-nums font-semibold text-slate-300">
                                    {formatEuro(h.stake)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>

                      <td className={`whitespace-nowrap px-3.5 ${rowPad} tabular-nums`}>
                        <span
                          className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${
                            row.lavagnaPct <= 100
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-slate-800/80 text-slate-300'
                          }`}
                        >
                          {row.lavagnaPct.toFixed(2)}%
                        </span>
                      </td>

                      <td className={`whitespace-nowrap px-3.5 ${rowPad} tabular-nums`}>
                        <div
                          className={`font-extrabold ${
                            row.guaranteedProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatEuro(row.guaranteedProfit, true)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Esb. {formatEuro(row.totalCashOutlay)}
                        </div>
                      </td>

                      <td className={`whitespace-nowrap px-3.5 ${rowPad} text-center`}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectRow(row);
                          }}
                          data-testid="pp-open-drawer-btn"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:border-brand-400/60 hover:bg-brand-500/15 hover:text-brand-200"
                        >
                          <Calculator className="h-3.5 w-3.5" />
                          Confronta
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {matchedRows.length > visibleRows.length && (
            <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-950/60 px-4 py-2.5 text-xs text-slate-400">
              <span>
                Mostrati <strong className="text-slate-200">{visibleRows.length}</strong> di{' '}
                <strong className="text-slate-200">{matchedRows.length}</strong> match Punta-Punta
              </span>
              <button
                type="button"
                onClick={() => setPageSize((s) => s + 80)}
                data-testid="pp-load-more"
                className="rounded-lg border border-brand-400/40 bg-brand-500/10 px-3 py-1 font-semibold text-brand-200 hover:bg-brand-500/20"
              >
                Carica altri 80 match
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

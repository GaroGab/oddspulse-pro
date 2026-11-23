import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BellPlus,
  Calculator,
  Filter,
  Flame,
  LayoutGrid,
  Layers,
  Lock,
  Radar,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { calculateSingleMatch } from '../../shared/math';
import {
  type BetMode,
  type MarketType,
  type OddsmatcherRow,
  type ScrapeSnapshot,
  type SportKey,
  type TableDensity,
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
import { NumericInput } from './NumericInput';
import { BookmakerIcon } from './BookmakerIcon';
import { ConnectionAlert } from './ConnectionAlert';
import { CustomSelect } from './CustomSelect';
import {
  DateRangeCalendar,
  EMPTY_DATE_RANGE,
  matchesDateRange,
  toLocalDateKey,
  type DateRangeValue,
} from './DateRangeCalendar';
import { SlidingPillTrack } from './SlidingPillTrack';
import {
  buildBookmakerSourceOptions,
  buildExchangeSourceOptions,
  SourceMultiSelect,
  type SourceOption,
} from './SourceSelect';

interface OddsmatcherViewProps {
  snapshot: ScrapeSnapshot;
  isBrowserOnline: boolean;
  mode: BetMode;
  stake: number;
  tableDensity: TableDensity;
  showKpis: boolean;
  lockedRowIds: string[];
  onChangeMode: (m: BetMode) => void;
  onChangeStake: (s: number) => void;
  onSelectRow: (row: OddsmatcherRow) => void;
  onToggleLockMulti: (row: OddsmatcherRow) => void;
  onCreateRatingWatch?: (row: OddsmatcherRow) => void;
  onToggleKpis: () => void;
  onRetryScrape: () => void;
  onOpenScrapers: () => void;
}

type SortKey = 'rating' | 'profit' | 'backOdds' | 'layOdds' | 'liquidity' | 'startTime';

export const OddsmatcherView: React.FC<OddsmatcherViewProps> = React.memo(({
  snapshot,
  isBrowserOnline,
  mode,
  stake,
  tableDensity,
  showKpis,
  lockedRowIds,
  onChangeMode,
  onChangeStake,
  onSelectRow,
  onToggleLockMulti,
  onCreateRatingWatch,
  onToggleKpis,
  onRetryScrape,
  onOpenScrapers,
}) => {
  const rowPad =
    tableDensity === 'compact' ? 'py-1.5' : tableDensity === 'spacious' ? 'py-3.5' : 'py-2.5';
  const logoSize =
    tableDensity === 'compact' ? 22 : tableDensity === 'spacious' ? 30 : 26;
  const [search, setSearch] = useState('');
  const [sport, setSport] = useState<SportKey | 'ALL'>('ALL');
  const [market, setMarket] = useState<MarketType | 'ALL'>('ALL');
  const [bookmakers, setBookmakers] = useState<string[]>([]);
  const [exchanges, setExchanges] = useState<string[]>([]);
  const [minBack, setMinBack] = useState<number>(1.15);
  const [maxBack, setMaxBack] = useState<number>(15);
  const [minRating, setMinRating] = useState<number>(0);
  const [minLiquidity, setMinLiquidity] = useState<number>(5);
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [onlySurebets, setOnlySurebets] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('rating');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [pageSize, setPageSize] = useState(60);

  const lockedSet = useMemo(() => new Set(lockedRowIds), [lockedRowIds]);

  const bookmakerOptions = useMemo<SourceOption[]>(
    () => buildBookmakerSourceOptions(snapshot),
    [snapshot]
  );

  const exchangeOptions = useMemo<SourceOption[]>(
    () => buildExchangeSourceOptions(snapshot),
    [snapshot]
  );

  // Prune any previously selected bookmaker/exchange if it later enters error state
  useEffect(() => {
    const disabledBookIds = new Set(bookmakerOptions.filter((o) => o.disabled).map((o) => o.id));
    if (disabledBookIds.size > 0) {
      setBookmakers((prev) => {
        const next = prev.filter((id) => !disabledBookIds.has(id));
        return next.length === prev.length ? prev : next;
      });
    }
    const disabledExIds = new Set(exchangeOptions.filter((o) => o.disabled).map((o) => o.id));
    if (disabledExIds.size > 0) {
      setExchanges((prev) => {
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

  const enriched = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nowMs = Date.now();

    const list: Array<{
      row: OddsmatcherRow;
      rating: number;
      profit: number;
      layStake: number;
      liability: number;
    }> = [];

    for (const row of snapshot.rows) {
      if (sport !== 'ALL' && row.sport !== sport) continue;
      if (market !== 'ALL' && row.marketType !== market) continue;
      if (bookmakers.length > 0 && !bookmakers.includes(row.bookmakerId)) continue;
      if (exchanges.length > 0 && !exchanges.includes(row.exchangeId)) continue;
      if (row.backOdds < minBack || row.backOdds > maxBack) continue;
      if (row.liquidity < minLiquidity) continue;
      if (onlySurebets && !row.isSurebet) continue;

      if (!matchesDateRange(row.startTime, dateRange, nowMs)) continue;

      if (q) {
        const hay = `${row.eventName} ${row.league} ${row.selectionLabel} ${row.bookmakerName}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }

      const calc = calculateSingleMatch({
        mode,
        stake,
        backOdds: row.backOdds,
        layOdds: row.layOdds,
        commission: row.commission,
        refundAmount: stake,
        refundRetention: 70,
      });

      if (calc.rating < minRating) continue;

      list.push({
        row,
        rating: calc.rating,
        profit: calc.expectedProfit,
        layStake: calc.layStake,
        liability: calc.liability,
      });
    }

    const mult = sortDir === 'desc' ? -1 : 1;
    list.sort((a, b) => {
      switch (sortBy) {
        case 'rating':
          return (a.rating - b.rating) * mult;
        case 'profit':
          return (a.profit - b.profit) * mult;
        case 'backOdds':
          return (a.row.backOdds - b.row.backOdds) * mult;
        case 'layOdds':
          return (a.row.layOdds - b.row.layOdds) * mult;
        case 'liquidity':
          return (a.row.liquidity - b.row.liquidity) * mult;
        case 'startTime':
          return (
            (new Date(a.row.startTime).getTime() - new Date(b.row.startTime).getTime()) * mult
          );
      }
    });

    return list;
  }, [
    snapshot.rows,
    search,
    sport,
    market,
    bookmakers,
    exchanges,
    minBack,
    maxBack,
    minRating,
    minLiquidity,
    dateRange,
    onlySurebets,
    mode,
    stake,
    sortBy,
    sortDir,
  ]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'startTime' ? 'asc' : 'desc');
    }
  };

  const bestRow = enriched[0];
  const avgTopLiq = useMemo(() => {
    const top = enriched.slice(0, 20);
    if (top.length === 0) return 0;
    return top.reduce((s, x) => s + x.row.liquidity, 0) / top.length;
  }, [enriched]);

  const visibleRows = enriched.slice(0, pageSize);

  const hasConnectionIssue =
    !isBrowserOnline ||
    snapshot.connection.health === 'offline' ||
    (snapshot.rows.length === 0 &&
      !snapshot.stats.isRunning &&
      (snapshot.connection.failedSourcesCount > 0 ||
        snapshot.connection.exchangesOnlineCount === 0));

  const noSourcesEnabled = snapshot.connection.enabledSourcesCount === 0;

  const resetAllFilters = () => {
    onChangeMode('normal');
    setSport('ALL');
    setMarket('ALL');
    setBookmakers([]);
    setExchanges([]);
    setMinBack(1.15);
    setMaxBack(15);
    setMinRating(0);
    setMinLiquidity(5);
    setDateRange(EMPTY_DATE_RANGE);
    setOnlySurebets(false);
    setSearch('');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Collapsible KPI Hero Row */}
      <div
        data-testid="oddsmatcher-kpi-wrapper"
        className={`grid transition-[grid-template-rows,opacity,margin-bottom] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          showKpis ? 'mb-4 grid-rows-[1fr] opacity-100' : 'mb-0 grid-rows-[0fr] opacity-0 pointer-events-none'
        }`}
      >
        <div className="overflow-hidden">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.02 }}
          onClick={() => bestRow && onSelectRow(bestRow.row)}
          className="glass-card glass-card-hover cursor-pointer rounded-2xl p-3.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">
              Miglior Rating ({mode.toUpperCase()})
            </span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-400/15 text-brand-300">
              <Sparkles className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <AnimatedNumber
              value={bestRow?.rating ?? 0}
              formatter={(v) => formatPct(v)}
              className="font-display text-2xl font-bold text-white"
            />
            {bestRow && (
              <span className="truncate text-[11px] text-brand-300">{bestRow.row.eventName}</span>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
          className="glass-card rounded-2xl p-3.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">Match Punta/Banca</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-500/15 text-accent-300">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <AnimatedNumber
              value={enriched.length}
              formatter={(v) => Math.round(v).toLocaleString('it-IT')}
              className="font-display text-2xl font-bold text-white"
            />
            <span className="text-[11px] text-slate-500">
              su {snapshot.rows.length.toLocaleString('it-IT')} live
            </span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onClick={() => setOnlySurebets((v) => !v)}
          className={`glass-card glass-card-hover cursor-pointer rounded-2xl p-3.5 ${
            onlySurebets ? 'border-brand-400/60 bg-brand-500/10' : ''
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">Surebet (&ge; 100%)</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
              <Flame className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <AnimatedNumber
              value={snapshot.stats.surebetsCount}
              formatter={(v) => String(Math.round(v))}
              className="font-display text-2xl font-bold text-emerald-300"
            />
            <span className="text-[11px] text-slate-400">
              {onlySurebets ? 'Filtro Surebet attivo' : 'Clicca per filtrare'}
            </span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14 }}
          className="glass-card rounded-2xl p-3.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">Liquidità Media Top 20</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
              <Radar className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <AnimatedNumber
              value={avgTopLiq}
              formatter={(v) => formatEuro(v)}
              className="font-display text-2xl font-bold text-white"
            />
            <span className="text-[11px] text-slate-400">Exchange</span>
          </div>
        </motion.div>
          </div>
        </div>
      </div>

      {/* Control & Filter Panel */}
      <div className="glass-panel relative z-30 mb-4 rounded-2xl p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Mode + Stake quick selector */}
          <div className="flex flex-wrap items-center gap-2">
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
                ] as Array<{ id: BetMode; label: string }>
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  data-pill-key={m.id}
                  onClick={() => onChangeMode(m.id)}
                  className={`relative z-10 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    mode === m.id ? 'text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </SlidingPillTrack>

            <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-1">
              <span className="text-[11px] text-slate-400">Puntata €</span>
              <NumericInput
                min={1}
                value={stake}
                onChange={onChangeStake}
                placeholder="50"
                aria-label="Puntata euro"
                className="w-16 bg-transparent font-mono text-xs font-bold text-brand-200 focus:outline-none"
              />
            </div>

            {/* Sport Pills */}
            <SlidingPillTrack
              activeKey={sport}
              pillClassName="rounded-lg bg-slate-800 shadow-inner"
              className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/70 p-0.5"
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
                  className={`relative z-10 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    sport === sp.id ? 'text-brand-300' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {sp.label}
                </button>
              ))}
            </SlidingPillTrack>
          </div>

          {/* Search & Toggle Filters */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca squadra, lega, esito..."
                className="w-56 rounded-xl border border-slate-800 bg-slate-950/80 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-brand-400/60 focus:outline-none"
              />
            </div>
            <button
              type="button"
              data-testid="toggle-kpi-cards"
              onClick={onToggleKpis}
              title={showKpis ? 'Nascondi schede riepilogo KPI' : 'Mostra schede riepilogo KPI'}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                showKpis
                  ? 'border-brand-400/40 bg-brand-500/10 text-brand-200'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Riepilogo
            </button>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                showFilters
                  ? 'border-brand-400/40 bg-brand-500/10 text-brand-200'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              Filtri
            </button>
          </div>
        </div>

        {/* Advanced Filter Row */}
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-3 space-y-2.5 border-t border-slate-800/80 pt-3"
          >
            {/* Quick Matched Betting Presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mr-1">
                Preset Rapidi:
              </span>
              <button
                onClick={() => {
                  onChangeMode('normal');
                  setMinBack(1.5);
                  setMaxBack(5.0);
                  setMinRating(95);
                  setMinLiquidity(25);
                  setOnlySurebets(false);
                }}
                className="rounded-lg border border-brand-400/25 bg-brand-500/10 px-2.5 py-1 text-[10px] font-semibold text-brand-200 transition hover:bg-brand-500/20"
              >
                Qualificante (&ge;95%)
              </button>
              <button
                onClick={() => {
                  onChangeMode('snr');
                  setMinBack(4.0);
                  setMaxBack(12.0);
                  setMinRating(65);
                  setMinLiquidity(20);
                  setOnlySurebets(false);
                }}
                className="rounded-lg border border-accent-400/25 bg-accent-500/10 px-2.5 py-1 text-[10px] font-semibold text-accent-200 transition hover:bg-accent-500/20"
              >
                Freebet SNR (Q &ge; 4.0)
              </button>
              <button
                onClick={() => {
                  onChangeMode('normal');
                  setMinBack(1.1);
                  setMaxBack(20);
                  setMinRating(100);
                  setMinLiquidity(10);
                  setOnlySurebets(true);
                }}
                className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
              >
                Solo Surebet (&ge;100%)
              </button>
              <button
                onClick={() => {
                  setMinLiquidity(100);
                  setOnlySurebets(false);
                }}
                className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-200 transition hover:bg-amber-500/20"
              >
                Alta Liquidità (&ge;100€)
              </button>
              <button
                onClick={resetAllFilters}
                className="ml-auto rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-1 text-[10px] font-medium text-slate-400 transition hover:text-white"
              >
                Reset Filtri
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500">Mercato</label>
              <CustomSelect<MarketType | 'ALL'>
                data-testid="om-market-select"
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
              <label className="text-[10px] uppercase tracking-wider text-slate-500">Bookmaker</label>
              <SourceMultiSelect
                data-testid="om-bookmaker-select"
                values={bookmakers}
                allLabel="Tutti i Bookmaker"
                options={bookmakerOptions}
                onChange={setBookmakers}
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500">Exchange</label>
              <SourceMultiSelect
                data-testid="om-exchange-select"
                values={exchanges}
                allLabel="Tutti gli Exchange"
                options={exchangeOptions}
                onChange={setExchanges}
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500">
                Quota Punta (Min / Max)
              </label>
              <div className="mt-1 flex items-center gap-1">
                <input
                  type="number"
                  step={0.1}
                  min={1.01}
                  value={minBack}
                  onChange={(e) => setMinBack(parseFloat(e.target.value) || 1.01)}
                  className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                />
                <input
                  type="number"
                  step={0.5}
                  min={1.05}
                  value={maxBack}
                  onChange={(e) => setMaxBack(parseFloat(e.target.value) || 50)}
                  className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500">
                Rating Min (%)
              </label>
              <input
                type="number"
                step={1}
                value={minRating}
                onChange={(e) => setMinRating(parseFloat(e.target.value) || 0)}
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500">
                Liquidità Min (€)
              </label>
              <input
                type="number"
                step={5}
                min={0}
                value={minLiquidity}
                onChange={(e) => setMinLiquidity(parseFloat(e.target.value) || 0)}
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500">
                Data / Periodo
              </label>
              <DateRangeCalendar
                value={dateRange}
                onChange={setDateRange}
                eventDateCounts={eventDateCounts}
              />
            </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Main Live Odds Table */}
      <div
        style={{ contain: 'layout style' }}
        className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl"
      >
        <div className="flex-1 overflow-auto">
          {snapshot.rows.length === 0 && snapshot.stats.isRunning ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-10 text-center">
              <div className="relative flex h-16 w-16 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400/30" />
                <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-400/40 bg-brand-500/15 text-brand-300 shadow-glow">
                  <Radar className="h-6 w-6 animate-spin" />
                </div>
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-white">
                  Scraping Quote Live in Corso...
                </h3>
                <p className="mt-1 max-w-md text-xs text-slate-400">
                  Connessione simultanea a Betfair Exchange IT, Smarkets, Sisal.it, SNAI.it, Betflag.it, Eurobet.it, GoldBet.it, 888sport.it, LeoVegas.it, Betfair Sportsbook, Unibet, Paf e Pinnacle.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {snapshot.sources
                  .filter((s) => s.enabled)
                  .map((s) => (
                    <span
                      key={s.id}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                        s.state === 'ok'
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                          : s.state === 'scraping'
                          ? 'border-brand-400/40 bg-brand-500/10 text-brand-200'
                          : 'border-slate-800 bg-slate-900 text-slate-500'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          s.state === 'ok'
                            ? 'bg-emerald-400'
                            : s.state === 'scraping'
                            ? 'animate-ping bg-brand-400'
                            : 'bg-slate-600'
                        }`}
                      />
                      {s.shortName} {s.marketsCount > 0 && `(${s.marketsCount})`}
                    </span>
                  ))}
              </div>
            </div>
          ) : snapshot.rows.length === 0 && hasConnectionIssue ? (
            <ConnectionAlert
              snapshot={snapshot}
              isBrowserOnline={isBrowserOnline}
              variant="empty"
              onRetry={onRetryScrape}
              onOpenScrapers={onOpenScrapers}
            />
          ) : snapshot.rows.length === 0 && noSourcesEnabled ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
              <Radar className="h-8 w-8 text-amber-400" />
              <div className="text-sm font-semibold text-slate-200">
                Nessuna fonte di scraping attiva
              </div>
              <p className="max-w-md text-xs text-slate-400">
                Attiva almeno un bookmaker e un exchange nella sezione Motore Scraping per confrontare le quote.
              </p>
              <button
                onClick={onOpenScrapers}
                className="rounded-xl border border-brand-400/40 bg-brand-500/15 px-4 py-2 text-xs font-bold text-brand-200 hover:bg-brand-500/25"
              >
                Apri Motore Scraping
              </button>
            </div>
          ) : enriched.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2.5 p-10 text-center">
              <Search className="h-8 w-8 text-slate-600" />
              <div className="text-sm font-semibold text-slate-300">
                Nessun match corrisponde ai filtri attuali
              </div>
              <p className="text-xs text-slate-500">
                Ci sono <strong className="text-slate-300">{snapshot.rows.length}</strong> quote live disponibili: prova ad abbassare la liquidità minima, allargare le quote o ripristinare i filtri.
              </p>
              <button
                onClick={resetAllFilters}
                className="mt-1 rounded-xl border border-brand-400/40 bg-brand-500/15 px-4 py-1.5 text-xs font-bold text-brand-200 transition hover:bg-brand-500/25"
              >
                Ripristina tutti i filtri
              </button>
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-20 border-b border-slate-800 bg-[var(--bg-modal-solid)]">
                <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="cursor-pointer px-3.5 py-3 hover:text-brand-300" onClick={() => toggleSort('startTime')}>
                    <span className="inline-flex items-center gap-1">
                      Data/Ora <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="px-3.5 py-3">Evento & Campionato</th>
                  <th className="px-3.5 py-3">Mercato / Esito</th>
                  <th className="cursor-pointer px-3 py-3 text-right hover:text-brand-300" onClick={() => toggleSort('rating')}>
                    <span className="inline-flex items-center gap-1">
                      Rating <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="cursor-pointer px-3 py-3 text-right hover:text-brand-300" onClick={() => toggleSort('backOdds')}>
                    <span className="inline-flex items-center gap-1">
                      Punta (Book) <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="cursor-pointer px-3 py-3 text-right hover:text-brand-300" onClick={() => toggleSort('layOdds')}>
                    <span className="inline-flex items-center gap-1">
                      Banca (Exch) <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="cursor-pointer px-3 py-3 text-right hover:text-brand-300" onClick={() => toggleSort('liquidity')}>
                    <span className="inline-flex items-center gap-1">
                      Liquidità <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="cursor-pointer px-3 py-3 text-right hover:text-brand-300" onClick={() => toggleSort('profit')}>
                    <span className="inline-flex items-center gap-1">
                      Esito (€) <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="px-3.5 py-3 text-right">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/55">
                {visibleRows.map(({ row, rating, profit }) => {
                  const tm = formatEventTime(row.startTime);
                  const isLocked = lockedSet.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      onClick={() => onSelectRow(row)}
                      className="oddsmatcher-row group cursor-pointer transition-colors hover:bg-brand-500/[0.06]"
                    >
                      <td className={`whitespace-nowrap px-3.5 ${rowPad}`}>
                        <div className="font-mono text-xs font-semibold text-slate-200">
                          {tm.date} <span className="text-brand-300">{tm.time}</span>
                        </div>
                        <div className="text-[10px] text-slate-500">{tm.relative}</div>
                      </td>

                      <td className={`max-w-[240px] px-3.5 ${rowPad}`}>
                        <div className="truncate font-semibold text-slate-100 group-hover:text-brand-200">
                          {row.eventName}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                          <span className="rounded bg-slate-800/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-300">
                            {sportLabel(row.sport)}
                          </span>
                          <span className="truncate">{row.league}</span>
                        </div>
                      </td>

                      <td className={`px-3.5 ${rowPad}`}>
                        <div className="font-semibold text-white">{row.selectionLabel}</div>
                        <div className="text-[10px] text-slate-400">{row.marketLabel}</div>
                      </td>

                      <td className={`whitespace-nowrap px-3 ${rowPad} text-right`}>
                        {row.isSurebet && mode === 'normal' ? (
                          <span className="surebet-badge inline-flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-xs font-extrabold text-brand-100">
                            {formatPct(rating)}
                          </span>
                        ) : (
                          <span
                            className={`font-mono text-sm font-bold tabular-nums ${ratingTone(
                              rating,
                              mode
                            )}`}
                          >
                            {formatPct(rating)}
                          </span>
                        )}
                      </td>

                      <td
                        className={`whitespace-nowrap px-3 ${rowPad} text-right ${
                          row.backDelta === 'up'
                            ? 'odds-flash-up'
                            : row.backDelta === 'down'
                            ? 'odds-flash-down'
                            : ''
                        }`}
                      >
                        <div className="inline-flex items-center justify-end gap-2.5">
                          <div className="flex flex-col items-end">
                            <span className="inline-flex items-center gap-1 rounded-md border border-blue-500/35 bg-blue-500/15 px-2 py-0.5 font-mono text-xs font-bold text-blue-200">
                              {row.backDelta === 'up' && <ArrowUp className="h-3 w-3 text-emerald-400" />}
                              {row.backDelta === 'down' && <ArrowDown className="h-3 w-3 text-rose-400" />}
                              {formatOdds(row.backOdds)}
                            </span>
                            <span className="mt-1 text-[10px] font-medium text-slate-300">
                              {row.bookmakerName}
                            </span>
                          </div>
                          <BookmakerIcon
                            sourceId={row.bookmakerId}
                            size={logoSize}
                            className="rounded-md"
                          />
                        </div>
                      </td>

                      <td
                        className={`whitespace-nowrap px-3 ${rowPad} text-right ${
                          row.layDelta === 'up'
                            ? 'odds-flash-up'
                            : row.layDelta === 'down'
                            ? 'odds-flash-down'
                            : ''
                        }`}
                      >
                        <div className="inline-flex items-center justify-end gap-2.5">
                          <div className="flex flex-col items-end">
                            <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/35 bg-rose-500/15 px-2 py-0.5 font-mono text-xs font-bold text-rose-200">
                              {row.layDelta === 'up' && <ArrowUp className="h-3 w-3 text-rose-400" />}
                              {row.layDelta === 'down' && <ArrowDown className="h-3 w-3 text-emerald-400" />}
                              {formatOdds(row.layOdds)}
                            </span>
                            <span className="mt-1 text-[10px] font-medium text-slate-300">
                              {row.exchangeName} ({(row.commission * 100).toFixed(1)}%)
                            </span>
                          </div>
                          <BookmakerIcon
                            sourceId={row.exchangeId}
                            size={logoSize}
                            className="rounded-md"
                          />
                        </div>
                      </td>

                      <td className={`whitespace-nowrap px-3 ${rowPad} text-right font-mono text-xs text-slate-300 tabular-nums`}>
                        {formatEuro(row.liquidity)}
                      </td>

                      <td className={`whitespace-nowrap px-3 ${rowPad} text-right`}>
                        <span
                          className={`font-mono text-xs font-bold tabular-nums ${
                            profit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatEuro(profit, true)}
                        </span>
                      </td>

                      <td
                        className={`whitespace-nowrap px-3.5 ${rowPad} text-right`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => onSelectRow(row)}
                            className="flex items-center gap-1 rounded-lg border border-brand-400/35 bg-brand-500/15 px-2.5 py-1 text-[11px] font-semibold text-brand-200 transition hover:bg-brand-400 hover:text-slate-950"
                            title="Apri Calcolatore Punta-Banca"
                          >
                            <Calculator className="h-3 w-3" />
                            Calcola
                          </button>
                          {onCreateRatingWatch && (
                            <button
                              type="button"
                              data-testid="om-watch-row-btn"
                              onClick={() => onCreateRatingWatch(row)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/80 text-slate-400 transition hover:border-brand-400/50 hover:text-brand-300"
                              title="Monitora rating di questo evento in Radar Rating"
                            >
                              <BellPlus className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            onClick={() => onToggleLockMulti(row)}
                            className={`flex h-7 w-7 items-center justify-center rounded-lg border transition ${
                              isLocked
                                ? 'border-accent-400 bg-accent-500/30 text-accent-100 shadow-glow-accent'
                                : 'border-slate-700/80 bg-slate-900/80 text-slate-400 hover:border-accent-400/50 hover:text-accent-300'
                            }`}
                            title={
                              isLocked
                                ? 'Rimuovi blocco Multiodds'
                                : 'Blocca questo evento nel generatore Multiodds'
                            }
                          >
                            {isLocked ? <Lock className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer / Pagination */}
        {enriched.length > visibleRows.length && (
          <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-950/80 px-4 py-2 text-xs">
            <span className="text-slate-400">
              Visualizzati <strong className="text-white">{visibleRows.length}</strong> di{' '}
              <strong className="text-brand-300">{enriched.length}</strong> match
            </span>
            <button
              onClick={() => setPageSize((s) => s + 80)}
              className="rounded-lg border border-brand-400/30 bg-brand-500/10 px-3 py-1 font-semibold text-brand-200 hover:bg-brand-500/20"
            >
              Carica altri 80 match
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

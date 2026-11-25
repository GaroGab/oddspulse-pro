import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  Ban,
  BellPlus,
  BellRing,
  Calculator,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Edit3,
  EyeOff,
  Flame,
  Gift,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  Trash2,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  EMPTY_DATE_RANGE,
  formatScrapeDateWindowLabel,
  matchesDateRange,
  needsFutureDateScrape,
  resolveScrapeDateWindow,
  toLocalDateKey,
  type DateRangeValue,
} from '../../shared/dateRange';
import {
  appendIgnoredWatchEvent,
  betModeLabelIt,
  buildCompetitionOptions,
  countAvailableCompetitions,
  estimateSingleWatchInterval,
  evaluateRatingWatch,
  extractMatchEventKey,
  getSelectionOptionsForMarket,
  getTopCompetitionValues,
  getWatchLeagues,
  inferSportFromLeague,
  isRowIgnoredByWatch,
  isWatchExpired,
  matchesWatchLeagues,
  normalizeWatchQuery,
  removeIgnoredWatchEvent,
  resolveCanonicalCompetition,
} from '../../shared/ratingWatch';
import {
  SOURCE_CATALOG,
  type AppSettings,
  type BetMode,
  type IgnoredWatchEvent,
  type MarketType,
  type OddsmatcherRow,
  type RatingWatch,
  type RatingWatchEngineStatus,
  type RatingWatchInput,
  type RatingWatchMatchSnapshot,
  type ScrapeSnapshot,
  type SourceId,
  type SportKey,
} from '../../shared/types';
import { formatEuro, formatEventTime, formatOdds, ratingTone, sportLabel } from '../utils/format';
import { playRatingAlertBurst, stopPersistentRatingAlarm } from '../utils/sound';
import { BookmakerIcon } from './BookmakerIcon';
import { CustomMultiSelect, CustomSelect } from './CustomSelect';
import { DateRangeCalendar } from './DateRangeCalendar';
import { NumericInput } from './NumericInput';
import { QuickPresetsMenu, type QuickPresetItem } from './QuickPresetsMenu';
import { SlidingPillTrack } from './SlidingPillTrack';
import {
  buildBookmakerSourceOptions,
  buildExchangeSourceOptions,
  SourceMultiSelect,
} from './SourceSelect';

interface RatingWatchViewProps {
  snapshot: ScrapeSnapshot;
  watches: RatingWatch[];
  status: RatingWatchEngineStatus;
  settings: AppSettings;
  soundEnabled: boolean;
  draftSeed?: {
    key: number;
    row: OddsmatcherRow;
    mode?: BetMode;
  } | null;
  onCreateWatch: (input: RatingWatchInput) => Promise<void> | void;
  onUpdateWatch: (id: string, patch: Partial<RatingWatch>) => Promise<void> | void;
  onDeleteWatch: (id: string) => Promise<void> | void;
  onRunNow: () => Promise<void> | void;
  onDateRangeFilterChange?: (
    range: DateRangeValue,
    opts?: { pendingEnd?: boolean; force?: boolean }
  ) => void;
  onEnableSound: () => void;
  onOpenCalculator: (row: OddsmatcherRow, mode?: BetMode) => void;
  onConsumeDraftSeed?: () => void;
}

interface WatchFormState {
  enabled: boolean;
  eventKey?: string;
  eventName: string;
  sport?: SportKey;
  league?: string;
  leagues: string[];
  startTime?: string;
  dateRange: DateRangeValue;
  marketType: MarketType | 'ALL';
  selectionKey: string;
  bookmakerIds: SourceId[];
  exchangeIds: SourceId[];
  mode: BetMode;
  targetRating: number;
  refundRetention: number;
  minLiquidity: number;
  minBackOdds: number;
  maxBackOdds: number;
  excludeSurebets: boolean;
  autoPauseOnTrigger: boolean;
  cooldownSec: number;
}

function createEmptyForm(defaultMode: BetMode = 'normal'): WatchFormState {
  return {
    enabled: true,
    eventKey: undefined,
    eventName: '',
    sport: undefined,
    league: undefined,
    leagues: [],
    startTime: undefined,
    dateRange: EMPTY_DATE_RANGE,
    marketType: 'ALL',
    selectionKey: 'ALL',
    bookmakerIds: [],
    exchangeIds: [],
    mode: defaultMode,
    targetRating: defaultMode === 'snr' ? 75 : 98,
    refundRetention: 70,
    minLiquidity: 20,
    minBackOdds: 1.2,
    maxBackOdds: 15,
    excludeSurebets: false,
    autoPauseOnTrigger: true,
    cooldownSec: 60,
  };
}

function formatWatchDateRangeLabel(range?: DateRangeValue): string | null {
  if (!range || range.mode === 'all') return null;
  if (range.mode === 'hours') {
    return range.hours === 6 ? 'Prossime 6h' : `Prossime ${range.hours ?? 24}h`;
  }
  if (range.mode === 'range' && range.startDate) {
    return formatScrapeDateWindowLabel({
      startDate: range.startDate,
      endDate: range.endDate ?? range.startDate,
    });
  }
  return null;
}

const SOURCE_NAME_MAP = new Map<SourceId, string>(SOURCE_CATALOG.map((s) => [s.id, s.name]));

const MARKET_LABEL_MAP: Record<MarketType | 'ALL', string> = {
  ALL: 'Tutti i mercati',
  '1X2': 'Esito Finale 1X2',
  OVER_UNDER_25: 'Under/Over 2.5 Gol',
  BTTS: 'Goal / NoGoal',
  H2H: 'Testa a Testa',
};

interface WatchFiltersBannerProps {
  watch: RatingWatch;
}

const WatchFiltersBanner: React.FC<WatchFiltersBannerProps> = ({ watch }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const track1Ref = useRef<HTMLDivElement>(null);
  const track2Ref = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  const dragRef = useRef<{ active: boolean; startX: number; startScroll: number }>({
    active: false,
    startX: 0,
    startScroll: 0,
  });

  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const watchLeagues = useMemo(() => getWatchLeagues(watch), [watch]);
  const watchDateLabel = useMemo(
    () => formatWatchDateRangeLabel(watch.dateRange),
    [watch.dateRange]
  );
  const selectionLabel = useMemo(
    () =>
      getSelectionOptionsForMarket(watch.marketType).find(
        (o) => o.value === watch.selectionKey
      )?.label ?? watch.selectionKey,
    [watch.marketType, watch.selectionKey]
  );

  // Measure whether the filter chips overflow the available banner width
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const t1 = track1Ref.current;
    if (!scrollEl || !t1) return;

    const measure = () => {
      const overflow = t1.scrollWidth > scrollEl.clientWidth + 2;
      setIsOverflowing(overflow);
      if (!overflow) {
        posRef.current = 0;
        scrollEl.scrollLeft = 0;
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    ro.observe(t1);
    return () => ro.disconnect();
  }, [watch, watchLeagues.length, watchDateLabel]);

  // Smooth infinite ticker auto-scroll via scrollLeft (pauses on hover/drag)
  useEffect(() => {
    if (!isOverflowing || isPaused || isDragging) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    let rafId = 0;
    let lastTs = performance.now();
    const SPEED_PX_PER_SEC = 42;

    const step = (now: number) => {
      const scrollEl = scrollRef.current;
      const t1 = track1Ref.current;
      const t2 = track2Ref.current;
      if (scrollEl && t1 && t2) {
        const loopWidth = t2.offsetLeft - t1.offsetLeft;
        if (loopWidth > 0) {
          const dt = Math.min(80, Math.max(0, now - lastTs));
          posRef.current = (posRef.current + (dt * SPEED_PX_PER_SEC) / 1000) % loopWidth;
          scrollEl.scrollLeft = posRef.current;
        }
      }
      lastTs = now;
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isOverflowing, isPaused, isDragging]);

  const nudgeScroll = (delta: number) => {
    const scrollEl = scrollRef.current;
    const t1 = track1Ref.current;
    const t2 = track2Ref.current;
    if (!scrollEl) return;

    if (t1 && t2 && t2.offsetLeft > t1.offsetLeft) {
      const loopWidth = t2.offsetLeft - t1.offsetLeft;
      let next = scrollEl.scrollLeft + delta;
      next = ((next % loopWidth) + loopWidth) % loopWidth;
      scrollEl.scrollLeft = next;
      posRef.current = next;
    } else {
      scrollEl.scrollLeft += delta;
      posRef.current = scrollEl.scrollLeft;
    }
  };

  const renderFilterTrack = (isDuplicate: boolean) => (
    <div
      ref={isDuplicate ? track2Ref : track1Ref}
      aria-hidden={isDuplicate ? true : undefined}
      className="flex w-max shrink-0 items-center gap-1.5 text-[10px]"
    >
      {watch.sport && (
        <span className="shrink-0 rounded-md border border-slate-700/80 bg-slate-950/90 px-1.5 py-0.5 font-semibold text-slate-200">
          {sportLabel(watch.sport)}
        </span>
      )}
      {watchDateLabel && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-accent-400/35 bg-accent-500/10 px-1.5 py-0.5 font-mono font-semibold text-accent-200">
          <CalendarRange className="h-2.5 w-2.5 shrink-0" />
          {watchDateLabel}
        </span>
      )}
      <span className="shrink-0 rounded-md border border-slate-800 bg-slate-950/90 px-1.5 py-0.5 text-slate-300">
        {MARKET_LABEL_MAP[watch.marketType]} &middot; {selectionLabel}
      </span>
      <span className="shrink-0 rounded-md border border-slate-800 bg-slate-950/90 px-1.5 py-0.5 font-mono text-slate-300">
        Liq &ge; {formatEuro(watch.minLiquidity)}
      </span>
      <span className="shrink-0 rounded-md border border-slate-800 bg-slate-950/90 px-1.5 py-0.5 font-mono text-slate-300">
        Q {watch.minBackOdds.toFixed(2)}–{watch.maxBackOdds.toFixed(2)}
      </span>
      {watch.excludeSurebets && (
        <span className="shrink-0 rounded-md border border-rose-400/35 bg-rose-500/10 px-1.5 py-0.5 font-semibold text-rose-200">
          No Surebet
        </span>
      )}
      {watchLeagues.map((lg) => (
        <span
          key={`${isDuplicate ? 'dup-' : ''}lg-${lg}`}
          className="shrink-0 rounded-md border border-brand-400/35 bg-brand-500/10 px-1.5 py-0.5 font-semibold text-brand-200"
        >
          {lg}
        </span>
      ))}
    </div>
  );

  return (
    <div
      data-testid={`watch-filters-banner-${watch.id}`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => {
        setIsPaused(false);
        dragRef.current.active = false;
        setIsDragging(false);
      }}
      className="mt-2.5 flex items-center gap-1 rounded-lg border border-brand-400/25 bg-slate-900/80 px-2 py-1.5"
      title={isOverflowing ? 'Passa il mouse per fermare o trascina per scorrere i filtri' : undefined}
    >
      <SlidersHorizontal className="h-3 w-3 shrink-0 text-brand-300" />
      {isOverflowing && (
        <button
          type="button"
          onClick={() => nudgeScroll(-180)}
          className="shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-slate-800 hover:text-brand-200"
          title="Scorri filtri a sinistra"
          aria-label="Scorri filtri a sinistra"
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
      )}
      <div
        ref={scrollRef}
        onPointerDown={(e) => {
          if (!isOverflowing || !scrollRef.current) return;
          dragRef.current = {
            active: true,
            startX: e.clientX,
            startScroll: scrollRef.current.scrollLeft,
          };
          setIsDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current.active || !scrollRef.current) return;
          const dx = e.clientX - dragRef.current.startX;
          const t1 = track1Ref.current;
          const t2 = track2Ref.current;
          let next = dragRef.current.startScroll - dx;
          if (t1 && t2 && t2.offsetLeft > t1.offsetLeft) {
            const loopWidth = t2.offsetLeft - t1.offsetLeft;
            next = ((next % loopWidth) + loopWidth) % loopWidth;
          }
          scrollRef.current.scrollLeft = next;
          posRef.current = next;
        }}
        onPointerUp={(e) => {
          if (!dragRef.current.active) return;
          dragRef.current.active = false;
          setIsDragging(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          dragRef.current.active = false;
          setIsDragging(false);
        }}
        style={
          isOverflowing
            ? {
                maskImage:
                  'linear-gradient(to right, transparent 0%, black 12px, black calc(100% - 12px), transparent 100%)',
                WebkitMaskImage:
                  'linear-gradient(to right, transparent 0%, black 12px, black calc(100% - 12px), transparent 100%)',
              }
            : undefined
        }
        className={`no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto select-none ${
          isOverflowing ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
      >
        <div className="flex w-max items-center">
          {renderFilterTrack(false)}
          {isOverflowing && (
            <>
              <span aria-hidden="true" className="px-2.5 text-[10px] text-brand-400/60">
                &bull;
              </span>
              {renderFilterTrack(true)}
            </>
          )}
        </div>
      </div>
      {isOverflowing && (
        <button
          type="button"
          onClick={() => nudgeScroll(180)}
          className="shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-slate-800 hover:text-brand-200"
          title="Scorri filtri a destra"
          aria-label="Scorri filtri a destra"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};

export const RatingWatchView: React.FC<RatingWatchViewProps> = ({
  snapshot,
  watches,
  status,
  settings,
  soundEnabled,
  draftSeed,
  onCreateWatch,
  onUpdateWatch,
  onDeleteWatch,
  onRunNow,
  onDateRangeFilterChange,
  onEnableSound,
  onOpenCalculator,
  onConsumeDraftSeed,
}) => {
  const [form, setForm] = useState<WatchFormState>(() => createEmptyForm('normal'));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [deleteConfirmWatch, setDeleteConfirmWatch] = useState<RatingWatch | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'triggered' | 'paused'>('all');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [testSoundPlaying, setTestSoundPlaying] = useState(false);
  const [nowSecTick, setNowSecTick] = useState(() => Date.now());
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close topmost dialog on Escape key
  useEffect(() => {
    if (!formModalOpen && !deleteConfirmWatch) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteConfirmWatch && !isDeleting) {
        setDeleteConfirmWatch(null);
        return;
      }
      if (formModalOpen && !pickerOpen) {
        setFormModalOpen(false);
        setEditingId(null);
        if (form.dateRange.mode !== 'all') {
          onDateRangeFilterChange?.(EMPTY_DATE_RANGE);
        }
        setForm(createEmptyForm(form.mode));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    formModalOpen,
    deleteConfirmWatch,
    isDeleting,
    pickerOpen,
    form.dateRange.mode,
    form.mode,
    onDateRangeFilterChange,
  ]);

  // Live 1s countdown clock for next adaptive check
  useEffect(() => {
    if (!status.nextCheckAt && watches.length === 0) return;
    const t = setInterval(() => setNowSecTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status.nextCheckAt, watches.length]);

  // Close event suggestion dropdown on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  // Pre-fill form when triggered from Oddsmatcher / Calculator 1-click shortcut
  useEffect(() => {
    if (!draftSeed) return;
    const { row, mode = 'normal' } = draftSeed;
    const canonLeague = resolveCanonicalCompetition(row.league, row.sport) ?? row.league;
    setEditingId(null);
    setForm({
      enabled: true,
      eventKey: row.eventKey,
      eventName: row.eventName,
      sport: row.sport,
      league: canonLeague,
      leagues: canonLeague ? [canonLeague] : [],
      startTime: row.startTime,
      dateRange: EMPTY_DATE_RANGE,
      marketType: row.marketType,
      selectionKey: row.selectionKey,
      bookmakerIds: [row.bookmakerId],
      exchangeIds: [row.exchangeId],
      mode,
      targetRating: mode === 'snr' ? Math.max(70, Math.round((row.ratingSnr + 2) * 10) / 10) : Math.max(96, Math.round((row.ratingNormal + 1) * 10) / 10),
      refundRetention: 70,
      minLiquidity: 20,
      minBackOdds: 1.2,
      maxBackOdds: 15,
      excludeSurebets: false,
      autoPauseOnTrigger: true,
      cooldownSec: 60,
    });
    setFormModalOpen(true);
    onConsumeDraftSeed?.();
  }, [draftSeed, onConsumeDraftSeed]);

  // Available Bookmaker & Exchange options
  const bookmakerOptions = useMemo(
    () => buildBookmakerSourceOptions(snapshot, settings.enabledSources),
    [snapshot, settings.enabledSources]
  );

  const exchangeOptions = useMemo(
    () => buildExchangeSourceOptions(snapshot, settings.enabledSources),
    [snapshot, settings.enabledSources]
  );

  // Prune any bookmaker/exchange from the draft form if deselected in scraper or in error state
  useEffect(() => {
    const disabledBookIds = new Set(bookmakerOptions.filter((o) => o.disabled).map((o) => o.id));
    if (disabledBookIds.size > 0) {
      setForm((prev) => {
        const next = prev.bookmakerIds.filter((id) => !disabledBookIds.has(id));
        return next.length === prev.bookmakerIds.length ? prev : { ...prev, bookmakerIds: next };
      });
    }
    const disabledExIds = new Set(exchangeOptions.filter((o) => o.disabled).map((o) => o.id));
    if (disabledExIds.size > 0) {
      setForm((prev) => {
        const next = prev.exchangeIds.filter((id) => !disabledExIds.has(id));
        return next.length === prev.exchangeIds.length ? prev : { ...prev, exchangeIds: next };
      });
    }
  }, [bookmakerOptions, exchangeOptions]);

  // Deduplicated upcoming/live events from snapshot.rows for searchable autocomplete
  const catalogEvents = useMemo(() => {
    const map = new Map<
      string,
      {
        eventKey: string;
        eventName: string;
        league: string;
        sport: SportKey;
        startTime: string;
        quoteCount: number;
      }
    >();
    for (const r of snapshot.rows) {
      const ex = map.get(r.eventKey);
      if (ex) {
        ex.quoteCount += 1;
      } else {
        map.set(r.eventKey, {
          eventKey: r.eventKey,
          eventName: r.eventName,
          league: r.league,
          sport: r.sport,
          startTime: r.startTime,
          quoteCount: 1,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
  }, [snapshot.rows]);

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

  const dateFilteredCatalogEvents = useMemo(() => {
    if (form.dateRange.mode === 'all') return catalogEvents;
    const nowMs = Date.now();
    return catalogEvents.filter((ev) => matchesDateRange(ev.startTime, form.dateRange, nowMs));
  }, [catalogEvents, form.dateRange]);

  const filteredEventSuggestions = useMemo(() => {
    const q = normalizeWatchQuery(form.eventName);
    const tokens = q ? q.split(' ').filter(Boolean) : [];
    return dateFilteredCatalogEvents
      .filter((ev) => {
        if (form.sport && ev.sport !== form.sport) return false;
        if (form.leagues.length > 0 && !matchesWatchLeagues(form.leagues, ev.league, ev.sport)) {
          return false;
        }
        if (tokens.length === 0) return true;
        const hay = normalizeWatchQuery(`${ev.eventName} ${ev.league}`);
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 35);
  }, [dateFilteredCatalogEvents, form.eventName, form.sport, form.leagues]);

  // Preset + dynamic live competition options filtered by current sport and selected date range
  const competitionOptions = useMemo(
    () =>
      buildCompetitionOptions(
        dateFilteredCatalogEvents,
        form.sport,
        form.leagues,
        form.dateRange.mode !== 'all'
      ),
    [dateFilteredCatalogEvents, form.sport, form.leagues, form.dateRange.mode]
  );

  const availableCompetitionsCount = useMemo(
    () => countAvailableCompetitions(dateFilteredCatalogEvents, form.sport),
    [dateFilteredCatalogEvents, form.sport]
  );

  const topCompetitionsForSport = useMemo(
    () => getTopCompetitionValues(form.sport ?? 'ALL'),
    [form.sport]
  );

  const isTopCompetitionsActive = useMemo(() => {
    if (topCompetitionsForSport.length === 0) return false;
    if (form.leagues.length !== topCompetitionsForSport.length) return false;
    const selected = new Set(form.leagues);
    return topCompetitionsForSport.every((comp) => selected.has(comp));
  }, [form.leagues, topCompetitionsForSport]);

  const watchPresets = useMemo<QuickPresetItem[]>(
    () => [
      {
        id: 'qualifier',
        label: 'Qualificante (≥95%)',
        description: 'Normale · Rating ≥95% · Quota 1.50–5.00 · Liq ≥25€',
        tone: 'brand',
        icon: <Target className="h-3 w-3" />,
        active:
          form.mode === 'normal' &&
          Math.abs(form.targetRating - 95) < 0.05 &&
          Math.abs(form.minBackOdds - 1.5) < 0.005 &&
          Math.abs(form.maxBackOdds - 5.0) < 0.005 &&
          Math.abs(form.minLiquidity - 25) < 0.005,
        onSelect: () =>
          setForm((prev) => ({
            ...prev,
            mode: 'normal',
            targetRating: 95,
            minBackOdds: 1.5,
            maxBackOdds: 5.0,
            minLiquidity: 25,
          })),
      },
      {
        id: 'snr',
        label: 'Freebet SNR (Q ≥ 4.0)',
        description: 'Freebet SNR · Rating ≥65% · Quota 4.00–12.00 · Liq ≥20€',
        tone: 'accent',
        icon: <Gift className="h-3 w-3" />,
        active:
          form.mode === 'snr' &&
          Math.abs(form.targetRating - 65) < 0.05 &&
          Math.abs(form.minBackOdds - 4.0) < 0.005 &&
          Math.abs(form.maxBackOdds - 12.0) < 0.005 &&
          Math.abs(form.minLiquidity - 20) < 0.005,
        onSelect: () =>
          setForm((prev) => ({
            ...prev,
            mode: 'snr',
            targetRating: 65,
            minBackOdds: 4.0,
            maxBackOdds: 12.0,
            minLiquidity: 20,
          })),
      },
      {
        id: 'surebet',
        label: 'Solo Surebet (≥100%)',
        description: 'Normale · Rating ≥100% · Quota 1.10–20.00 · Liq ≥10€',
        tone: 'emerald',
        icon: <Flame className="h-3 w-3" />,
        active:
          form.mode === 'normal' &&
          !form.excludeSurebets &&
          form.targetRating >= 100 &&
          Math.abs(form.minBackOdds - 1.1) < 0.005 &&
          Math.abs(form.maxBackOdds - 20) < 0.005,
        onSelect: () =>
          setForm((prev) => ({
            ...prev,
            mode: 'normal',
            targetRating: 100,
            minBackOdds: 1.1,
            maxBackOdds: 20,
            minLiquidity: 10,
            excludeSurebets: false,
          })),
      },
      {
        id: 'high-liquidity',
        label: 'Alta Liquidità (≥100€)',
        description: 'Monitora solo mercati Exchange con almeno 100€ disponibili',
        tone: 'amber',
        icon: <Coins className="h-3 w-3" />,
        active: form.minLiquidity >= 100,
        onSelect: () =>
          setForm((prev) => ({
            ...prev,
            minLiquidity: 100,
          })),
      },
      {
        id: 'top-competitions',
        label: 'Top Competizioni',
        description: 'Serie A/B, Premier, LaLiga, Bundesliga, UEFA, ATP/WTA, NBA',
        tone: 'sky',
        icon: <Trophy className="h-3 w-3" />,
        active: isTopCompetitionsActive,
        onSelect: () =>
          setForm((prev) => {
            const nextLeagues = isTopCompetitionsActive ? [] : topCompetitionsForSport;
            return {
              ...prev,
              leagues: nextLeagues,
              league: nextLeagues[0],
            };
          }),
      },
    ],
    [
      form.mode,
      form.targetRating,
      form.minBackOdds,
      form.maxBackOdds,
      form.minLiquidity,
      form.excludeSurebets,
      isTopCompetitionsActive,
      topCompetitionsForSport,
    ]
  );

  const activeWatchPresetsCount = useMemo(
    () => watchPresets.filter((p) => p.active).length,
    [watchPresets]
  );

  const isFutureDateSelected = useMemo(
    () => needsFutureDateScrape(form.dateRange),
    [form.dateRange]
  );
  const selectedDateWindow = useMemo(
    () => resolveScrapeDateWindow(form.dateRange),
    [form.dateRange]
  );
  const selectedDateLabel = selectedDateWindow
    ? formatScrapeDateWindowLabel(selectedDateWindow)
    : null;
  const isDateRangeScraping = Boolean(snapshot.stats.isDateRangeScraping);

  const handleDateRangeChange = (next: DateRangeValue, meta?: { pendingEnd?: boolean }) => {
    setForm((prev) => {
      const keepLinked =
        !prev.startTime || next.mode === 'all' || matchesDateRange(prev.startTime, next);
      return {
        ...prev,
        dateRange: next,
        eventKey: keepLinked ? prev.eventKey : undefined,
        startTime: keepLinked ? prev.startTime : undefined,
      };
    });
    onDateRangeFilterChange?.(next, meta);
  };

  const selectionOptions = useMemo(
    () => getSelectionOptionsForMarket(form.marketType),
    [form.marketType]
  );

  // Live adaptive frequency estimate for current form filters
  const draftFrequencyEstimate = useMemo(
    () =>
      estimateSingleWatchInterval(
        { bookmakerIds: form.bookmakerIds, exchangeIds: form.exchangeIds },
        settings
      ),
    [form.bookmakerIds, form.exchangeIds, settings]
  );

  // Live preview of best match currently present in snapshot.rows for the form
  const draftLiveEval = useMemo(() => {
    const tempWatch: RatingWatch = {
      ...form,
      id: 'draft',
      createdAt: 0,
      updatedAt: 0,
      lastCheckedAt: null,
      lastBestMatch: null,
      lastTriggeredAt: null,
      triggerCount: 0,
    };
    return evaluateRatingWatch(tempWatch, snapshot.rows, {
      includeLiveEvents: settings.includeLiveEvents,
    });
  }, [form, snapshot.rows, settings.includeLiveEvents]);

  const rowById = useMemo(() => {
    const m = new Map<string, OddsmatcherRow>();
    for (const r of snapshot.rows) m.set(r.id, r);
    return m;
  }, [snapshot.rows]);

  const filteredWatches = useMemo(() => {
    return watches.filter((w) => {
      if (filterTab === 'active') return w.enabled;
      if (filterTab === 'triggered') return w.triggerCount > 0;
      if (filterTab === 'paused') return !w.enabled;
      return true;
    });
  }, [watches, filterTab]);

  const countdownSec =
    status.nextCheckAt && status.intervalSec
      ? Math.max(0, Math.ceil((status.nextCheckAt - nowSecTick) / 1000))
      : null;

  const handleSelectEventSuggestion = (ev: (typeof catalogEvents)[number]) => {
    const canonLeague = resolveCanonicalCompetition(ev.league, ev.sport) ?? ev.league;
    setForm((prev) => ({
      ...prev,
      eventKey: ev.eventKey,
      eventName: ev.eventName,
      sport: ev.sport,
      league: canonLeague,
      leagues: canonLeague ? [canonLeague] : prev.leagues,
      startTime: ev.startTime,
    }));
    setPickerOpen(false);
  };

  const handleMarketChange = (nextMarket: MarketType | 'ALL') => {
    const nextOpts = getSelectionOptionsForMarket(nextMarket);
    const keepSelection = nextOpts.some((o) => o.value === form.selectionKey);
    setForm((prev) => ({
      ...prev,
      marketType: nextMarket,
      selectionKey: keepSelection ? prev.selectionKey : 'ALL',
    }));
  };

  const hasAnyWatchFilter = Boolean(
    form.eventName.trim() ||
      form.dateRange.mode !== 'all' ||
      form.sport ||
      form.leagues.length > 0 ||
      form.league?.trim() ||
      form.marketType !== 'ALL' ||
      form.selectionKey !== 'ALL' ||
      form.bookmakerIds.length > 0 ||
      form.exchangeIds.length > 0
  );

  const openNewFormDialog = () => {
    setEditingId(null);
    setPickerOpen(false);
    setForm(createEmptyForm('normal'));
    setFormModalOpen(true);
  };

  const closeFormDialog = () => {
    setFormModalOpen(false);
    setPickerOpen(false);
    setEditingId(null);
    if (form.dateRange.mode !== 'all') {
      onDateRangeFilterChange?.(EMPTY_DATE_RANGE);
    }
    setForm(createEmptyForm(form.mode));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasAnyWatchFilter) return;

    const cleanLeagues = form.leagues.map((l) => l.trim()).filter(Boolean);
    const payload: RatingWatchInput = {
      enabled: form.enabled,
      eventKey: form.eventName.trim() ? form.eventKey : undefined,
      eventName: form.eventName.trim(),
      sport: form.sport,
      league: cleanLeagues[0] || form.league?.trim() || undefined,
      leagues: cleanLeagues,
      startTime: form.eventName.trim() ? form.startTime : undefined,
      dateRange: form.dateRange.mode !== 'all' ? form.dateRange : undefined,
      marketType: form.marketType,
      selectionKey: form.selectionKey,
      bookmakerIds: form.bookmakerIds,
      exchangeIds: form.exchangeIds,
      mode: form.mode,
      targetRating: form.targetRating,
      refundRetention: form.refundRetention,
      minLiquidity: form.minLiquidity,
      minBackOdds: form.minBackOdds,
      maxBackOdds: Math.max(form.minBackOdds, form.maxBackOdds),
      excludeSurebets: form.excludeSurebets,
      autoPauseOnTrigger: form.autoPauseOnTrigger,
      cooldownSec: Math.max(10, form.cooldownSec),
    };

    if (editingId) {
      await onUpdateWatch(editingId, payload);
      setEditingId(null);
    } else {
      await onCreateWatch(payload);
    }
    setFormModalOpen(false);
    setPickerOpen(false);
    if (form.dateRange.mode !== 'all') {
      onDateRangeFilterChange?.(EMPTY_DATE_RANGE);
    }
    setForm(createEmptyForm(form.mode));
  };

  const startEdit = (w: RatingWatch) => {
    const resolvedLeagues = getWatchLeagues(w).map(
      (lg) => resolveCanonicalCompetition(lg, w.sport) ?? lg
    );
    const nextDateRange = w.dateRange ?? EMPTY_DATE_RANGE;
    setEditingId(w.id);
    setPickerOpen(false);
    setForm({
      enabled: w.enabled,
      eventKey: w.eventKey,
      eventName: w.eventName,
      sport: w.sport,
      league: resolvedLeagues[0],
      leagues: resolvedLeagues,
      startTime: w.startTime,
      dateRange: nextDateRange,
      marketType: w.marketType,
      selectionKey: w.selectionKey,
      bookmakerIds: w.bookmakerIds,
      exchangeIds: w.exchangeIds,
      mode: w.mode,
      targetRating: w.targetRating,
      refundRetention: w.refundRetention,
      minLiquidity: w.minLiquidity,
      minBackOdds: w.minBackOdds,
      maxBackOdds: w.maxBackOdds,
      excludeSurebets: Boolean(w.excludeSurebets),
      autoPauseOnTrigger: w.autoPauseOnTrigger,
      cooldownSec: w.cooldownSec,
    });
    if (nextDateRange.mode !== 'all') {
      onDateRangeFilterChange?.(nextDateRange);
    }
    setFormModalOpen(true);
  };

  const confirmDeleteWatch = async () => {
    if (!deleteConfirmWatch || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDeleteWatch(deleteConfirmWatch.id);
      setDeleteConfirmWatch(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleIgnoreBestMatch = async (
    watch: RatingWatch,
    match: RatingWatchMatchSnapshot
  ) => {
    const nextIgnored = appendIgnoredWatchEvent(watch.ignoredEvents, match);
    await onUpdateWatch(watch.id, {
      ignoredEvents: nextIgnored,
      enabled: true,
    });
  };

  const handleRestoreIgnoredEvent = async (
    watch: RatingWatch,
    target: IgnoredWatchEvent
  ) => {
    const nextIgnored = removeIgnoredWatchEvent(watch.ignoredEvents, target);
    await onUpdateWatch(watch.id, {
      ignoredEvents: nextIgnored,
    });
  };

  const handleClearIgnoredEvents = async (watch: RatingWatch) => {
    await onUpdateWatch(watch.id, {
      ignoredEvents: [],
    });
  };

  const handleTestSound = () => {
    if (testSoundPlaying) {
      stopPersistentRatingAlarm();
      setTestSoundPlaying(false);
    } else {
      setTestSoundPlaying(true);
      playRatingAlertBurst();
      setTimeout(() => setTestSoundPlaying(false), 1200);
    }
  };

  const targetedSourceCount =
    status.effectiveBookmakerIds.length + status.effectiveExchangeIds.length;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* Header & Live Radar Telemetry */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-300 to-accent-400 text-slate-950 shadow-glow">
            <BellRing className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-base font-bold text-white">
                Radar Rating — Tracking & Avvisi Mirati
              </h1>
              {status.activeCount > 0 && (
                <span className="flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                  {status.activeCount} ATTIV{status.activeCount === 1 ? 'O' : 'I'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Monitora solo gli eventi e i siti selezionati con frequenza adattiva e avviso sonoro persistente al raggiungimento del rating.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Adaptive Frequency Pill */}
          <div
            data-testid="radar-frequency-pill"
            className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/85 px-3 py-1.5 text-xs"
          >
            <Activity
              className={`h-3.5 w-3.5 ${
                status.isPolling ? 'animate-spin text-brand-300' : 'text-brand-300'
              }`}
            />
            {status.intervalSec ? (
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-white">
                  Ogni {status.intervalSec}s
                </span>
                <span className="text-[10px] text-slate-400">
                  ({targetedSourceCount} font{targetedSourceCount === 1 ? 'e' : 'i'})
                </span>
                {countdownSec !== null && !status.isPolling && (
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-brand-200">
                    tra {countdownSec}s
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[11px] text-slate-400">Radar in standby</span>
            )}
          </div>

          {status.backoffMultiplier > 1 && (
            <span className="flex items-center gap-1 rounded-xl border border-amber-400/40 bg-amber-500/15 px-2.5 py-1.5 text-[10px] font-bold text-amber-200">
              <ShieldAlert className="h-3.5 w-3.5" />
              Backoff {status.backoffMultiplier}x
            </span>
          )}

          <button
            type="button"
            onClick={handleTestSound}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-brand-400/50 hover:text-brand-200"
            title="Prova la suoneria dell'allarme"
          >
            {testSoundPlaying ? (
              <VolumeX className="h-3.5 w-3.5 text-rose-300" />
            ) : (
              <Volume2 className="h-3.5 w-3.5 text-brand-300" />
            )}
            Test Suono
          </button>

          <button
            type="button"
            data-testid="radar-run-now-btn"
            disabled={status.activeCount === 0 || status.isPolling}
            onClick={() => void onRunNow()}
            className="flex items-center gap-1.5 rounded-xl border border-brand-400/40 bg-brand-500/15 px-3 py-1.5 text-xs font-bold text-brand-200 transition hover:bg-brand-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${status.isPolling ? 'animate-spin' : ''}`} />
            {status.isPolling ? 'Scansione...' : 'Controlla Ora'}
          </button>

          <button
            type="button"
            data-testid="radar-new-watch-btn"
            onClick={openNewFormDialog}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-3.5 py-1.5 text-xs font-extrabold text-slate-950 shadow-glow transition hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" />
            Nuovo Tracking
          </button>
        </div>
      </div>

      {/* Global audio muted warning */}
      {!soundEnabled && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-2 text-xs text-amber-100">
          <div className="flex items-center gap-2">
            <VolumeX className="h-4 w-4 shrink-0 text-amber-300" />
            <span>
              <strong>Audio globale disattivato:</strong> gli avvisi visivi e le notifiche desktop appariranno comunque, ma il suono persistente non verrà riprodotto.
            </span>
          </div>
          <button
            type="button"
            onClick={onEnableSound}
            className="shrink-0 rounded-lg bg-amber-400 px-3 py-1 text-[11px] font-bold text-slate-950 hover:brightness-110"
          >
            Attiva Audio
          </button>
        </div>
      )}

      {/* Main Full-Width Active & Historical Rating Watches List */}
      <div className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        {/* Sub-header & Status Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-3">
          <SlidingPillTrack
            activeKey={filterTab}
            measureDep={`${watches.length}_${watches.filter((w) => w.enabled).length}_${watches.filter((w) => w.triggerCount > 0).length}`}
            pillClassName="rounded-lg border border-brand-400/40 bg-brand-500/20"
            className="flex items-center gap-1.5"
          >
            {(
              [
                { id: 'all', label: `Tutti (${watches.length})` },
                {
                  id: 'active',
                  label: `Attivi (${watches.filter((w) => w.enabled).length})`,
                },
                {
                  id: 'triggered',
                  label: `Scattati (${watches.filter((w) => w.triggerCount > 0).length})`,
                },
                {
                  id: 'paused',
                  label: `In Pausa (${watches.filter((w) => !w.enabled).length})`,
                },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                data-pill-key={t.id}
                onClick={() => setFilterTab(t.id)}
                className={`relative z-10 rounded-lg border border-transparent px-2.5 py-1 text-xs font-semibold transition ${
                  filterTab === t.id
                    ? 'text-brand-200'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </SlidingPillTrack>

          {status.lastCheckAt && (
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
              <Clock className="h-3 w-3 text-slate-500" />
              Ultimo check: {new Date(status.lastCheckAt).toLocaleTimeString('it-IT')} (
              {(status.lastCycleDurationMs / 1000).toFixed(1)}s)
            </div>
          )}
        </div>

        {/* Cards Scroll Container */}
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3.5">
          {filteredWatches.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/70 text-brand-300">
                <BellRing className="h-6 w-6" />
              </div>
              <h3 className="mt-3 text-sm font-bold text-white">
                {watches.length === 0
                  ? 'Nessun tracking rating attivo'
                  : 'Nessun tracking in questa categoria'}
              </h3>
              <p className="mt-1 max-w-md text-xs text-slate-400">
                Clicca su &laquo;Nuovo Tracking&raquo; per impostare i filtri (anche solo bookmaker, exchange e rating minimo, senza obbligo di evento) oppure clicca la campanella su una riga dell&apos;Oddsmatcher.
              </p>
              <button
                type="button"
                onClick={openNewFormDialog}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-glow transition hover:brightness-110"
              >
                <Plus className="h-3.5 w-3.5" />
                Nuovo Tracking Rating
              </button>
            </div>
          ) : (
            filteredWatches.map((w) => {
              const expired = isWatchExpired(w, nowSecTick, settings.includeLiveEvents);
              const rawBest = w.lastBestMatch;
              const liveBest =
                rawBest &&
                !isRowIgnoredByWatch(w, {
                  eventKey: extractMatchEventKey(rawBest),
                  eventName: rawBest.eventName,
                  startTime: rawBest.startTime,
                })
                  ? rawBest
                  : null;
              const liveRow = liveBest ? rowById.get(liveBest.rowId) : undefined;
              const progressPct = liveBest
                ? Math.max(5, Math.min(100, (liveBest.rating / Math.max(1, w.targetRating)) * 100))
                : 0;
              const hitNow = Boolean(liveBest && liveBest.rating >= w.targetRating);

              return (
                <div
                  key={w.id}
                  data-testid={`watch-card-${w.id}`}
                  className={`rounded-xl border p-3.5 transition ${
                    w.enabled
                      ? hitNow
                        ? 'border-emerald-400/50 bg-emerald-950/20'
                        : 'border-brand-400/30 bg-slate-950/75'
                      : 'border-slate-800/80 bg-slate-950/45 opacity-85'
                  }`}
                >
                  {/* Card Top Row */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            expired
                              ? 'bg-slate-800 text-slate-400'
                              : w.enabled
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/35'
                              : w.triggerCount > 0
                              ? 'bg-brand-500/20 text-brand-200 border border-brand-400/35'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {expired
                            ? 'Iniziata / Scaduta'
                            : w.enabled
                            ? 'In Monitoraggio'
                            : w.triggerCount > 0
                            ? 'Target Raggiunto'
                            : 'In Pausa'}
                        </span>
                        <span className="rounded-md bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-300 border border-slate-800">
                          {betModeLabelIt(w.mode)} &ge; {w.targetRating.toFixed(1)}%
                        </span>
                        {w.excludeSurebets && (
                          <span
                            data-testid={`watch-no-surebet-badge-${w.id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-400/35 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200"
                          >
                            <Ban className="h-2.5 w-2.5 shrink-0" />
                            No Surebet
                          </span>
                        )}
                        {w.triggerCount > 0 && (
                          <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                            Avvisi: {w.triggerCount}
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-bold text-white">
                          {w.eventName.trim() ? w.eventName : 'Tutti gli eventi'}
                        </span>
                        {w.eventName.trim() && w.startTime && (
                          <span className="shrink-0 font-mono text-[11px] text-slate-400">
                            &middot; {formatEventTime(w.startTime).date}{' '}
                            {formatEventTime(w.startTime).time}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action Toolbar */}
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        data-testid={`watch-toggle-${w.id}`}
                        onClick={() => void onUpdateWatch(w.id, { enabled: !w.enabled })}
                        className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                          w.enabled
                            ? 'border-amber-400/35 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                            : 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                        }`}
                      >
                        {w.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                        {w.enabled ? 'Pausa' : 'Attiva'}
                      </button>

                      <button
                        type="button"
                        data-testid={`watch-edit-${w.id}`}
                        onClick={() => startEdit(w)}
                        className="rounded-lg border border-slate-700/80 bg-slate-900 p-1.5 text-slate-300 transition hover:border-brand-400/50 hover:text-brand-200"
                        title="Modifica filtri tracking"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>

                      {liveRow && (
                        <button
                          type="button"
                          onClick={() => onOpenCalculator(liveRow, w.mode)}
                          className="rounded-lg border border-brand-400/35 bg-brand-500/15 p-1.5 text-brand-200 transition hover:bg-brand-500/25"
                          title="Apri miglior quota nel Calcolatore"
                        >
                          <Calculator className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        data-testid={`watch-delete-${w.id}`}
                        onClick={() => setDeleteConfirmWatch(w)}
                        className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-300 transition hover:bg-rose-500/25"
                        title="Elimina tracking"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Sources row (always visible) */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="text-slate-500">Book:</span>
                    {w.bookmakerIds.length === 0 ? (
                      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-300">
                        Tutti
                      </span>
                    ) : (
                      w.bookmakerIds.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 text-slate-200"
                        >
                          <BookmakerIcon sourceId={id} size={17} />
                          {SOURCE_NAME_MAP.get(id) ?? id}
                        </span>
                      ))
                    )}
                    <span className="ml-1 text-slate-500">Exch:</span>
                    {w.exchangeIds.length === 0 ? (
                      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-300">
                        Tutti
                      </span>
                    ) : (
                      w.exchangeIds.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 text-slate-200"
                        >
                          <BookmakerIcon sourceId={id} size={17} />
                          {SOURCE_NAME_MAP.get(id) ?? id}
                        </span>
                      ))
                    )}
                  </div>

                  <WatchFiltersBanner watch={w} />

                    {/* Current rating progress */}
                    <div className="mt-2.5 rounded-lg border border-slate-800/80 bg-slate-900/60 p-2">
                      <div className="flex items-center justify-between gap-3 text-[11px]">
                        <span className="shrink-0 whitespace-nowrap text-slate-400">
                          Miglior rating rilevato
                        </span>
                        {liveBest ? (
                          <span className="truncate font-mono font-bold text-white">
                            <span className={ratingTone(liveBest.rating, w.mode)}>
                              {liveBest.rating.toFixed(2)}%
                            </span>{' '}
                            <span className="text-slate-400 font-normal">
                              ({liveBest.selectionLabel} &middot; {liveBest.bookmakerName} @
                              {formatOdds(liveBest.backOdds)} vs {liveBest.exchangeName} @
                              {formatOdds(liveBest.layOdds)} &middot; Liq {formatEuro(liveBest.liquidity)})
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-500">In attesa di corrispondenza live...</span>
                        )}
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-950">
                        <div
                          style={{ width: `${progressPct}%` }}
                          className={`h-full rounded-full transition-all duration-300 ${
                            hitNow
                              ? 'bg-gradient-to-r from-emerald-400 to-brand-300'
                              : 'bg-gradient-to-r from-brand-500 to-accent-400'
                          }`}
                        />
                      </div>
                      {liveBest && (
                        <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-800/70 pt-1.5 text-[10px]">
                          <div className="min-w-0 truncate text-slate-300">
                            <span className="text-slate-500">Evento rilevato: </span>
                            <span className="font-semibold text-white">{liveBest.eventName}</span>
                            {liveBest.league && (
                              <span className="text-slate-400"> &middot; {liveBest.league}</span>
                            )}
                          </div>
                          <button
                            type="button"
                            data-testid={`watch-ignore-best-${w.id}`}
                            onClick={() => void handleIgnoreBestMatch(w, liveBest)}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-500/20 hover:text-amber-100"
                            title="Quote cambiate o non giocabili? Ignora questo evento e continua la ricerca del rating"
                          >
                            <EyeOff className="h-3 w-3 shrink-0" />
                            Ignora evento
                          </button>
                        </div>
                      )}
                    </div>

                    {w.ignoredEvents && w.ignoredEvents.length > 0 && (
                      <div
                        data-testid={`watch-ignored-list-${w.id}`}
                        className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-500/5 px-2.5 py-1.5 text-[10px]"
                      >
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                          <EyeOff className="h-3 w-3 shrink-0" />
                          Eventi ignorati ({w.ignoredEvents.length}):
                        </span>
                        {w.ignoredEvents.map((ig) => {
                          const igKey = ig.eventKey || `${ig.eventName}|${ig.startTime ?? ''}`;
                          return (
                            <span
                              key={igKey}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-900 px-1.5 py-0.5 text-slate-200"
                            >
                              <span className="max-w-[180px] truncate">{ig.eventName}</span>
                              <button
                                type="button"
                                data-testid={`watch-restore-ignored-${w.id}`}
                                onClick={() => void handleRestoreIgnoredEvent(w, ig)}
                                className="rounded p-0.5 text-slate-400 transition hover:bg-slate-800 hover:text-emerald-300"
                                title={`Ripristina ${ig.eventName} nella ricerca`}
                                aria-label={`Ripristina ${ig.eventName}`}
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          );
                        })}
                        {w.ignoredEvents.length > 1 && (
                          <button
                            type="button"
                            data-testid={`watch-clear-ignored-${w.id}`}
                            onClick={() => void handleClearIgnoredEvents(w)}
                            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-amber-200 transition hover:bg-amber-500/15 hover:text-white"
                            title="Ripristina tutti gli eventi ignorati"
                          >
                            <RotateCcw className="h-2.5 w-2.5" />
                            Ripristina tutti
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

      {/* Create / Edit Watch Modal Dialog */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {formModalOpen && (
              <div
                data-testid="watch-form-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="watch-form-dialog-title"
                className="fixed inset-0 z-[110] flex items-center justify-center p-4"
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  onClick={closeFormDialog}
                  className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
                />
                <motion.form
                  data-testid="watch-form"
                  onSubmit={(e) => void handleSubmit(e)}
                  initial={{ opacity: 0, scale: 0.97, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 10 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-brand-400/35 bg-[var(--bg-modal-solid)] shadow-[0_24px_72px_rgba(0,0,0,0.92),0_0_38px_-14px_rgb(var(--brand-400)/0.3)]"
                >
                  {/* Dialog Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300 border border-brand-400/30">
                        {editingId ? (
                          <Edit3 className="h-4 w-4" />
                        ) : (
                          <BellPlus className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <h2
                          id="watch-form-dialog-title"
                          className="font-display text-sm font-bold text-white"
                        >
                          {editingId ? 'Modifica Tracking Rating' : 'Nuovo Tracking Rating'}
                        </h2>
                        <p className="text-[11px] text-slate-400">
                          {editingId
                            ? 'Aggiorna i filtri e la soglia di notifica per questo radar.'
                            : 'Configura i filtri di ricerca e la soglia rating da monitorare.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <QuickPresetsMenu
                        data-testid="watch-quick-presets-btn"
                        menuTestId="watch-quick-presets-menu"
                        items={watchPresets}
                        activeCount={activeWatchPresetsCount}
                        onReset={() => {
                          if (form.dateRange.mode !== 'all') {
                            onDateRangeFilterChange?.(EMPTY_DATE_RANGE);
                          }
                          setForm(createEmptyForm('normal'));
                        }}
                        resetLabel="Ripristina filtri form"
                      />
                      <button
                        type="button"
                        data-testid="watch-form-close-btn"
                        onClick={closeFormDialog}
                        className="rounded-lg border border-slate-700/80 bg-slate-900 p-1.5 text-slate-400 transition hover:border-slate-600 hover:text-white"
                        title="Chiudi"
                        aria-label="Chiudi finestra"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Dialog Scrollable Form Fields */}
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                    {/* Searchable Event Picker (optional) */}
                    <div ref={pickerRef} className="relative">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Evento (opzionale)
                      </label>
                      <div className="relative mt-1">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                        <input
                          type="text"
                          data-testid="watch-event-input"
                          value={form.eventName}
                          onFocus={() => setPickerOpen(true)}
                          onChange={(e) => {
                            const nextName = e.target.value;
                            setForm((prev) => ({
                              ...prev,
                              eventName: nextName,
                              eventKey: undefined,
                              startTime: undefined,
                            }));
                            setPickerOpen(true);
                          }}
                          placeholder="Tutti gli eventi (o cerca es. Inter - Milan)"
                          className="w-full rounded-lg border border-slate-800 bg-slate-950 py-1.5 pl-8 pr-8 text-xs text-white placeholder-slate-500 focus:border-brand-400 focus:outline-none"
                        />
                        {form.eventName && (
                          <button
                            type="button"
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                eventName: '',
                                eventKey: undefined,
                                startTime: undefined,
                              }))
                            }
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 hover:text-white"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {form.startTime && (
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-brand-300">
                          <CheckCircle2 className="h-3 w-3 shrink-0" />
                          <span>
                            Collegato ({sportLabel(form.sport ?? 'football')})
                            {form.league ? ` · ${form.league}` : ''} &middot;{' '}
                            {formatEventTime(form.startTime).date}{' '}
                            {formatEventTime(form.startTime).time}
                          </span>
                        </div>
                      )}

                      {pickerOpen && filteredEventSuggestions.length > 0 && (
                        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-60 overflow-y-auto rounded-xl border border-brand-400/40 bg-[var(--bg-modal-solid)] p-1 shadow-[0_18px_48px_rgba(0,0,0,0.92)]">
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Eventi live disponibili ({filteredEventSuggestions.length})
                          </div>
                          {filteredEventSuggestions.map((ev) => {
                            const t = formatEventTime(ev.startTime);
                            return (
                              <button
                                key={ev.eventKey}
                                type="button"
                                onClick={() => handleSelectEventSuggestion(ev)}
                                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition hover:bg-brand-500/15"
                              >
                                <div className="min-w-0">
                                  <div className="truncate font-semibold text-white">
                                    {ev.eventName}
                                  </div>
                                  <div className="truncate text-[10px] text-slate-400">
                                    {sportLabel(ev.sport)} &middot; {ev.league}
                                  </div>
                                </div>
                                <div className="shrink-0 text-right font-mono text-[10px] text-brand-300">
                                  {t.date} {t.time}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Date Range Calendar Filter */}
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Data / Periodo (Competizioni)
                        </label>
                        {isDateRangeScraping && isFutureDateSelected ? (
                          <span
                            data-testid="watch-date-scraping-status"
                            className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-brand-300"
                          >
                            <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                            Ricerca {selectedDateLabel ?? 'periodo'}...
                          </span>
                        ) : form.dateRange.mode !== 'all' ? (
                          <span
                            data-testid="watch-date-summary"
                            className="font-mono text-[10px] text-emerald-300"
                          >
                            {availableCompetitionsCount} competizioni &middot;{' '}
                            {dateFilteredCatalogEvents.length} eventi
                          </span>
                        ) : null}
                      </div>
                      <DateRangeCalendar
                        data-testid="watch-date-range-calendar"
                        value={form.dateRange}
                        onChange={handleDateRangeChange}
                        eventDateCounts={eventDateCounts}
                        isScraping={isDateRangeScraping && isFutureDateSelected}
                      />
                    </div>

                    {/* Sport & Competition Multi-Select Filters */}
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Sport
                        </label>
                        <CustomSelect<SportKey | 'ALL'>
                          data-testid="watch-sport-select"
                          className="mt-1"
                          value={form.sport ?? 'ALL'}
                          minMenuWidth={170}
                          onChange={(val) =>
                            setForm((prev) => {
                              const nextSport = val === 'ALL' ? undefined : val;
                              const nextLeagues = nextSport
                                ? prev.leagues.filter((lg) => {
                                    const inferred = inferSportFromLeague(lg);
                                    return !inferred || inferred === nextSport;
                                  })
                                : prev.leagues;
                              return {
                                ...prev,
                                sport: nextSport,
                                leagues: nextLeagues,
                                league: nextLeagues[0],
                              };
                            })
                          }
                          options={[
                            { value: 'ALL', label: 'Tutti gli sport' },
                            { value: 'football', label: 'Calcio' },
                            { value: 'tennis', label: 'Tennis' },
                            { value: 'basketball', label: 'Basket' },
                          ]}
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Competizioni ({form.leagues.length === 0 ? 'Tutte' : form.leagues.length})
                        </label>
                        <CustomMultiSelect<string>
                          data-testid="watch-league-select"
                          values={form.leagues}
                          allLabel="Tutte le competizioni"
                          searchable
                          searchPlaceholder="Cerca competizione nel periodo..."
                          minMenuWidth={255}
                          onChange={(vals) =>
                            setForm((prev) => ({
                              ...prev,
                              leagues: vals,
                              league: vals[0],
                            }))
                          }
                          options={competitionOptions}
                        />
                      </div>
                    </div>

                    {/* Bookmakers & Exchanges Multi-Select */}
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Bookmakers (
                          {form.bookmakerIds.length === 0 ? 'Tutti' : form.bookmakerIds.length})
                        </label>
                        <SourceMultiSelect
                          data-testid="watch-bookmakers-select"
                          values={form.bookmakerIds}
                          allLabel="Tutti i Bookmaker"
                          searchPlaceholder="Cerca bookmaker per nome..."
                          options={bookmakerOptions}
                          onChange={(vals) =>
                            setForm((prev) => ({ ...prev, bookmakerIds: vals as SourceId[] }))
                          }
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Exchanges (
                          {form.exchangeIds.length === 0 ? 'Tutti' : form.exchangeIds.length})
                        </label>
                        <SourceMultiSelect
                          data-testid="watch-exchanges-select"
                          values={form.exchangeIds}
                          allLabel="Tutti gli Exchange"
                          options={exchangeOptions}
                          onChange={(vals) =>
                            setForm((prev) => ({ ...prev, exchangeIds: vals as SourceId[] }))
                          }
                        />
                      </div>
                    </div>

                    {/* Target Rating + Mode + Refund Retention */}
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Rating Target (&ge; %)
                        </label>
                        <NumericInput
                          data-testid="watch-target-rating"
                          min={1}
                          max={300}
                          value={form.targetRating}
                          onChange={(val) => setForm((prev) => ({ ...prev, targetRating: val }))}
                          placeholder="98"
                          className="mt-1 w-full rounded-lg border border-brand-400/40 bg-slate-950 px-2.5 py-1.5 font-mono text-xs font-extrabold text-brand-200 focus:border-brand-400 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Modalità Calcolo
                        </label>
                        <CustomSelect<BetMode>
                          data-testid="watch-mode-select"
                          className="mt-1"
                          value={form.mode}
                          minMenuWidth={180}
                          onChange={(val) =>
                            setForm((prev) => ({
                              ...prev,
                              mode: val,
                              targetRating:
                                val === 'snr' && prev.targetRating >= 90
                                  ? 75
                                  : val !== 'snr' && prev.targetRating < 85
                                  ? 98
                                  : prev.targetRating,
                            }))
                          }
                          options={[
                            { value: 'normal', label: 'Normale' },
                            { value: 'snr', label: 'Freebet SNR' },
                            { value: 'sr', label: 'Bonus SR' },
                            { value: 'rf', label: 'Rimborso RF' },
                          ]}
                        />
                      </div>

                      {form.mode === 'rf' && (
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Ritenzione RF (%)
                          </label>
                          <NumericInput
                            min={10}
                            max={100}
                            value={form.refundRetention}
                            onChange={(val) =>
                              setForm((prev) => ({ ...prev, refundRetention: val }))
                            }
                            placeholder="70"
                            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                          />
                        </div>
                      )}
                    </div>

                    {/* Market & Selection */}
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Mercato
                        </label>
                        <CustomSelect<MarketType | 'ALL'>
                          data-testid="watch-market-select"
                          className="mt-1"
                          value={form.marketType}
                          minMenuWidth={185}
                          onChange={handleMarketChange}
                          options={[
                            { value: 'ALL', label: 'Tutti i mercati' },
                            { value: '1X2', label: 'Esito Finale 1X2' },
                            { value: 'OVER_UNDER_25', label: 'Under/Over 2.5 Gol' },
                            { value: 'BTTS', label: 'Goal / NoGoal' },
                            { value: 'H2H', label: 'Testa a Testa' },
                          ]}
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Esito Specifico
                        </label>
                        <CustomSelect<string>
                          data-testid="watch-selection-select"
                          className="mt-1"
                          value={form.selectionKey}
                          minMenuWidth={185}
                          onChange={(val) => setForm((prev) => ({ ...prev, selectionKey: val }))}
                          options={selectionOptions}
                        />
                      </div>
                    </div>

                    {/* Extra Filters: Min Liquidity + Back Odds Range */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Liquidità Min (&euro;)
                        </label>
                        <NumericInput
                          min={0}
                          value={form.minLiquidity}
                          onChange={(val) => setForm((prev) => ({ ...prev, minLiquidity: val }))}
                          placeholder="20"
                          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Quota Min
                        </label>
                        <NumericInput
                          min={1.01}
                          value={form.minBackOdds}
                          onChange={(val) => setForm((prev) => ({ ...prev, minBackOdds: val }))}
                          placeholder="1.2"
                          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          Quota Max
                        </label>
                        <NumericInput
                          min={1.05}
                          value={form.maxBackOdds}
                          onChange={(val) => setForm((prev) => ({ ...prev, maxBackOdds: val }))}
                          placeholder="15"
                          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* No Surebet ON/OFF + Auto-pause & Cooldown */}
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2">
                      <button
                        type="button"
                        data-testid="watch-no-surebet-toggle"
                        aria-pressed={form.excludeSurebets}
                        onClick={() =>
                          setForm((prev) => ({ ...prev, excludeSurebets: !prev.excludeSurebets }))
                        }
                        title="Esclude dal monitoraggio tutte le surebet recuperate (Rating Normale ≥ 100%)"
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                          form.excludeSurebets
                            ? 'border-rose-400/60 bg-rose-500/15 text-rose-100 shadow-[0_0_10px_-3px_rgba(244,63,94,0.45)]'
                            : 'border-slate-700/80 bg-slate-900 text-slate-300 hover:border-slate-600 hover:text-white'
                        }`}
                      >
                        <Ban
                          className={`h-3 w-3 ${
                            form.excludeSurebets ? 'text-rose-300' : 'text-slate-400'
                          }`}
                        />
                        <span>No Surebet</span>
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
                            form.excludeSurebets
                              ? 'bg-rose-400/25 text-rose-200'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {form.excludeSurebets ? 'ON' : 'OFF'}
                        </span>
                      </button>

                      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={form.autoPauseOnTrigger}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              autoPauseOnTrigger: e.target.checked,
                            }))
                          }
                          className="h-3.5 w-3.5 accent-amber-400"
                        />
                        <span>Pausa automatica dopo avviso</span>
                      </label>

                      {!form.autoPauseOnTrigger && (
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          <span>Cooldown (s)</span>
                          <NumericInput
                            min={10}
                            max={3600}
                            value={form.cooldownSec}
                            onChange={(val) => setForm((prev) => ({ ...prev, cooldownSec: val }))}
                            placeholder="60"
                            className="w-16 rounded-md border border-slate-800 bg-slate-950 px-2 py-0.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
                          />
                        </div>
                      )}
                    </div>

                    {/* Adaptive Cadence + Live Match Preview Strip */}
                    <div className="space-y-1 rounded-xl border border-brand-400/25 bg-brand-500/10 p-2.5 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-300">Frequenza stimata su questi siti:</span>
                        <span
                          data-testid="watch-estimated-interval"
                          className="font-mono font-extrabold text-brand-300"
                        >
                          Ogni {draftFrequencyEstimate.intervalSec}s (
                          {draftFrequencyEstimate.bookCount} book &middot;{' '}
                          {draftFrequencyEstimate.exCount} ex)
                        </span>
                      </div>
                      {draftFrequencyEstimate.rateLimitReasons.length > 0 && (
                        <div className="text-[10px] text-amber-300">
                          Sicurezza anti-429: {draftFrequencyEstimate.rateLimitReasons.join(' · ')}
                        </div>
                      )}
                      {draftLiveEval && (
                        <div className="flex items-center justify-between border-t border-brand-400/20 pt-1">
                          <span className="text-slate-300">Miglior rating live attuale:</span>
                          {draftLiveEval.bestMatch ? (
                            <span
                              className={`font-mono font-bold ${ratingTone(
                                draftLiveEval.bestMatch.rating,
                                form.mode
                              )}`}
                            >
                              {draftLiveEval.bestMatch.rating.toFixed(2)}% (
                              {draftLiveEval.bestMatch.bookmakerName} @
                              {formatOdds(draftLiveEval.bestMatch.backOdds)})
                            </span>
                          ) : (
                            <span className="text-slate-500">
                              Nessun match attivo con questi filtri
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {!hasAnyWatchFilter && (
                      <p
                        data-testid="watch-no-filter-hint"
                        className="text-[11px] text-amber-300/90"
                      >
                        Seleziona almeno un filtro (evento, periodo/date, sport, competizione, bookmaker, exchange, mercato o esito) per attivare il tracking.
                      </p>
                    )}
                  </div>

                  {/* Dialog Footer */}
                  <div className="flex items-center justify-end gap-2 border-t border-slate-800/80 bg-slate-950/50 px-5 py-3">
                    <button
                      type="button"
                      data-testid="watch-form-cancel-btn"
                      onClick={closeFormDialog}
                      className="rounded-xl border border-slate-700/80 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white"
                    >
                      Annulla
                    </button>
                    <button
                      type="submit"
                      data-testid="watch-submit-btn"
                      disabled={!hasAnyWatchFilter}
                      title={
                        !hasAnyWatchFilter
                          ? 'Seleziona almeno un filtro (evento, periodo/date, sport, competizione, bookmaker, exchange, mercato o esito)'
                          : undefined
                      }
                      className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-5 py-2 text-xs font-extrabold text-slate-950 shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <BellPlus className="h-4 w-4" />
                      {editingId ? 'Salva Modifiche Tracking' : 'Attiva Monitoraggio Rating'}
                    </button>
                  </div>
                </motion.form>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Delete Confirmation Modal Dialog */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {deleteConfirmWatch && (
              <div
                data-testid="watch-delete-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="watch-delete-dialog-title"
                className="fixed inset-0 z-[130] flex items-center justify-center p-4"
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14, ease: 'easeOut' }}
                  onClick={() => {
                    if (!isDeleting) setDeleteConfirmWatch(null);
                  }}
                  className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                  className="relative z-10 w-full max-w-md rounded-2xl border border-rose-500/35 bg-[var(--bg-modal-solid)] p-5 shadow-[0_24px_72px_rgba(0,0,0,0.92)]"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/35 bg-rose-500/15 text-rose-300">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3
                        id="watch-delete-dialog-title"
                        className="font-display text-sm font-bold text-white"
                      >
                        Conferma eliminazione Radar Rating
                      </h3>
                      <p className="mt-1 text-xs text-slate-300">
                        Vuoi eliminare definitivamente questo tracking rating? L&apos;operazione non può essere annullata.
                      </p>
                      <div className="mt-2.5 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs">
                        <div className="truncate font-bold text-white">
                          {deleteConfirmWatch.eventName.trim()
                            ? deleteConfirmWatch.eventName
                            : 'Tutti gli eventi'}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-brand-300">
                          {betModeLabelIt(deleteConfirmWatch.mode)} &ge;{' '}
                          {deleteConfirmWatch.targetRating.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      data-testid="watch-delete-cancel-btn"
                      disabled={isDeleting}
                      onClick={() => setDeleteConfirmWatch(null)}
                      className="rounded-xl border border-slate-700/80 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-50"
                    >
                      Annulla
                    </button>
                    <button
                      type="button"
                      data-testid="watch-delete-confirm-btn"
                      disabled={isDeleting}
                      onClick={() => void confirmDeleteWatch()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/50 bg-rose-500/20 px-4 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-500/35 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {isDeleting ? 'Eliminazione...' : 'Elimina Tracking'}
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

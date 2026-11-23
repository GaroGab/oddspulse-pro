import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BellPlus,
  BellRing,
  Calculator,
  CheckCircle2,
  Clock,
  Edit3,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  betModeLabelIt,
  buildCompetitionOptions,
  estimateSingleWatchInterval,
  evaluateRatingWatch,
  getSelectionOptionsForMarket,
  getWatchLeagues,
  inferSportFromLeague,
  isWatchExpired,
  matchesWatchLeagues,
  normalizeWatchQuery,
  resolveCanonicalCompetition,
} from '../../shared/ratingWatch';
import {
  SOURCE_CATALOG,
  type AppSettings,
  type BetMode,
  type MarketType,
  type OddsmatcherRow,
  type RatingWatch,
  type RatingWatchEngineStatus,
  type RatingWatchInput,
  type ScrapeSnapshot,
  type SourceId,
  type SportKey,
} from '../../shared/types';
import { formatEuro, formatEventTime, formatOdds, ratingTone, sportLabel } from '../utils/format';
import { playRatingAlertBurst, stopPersistentRatingAlarm } from '../utils/sound';
import { BookmakerIcon } from './BookmakerIcon';
import { CustomMultiSelect, CustomSelect } from './CustomSelect';
import { NumericInput } from './NumericInput';
import { SlidingPillTrack } from './SlidingPillTrack';
import { SourceMultiSelect } from './SourceSelect';

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
    autoPauseOnTrigger: true,
    cooldownSec: 60,
  };
}

const SOURCE_NAME_MAP = new Map<SourceId, string>(SOURCE_CATALOG.map((s) => [s.id, s.name]));

const MARKET_LABEL_MAP: Record<MarketType | 'ALL', string> = {
  ALL: 'Tutti i mercati',
  '1X2': 'Esito Finale 1X2',
  OVER_UNDER_25: 'Under/Over 2.5 Gol',
  BTTS: 'Goal / NoGoal',
  H2H: 'Testa a Testa',
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
  onEnableSound,
  onOpenCalculator,
  onConsumeDraftSeed,
}) => {
  const [form, setForm] = useState<WatchFormState>(() => createEmptyForm('normal'));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'triggered' | 'paused'>('all');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [testSoundPlaying, setTestSoundPlaying] = useState(false);
  const [nowSecTick, setNowSecTick] = useState(() => Date.now());
  const pickerRef = useRef<HTMLDivElement>(null);
  const formTopRef = useRef<HTMLDivElement>(null);

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
      autoPauseOnTrigger: true,
      cooldownSec: 60,
    });
    onConsumeDraftSeed?.();
  }, [draftSeed, onConsumeDraftSeed]);

  // Available Bookmaker & Exchange options
  const bookmakerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of snapshot.rows) map.set(r.bookmakerId, r.bookmakerName);
    for (const s of SOURCE_CATALOG.filter((x) => x.kind === 'bookmaker' && x.enabled)) {
      if (!map.has(s.id)) map.set(s.id, s.name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [snapshot.rows]);

  const exchangeOptions = useMemo(
    () => SOURCE_CATALOG.filter((s) => s.kind === 'exchange').map((s) => ({ id: s.id, name: s.name })),
    []
  );

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

  const filteredEventSuggestions = useMemo(() => {
    const q = normalizeWatchQuery(form.eventName);
    const tokens = q ? q.split(' ').filter(Boolean) : [];
    return catalogEvents
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
  }, [catalogEvents, form.eventName, form.sport, form.leagues]);

  // Preset + dynamic live competition options filtered by current sport
  const competitionOptions = useMemo(
    () => buildCompetitionOptions(catalogEvents, form.sport, form.leagues),
    [catalogEvents, form.sport, form.leagues]
  );

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
      form.sport ||
      form.leagues.length > 0 ||
      form.league?.trim() ||
      form.marketType !== 'ALL' ||
      form.selectionKey !== 'ALL' ||
      form.bookmakerIds.length > 0 ||
      form.exchangeIds.length > 0
  );

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
      autoPauseOnTrigger: form.autoPauseOnTrigger,
      cooldownSec: Math.max(10, form.cooldownSec),
    };

    if (editingId) {
      await onUpdateWatch(editingId, payload);
      setEditingId(null);
    } else {
      await onCreateWatch(payload);
    }
    setForm(createEmptyForm(form.mode));
  };

  const startEdit = (w: RatingWatch) => {
    const resolvedLeagues = getWatchLeagues(w).map(
      (lg) => resolveCanonicalCompetition(lg, w.sport) ?? lg
    );
    setEditingId(w.id);
    setForm({
      enabled: w.enabled,
      eventKey: w.eventKey,
      eventName: w.eventName,
      sport: w.sport,
      league: resolvedLeagues[0],
      leagues: resolvedLeagues,
      startTime: w.startTime,
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
      autoPauseOnTrigger: w.autoPauseOnTrigger,
      cooldownSec: w.cooldownSec,
    });
    formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

      {/* Main Two-Column Content */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-12">
        {/* LEFT: Create / Edit Form */}
        <form
          ref={formTopRef as unknown as React.RefObject<HTMLFormElement>}
          data-testid="watch-form"
          onSubmit={(e) => void handleSubmit(e)}
          className="glass-panel flex min-h-0 flex-col gap-3 overflow-y-auto rounded-2xl p-4 lg:col-span-5"
        >
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
            <div className="flex items-center gap-2">
              <BellPlus className="h-4 w-4 text-brand-300" />
              <h2 className="font-display text-sm font-bold text-white">
                {editingId ? 'Modifica Tracking Rating' : 'Nuovo Tracking Rating'}
              </h2>
            </div>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(createEmptyForm('normal'));
                }}
                className="flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:text-white"
              >
                <X className="h-3 w-3" /> Annulla modifica
              </button>
            )}
          </div>

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
                  {formatEventTime(form.startTime).date} {formatEventTime(form.startTime).time}
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
                        <div className="truncate font-semibold text-white">{ev.eventName}</div>
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
                minMenuWidth={240}
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
                Bookmakers ({form.bookmakerIds.length === 0 ? 'Tutti' : form.bookmakerIds.length})
              </label>
              <SourceMultiSelect
                data-testid="watch-bookmakers-select"
                values={form.bookmakerIds}
                allLabel="Tutti i Bookmaker"
                options={bookmakerOptions}
                onChange={(vals) =>
                  setForm((prev) => ({ ...prev, bookmakerIds: vals as SourceId[] }))
                }
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Exchanges ({form.exchangeIds.length === 0 ? 'Tutti' : form.exchangeIds.length})
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
                  onChange={(val) => setForm((prev) => ({ ...prev, refundRetention: val }))}
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

          {/* Auto-pause & Cooldown */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={form.autoPauseOnTrigger}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, autoPauseOnTrigger: e.target.checked }))
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
          <div className="rounded-xl border border-brand-400/25 bg-brand-500/10 p-2.5 text-[11px] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-300">Frequenza stimata su questi siti:</span>
              <span
                data-testid="watch-estimated-interval"
                className="font-mono font-extrabold text-brand-300"
              >
                Ogni {draftFrequencyEstimate.intervalSec}s ({draftFrequencyEstimate.bookCount} book &middot;{' '}
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
                    {draftLiveEval.bestMatch.rating.toFixed(2)}% ({draftLiveEval.bestMatch.bookmakerName}{' '}
                    @{formatOdds(draftLiveEval.bestMatch.backOdds)})
                  </span>
                ) : (
                  <span className="text-slate-500">Nessun match attivo con questi filtri</span>
                )}
              </div>
            )}
          </div>

          {!hasAnyWatchFilter && (
            <p
              data-testid="watch-no-filter-hint"
              className="text-[11px] text-amber-300/90"
            >
              Seleziona almeno un filtro (evento, sport, competizione, bookmaker, exchange, mercato o esito) per attivare il tracking.
            </p>
          )}

          <button
            type="submit"
            data-testid="watch-submit-btn"
            disabled={!hasAnyWatchFilter}
            title={
              !hasAnyWatchFilter
                ? 'Seleziona almeno un filtro (evento, sport, competizione, bookmaker, exchange, mercato o esito)'
                : undefined
            }
            className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-4 py-2.5 text-xs font-extrabold text-slate-950 shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BellPlus className="h-4 w-4" />
            {editingId ? 'Salva Modifiche Tracking' : 'Attiva Monitoraggio Rating'}
          </button>
        </form>

        {/* RIGHT: Active & Historical Rating Watches List */}
        <div className="glass-panel flex min-h-0 flex-col overflow-hidden rounded-2xl lg:col-span-7">
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
                <p className="mt-1 max-w-sm text-xs text-slate-400">
                  Imposta i filtri a sinistra (anche solo bookmaker, exchange e rating minimo, senza obbligo di evento) oppure clicca la campanella su una riga dell&apos;Oddsmatcher.
                </p>
              </div>
            ) : (
              filteredWatches.map((w) => {
                const expired = isWatchExpired(w, nowSecTick, settings.includeLiveEvents);
                const liveBest = w.lastBestMatch;
                const liveRow = liveBest ? rowById.get(liveBest.rowId) : undefined;
                const progressPct = liveBest
                  ? Math.max(5, Math.min(100, (liveBest.rating / Math.max(1, w.targetRating)) * 100))
                  : 0;
                const hitNow = Boolean(liveBest && liveBest.rating >= w.targetRating);
                const watchLeagues = getWatchLeagues(w);

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
                          <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-300 border border-slate-800">
                            {MARKET_LABEL_MAP[w.marketType]} &middot;{' '}
                            {getSelectionOptionsForMarket(w.marketType).find(
                              (o) => o.value === w.selectionKey
                            )?.label ?? w.selectionKey}
                          </span>
                          {watchLeagues.map((lg) => (
                            <span
                              key={lg}
                              className="rounded-md border border-brand-400/35 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-200"
                            >
                              {lg}
                            </span>
                          ))}
                          {w.triggerCount > 0 && (
                            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                              Avvisi: {w.triggerCount}
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5 truncate text-sm font-bold text-white">
                          {w.eventName.trim()
                            ? w.eventName
                            : watchLeagues.length > 0
                            ? `Tutti gli eventi — ${watchLeagues.join(', ')}`
                            : `Tutti gli eventi${w.sport ? ` (${sportLabel(w.sport)})` : ''}`}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                          {w.sport && <span>{sportLabel(w.sport)}</span>}
                          {watchLeagues.length > 0 && (
                            <span>
                              {w.sport ? '· ' : ''}
                              {watchLeagues.join(', ')}
                            </span>
                          )}
                          {w.startTime && (
                            <span>
                              &middot; {formatEventTime(w.startTime).date}{' '}
                              {formatEventTime(w.startTime).time}
                            </span>
                          )}
                          <span>&middot; Liq &ge; {formatEuro(w.minLiquidity)}</span>
                          <span>
                            &middot; Q {w.minBackOdds.toFixed(2)}–{w.maxBackOdds.toFixed(2)}
                          </span>
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
                          onClick={() => void onDeleteWatch(w.id)}
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-300 transition hover:bg-rose-500/25"
                          title="Elimina tracking"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Sources row */}
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
                            className="inline-flex items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 text-slate-200 border border-slate-800"
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
                            className="inline-flex items-center gap-1 rounded bg-slate-900 px-1.5 py-0.5 text-slate-200 border border-slate-800"
                          >
                            <BookmakerIcon sourceId={id} size={17} />
                            {SOURCE_NAME_MAP.get(id) ?? id}
                          </span>
                        ))
                      )}
                    </div>

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
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

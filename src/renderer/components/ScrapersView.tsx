import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Ban,
  CheckCheck,
  CheckCircle2,
  KeyRound,
  Play,
  Radar,
  RefreshCw,
  Search,
  Settings2,
  Square,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import {
  SOURCE_CATALOG,
  type AppSettings,
  type ScrapeSnapshot,
  type SourceId,
} from '../../shared/types';
import { BookmakerIcon } from './BookmakerIcon';
import { CustomSelect } from './CustomSelect';
import { SlidingPillTrack } from './SlidingPillTrack';

interface ScrapersViewProps {
  snapshot: ScrapeSnapshot;
  settings: AppSettings;
  autoScrapeActive: boolean;
  isTogglingAutoScrape?: boolean;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onRunScrape: () => void;
  onStopAutoScrape: () => void;
  onStartAutoScrape: () => void;
}

export const ScrapersView: React.FC<ScrapersViewProps> = ({
  snapshot,
  settings,
  autoScrapeActive,
  isTogglingAutoScrape = false,
  onUpdateSettings,
  onRunScrape,
  onStopAutoScrape,
  onStartAutoScrape,
}) => {
  const [apiKeyDraft, setApiKeyDraft] = useState(settings.theOddsApiKey);
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceKindFilter, setSourceKindFilter] = useState<'ALL' | 'bookmaker' | 'exchange'>('ALL');

  const sourceMetaMap = useMemo(() => new Map(SOURCE_CATALOG.map((c) => [c.id, c])), []);

  const filteredSources = useMemo(() => {
    const q = sourceSearch.trim().toLowerCase();
    return snapshot.sources.filter((src) => {
      if (sourceKindFilter !== 'ALL' && src.kind !== sourceKindFilter) return false;
      if (!q) return true;
      const meta = sourceMetaMap.get(src.id);
      const hay = `${src.name} ${src.shortName} ${src.id} ${meta?.region ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [snapshot.sources, sourceKindFilter, sourceSearch, sourceMetaMap]);

  const bookmakersTotal = useMemo(
    () => snapshot.sources.filter((s) => s.kind === 'bookmaker').length,
    [snapshot.sources]
  );
  const exchangesTotal = useMemo(
    () => snapshot.sources.filter((s) => s.kind === 'exchange').length,
    [snapshot.sources]
  );

  const enabledFilteredCount = useMemo(
    () =>
      filteredSources.reduce((acc, src) => {
        const meta = sourceMetaMap.get(src.id);
        const isEnabled = settings.enabledSources[src.id] ?? meta?.enabled ?? src.enabled;
        return acc + (isEnabled ? 1 : 0);
      }, 0),
    [filteredSources, settings.enabledSources, sourceMetaMap]
  );

  const allFilteredEnabled =
    filteredSources.length > 0 && enabledFilteredCount === filteredSources.length;
  const noneFilteredEnabled = filteredSources.length === 0 || enabledFilteredCount === 0;

  const toggleSource = (id: SourceId) => {
    onUpdateSettings({
      enabledSources: {
        ...settings.enabledSources,
        [id]: !settings.enabledSources[id],
      },
    });
  };

  const setFilteredSourcesEnabled = (enabled: boolean) => {
    if (filteredSources.length === 0) return;
    const nextEnabledSources: AppSettings['enabledSources'] = {
      ...settings.enabledSources,
    };
    for (const src of filteredSources) {
      nextEnabledSources[src.id] = enabled;
    }
    onUpdateSettings({ enabledSources: nextEnabledSources });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
      {/* Top Engine Control Bar */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-300 to-accent-500 text-slate-950 shadow-glow">
            <Radar className={`h-5 w-5 ${snapshot.stats.isRunning ? 'animate-spin' : ''}`} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-base font-bold text-white">
                Motore di Scraping Live & Telemetria
              </h1>
              <span
                data-testid="scrapers-auto-status-badge"
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold ${
                  autoScrapeActive
                    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-amber-400/40 bg-amber-500/15 text-amber-300'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    autoScrapeActive ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'
                  }`}
                />
                {autoScrapeActive
                  ? `AUTO ATTIVO (${settings.refreshIntervalSec}s)`
                  : 'AUTO FERMO'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Scraping live su Exchange (Betfair.it, Betflag EX, Smarkets) e Bookmaker ADM italiani (Sisal, SNAI, Betflag, Eurobet, GoldBet, Lottomatica, Planetwin365, bet365, Betsson, DomusBet, DAZN Bet, WilliamHill, Gioco Digitale, PokerStars, NetBet, Stanleybet, 888sport, LeoVegas, Betfair SB) + EU.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {autoScrapeActive || snapshot.stats.isRunning ? (
            <motion.button
              key="scrapers-auto-stop"
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={onStopAutoScrape}
              disabled={isTogglingAutoScrape}
              data-testid="scrapers-auto-scrape-toggle"
              className="flex items-center gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-3.5 py-2 text-xs font-bold text-rose-200 transition hover:border-rose-400/75 hover:bg-rose-500/25 disabled:opacity-60"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stoppa Auto-Scraping
            </motion.button>
          ) : (
            <motion.button
              key="scrapers-auto-restart"
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={onStartAutoScrape}
              disabled={isTogglingAutoScrape}
              data-testid="scrapers-auto-scrape-toggle"
              className="flex items-center gap-2 rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-3.5 py-2 text-xs font-bold text-emerald-200 transition hover:border-emerald-400/80 hover:bg-emerald-500/30 disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Riavvia Auto-Scraping
            </motion.button>
          )}

          <motion.button
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            onClick={onRunScrape}
            disabled={snapshot.stats.isRunning}
            data-testid="scrapers-run-now-btn"
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-4 py-2 text-xs font-bold text-slate-950 shadow-glow transition hover:brightness-110 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${snapshot.stats.isRunning ? 'animate-spin' : ''}`} />
            {snapshot.stats.isRunning ? 'Scansione Live in corso...' : 'Avvia Scraping Completo'}
          </motion.button>
        </div>
      </div>

      {/* Global Settings Row */}
      <div className="glass-card grid grid-cols-1 items-start gap-3.5 rounded-2xl p-4 md:grid-cols-5">
        <div className="flex flex-col">
          <label className="flex h-4 items-center gap-1.5 text-[11px] font-semibold text-slate-300">
            <Settings2 className="h-3.5 w-3.5 shrink-0 text-brand-400" />
            <span className="truncate">Frequenza Auto-Scraping</span>
          </label>
          <CustomSelect<number>
            data-testid="scrapers-interval-select"
            className="mt-1.5"
            minMenuWidth={220}
            value={settings.refreshIntervalSec}
            onChange={(val) =>
              onUpdateSettings({
                refreshIntervalSec: val,
                autoScrapeEnabled: val > 0,
              })
            }
            triggerClassName="h-9 rounded-xl py-0"
            options={[
              { value: 0, label: 'Manuale (On-Demand)', dotColor: 'bg-slate-400' },
              { value: 20, label: 'Ogni 20 secondi', hint: 'Ultra-rapido', dotColor: 'bg-brand-300' },
              { value: 30, label: 'Ogni 30 secondi', hint: 'Veloce', dotColor: 'bg-amber-400' },
              { value: 60, label: 'Ogni 60 secondi', hint: 'Consigliato', dotColor: 'bg-emerald-400' },
              { value: 120, label: 'Ogni 2 minuti', dotColor: 'bg-brand-300' },
              { value: 300, label: 'Ogni 5 minuti', dotColor: 'bg-slate-400' },
            ]}
          />
          {!autoScrapeActive && settings.refreshIntervalSec > 0 && (
            <p className="mt-1.5 text-[10px] font-medium text-amber-300/90">
              In pausa (riprenderà ogni {settings.refreshIntervalSec}s al riavvio)
            </p>
          )}
        </div>

        <div className="flex flex-col">
          <label className="flex h-4 items-center text-[11px] font-semibold text-slate-300">
            <span className="truncate">Comm. Betfair EX (%)</span>
          </label>
          <input
            type="number"
            min={0}
            max={15}
            step={0.5}
            value={Math.round(settings.betfairCommission * 1000) / 10}
            onChange={(e) =>
              onUpdateSettings({
                betfairCommission: Math.max(0, (parseFloat(e.target.value) || 0) / 100),
              })
            }
            className="mt-1.5 h-9 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 font-mono text-xs font-bold text-amber-300 focus:border-brand-400 focus:outline-none"
          />
        </div>

        <div className="flex flex-col">
          <label className="flex h-4 items-center text-[11px] font-semibold text-slate-300">
            <span className="truncate">Comm. Betflag EX (%)</span>
          </label>
          <input
            type="number"
            min={0}
            max={15}
            step={0.5}
            value={Math.round((settings.betflagCommission ?? 0.05) * 1000) / 10}
            onChange={(e) =>
              onUpdateSettings({
                betflagCommission: Math.max(0, (parseFloat(e.target.value) || 0) / 100),
              })
            }
            className="mt-1.5 h-9 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 font-mono text-xs font-bold text-sky-300 focus:border-brand-400 focus:outline-none"
          />
        </div>

        <div className="flex flex-col">
          <label className="flex h-4 items-center text-[11px] font-semibold text-slate-300">
            <span className="truncate">Comm. Smarkets (%)</span>
          </label>
          <input
            type="number"
            min={0}
            max={15}
            step={0.5}
            value={Math.round(settings.smarketsCommission * 1000) / 10}
            onChange={(e) =>
              onUpdateSettings({
                smarketsCommission: Math.max(0, (parseFloat(e.target.value) || 0) / 100),
              })
            }
            className="mt-1.5 h-9 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 font-mono text-xs font-bold text-emerald-300 focus:border-brand-400 focus:outline-none"
          />
        </div>

        <div className="flex flex-col">
          <label className="flex h-4 items-center text-[11px] font-semibold text-slate-300">
            <span className="truncate">Eventi In-Play (LIVE)</span>
          </label>
          <button
            type="button"
            onClick={() => onUpdateSettings({ includeLiveEvents: !settings.includeLiveEvents })}
            className={`mt-1.5 flex h-9 items-center justify-between rounded-xl border px-3 text-xs font-semibold transition ${
              settings.includeLiveEvents
                ? 'border-brand-400/50 bg-brand-500/15 text-brand-200'
                : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-300'
            }`}
          >
            <span className="truncate">
              {settings.includeLiveEvents ? 'Inclusi (Pre + Live)' : 'Solo Pre-Match'}
            </span>
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                settings.includeLiveEvents ? 'bg-brand-400 shadow-[0_0_8px_rgb(var(--brand-400))]' : 'bg-slate-600'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Bookmakers & Sources Search / Filter Bar */}
      <div className="glass-card flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white">Elenco Bookmaker & Fonti</span>
            <span className="rounded-lg border border-slate-800 bg-slate-950/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-300">
              {filteredSources.length} / {snapshot.sources.length}
            </span>
          </div>

          <SlidingPillTrack
            activeKey={sourceKindFilter}
            pillClassName="rounded-lg bg-slate-800 shadow-inner"
            className="flex items-center rounded-xl border border-slate-800 bg-slate-950/75 p-0.5"
          >
            {(
              [
                { id: 'ALL', label: `Tutti (${snapshot.sources.length})` },
                { id: 'bookmaker', label: `Bookmaker (${bookmakersTotal})` },
                { id: 'exchange', label: `Exchange (${exchangesTotal})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-pill-key={tab.id}
                data-testid={`scrapers-kind-${tab.id.toLowerCase()}`}
                onClick={() => setSourceKindFilter(tab.id)}
                className={`relative z-10 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  sourceKindFilter === tab.id
                    ? 'text-brand-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </SlidingPillTrack>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilteredSourcesEnabled(true)}
              disabled={allFilteredEnabled}
              data-testid="scrapers-select-all"
              title="Attiva tutte le fonti visibili nell'elenco"
              className="flex h-9 items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-2.5 text-[11px] font-bold text-emerald-200 transition hover:border-emerald-400/65 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <CheckCheck className="h-3.5 w-3.5 shrink-0" />
              <span>Seleziona tutti</span>
            </button>
            <button
              type="button"
              onClick={() => setFilteredSourcesEnabled(false)}
              disabled={noneFilteredEnabled}
              data-testid="scrapers-deselect-all"
              title="Disattiva tutte le fonti visibili nell'elenco"
              className="flex h-9 items-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-2.5 text-[11px] font-bold text-rose-200 transition hover:border-rose-400/65 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Ban className="h-3.5 w-3.5 shrink-0" />
              <span>Deseleziona tutti</span>
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={sourceSearch}
              onChange={(e) => setSourceSearch(e.target.value)}
              placeholder="Cerca bookmaker o exchange per nome..."
              data-testid="scrapers-bookmaker-search"
              className="h-9 w-full rounded-xl border border-slate-800 bg-slate-950/90 pl-8 pr-8 text-xs text-white placeholder-slate-500 focus:border-brand-400 focus:outline-none"
            />
            {sourceSearch && (
              <button
                type="button"
                aria-label="Azzera ricerca bookmaker"
                data-testid="scrapers-bookmaker-search-clear"
                onClick={() => setSourceSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sources Health Cards Grid */}
      {filteredSources.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center gap-2 rounded-2xl p-8 text-center">
          <Search className="h-6 w-6 text-slate-500" />
          <div className="text-xs font-semibold text-slate-300">
            Nessun bookmaker o fonte trovato{sourceSearch.trim() ? ` per "${sourceSearch.trim()}"` : ''}.
          </div>
          <button
            type="button"
            onClick={() => {
              setSourceSearch('');
              setSourceKindFilter('ALL');
            }}
            className="mt-1 rounded-lg border border-brand-400/40 bg-brand-500/15 px-3 py-1.5 text-[11px] font-bold text-brand-200 transition hover:bg-brand-500/25"
          >
            Mostra tutte le fonti
          </button>
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filteredSources.map((src, idx) => {
          const meta = sourceMetaMap.get(src.id);
          if (!meta) return null;
          const isEnabled = settings.enabledSources[src.id] ?? meta.enabled;

          return (
            <motion.div
              key={src.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx * 0.02, 0.2) }}
              className={`glass-card relative overflow-hidden rounded-2xl p-4 transition ${
                isEnabled ? 'border-slate-800/90' : 'opacity-60 border-slate-900'
              }`}
            >
              {/* Brand top color accent */}
              <div
                className="absolute inset-x-0 top-0 h-[2px]"
                style={{ backgroundColor: isEnabled ? src.color : '#334155' }}
              />

              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <BookmakerIcon sourceId={src.id} size={40} className="rounded-xl" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{src.name}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-300">
                        {src.kind === 'exchange' ? 'EXCHANGE' : meta.region}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400 line-clamp-1">
                      {meta.description}
                    </p>
                  </div>
                </div>

                {/* Enable/Disable Toggle */}
                <button
                  onClick={() => toggleSource(src.id)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    isEnabled ? 'bg-brand-400' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-slate-950 transition-transform ${
                      isEnabled ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="mt-3.5 grid grid-cols-3 gap-2 rounded-xl bg-slate-950/70 p-2.5 text-center">
                <div>
                  <div className="text-[10px] text-slate-500">Eventi</div>
                  <div className="font-mono text-xs font-bold text-white">{src.eventsCount}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Mercati</div>
                  <div className="font-mono text-xs font-bold text-brand-300">
                    {src.marketsCount}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Latenza</div>
                  <div className="font-mono text-xs font-bold text-emerald-300">
                    {src.latencyMs > 0 ? `${src.latencyMs}ms` : '--'}
                  </div>
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5">
                  {src.state === 'ok' && (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-300 font-medium">Connesso</span>
                      {src.lastCacheAgeSec !== undefined && src.lastCacheAgeSec >= 60 && (
                        <span
                          title={`Feed pubblico con cache CDN upstream di circa ${Math.round(
                            src.lastCacheAgeSec / 60
                          )} minuti`}
                          className="rounded border border-amber-400/35 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-200"
                        >
                          Cache ~{Math.round(src.lastCacheAgeSec / 60)}m
                        </span>
                      )}
                    </>
                  )}
                  {src.state === 'scraping' && (
                    <>
                      <Activity className="h-3.5 w-3.5 animate-pulse text-brand-400" />
                      <span className="text-brand-300 font-medium">Scraping in corso...</span>
                    </>
                  )}
                  {src.state === 'error' && (
                    <>
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span
                        className="truncate max-w-[205px] text-amber-300"
                        title={src.lastError ?? ''}
                      >
                        {src.lastError}
                      </span>
                    </>
                  )}
                  {(src.state === 'idle' || src.state === 'disabled') && (
                    <span className="text-slate-500">
                      {src.state === 'disabled' ? 'Disattivato' : 'In attesa'}
                    </span>
                  )}
                </span>

                <span className="font-mono text-[10px] text-slate-500">
                  OK:{src.successCount} / ERR:{src.errorCount}
                </span>
              </div>

              {/* Optional API key input for The Odds API */}
              {src.id === 'the_odds_api' && (
                <div className="mt-3 flex items-center gap-1.5 border-t border-slate-800/80 pt-2.5">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-accent-400" />
                  <input
                    type="password"
                    value={apiKeyDraft}
                    onChange={(e) => setApiKeyDraft(e.target.value)}
                    placeholder="API Key opzionale (the-odds-api.com)"
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[11px] text-white focus:border-accent-400 focus:outline-none"
                  />
                  <button
                    onClick={() => onUpdateSettings({ theOddsApiKey: apiKeyDraft })}
                    className="rounded-lg bg-accent-500/20 px-2.5 py-1 text-[10px] font-bold text-accent-200 hover:bg-accent-500/35"
                  >
                    Salva
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
      )}

      {/* Live Terminal Scraping Log */}
      <div className="glass-panel flex min-h-[210px] flex-col rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-950/90 px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <Terminal className="h-4 w-4 text-brand-400" />
            Console Log Scraping Live
          </div>
          <span className="font-mono text-[10px] text-slate-500">
            {snapshot.logs.length} eventi registrati
          </span>
        </div>

        <div className="max-h-56 overflow-y-auto bg-black/45 p-3 font-mono text-[11px] space-y-1">
          {snapshot.logs.length === 0 ? (
            <div className="text-slate-600">In attesa di eventi dallo scraper...</div>
          ) : (
            snapshot.logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2.5 leading-relaxed">
                <span className="shrink-0 text-slate-600">
                  {new Date(log.timestamp).toLocaleTimeString('it-IT')}
                </span>
                <span
                  className={`w-28 shrink-0 font-bold ${
                    log.level === 'success'
                      ? 'text-emerald-400'
                      : log.level === 'error'
                      ? 'text-rose-400'
                      : log.level === 'warn'
                      ? 'text-amber-400'
                      : 'text-brand-400'
                  }`}
                >
                  [{log.source}]
                </span>
                <span className="text-slate-300">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

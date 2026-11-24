import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  CheckCircle2,
  KeyRound,
  Play,
  Radar,
  RefreshCw,
  Settings2,
  Square,
  Terminal,
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

  const toggleSource = (id: SourceId) => {
    onUpdateSettings({
      enabledSources: {
        ...settings.enabledSources,
        [id]: !settings.enabledSources[id],
      },
    });
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
              Scraping live su Exchange (Betfair.it, Betflag EX, Smarkets) e Bookmaker ADM italiani (Sisal, SNAI, Betflag, Eurobet, GoldBet, 888sport, LeoVegas, Betfair SB) + EU.
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
      <div className="glass-card grid grid-cols-1 gap-3 rounded-2xl p-4 md:grid-cols-5">
        <div>
          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
            <Settings2 className="h-3.5 w-3.5 text-brand-400" />
            Frequenza Auto-Scraping
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
            triggerClassName="rounded-xl py-2"
            options={[
              { value: 0, label: 'Manuale (On-Demand)', dotColor: 'bg-slate-400' },
              { value: 30, label: 'Ogni 30 secondi', hint: 'Veloce', dotColor: 'bg-amber-400' },
              { value: 60, label: 'Ogni 60 secondi', hint: 'Consigliato', dotColor: 'bg-emerald-400' },
              { value: 120, label: 'Ogni 2 minuti', dotColor: 'bg-brand-300' },
              { value: 300, label: 'Ogni 5 minuti', dotColor: 'bg-slate-400' },
            ]}
          />
          {!autoScrapeActive && settings.refreshIntervalSec > 0 && (
            <p className="mt-1 text-[10px] font-medium text-amber-300/90">
              In pausa (riprenderà ogni {settings.refreshIntervalSec}s al riavvio)
            </p>
          )}
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-300">
            Comm. Betfair EX (%)
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
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs font-bold text-amber-300 focus:border-brand-400 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-300">
            Comm. Betflag EX (%)
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
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs font-bold text-sky-300 focus:border-brand-400 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-slate-300">
            Comm. Smarkets (%)
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
            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs font-bold text-emerald-300 focus:border-brand-400 focus:outline-none"
          />
        </div>

        <div className="flex flex-col justify-between">
          <label className="text-[11px] font-semibold text-slate-300">Eventi In-Play (LIVE)</label>
          <button
            onClick={() => onUpdateSettings({ includeLiveEvents: !settings.includeLiveEvents })}
            className={`mt-1.5 flex items-center justify-between rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              settings.includeLiveEvents
                ? 'border-brand-400/50 bg-brand-500/15 text-brand-200'
                : 'border-slate-800 bg-slate-950 text-slate-400'
            }`}
          >
            <span>{settings.includeLiveEvents ? 'Inclusi (Pre + Live)' : 'Solo Pre-Match'}</span>
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                settings.includeLiveEvents ? 'bg-brand-400 shadow-[0_0_8px_rgb(var(--brand-400))]' : 'bg-slate-600'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Sources Health Cards Grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.sources.map((src, idx) => {
          const meta = SOURCE_CATALOG.find((c) => c.id === src.id);
          if (!meta) return null;
          const isEnabled = settings.enabledSources[src.id] ?? meta.enabled;

          return (
            <motion.div
              key={src.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.03 }}
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
                  className={`w-20 shrink-0 font-bold ${
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

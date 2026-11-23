import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Maximize2,
  Minimize2,
  Minus,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { THEME_CATALOG, type ScrapeSnapshot, type ThemeId } from '../../shared/types';

interface TitleBarProps {
  snapshot: ScrapeSnapshot;
  theme: ThemeId;
  isBrowserOnline: boolean;
  refreshIntervalSec: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onRunScrape: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = React.memo(({
  snapshot,
  theme,
  isBrowserOnline,
  refreshIntervalSec,
  soundEnabled,
  onToggleSound,
  onRunScrape,
}) => {
  const themeMeta = THEME_CATALOG.find((t) => t.id === theme) ?? THEME_CATALOG[0];
  const isOffline = !isBrowserOnline || snapshot.connection.health === 'offline';
  const [isMaximized, setIsMaximized] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(refreshIntervalSec);

  useEffect(() => {
    window.oddspulse?.isMaximized().then(setIsMaximized).catch(() => {});
    const unsub = window.oddspulse?.onMaximizedChange((m) => setIsMaximized(m));
    return () => {
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (refreshIntervalSec <= 0 || !snapshot.stats.lastCompletedAt) {
      setSecondsLeft(refreshIntervalSec);
      return;
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - (snapshot.stats.lastCompletedAt ?? Date.now())) / 1000);
      const rem = Math.max(0, refreshIntervalSec - (elapsed % Math.max(1, refreshIntervalSec)));
      setSecondsLeft(rem);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [refreshIntervalSec, snapshot.stats.lastCompletedAt]);

  const progress =
    refreshIntervalSec > 0 ? Math.max(0, Math.min(1, secondsLeft / refreshIntervalSec)) : 0;
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  const activeSources = snapshot.sources.filter((s) => s.state === 'ok').length;
  const enabledSources = snapshot.sources.filter((s) => s.enabled).length;

  return (
    <header className="relative z-40 h-12 shrink-0 select-none border-b border-slate-800/80 bg-[var(--bg-modal-solid)]">
      {/* Animated top neon hairline */}
      <div className="aurora-bar absolute inset-x-0 top-0 h-[2px]" />

      <div className="app-drag flex h-full items-center justify-between px-4">
        {/* Left: Brand Logo */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 via-brand-400 to-accent-500 shadow-glow">
            <Zap className="h-4 w-4 text-slate-950" strokeWidth={2.6} />
            {snapshot.stats.isRunning && (
              <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-300 opacity-80" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-400" />
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-sm font-bold tracking-tight text-white">
              Odds<span className="bg-gradient-to-r from-brand-200 to-accent-300 bg-clip-text text-transparent">Pulse</span>
            </span>
            <span className="rounded bg-brand-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-brand-300 border border-brand-400/30">
              PRO
            </span>
          </div>

          <div className="mx-1 hidden h-4 w-px bg-slate-800 sm:block" />

          {/* Live Scraper Status Telemetry Pill */}
          <div
            className={`hidden items-center gap-2 rounded-full border px-3 py-1 text-xs sm:flex ${
              isOffline
                ? 'border-rose-500/45 bg-rose-500/10'
                : 'border-slate-800/90 bg-slate-900/70'
            }`}
          >
            <span className="relative flex h-2 w-2">
              {snapshot.stats.isRunning ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-80" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-400" />
                </>
              ) : isOffline ? (
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
              ) : activeSources > 0 ? (
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
              ) : (
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
              )}
            </span>
            <span className="text-slate-300">
              {snapshot.stats.isRunning ? (
                <span className="text-brand-300 font-medium">Scraping Live in corso...</span>
              ) : isOffline ? (
                <span className="font-semibold text-rose-300">
                  Offline • Problemi di connessione
                </span>
              ) : (
                <>
                  <span className="font-mono font-semibold text-emerald-300">
                    {activeSources}/{enabledSources}
                  </span>{' '}
                  <span className="text-slate-400">fonti attive</span>
                </>
              )}
            </span>
            {snapshot.stats.totalMatchesCount > 0 && (
              <>
                <span className="text-slate-700">•</span>
                <span className="font-mono text-slate-300">
                  <span className="text-white font-semibold">
                    {snapshot.stats.totalMatchesCount.toLocaleString('it-IT')}
                  </span>{' '}
                  <span className="text-slate-400">quote</span>
                </span>
              </>
            )}
            {snapshot.stats.surebetsCount > 0 && (
              <span className="surebet-badge ml-1 flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold text-brand-200">
                <Activity className="h-2.5 w-2.5" />
                {snapshot.stats.surebetsCount} SUREBET
              </span>
            )}
          </div>
        </div>

        {/* Right: Quick Controls + Window Controls */}
        <div className="app-no-drag flex items-center gap-2">
          {/* Countdown + Scrape Now button */}
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            onClick={onRunScrape}
            disabled={snapshot.stats.isRunning}
            className="flex items-center gap-2 rounded-lg border border-brand-400/30 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-200 transition hover:border-brand-400/60 hover:bg-brand-500/20 disabled:opacity-60"
            title="Avvia subito nuovo ciclo di scraping live"
          >
            {refreshIntervalSec > 0 && !snapshot.stats.isRunning ? (
              <svg className="h-4 w-4 -rotate-90" viewBox="0 0 20 20">
                <circle
                  cx="10"
                  cy="10"
                  r={radius}
                  fill="none"
                  stroke="rgba(148,163,184,0.2)"
                  strokeWidth="2"
                />
                <circle
                  cx="10"
                  cy="10"
                  r={radius}
                  fill="none"
                  stroke={themeMeta.primaryHex}
                  strokeWidth="2"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  className="transition-all duration-700"
                />
              </svg>
            ) : (
              <RefreshCw
                className={`h-3.5 w-3.5 text-brand-300 ${
                  snapshot.stats.isRunning ? 'animate-spin' : ''
                }`}
              />
            )}
            <span>
              {snapshot.stats.isRunning
                ? 'Scansione...'
                : refreshIntervalSec > 0
                ? `Aggiorna (${secondsLeft}s)`
                : 'Aggiorna Quote'}
            </span>
          </motion.button>

          {/* Sound toggle */}
          <button
            onClick={onToggleSound}
            className={`flex h-7 w-7 items-center justify-center rounded-lg border transition ${
              soundEnabled
                ? 'border-slate-700/80 bg-slate-800/60 text-brand-300 hover:border-brand-400/40'
                : 'border-slate-800 bg-slate-900/60 text-slate-500 hover:text-slate-300'
            }`}
            title={soundEnabled ? 'Avvisi sonori Surebet attivi' : 'Avvisi sonori disattivati'}
          >
            {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>

          <div className="mx-1 h-4 w-px bg-slate-800" />

          {/* Native Electron Window Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => void window.oddspulse?.minimize()}
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-800 hover:text-white"
              title="Riduci a icona"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() =>
                void window.oddspulse?.maximize().then((m) => setIsMaximized(m))
              }
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-800 hover:text-white"
              title={isMaximized ? 'Ripristina' : 'Ingrandisci'}
            >
              {isMaximized ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              onClick={() => void window.oddspulse?.close()}
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-500/80 hover:text-white"
              title="Chiudi"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
});

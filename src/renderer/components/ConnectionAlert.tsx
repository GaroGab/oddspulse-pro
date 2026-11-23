import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Radar, RefreshCw, WifiOff, X } from 'lucide-react';
import type { ScrapeSnapshot } from '../../shared/types';

interface ConnectionAlertProps {
  snapshot: ScrapeSnapshot;
  isBrowserOnline: boolean;
  variant: 'banner' | 'empty';
  onRetry: () => void;
  onOpenScrapers: () => void;
  onDismiss?: () => void;
}

export const ConnectionAlert: React.FC<ConnectionAlertProps> = ({
  snapshot,
  isBrowserOnline,
  variant,
  onRetry,
  onOpenScrapers,
  onDismiss,
}) => {
  const conn = snapshot.connection;
  const isOffline = !isBrowserOnline || conn.health === 'offline';
  const failedSources = snapshot.sources.filter((s) => s.enabled && s.state === 'error');

  const headline = !isBrowserOnline || !conn.isSystemOnline
    ? 'Connessione internet assente'
    : conn.exchangesOnlineCount === 0 && conn.failedSourcesCount > 0
    ? 'Nessun Betting Exchange raggiungibile'
    : isOffline
    ? 'Problemi di connessione ai siti di scommesse'
    : `Connessione parziale (${conn.failedSourcesCount}/${conn.enabledSourcesCount} fonti in errore)`;

  const description = !isBrowserOnline || !conn.isSystemOnline
    ? 'Il computer risulta offline. Verifica Wi-Fi, cavo Ethernet, VPN o proxy e riprova per scaricare le quote live.'
    : conn.lastErrorSummary ||
      'Impossibile scaricare le quote dai bookmaker o dagli exchange. Potrebbe trattarsi di un problema di rete temporaneo, blocco DNS o firewall.';

  if (variant === 'banner') {
    return (
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.2 }}
        role="alert"
        className={`mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 backdrop-blur-xl ${
          isOffline
            ? 'border-rose-500/45 bg-rose-500/12 shadow-[0_8px_28px_-10px_rgba(244,63,94,0.35)]'
            : 'border-amber-400/40 bg-amber-500/10'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
              isOffline
                ? 'border-rose-400/45 bg-rose-500/20 text-rose-300'
                : 'border-amber-400/40 bg-amber-500/20 text-amber-300'
            }`}
          >
            {isOffline ? (
              <WifiOff className="h-4 w-4 animate-pulse" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-xs font-bold ${
                  isOffline ? 'text-rose-200' : 'text-amber-200'
                }`}
              >
                {headline}
              </span>
              {conn.failedSourcesCount > 0 && (
                <span className="rounded-md bg-black/30 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-300">
                  {conn.failedSourcesCount}/{conn.enabledSourcesCount} fonti offline
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-slate-300/90">{description}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onRetry}
            disabled={snapshot.stats.isRunning}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition disabled:opacity-50 ${
              isOffline
                ? 'border-rose-400/50 bg-rose-500/25 text-rose-100 hover:bg-rose-500/35'
                : 'border-amber-400/45 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'
            }`}
          >
            <RefreshCw className={`h-3 w-3 ${snapshot.stats.isRunning ? 'animate-spin' : ''}`} />
            Riprova
          </button>
          <button
            onClick={onOpenScrapers}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/75 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:border-brand-400/50 hover:text-white"
          >
            <Radar className="h-3 w-3 text-brand-300" />
            Diagnostica
          </button>
          {onDismiss && !isOffline && (
            <button
              onClick={onDismiss}
              aria-label="Chiudi avviso"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </motion.div>
    );
  }

  // Full centered empty-state alert card
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center p-8 text-center"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-lg rounded-2xl border border-rose-500/35 bg-gradient-to-b from-rose-500/[0.10] via-slate-950/85 to-slate-950/95 p-6 shadow-[0_20px_55px_-16px_rgba(244,63,94,0.3)]"
      >
        <div className="mx-auto mb-4 relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500/25" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-400/45 bg-rose-500/20 text-rose-300">
            <WifiOff className="h-7 w-7" />
          </div>
        </div>

        <h3 className="font-display text-base font-bold text-white">{headline}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{description}</p>

        {failedSources.length > 0 && (
          <div className="mt-4 rounded-xl border border-slate-800/90 bg-black/35 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Fonti non raggiungibili ({failedSources.length}/{conn.enabledSourcesCount})
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {failedSources.slice(0, 8).map((s) => (
                <span
                  key={s.id}
                  title={s.lastError ?? undefined}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-200"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                  {s.shortName}
                </span>
              ))}
              {failedSources.length > 8 && (
                <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                  +{failedSources.length - 8} altre
                </span>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            onClick={onRetry}
            disabled={snapshot.stats.isRunning}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-4 py-2 text-xs font-bold text-slate-950 shadow-glow transition hover:brightness-110 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${snapshot.stats.isRunning ? 'animate-spin' : ''}`} />
            {snapshot.stats.isRunning ? 'Tentativo in corso...' : 'Riprova Connessione'}
          </motion.button>

          <button
            onClick={onOpenScrapers}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700/90 bg-slate-900/80 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-brand-400/50 hover:text-white"
          >
            <Radar className="h-3.5 w-3.5 text-brand-300" />
            Apri Motore Scraping
          </button>
        </div>
      </motion.div>
    </div>
  );
};

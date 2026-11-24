import React from 'react';
import { Pause, Play, RefreshCw } from 'lucide-react';

interface AutoScrapePausedStateProps {
  description?: string;
  onRetryScrape: () => void;
  onRestartAutoScrape?: () => void;
  'data-testid'?: string;
}

/**
 * Shared empty state shown when no live quotes are loaded and automatic scraping is stopped.
 */
export const AutoScrapePausedState: React.FC<AutoScrapePausedStateProps> = ({
  description = "Lo scraping automatico è attualmente in pausa. Riavvia l'aggiornamento automatico oppure avvia una scansione manuale per scaricare le quote live.",
  onRetryScrape,
  onRestartAutoScrape,
  'data-testid': testId,
}) => (
  <div
    data-testid={testId}
    className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center"
  >
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/40 bg-amber-500/15 text-amber-300">
      <Pause className="h-6 w-6" />
    </div>
    <div className="text-sm font-bold text-white">
      Aggiornamento automatico dello scraping fermo
    </div>
    <p className="max-w-md text-xs text-slate-400">{description}</p>
    <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
      {onRestartAutoScrape && (
        <button
          type="button"
          onClick={onRestartAutoScrape}
          className="flex items-center gap-1.5 rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-4 py-2 text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/30"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
          Riavvia Auto-Scraping
        </button>
      )}
      <button
        type="button"
        onClick={onRetryScrape}
        className="flex items-center gap-1.5 rounded-xl border border-brand-400/40 bg-brand-500/15 px-4 py-2 text-xs font-bold text-brand-200 transition hover:bg-brand-500/25"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Scansiona Ora
      </button>
    </div>
  </div>
);

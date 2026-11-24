import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, BellRing, Calculator, Check, EyeOff, VolumeX, X } from 'lucide-react';
import type { RatingWatchTriggerEvent } from '../../shared/types';
import { betModeLabelIt } from '../../shared/ratingWatch';
import { formatEuro, formatOdds } from '../utils/format';
import { BookmakerIcon } from './BookmakerIcon';

interface RatingAlertBannerProps {
  alerts: RatingWatchTriggerEvent[];
  isAlarmRinging: boolean;
  onSilence: () => void;
  onDismiss: (alertId: string) => void;
  onDismissAll: () => void;
  onOpenCalculator: (alert: RatingWatchTriggerEvent) => void;
  onIgnoreEvent: (alert: RatingWatchTriggerEvent) => void;
}

/**
 * High-priority persistent floating banner displayed bottom-right whenever a
 * monitored Rating Watch reaches its target rating threshold.
 */
export const RatingAlertBanner: React.FC<RatingAlertBannerProps> = ({
  alerts,
  isAlarmRinging,
  onSilence,
  onDismiss,
  onDismissAll,
  onOpenCalculator,
  onIgnoreEvent,
}) => {
  if (alerts.length === 0) return null;

  return (
    <div
      data-testid="rating-alert-banner-stack"
      className="fixed bottom-4 right-4 z-[90] flex w-[410px] max-w-[calc(100vw-2rem)] flex-col gap-2.5"
    >
      <AnimatePresence>
        {alerts.slice(-3).map((ev) => (
          <motion.div
            key={ev.id}
            data-testid={`rating-alert-card-${ev.watchId}`}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="overflow-hidden rounded-2xl border border-brand-400/70 bg-[var(--bg-modal-solid)] shadow-[0_20px_60px_rgba(0,0,0,0.92),0_0_32px_-8px_rgb(var(--brand-400)/0.45)]"
          >
            <div className="aurora-bar h-[3px] w-full" />

            <div className="p-3.5">
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-300/60 bg-brand-400/20 text-brand-200">
                    <BellRing className={`h-4.5 w-4.5 ${isAlarmRinging ? 'animate-bounce' : ''}`} />
                    {isAlarmRinging && (
                      <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-[var(--bg-modal-solid)]" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-brand-300">
                        Target Rating Raggiunto!
                      </span>
                      <span className="rounded-md border border-brand-400/40 bg-brand-500/20 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-brand-200">
                        {betModeLabelIt(ev.mode)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="font-mono text-xl font-extrabold text-emerald-300">
                        {ev.match.rating.toFixed(2)}%
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        (target &ge; {ev.targetRating.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onDismiss(ev.id)}
                  aria-label="Chiudi avviso"
                  className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Match + Odds summary */}
              <div className="mt-2.5 rounded-xl border border-slate-800/90 bg-slate-950/80 p-2.5">
                <div className="truncate text-xs font-bold text-white">{ev.match.eventName}</div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="truncate">
                    {ev.match.marketLabel} &middot;{' '}
                    <strong className="text-brand-200">{ev.match.selectionLabel}</strong>
                  </span>
                  <span className="shrink-0 font-mono text-slate-400">
                    Liq {formatEuro(ev.match.liquidity)}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2 text-xs">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <BookmakerIcon sourceId={ev.match.bookmakerId} size={20} className="rounded-[5px]" />
                    <span className="truncate font-medium text-slate-200">
                      {ev.match.bookmakerName}
                    </span>
                    <span className="rounded bg-blue-500/20 px-1.5 py-0.5 font-mono text-[11px] font-bold text-blue-200">
                      {formatOdds(ev.match.backOdds)}
                    </span>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <div className="flex min-w-0 items-center gap-1.5">
                    <BookmakerIcon sourceId={ev.match.exchangeId} size={20} className="rounded-[5px]" />
                    <span className="truncate font-medium text-slate-200">
                      {ev.match.exchangeName}
                    </span>
                    <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[11px] font-bold text-rose-200">
                      {formatOdds(ev.match.layOdds)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="rating-alert-open-calc"
                  onClick={() => onOpenCalculator(ev)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-3 py-2 text-xs font-extrabold text-slate-950 shadow-glow transition hover:brightness-110"
                >
                  <Calculator className="h-3.5 w-3.5" />
                  Apri Calcolatore
                </button>

                {isAlarmRinging && (
                  <button
                    type="button"
                    data-testid="rating-alert-silence"
                    onClick={onSilence}
                    className="flex items-center gap-1.5 rounded-xl border border-rose-400/50 bg-rose-500/20 px-3 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-500/30"
                  >
                    <VolumeX className="h-3.5 w-3.5" />
                    Silenzia
                  </button>
                )}

                <button
                  type="button"
                  data-testid="rating-alert-dismiss"
                  onClick={() => (alerts.length > 1 ? onDismissAll() : onDismiss(ev.id))}
                  className="flex items-center gap-1 rounded-xl border border-slate-700/80 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white"
                >
                  <Check className="h-3.5 w-3.5" />
                  OK
                </button>
              </div>

              <button
                type="button"
                data-testid="rating-alert-ignore-event"
                onClick={() => onIgnoreEvent(ev)}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-1.5 text-[11px] font-semibold text-amber-200 transition hover:border-amber-400/60 hover:bg-amber-500/20 hover:text-amber-100"
                title="Quote cambiate? Escludi questo evento e continua la ricerca del rating su altri match"
              >
                <EyeOff className="h-3.5 w-3.5 shrink-0" />
                Ignora evento e continua ricerca
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

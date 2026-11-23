import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, AlertTriangle, Check, ChevronDown, Globe, X } from 'lucide-react';
import { formatFriendlyNetworkError } from '../../shared/networkHealth';
import {
  SOURCE_CATALOG,
  type ScrapeSnapshot,
  type SourceStatus,
} from '../../shared/types';
import { BookmakerIcon } from './BookmakerIcon';
import { getDropdownMotionProps, useDropdownPortal } from './CustomSelect';

export interface SourceOption {
  id: string;
  name: string;
  disabled?: boolean;
  disabledReason?: string;
}

export function formatSourceErrorReason(src: SourceStatus): string {
  const raw = src.lastError?.trim() || '';
  if (!raw) {
    return 'Errore nel recupero delle quote dal sito. Controlla Motore Scraping o riprova più tardi.';
  }
  const friendly = formatFriendlyNetworkError(raw);
  if (friendly.toLowerCase() === raw.toLowerCase() || friendly.includes(raw)) {
    return `Impossibile recuperare le quote: ${friendly}.`;
  }
  return `Impossibile recuperare le quote: ${friendly} (${raw}).`;
}

/**
 * Build bookmaker filter options combining live source status (marking errored
 * sites as disabled with an explanatory tooltip) and any seen snapshot quotes.
 */
export function buildBookmakerSourceOptions(
  snapshot: Pick<ScrapeSnapshot, 'sources' | 'rows' | 'backMarketGroups' | 'dutcherRows'>
): SourceOption[] {
  const map = new Map<string, SourceOption>();
  for (const s of snapshot.sources) {
    if (s.kind !== 'bookmaker' || !s.enabled) continue;
    const isErr = s.state === 'error';
    map.set(s.id, {
      id: s.id,
      name: s.name,
      disabled: isErr,
      disabledReason: isErr ? formatSourceErrorReason(s) : undefined,
    });
  }
  for (const r of snapshot.rows) {
    if (!map.has(r.bookmakerId)) {
      map.set(r.bookmakerId, { id: r.bookmakerId, name: r.bookmakerName });
    }
  }
  for (const g of snapshot.backMarketGroups ?? []) {
    for (const q of g.quotes) {
      if (!map.has(q.bookmakerId)) {
        map.set(q.bookmakerId, { id: q.bookmakerId, name: q.bookmakerName });
      }
    }
  }
  for (const dr of snapshot.dutcherRows ?? []) {
    for (const leg of dr.legs) {
      if (!map.has(leg.bookmakerId)) {
        map.set(leg.bookmakerId, { id: leg.bookmakerId, name: leg.bookmakerName });
      }
    }
  }
  if (map.size === 0) {
    for (const s of SOURCE_CATALOG.filter((x) => x.kind === 'bookmaker' && x.enabled)) {
      map.set(s.id, { id: s.id, name: s.name });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => Number(Boolean(a.disabled)) - Number(Boolean(b.disabled))
  );
}

/**
 * Build exchange filter options from snapshot sources, marking errored ones disabled.
 */
export function buildExchangeSourceOptions(
  snapshot: Pick<ScrapeSnapshot, 'sources'>
): SourceOption[] {
  const exchangeSrcs = snapshot.sources.filter((x) => x.kind === 'exchange');
  if (exchangeSrcs.length === 0) {
    return SOURCE_CATALOG.filter((x) => x.kind === 'exchange').map((x) => ({
      id: x.id,
      name: x.name,
    }));
  }
  return exchangeSrcs
    .map((s) => {
      const isErr = s.enabled && s.state === 'error';
      return {
        id: s.id,
        name: s.name,
        disabled: isErr,
        disabledReason: isErr ? formatSourceErrorReason(s) : undefined,
      };
    })
    .sort((a, b) => Number(Boolean(a.disabled)) - Number(Boolean(b.disabled)));
}

interface HoveredDisabledTooltip {
  name: string;
  reason: string;
  rect: DOMRect;
}

const DisabledSourceTooltipPortal: React.FC<{ hovered: HoveredDisabledTooltip | null }> = ({
  hovered,
}) => {
  if (!hovered || typeof document === 'undefined') return null;
  const tooltipW = 256;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fitsRight = hovered.rect.right + 10 + tooltipW <= vw - 12;
  const left = fitsRight
    ? Math.round(hovered.rect.right + 10)
    : Math.max(12, Math.round(hovered.rect.left - tooltipW - 10));
  const rawTop = hovered.rect.top + hovered.rect.height / 2 - 34;
  const top = Math.max(12, Math.min(vh - 96, Math.round(rawTop)));

  return createPortal(
    <div
      role="tooltip"
      data-testid="source-disabled-tooltip"
      style={{ position: 'fixed', left, top, width: tooltipW }}
      className="pointer-events-none z-[1050] rounded-xl border border-rose-500/45 bg-[var(--bg-modal-solid)] p-2.5 shadow-[0_14px_38px_rgba(0,0,0,0.92)]"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-rose-200">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
        <span className="truncate">{hovered.name} non disponibile</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-300">{hovered.reason}</p>
    </div>,
    document.body
  );
};

interface SourceSelectProps {
  value: string;
  options: SourceOption[];
  allLabel: string;
  disabled?: boolean;
  minMenuWidth?: number;
  onChange: (value: string) => void;
  'data-testid'?: string;
}

/**
 * Portal-backed single-select dropdown with crisp Bookmaker/Exchange icons
 * both in the trigger and every dropdown row.
 */
export const SourceSelect: React.FC<SourceSelectProps> = ({
  value,
  options,
  allLabel,
  disabled = false,
  minMenuWidth = 210,
  onChange,
  'data-testid': dataTestId,
}) => {
  const { open, setOpen, coords, triggerRef, menuRef } = useDropdownPortal(minMenuWidth);
  const selected = options.find((o) => o.id === value);
  const [hoveredDisabled, setHoveredDisabled] = useState<HoveredDisabledTooltip | null>(null);

  useEffect(() => {
    if (!open) setHoveredDisabled(null);
  }, [open]);

  return (
    <div ref={triggerRef} className="relative mt-1">
      <button
        type="button"
        disabled={disabled}
        data-testid={dataTestId}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${
          open
            ? 'border-brand-400 bg-slate-950 text-white shadow-[0_0_16px_-6px_rgb(var(--brand-400)/0.45)]'
            : selected
            ? 'border-brand-400/50 bg-brand-500/10 text-brand-100'
            : 'border-slate-800 bg-slate-950 text-slate-200 hover:border-slate-700'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <>
              <BookmakerIcon sourceId={selected.id} size={18} />
              <span className="truncate font-medium text-white">{selected.name}</span>
            </>
          ) : (
            <>
              <Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate text-slate-200">{allLabel}</span>
            </>
          )}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-150 ${
            open ? 'rotate-180 text-brand-300' : ''
          }`}
        />
      </button>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <motion.div
                key="source-select-menu"
                ref={menuRef}
                data-testid={dataTestId ? `${dataTestId}-menu` : undefined}
                {...getDropdownMotionProps(coords.openUpward)}
                style={{
                  position: 'fixed',
                  left: coords.left,
                  width: coords.width,
                  top: coords.top,
                  bottom: coords.bottom,
                  maxHeight: coords.maxHeight,
                  transformOrigin: coords.openUpward ? 'bottom center' : 'top center',
                }}
                className="z-[999] overflow-y-auto rounded-xl border border-brand-400/35 bg-[var(--bg-modal-solid)] p-1 shadow-[0_18px_48px_rgba(0,0,0,0.9),0_0_24px_-10px_rgb(var(--brand-400)/0.28)]"
              >
                {/* "All" option */}
                <button
                  type="button"
                  onClick={() => {
                    onChange('ALL');
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                    value === 'ALL'
                      ? 'bg-brand-500/20 font-semibold text-brand-200'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{allLabel}</span>
                  </span>
                  {value === 'ALL' && <Check className="h-3.5 w-3.5 shrink-0 text-brand-300" />}
                </button>

                <div className="my-1 h-px bg-slate-800/80" />

                {options.map((opt) => {
                  const isSelected = value === opt.id && !opt.disabled;
                  const isOptDisabled = Boolean(opt.disabled);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-disabled={isOptDisabled || undefined}
                      data-disabled={isOptDisabled ? 'true' : undefined}
                      data-testid={dataTestId ? `${dataTestId}-opt-${opt.id}` : undefined}
                      onClick={() => {
                        if (isOptDisabled) return;
                        onChange(opt.id);
                        setOpen(false);
                      }}
                      onMouseEnter={(e) => {
                        if (!isOptDisabled) return;
                        setHoveredDisabled({
                          name: opt.name,
                          reason: opt.disabledReason || 'Errore nel recupero delle quote',
                          rect: e.currentTarget.getBoundingClientRect(),
                        });
                      }}
                      onMouseLeave={() => {
                        if (isOptDisabled) setHoveredDisabled(null);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                        isOptDisabled
                          ? 'cursor-not-allowed bg-rose-950/15 text-slate-500 opacity-55 hover:bg-rose-950/25'
                          : isSelected
                          ? 'bg-brand-500/20 font-semibold text-brand-200'
                          : 'text-slate-200 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <BookmakerIcon
                          sourceId={opt.id}
                          size={22}
                          className={`rounded-[5px] ${isOptDisabled ? 'grayscale opacity-75' : ''}`}
                        />
                        <span className="truncate">{opt.name}</span>
                      </span>
                      {isOptDisabled ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded border border-rose-500/35 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-rose-300">
                          <AlertCircle className="h-2.5 w-2.5" />
                          ERRORE
                        </span>
                      ) : (
                        isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-brand-300" />
                      )}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
      {open && <DisabledSourceTooltipPortal hovered={hoveredDisabled} />}
    </div>
  );
};

interface SourceMultiSelectProps {
  values: string[]; // [] means ALL selected
  options: SourceOption[];
  allLabel: string;
  disabled?: boolean;
  minMenuWidth?: number;
  onChange: (values: string[]) => void;
  'data-testid'?: string;
}

/**
 * Multi-select source dropdown (Bookmaker / Exchange) with stacked icons in trigger,
 * checkboxes, quick "Tutti" / "Azzera" / "Fatto" actions, and animated portal positioning.
 */
export const SourceMultiSelect: React.FC<SourceMultiSelectProps> = ({
  values,
  options,
  allLabel,
  disabled = false,
  minMenuWidth = 228,
  onChange,
  'data-testid': dataTestId,
}) => {
  const { open, setOpen, coords, triggerRef, menuRef } = useDropdownPortal(minMenuWidth, 310);
  const [hoveredDisabled, setHoveredDisabled] = useState<HoveredDisabledTooltip | null>(null);

  useEffect(() => {
    if (!open) setHoveredDisabled(null);
  }, [open]);

  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedOptions = useMemo(
    () => options.filter((o) => selectedSet.has(o.id)),
    [options, selectedSet]
  );

  // Also handle cases where a locked ID isn't currently in filtered options list
  const effectiveSelected = useMemo(() => {
    if (selectedOptions.length > 0 || values.length === 0) return selectedOptions;
    return values.map((id) => ({ id, name: id }));
  }, [selectedOptions, values]);

  const toggleId = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(values.filter((v) => v !== id));
    } else {
      onChange([...values, id]);
    }
  };

  return (
    <div ref={triggerRef} className="relative mt-1">
      <div
        className={`flex w-full items-center justify-between gap-1 rounded-lg border text-left text-xs transition ${
          disabled ? 'opacity-60' : ''
        } ${
          open
            ? 'border-brand-400 bg-slate-950 text-white shadow-[0_0_16px_-6px_rgb(var(--brand-400)/0.45)]'
            : effectiveSelected.length > 0
            ? 'border-brand-400/60 bg-brand-500/10 text-brand-100'
            : 'border-slate-800 bg-slate-950 text-slate-200 hover:border-slate-700'
        }`}
      >
        <button
          type="button"
          disabled={disabled}
          data-testid={dataTestId}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left focus:outline-none disabled:cursor-not-allowed"
        >
          {effectiveSelected.length === 0 ? (
            <>
              <Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate text-slate-200">{allLabel}</span>
            </>
          ) : effectiveSelected.length === 1 ? (
            <>
              <BookmakerIcon sourceId={effectiveSelected[0].id} size={18} />
              <span className="truncate font-semibold text-white">
                {effectiveSelected[0].name}
              </span>
            </>
          ) : (
            <>
              <span className="flex shrink-0 items-center -space-x-1.5">
                {effectiveSelected.slice(0, 3).map((s) => (
                  <span
                    key={s.id}
                    className="rounded-md ring-1 ring-slate-950"
                  >
                    <BookmakerIcon sourceId={s.id} size={18} />
                  </span>
                ))}
              </span>
              <span className="truncate font-semibold text-white">
                <span className="font-mono text-brand-300">{effectiveSelected.length}</span>{' '}
                selez.
              </span>
            </>
          )}
        </button>

        <div className="flex shrink-0 items-center gap-1 pr-2">
          {effectiveSelected.length > 0 && !disabled && (
            <button
              type="button"
              data-testid={dataTestId ? `${dataTestId}-clear` : undefined}
              aria-label="Azzera selezione"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-slate-400 transition hover:bg-rose-500/30 hover:text-rose-200"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            aria-label="Apri menu selezione"
            onClick={() => setOpen((v) => !v)}
            className="text-slate-400 focus:outline-none"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-150 ${
                open ? 'rotate-180 text-brand-300' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <motion.div
                key="source-multi-select-menu"
                ref={menuRef}
                data-testid={dataTestId ? `${dataTestId}-menu` : undefined}
                {...getDropdownMotionProps(coords.openUpward)}
                style={{
                  position: 'fixed',
                  left: coords.left,
                  width: coords.width,
                  top: coords.top,
                  bottom: coords.bottom,
                  maxHeight: coords.maxHeight,
                  transformOrigin: coords.openUpward ? 'bottom center' : 'top center',
                }}
                className="z-[999] flex flex-col overflow-hidden rounded-xl border border-brand-400/35 bg-[var(--bg-modal-solid)] shadow-[0_18px_48px_rgba(0,0,0,0.9),0_0_24px_-10px_rgb(var(--brand-400)/0.28)]"
              >
                {/* Header row: "Tutti" + Quick reset */}
                <div className="flex items-center justify-between gap-1 border-b border-slate-800/80 p-1">
                  <button
                    type="button"
                    data-testid={dataTestId ? `${dataTestId}-all` : undefined}
                    onClick={() => {
                      onChange([]);
                      setOpen(false);
                    }}
                    className={`flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                      values.length === 0
                        ? 'bg-brand-500/20 font-semibold text-brand-200'
                        : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                  >
                    <Globe className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{allLabel}</span>
                    {values.length === 0 && (
                      <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-brand-300" />
                    )}
                  </button>

                  {values.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onChange([])}
                      className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/15"
                    >
                      Azzera ({values.length})
                    </button>
                  )}
                </div>

                {/* Checkbox Options List */}
                <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
                  {options.map((opt) => {
                    const isSelected = selectedSet.has(opt.id) && !opt.disabled;
                    const isOptDisabled = Boolean(opt.disabled);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-disabled={isOptDisabled || undefined}
                        data-disabled={isOptDisabled ? 'true' : undefined}
                        data-testid={dataTestId ? `${dataTestId}-opt-${opt.id}` : undefined}
                        onClick={() => {
                          if (isOptDisabled) return;
                          toggleId(opt.id);
                        }}
                        onMouseEnter={(e) => {
                          if (!isOptDisabled) return;
                          setHoveredDisabled({
                            name: opt.name,
                            reason: opt.disabledReason || 'Errore nel recupero delle quote',
                            rect: e.currentTarget.getBoundingClientRect(),
                          });
                        }}
                        onMouseLeave={() => {
                          if (isOptDisabled) setHoveredDisabled(null);
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                          isOptDisabled
                            ? 'cursor-not-allowed bg-rose-950/15 text-slate-500 opacity-55 hover:bg-rose-950/25'
                            : isSelected
                            ? 'bg-brand-500/15 font-semibold text-brand-100'
                            : 'text-slate-200 hover:bg-slate-800/80 hover:text-white'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                              isOptDisabled
                                ? 'border-rose-500/40 bg-rose-950/60 text-rose-400'
                                : isSelected
                                ? 'border-brand-300 bg-brand-400 text-slate-950'
                                : 'border-slate-700 bg-slate-900/90 text-transparent'
                            }`}
                          >
                            {isOptDisabled ? (
                              <AlertCircle className="h-3 w-3" />
                            ) : (
                              <Check className="h-3 w-3 stroke-[3]" />
                            )}
                          </span>
                          <BookmakerIcon
                            sourceId={opt.id}
                            size={22}
                            className={`rounded-[5px] ${isOptDisabled ? 'grayscale opacity-75' : ''}`}
                          />
                          <span className="truncate">{opt.name}</span>
                        </span>
                        {isOptDisabled && (
                          <span className="shrink-0 rounded border border-rose-500/35 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-rose-300">
                            ERRORE
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Compact Footer when selections are active */}
                {values.length > 0 && (
                  <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-950/60 px-2.5 py-1.5">
                    <span className="font-mono text-[10px] text-slate-400">
                      <strong className="text-brand-300">{values.length}</strong>{' '}
                      {values.length === 1 ? 'selezionato' : 'selezionati'}
                    </span>
                    <button
                      type="button"
                      data-testid={dataTestId ? `${dataTestId}-done` : undefined}
                      onClick={() => setOpen(false)}
                      className="rounded-md bg-gradient-to-r from-brand-300 to-accent-400 px-2.5 py-0.5 text-[10px] font-bold text-slate-950 hover:brightness-110"
                    >
                      Fatto
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
      {open && <DisabledSourceTooltipPortal hovered={hoveredDisabled} />}
    </div>
  );
};

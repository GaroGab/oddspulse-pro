import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, RotateCcw, Sparkles } from 'lucide-react';
import { getDropdownMotionProps, useDropdownPortal } from './CustomSelect';

export type QuickPresetTone = 'brand' | 'accent' | 'emerald' | 'amber' | 'sky';

export interface QuickPresetItem {
  id: string;
  label: string;
  description: string;
  active?: boolean;
  tone?: QuickPresetTone;
  icon?: React.ReactNode;
  onSelect: () => void;
}

interface QuickPresetsMenuProps {
  items: QuickPresetItem[];
  activeCount?: number;
  onReset?: () => void;
  resetLabel?: string;
  buttonLabel?: string;
  'data-testid'?: string;
  menuTestId?: string;
  className?: string;
}

const TONE_BADGE_CLASS: Record<QuickPresetTone, string> = {
  brand: 'border-brand-400/35 bg-brand-500/15 text-brand-200',
  accent: 'border-accent-400/35 bg-accent-500/15 text-accent-200',
  emerald: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200',
  amber: 'border-amber-400/35 bg-amber-500/15 text-amber-200',
  sky: 'border-sky-400/35 bg-sky-500/15 text-sky-200',
};

const TONE_ITEM_ACTIVE_CLASS: Record<QuickPresetTone, string> = {
  brand: 'border-brand-400/50 bg-brand-500/15',
  accent: 'border-accent-400/50 bg-accent-500/15',
  emerald: 'border-emerald-400/50 bg-emerald-500/15',
  amber: 'border-amber-400/50 bg-amber-500/15',
  sky: 'border-sky-400/50 bg-sky-500/15',
};

/**
 * Compact trigger button that opens a portal-backed Quick Presets menu on click,
 * keeping filter panels and modals clean and space-efficient.
 */
export const QuickPresetsMenu: React.FC<QuickPresetsMenuProps> = ({
  items,
  activeCount = 0,
  onReset,
  resetLabel = 'Ripristina valori predefiniti',
  buttonLabel = 'Preset Rapidi',
  'data-testid': testId,
  menuTestId,
  className = '',
}) => {
  const { open, setOpen, coords, triggerRef, menuRef } = useDropdownPortal(320, 420);

  return (
    <div ref={triggerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
          open || activeCount > 0
            ? 'border-brand-400/55 bg-brand-500/15 text-brand-100 shadow-[0_0_12px_-4px_rgb(var(--brand-400)/0.45)]'
            : 'border-slate-700/80 bg-slate-900/90 text-slate-200 hover:border-brand-400/45 hover:text-brand-200'
        }`}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand-300" />
        <span>{buttonLabel}</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-brand-400/25 px-1.5 py-0.2 font-mono text-[9px] font-bold text-brand-200">
            {activeCount}
          </span>
        )}
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-slate-400 transition-transform duration-150 ${
            open ? 'rotate-180 text-brand-200' : ''
          }`}
        />
      </button>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <motion.div
                ref={menuRef}
                role="menu"
                data-testid={menuTestId ?? (testId ? `${testId}-menu` : undefined)}
                {...getDropdownMotionProps(coords.openUpward)}
                style={{
                  position: 'fixed',
                  left: coords.left,
                  width: coords.width,
                  ...(coords.openUpward
                    ? { bottom: coords.bottom }
                    : { top: coords.top }),
                  zIndex: 140,
                }}
                className="overflow-hidden rounded-xl border border-brand-400/35 bg-[var(--bg-modal-solid)] shadow-[0_18px_48px_rgba(0,0,0,0.92)]"
              >
                <div className="border-b border-slate-800/80 px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-white">
                    <Sparkles className="h-3.5 w-3.5 text-brand-300" />
                    <span>Preset Rapidi Matched Betting</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Seleziona un profilo per impostare subito i filtri consigliati
                  </p>
                </div>

                <div
                  style={{ maxHeight: coords.maxHeight - 84 }}
                  className="space-y-1 overflow-y-auto p-1.5"
                >
                  {items.map((item) => {
                    const tone = item.tone ?? 'brand';
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        data-testid={`preset-option-${item.id}`}
                        onClick={() => {
                          item.onSelect();
                          setOpen(false);
                        }}
                        className={`flex w-full items-start justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                          item.active
                            ? TONE_ITEM_ACTIVE_CLASS[tone]
                            : 'border-transparent hover:border-slate-700/80 hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {item.icon && (
                              <span
                                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${TONE_BADGE_CLASS[tone]}`}
                              >
                                {item.icon}
                              </span>
                            )}
                            <span className="truncate text-xs font-semibold text-white">
                              {item.label}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            {item.description}
                          </div>
                        </div>

                        {item.active && (
                          <span
                            className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase ${TONE_BADGE_CLASS[tone]}`}
                          >
                            <Check className="h-2.5 w-2.5" />
                            Attivo
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {onReset && (
                  <div className="border-t border-slate-800/80 p-1.5">
                    <button
                      type="button"
                      data-testid="preset-option-reset"
                      onClick={() => {
                        onReset();
                        setOpen(false);
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-200"
                    >
                      <RotateCcw className="h-3 w-3" />
                      {resetLabel}
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
};

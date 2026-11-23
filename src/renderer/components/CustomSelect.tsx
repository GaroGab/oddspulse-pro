import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';

export const DROPDOWN_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function getDropdownMotionProps(openUpward: boolean) {
  return {
    initial: { opacity: 0, y: openUpward ? 6 : -6, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: openUpward ? 4 : -4, scale: 0.97 },
    transition: { duration: 0.16, ease: DROPDOWN_EASE },
  };
}

export interface PortalMenuCoords {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
  openUpward: boolean;
}

/**
 * Shared dropdown portal hook handling smart viewport positioning (auto-flip upward when near bottom),
 * outside click dismissal across trigger + portal menu, and Escape key closing.
 * Preserves last known coords while closing so Framer Motion exit transitions remain anchored.
 */
export function useDropdownPortal(minMenuWidth?: number, maxMenuHeight = 272) {
  const [open, setOpenState] = useState(false);
  const [coords, setCoords] = useState<PortalMenuCoords | null>(null);
  const openRef = useRef(false);
  openRef.current = open;
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const computeCoords = useCallback((): PortalMenuCoords | null => {
    const el = triggerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const width = Math.min(
      Math.max(rect.width, minMenuWidth ?? rect.width),
      window.innerWidth - 24
    );
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - 12 - width);
    }
    left = Math.max(12, left);

    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 56; // leave breathing room below custom titlebar
    const openUpward = spaceBelow < 210 && spaceAbove > spaceBelow;

    if (openUpward) {
      return {
        left: Math.round(left),
        width: Math.round(width),
        bottom: Math.round(window.innerHeight - rect.top + 6),
        maxHeight: Math.min(maxMenuHeight, Math.max(140, Math.floor(spaceAbove))),
        openUpward: true,
      };
    }

    return {
      left: Math.round(left),
      width: Math.round(width),
      top: Math.round(rect.bottom + 6),
      maxHeight: Math.min(maxMenuHeight, Math.max(140, Math.floor(spaceBelow))),
      openUpward: false,
    };
  }, [minMenuWidth, maxMenuHeight]);

  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === 'function' ? next(openRef.current) : next;
      if (resolved && !openRef.current) {
        const fresh = computeCoords();
        if (fresh) setCoords(fresh);
      }
      openRef.current = resolved;
      setOpenState(resolved);
    },
    [computeCoords]
  );

  useLayoutEffect(() => {
    if (!open) return;
    const fresh = computeCoords();
    if (fresh) setCoords(fresh);
  }, [open, computeCoords]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    const handleViewportChange = (e: Event) => {
      if (e.type === 'scroll' && menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      const fresh = computeCoords();
      if (fresh) setCoords(fresh);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, computeCoords, setOpen]);

  return { open, setOpen, coords, triggerRef, menuRef };
}

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  dotColor?: string;
}

interface CustomSelectProps<T extends string | number = string> {
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  minMenuWidth?: number;
  className?: string;
  triggerClassName?: string;
  'data-testid'?: string;
  'aria-label'?: string;
}

/**
 * Modern custom portal-backed dropdown matching SourceSelect's obsidian + gold aesthetic.
 * Replaces native OS `<select>` elements across the entire app for uniform styling.
 */
export function CustomSelect<T extends string | number = string>({
  value,
  options,
  onChange,
  disabled = false,
  size = 'md',
  minMenuWidth,
  className = '',
  triggerClassName = '',
  'data-testid': dataTestId,
  'aria-label': ariaLabel,
}: CustomSelectProps<T>) {
  const { open, setOpen, coords, triggerRef, menuRef } = useDropdownPortal(minMenuWidth);
  const selected = options.find((o) => o.value === value) ?? options[0];

  const padCls = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs';

  return (
    <div ref={triggerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        data-testid={dataTestId}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${padCls} ${
          open
            ? 'border-brand-400 bg-slate-950 text-white shadow-[0_0_16px_-6px_rgb(var(--brand-400)/0.45)]'
            : 'border-slate-800 bg-slate-950 text-slate-200 hover:border-slate-700 hover:text-white'
        } ${triggerClassName}`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {selected?.dotColor && (
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected.dotColor}`} />
          )}
          {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
          <span className="truncate font-medium">{selected?.label ?? ''}</span>
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
                key="custom-select-menu"
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
                {options.map((opt) => {
                  const isSelected = opt.value === value;
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      data-testid={dataTestId ? `${dataTestId}-opt-${String(opt.value)}` : undefined}
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                        isSelected
                          ? 'bg-brand-500/20 font-semibold text-brand-200'
                          : 'text-slate-200 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {opt.dotColor && (
                          <span className={`h-2 w-2 shrink-0 rounded-full ${opt.dotColor}`} />
                        )}
                        {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                        <span className="truncate">{opt.label}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {opt.hint && (
                          <span className="font-mono text-[10px] text-slate-500">{opt.hint}</span>
                        )}
                        {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-brand-300" />}
                      </span>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}

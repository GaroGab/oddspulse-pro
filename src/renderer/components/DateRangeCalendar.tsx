import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  Sparkles,
  X,
} from 'lucide-react';

import {
  addDays,
  EMPTY_DATE_RANGE,
  matchesDateRange,
  parseLocalDateKey,
  toLocalDateKey,
  type DateRangeValue,
} from '../../shared/dateRange';

export { EMPTY_DATE_RANGE, matchesDateRange, toLocalDateKey, type DateRangeValue };

const MONTHS_IT = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
];

const MONTHS_SHORT_IT = [
  'gen',
  'feb',
  'mar',
  'apr',
  'mag',
  'giu',
  'lug',
  'ago',
  'set',
  'ott',
  'nov',
  'dic',
];

const WEEKDAYS_IT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export function formatShortItalianDate(key: string | null): string {
  if (!key) return '—';
  const today = new Date();
  const todayKey = toLocalDateKey(today);
  const tomorrowKey = toLocalDateKey(addDays(today, 1));
  if (key === todayKey) return 'Oggi';
  if (key === tomorrowKey) return 'Domani';
  const d = parseLocalDateKey(key);
  return `${d.getDate()} ${MONTHS_SHORT_IT[d.getMonth()]}`;
}

export function formatFullItalianDate(key: string | null): string {
  if (!key) return 'Seleziona';
  const d = parseLocalDateKey(key);
  return `${d.getDate()} ${MONTHS_SHORT_IT[d.getMonth()]} ${d.getFullYear()}`;
}

function getWeekendRange(today: Date): { start: string; end: string } {
  const dow = today.getDay(); // 0=Sun, 6=Sat
  if (dow === 6) {
    return { start: toLocalDateKey(today), end: toLocalDateKey(addDays(today, 1)) };
  }
  if (dow === 0) {
    return { start: toLocalDateKey(today), end: toLocalDateKey(today) };
  }
  const daysToSat = 6 - dow;
  return {
    start: toLocalDateKey(addDays(today, daysToSat)),
    end: toLocalDateKey(addDays(today, daysToSat + 1)),
  };
}

interface DateRangeCalendarProps {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  eventDateCounts: Record<string, number>;
}

export const DateRangeCalendar: React.FC<DateRangeCalendarProps> = ({
  value,
  onChange,
  eventDateCounts,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => toLocalDateKey(today), [today]);

  const [viewYear, setViewYear] = useState<number>(() =>
    value.startDate ? parseLocalDateKey(value.startDate).getFullYear() : today.getFullYear()
  );
  const [viewMonth, setViewMonth] = useState<number>(() =>
    value.startDate ? parseLocalDateKey(value.startDate).getMonth() : today.getMonth()
  );

  // Draft state for interactive 2-click range selection with live hover preview
  const [draftStart, setDraftStart] = useState<string | null>(value.startDate);
  const [draftEnd, setDraftEnd] = useState<string | null>(value.endDate);
  const [isPickingEnd, setIsPickingEnd] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // Sync draft only when opening popover (never clobbering an in-progress 2-click range selection)
  useEffect(() => {
    if (open) {
      setDraftStart(value.startDate);
      setDraftEnd(value.endDate);
      setIsPickingEnd(false);
      if (value.startDate) {
        const d = parseLocalDateKey(value.startDate);
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset draft if cleared externally (e.g. Reset Filtri button)
  useEffect(() => {
    if (value.mode === 'all') {
      setDraftStart(null);
      setDraftEnd(null);
      setIsPickingEnd(false);
    }
  }, [value.mode]);

  // Close on click outside or Escape
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Build 42-cell Monday-first calendar grid for (viewYear, viewMonth)
  const calendarCells = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // Mon=0 .. Sun=6
    const gridStart = new Date(viewYear, viewMonth, 1 - startOffset);
    const cells: Array<{
      key: string;
      day: number;
      inCurrentMonth: boolean;
      isToday: boolean;
      eventCount: number;
    }> = [];

    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = toLocalDateKey(d);
      cells.push({
        key,
        day: d.getDate(),
        inCurrentMonth: d.getMonth() === viewMonth,
        isToday: key === todayKey,
        eventCount: eventDateCounts[key] ?? 0,
      });
    }
    return cells;
  }, [viewYear, viewMonth, todayKey, eventDateCounts]);

  // Compute effective preview range [rangeStart, rangeEnd] while hovering
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (!draftStart) return { rangeStart: null, rangeEnd: null };
    if (draftEnd) {
      return draftStart <= draftEnd
        ? { rangeStart: draftStart, rangeEnd: draftEnd }
        : { rangeStart: draftEnd, rangeEnd: draftStart };
    }
    if (hoverKey) {
      return draftStart <= hoverKey
        ? { rangeStart: draftStart, rangeEnd: hoverKey }
        : { rangeStart: hoverKey, rangeEnd: draftStart };
    }
    return { rangeStart: draftStart, rangeEnd: draftStart };
  }, [draftStart, draftEnd, hoverKey]);

  // Count how many live quotes fall inside the currently previewed range
  const previewCount = useMemo(() => {
    if (!rangeStart) {
      return Object.values(eventDateCounts).reduce((s, n) => s + n, 0);
    }
    const end = rangeEnd ?? rangeStart;
    let total = 0;
    for (const [k, cnt] of Object.entries(eventDateCounts)) {
      if (k >= rangeStart && k <= end) total += cnt;
    }
    return total;
  }, [rangeStart, rangeEnd, eventDateCounts]);

  const previewDays = useMemo(() => {
    if (!rangeStart) return 0;
    const end = rangeEnd ?? rangeStart;
    const a = parseLocalDateKey(rangeStart).getTime();
    const b = parseLocalDateKey(end).getTime();
    return Math.round(Math.abs(b - a) / 86400_000) + 1;
  }, [rangeStart, rangeEnd]);

  const handleDayClick = (key: string) => {
    if (!isPickingEnd || !draftStart) {
      // 1st click: start fresh selection & immediately preview that day
      setDraftStart(key);
      setDraftEnd(null);
      setIsPickingEnd(true);
      onChange({ mode: 'range', startDate: key, endDate: key });
    } else {
      // 2nd click: complete range (auto-order chronologically)
      const [s, e] = key >= draftStart ? [draftStart, key] : [key, draftStart];
      setDraftStart(s);
      setDraftEnd(e);
      setIsPickingEnd(false);
      onChange({ mode: 'range', startDate: s, endDate: e });
    }
  };

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const jumpToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  // Trigger display text
  const triggerLabel = useMemo(() => {
    if (value.mode === 'all') return 'Tutte le date';
    if (value.mode === 'hours') {
      return value.hours === 6 ? 'Prossime 6 ore' : `Prossime ${value.hours ?? 24}h`;
    }
    if (value.startDate) {
      if (!value.endDate || value.startDate === value.endDate) {
        return formatShortItalianDate(value.startDate);
      }
      return `${formatShortItalianDate(value.startDate)} → ${formatShortItalianDate(value.endDate)}`;
    }
    return 'Tutte le date';
  }, [value]);

  const isFiltered = value.mode !== 'all';

  const weekend = useMemo(() => getWeekendRange(today), [today]);

  const presets: Array<{
    id: string;
    label: string;
    hint?: string;
    active: boolean;
    apply: () => void;
  }> = [
    {
      id: 'all',
      label: 'Tutte le date',
      active: value.mode === 'all',
      apply: () => {
        onChange(EMPTY_DATE_RANGE);
        setOpen(false);
      },
    },
    {
      id: '6h',
      label: 'Prossime 6 ore',
      active: value.mode === 'hours' && value.hours === 6,
      apply: () => {
        onChange({ mode: 'hours', hours: 6, startDate: null, endDate: null });
        setOpen(false);
      },
    },
    {
      id: 'today',
      label: 'Oggi',
      hint: formatShortItalianDate(todayKey) === 'Oggi' ? `${today.getDate()} ${MONTHS_SHORT_IT[today.getMonth()]}` : undefined,
      active: value.mode === 'range' && value.startDate === todayKey && value.endDate === todayKey,
      apply: () => {
        onChange({ mode: 'range', startDate: todayKey, endDate: todayKey });
        setOpen(false);
      },
    },
    {
      id: 'tomorrow',
      label: 'Domani',
      active:
        value.mode === 'range' &&
        value.startDate === toLocalDateKey(addDays(today, 1)) &&
        value.endDate === toLocalDateKey(addDays(today, 1)),
      apply: () => {
        const k = toLocalDateKey(addDays(today, 1));
        onChange({ mode: 'range', startDate: k, endDate: k });
        setOpen(false);
      },
    },
    {
      id: 'weekend',
      label: 'Weekend',
      hint: 'Sab–Dom',
      active:
        value.mode === 'range' &&
        value.startDate === weekend.start &&
        value.endDate === weekend.end,
      apply: () => {
        onChange({ mode: 'range', startDate: weekend.start, endDate: weekend.end });
        setOpen(false);
      },
    },
    {
      id: '3d',
      label: 'Prossimi 3 giorni',
      active:
        value.mode === 'range' &&
        value.startDate === todayKey &&
        value.endDate === toLocalDateKey(addDays(today, 2)),
      apply: () => {
        onChange({
          mode: 'range',
          startDate: todayKey,
          endDate: toLocalDateKey(addDays(today, 2)),
        });
        setOpen(false);
      },
    },
    {
      id: '7d',
      label: 'Prossimi 7 giorni',
      active:
        value.mode === 'range' &&
        value.startDate === todayKey &&
        value.endDate === toLocalDateKey(addDays(today, 6)),
      apply: () => {
        onChange({
          mode: 'range',
          startDate: todayKey,
          endDate: toLocalDateKey(addDays(today, 6)),
        });
        setOpen(false);
      },
    },
  ];

  const hoveredDayEvents = hoverKey ? eventDateCounts[hoverKey] ?? 0 : null;

  return (
    <div ref={rootRef} className="relative mt-1">
      {/* Trigger Pill */}
      <div
        className={`flex w-full items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
          open || isFiltered
            ? 'border-brand-400/70 bg-brand-500/10 text-brand-100 shadow-[0_0_16px_-6px_rgb(var(--brand-400)/0.45)]'
            : 'border-slate-800 bg-slate-950 text-slate-200 hover:border-slate-700'
        }`}
      >
        <button
          type="button"
          data-testid="date-range-trigger"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus:outline-none"
        >
          <CalendarRange
            className={`h-3.5 w-3.5 shrink-0 ${isFiltered || open ? 'text-brand-300' : 'text-slate-400'}`}
          />
          <span className="truncate font-medium">{triggerLabel}</span>
        </button>

        {isFiltered && (
          <button
            type="button"
            data-testid="date-range-clear"
            aria-label="Rimuovi filtro date"
            onClick={(e) => {
              e.stopPropagation();
              onChange(EMPTY_DATE_RANGE);
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-800/90 text-slate-400 transition hover:bg-rose-500/30 hover:text-rose-200"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>

      {/* Cutting-Edge Floating Range Calendar Popover */}
      {open && (
        <div
          data-testid="date-range-popover"
          className="absolute right-0 top-full z-50 mt-2 w-[516px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-brand-400/35 bg-[var(--bg-modal-solid)] shadow-[0_24px_72px_rgba(0,0,0,0.9),0_0_38px_-14px_rgb(var(--brand-400)/0.32)]"
        >
          {/* Luminous Aurora Hairline */}
          <div className="aurora-bar h-[2px] w-full" />

          {/* Top Interactive Range Display Header */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-950/60 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <div
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition ${
                  !isPickingEnd
                    ? 'border-brand-400/50 bg-brand-500/15 text-white'
                    : 'border-slate-800 bg-slate-900/80 text-slate-300'
                }`}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-brand-300">
                  Dal
                </span>
                <span className="font-mono font-semibold">
                  {formatFullItalianDate(rangeStart)}
                </span>
              </div>

              <ArrowRight className="h-3.5 w-3.5 text-slate-500" />

              <div
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition ${
                  isPickingEnd
                    ? 'border-accent-400/60 bg-accent-500/15 text-white'
                    : 'border-slate-800 bg-slate-900/80 text-slate-300'
                }`}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-accent-300">
                  Al
                </span>
                <span className="font-mono font-semibold">
                  {formatFullItalianDate(rangeEnd)}
                </span>
              </div>
            </div>

            <span className="text-[10px] font-medium text-slate-400">
              {isPickingEnd
                ? 'Scegli data di fine'
                : 'Clicca 2 giorni per il range'}
            </span>
          </div>

          {/* Two-Column Body: Presets Rail + Interactive Month Grid */}
          <div className="flex">
            {/* Left Quick Presets Rail */}
            <div className="w-[162px] shrink-0 border-r border-slate-800/80 bg-slate-950/45 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 whitespace-nowrap px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
                <Sparkles className="h-3 w-3 shrink-0 text-brand-400" />
                Intervalli Rapidi
              </div>
              <div className="space-y-1">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`calendar-preset-${p.id}`}
                    onClick={p.apply}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium transition ${
                      p.active
                        ? 'border border-brand-400/45 bg-gradient-to-r from-brand-500/20 to-accent-500/15 font-semibold text-brand-200'
                        : 'border border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {p.id === '6h' && <Clock className="h-3 w-3 shrink-0 text-amber-400" />}
                      <span className="truncate">{p.label}</span>
                    </span>
                    {p.hint && (
                      <span className="ml-1 shrink-0 font-mono text-[9px] text-slate-500">
                        {p.hint}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Right Interactive Month Calendar */}
            <div className="flex-1 p-3.5">
              {/* Month Navigation Header */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-brand-300" />
                  <span className="font-display text-sm font-bold text-white">
                    {MONTHS_IT[viewMonth]} {viewYear}
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={jumpToToday}
                    className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-300 transition hover:border-brand-400/40 hover:text-brand-200"
                  >
                    Oggi
                  </button>
                  <button
                    type="button"
                    aria-label="Mese precedente"
                    onClick={prevMonth}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/90 text-slate-300 transition hover:border-brand-400/40 hover:text-white"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Mese successivo"
                    onClick={nextMonth}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/90 text-slate-300 transition hover:border-brand-400/40 hover:text-white"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Weekday Labels (Mon-Sun) */}
              <div className="mb-1.5 grid grid-cols-7 text-center">
                {WEEKDAYS_IT.map((wd) => (
                  <div
                    key={wd}
                    className="py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500"
                  >
                    {wd}
                  </div>
                ))}
              </div>

              {/* 6x7 Interactive Day Cells with Continuous Glowing Range Ribbon */}
              <div
                className="grid grid-cols-7 gap-y-1"
                onMouseLeave={() => setHoverKey(null)}
              >
                {calendarCells.map((cell) => {
                  const isStart = rangeStart === cell.key;
                  const isEnd = rangeEnd === cell.key;
                  const isSingle = isStart && isEnd;
                  const isInRange =
                    !!rangeStart &&
                    !!rangeEnd &&
                    cell.key > rangeStart &&
                    cell.key < rangeEnd;
                  const isEndpoint = isStart || isEnd;

                  // Seamless glowing ribbon background behind selected range days
                  let ribbonClass = '';
                  if (isInRange) {
                    ribbonClass = 'bg-brand-400/20';
                  } else if (isStart && !isSingle) {
                    ribbonClass = 'rounded-l-xl bg-brand-400/20';
                  } else if (isEnd && !isSingle) {
                    ribbonClass = 'rounded-r-xl bg-brand-400/20';
                  }

                  return (
                    <div
                      key={cell.key}
                      className={`relative flex h-9 items-center justify-center ${ribbonClass}`}
                    >
                      <button
                        type="button"
                        data-testid={`calendar-day-${cell.key}`}
                        onClick={() => handleDayClick(cell.key)}
                        onMouseEnter={() => setHoverKey(cell.key)}
                        title={
                          cell.eventCount > 0
                            ? `${formatFullItalianDate(cell.key)} • ${cell.eventCount} quote live`
                            : formatFullItalianDate(cell.key)
                        }
                        className={`relative flex h-8 w-8 flex-col items-center justify-center rounded-xl font-mono text-xs transition ${
                          isEndpoint
                            ? 'bg-gradient-to-br from-brand-300 to-accent-400 font-extrabold text-slate-950 shadow-[0_0_16px_-2px_rgb(var(--brand-400)/0.75)]'
                            : isInRange
                            ? 'font-bold text-brand-100 hover:bg-brand-400/25'
                            : cell.inCurrentMonth
                            ? 'font-semibold text-slate-200 hover:bg-slate-800/90 hover:text-white'
                            : 'text-slate-600 hover:bg-slate-800/50 hover:text-slate-400'
                        } ${
                          cell.isToday && !isEndpoint
                            ? 'ring-1 ring-brand-400/60'
                            : ''
                        }`}
                      >
                        <span className="leading-none">{cell.day}</span>
                        {/* Live Event Density Indicator Dot */}
                        {cell.eventCount > 0 && (
                          <span
                            className={`mt-0.5 h-1 w-1 rounded-full ${
                              isEndpoint
                                ? 'bg-slate-950/80'
                                : cell.eventCount >= 20
                                ? 'bg-emerald-400 shadow-[0_0_5px_#34d399]'
                                : 'bg-brand-300/80'
                            }`}
                          />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer Status & Action Bar */}
          <div className="flex items-center justify-between border-t border-slate-800/80 bg-slate-950/70 px-4 py-2.5">
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              {hoverKey && hoveredDayEvents !== null ? (
                <span>
                  <strong className="text-slate-200">{formatShortItalianDate(hoverKey)}</strong>:{' '}
                  <span className="font-mono text-brand-300">{hoveredDayEvents}</span> quote live
                </span>
              ) : rangeStart ? (
                <span>
                  <strong className="text-white">
                    {previewDays} {previewDays === 1 ? 'giorno' : 'giorni'}
                  </strong>{' '}
                  • <span className="font-mono font-bold text-emerald-300">{previewCount}</span>{' '}
                  quote live nel range
                </span>
              ) : (
                <span>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle" />
                  I pallini indicano giorni con eventi live
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setDraftStart(null);
                  setDraftEnd(null);
                  setIsPickingEnd(false);
                  onChange(EMPTY_DATE_RANGE);
                }}
                className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-400 transition hover:border-slate-700 hover:text-white"
              >
                Azzera
              </button>
              <button
                type="button"
                data-testid="calendar-apply-btn"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-gradient-to-r from-brand-300 to-accent-400 px-3 py-1 text-[11px] font-bold text-slate-950 shadow-glow transition hover:brightness-110"
              >
                Fatto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

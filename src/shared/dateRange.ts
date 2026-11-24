import type { DateRangeValue, ScrapeDateWindow } from './types';

export type { DateRangeValue };

export const EMPTY_DATE_RANGE: DateRangeValue = {
  mode: 'all',
  startDate: null,
  endDate: null,
};

export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

export function parseLocalDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * Evaluates whether an ISO string or epoch-ms startTime falls within the chosen DateRangeValue.
 */
export function matchesDateRange(
  startTime: string | number,
  filter: DateRangeValue,
  nowMs: number = Date.now()
): boolean {
  if (filter.mode === 'all') return true;
  const ts = typeof startTime === 'number' ? startTime : new Date(startTime).getTime();
  if (!Number.isFinite(ts)) return true;

  if (filter.mode === 'hours') {
    const hrs = filter.hours ?? 24;
    return ts <= nowMs + hrs * 3600_000;
  }

  if (filter.mode === 'range' && filter.startDate) {
    const startD = parseLocalDateKey(filter.startDate);
    startD.setHours(0, 0, 0, 0);
    const endD = parseLocalDateKey(filter.endDate ?? filter.startDate);
    endD.setHours(23, 59, 59, 999);
    return ts >= startD.getTime() && ts <= endD.getTime();
  }

  return true;
}

/**
 * Converts a DateRangeValue in 'range' mode into a normalized ScrapeDateWindow
 * with local start-of-day and end-of-day UTC epoch timestamps.
 */
export function resolveScrapeDateWindow(filter: DateRangeValue): ScrapeDateWindow | null {
  if (filter.mode !== 'range' || !filter.startDate) return null;
  const rawStart = filter.startDate;
  const rawEnd = filter.endDate ?? filter.startDate;
  const [startDate, endDate] = rawStart <= rawEnd ? [rawStart, rawEnd] : [rawEnd, rawStart];

  const startD = parseLocalDateKey(startDate);
  startD.setHours(0, 0, 0, 0);
  const endD = parseLocalDateKey(endDate);
  endD.setHours(23, 59, 59, 999);

  const startMs = startD.getTime();
  const endMs = endD.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;

  return { startDate, endDate, startMs, endMs };
}

/**
 * Returns true when the selected DateRangeValue covers future calendar days beyond today
 * that may not be covered by the default near-term scrape cycle.
 */
export function needsFutureDateScrape(
  filter: DateRangeValue,
  nowMs: number = Date.now()
): boolean {
  const win = resolveScrapeDateWindow(filter);
  if (!win) return false;
  const todayKey = toLocalDateKey(new Date(nowMs));
  return win.endDate > todayKey;
}

/**
 * Checks whether an event kickoff timestamp falls inside a ScrapeDateWindow.
 */
export function matchesScrapeDateWindow(
  startTime: string | number,
  dateWindow?: ScrapeDateWindow
): boolean {
  if (!dateWindow) return true;
  const ts = typeof startTime === 'number' ? startTime : new Date(startTime).getTime();
  if (!Number.isFinite(ts)) return false;
  return ts >= dateWindow.startMs && ts <= dateWindow.endMs;
}

/**
 * Computes the Diretta/Flashscore feed day offsets (0..7) needed to cover a ScrapeDateWindow.
 * Defaults to [0, 1] (today + tomorrow) when no dateWindow is active.
 */
export function getDirettaDayOffsetsForWindow(
  dateWindow?: ScrapeDateWindow,
  nowMs: number = Date.now(),
  maxOffset = 7
): number[] {
  if (!dateWindow) return [0, 1];

  const now = new Date(nowMs);
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startMidnight = parseLocalDateKey(dateWindow.startDate).getTime();
  const endMidnight = parseLocalDateKey(dateWindow.endDate).getTime();

  const rawStartOff = Math.round((startMidnight - todayMidnight) / 86400_000);
  const rawEndOff = Math.round((endMidnight - todayMidnight) / 86400_000);

  if (rawEndOff < 0 || rawStartOff > maxOffset) return [];

  const from = Math.max(0, rawStartOff);
  const to = Math.min(maxOffset, rawEndOff);
  const offsets: number[] = [];
  for (let d = from; d <= to; d++) {
    offsets.push(d);
  }
  return offsets;
}

/**
 * Formats a compact Italian label for a ScrapeDateWindow (e.g. "29/11" or "29/11–30/11").
 */
export function formatScrapeDateWindowLabel(
  win: { startDate: string; endDate: string }
): string {
  const fmt = (iso: string) => {
    const parts = iso.split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : iso;
  };
  return win.startDate === win.endDate
    ? fmt(win.startDate)
    : `${fmt(win.startDate)}–${fmt(win.endDate)}`;
}

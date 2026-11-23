export interface DateRangeValue {
  mode: 'all' | 'hours' | 'range';
  hours?: number;
  startDate: string | null; // YYYY-MM-DD (local calendar day)
  endDate: string | null;   // YYYY-MM-DD (local calendar day)
}

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

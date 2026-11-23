import type { SportKey } from '../../shared/types';

export function formatEuro(val: number, withSign = false): string {
  const abs = Math.abs(val).toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (val < -0.004) return `-€${abs}`;
  if (withSign && val > 0.004) return `+€${abs}`;
  return `€${abs}`;
}

export function formatOdds(val: number): string {
  return val.toFixed(2);
}

export function formatPct(val: number): string {
  return `${val.toFixed(2)}%`;
}

export function formatEventTime(iso: string): { date: string; time: string; relative: string } {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    return { date: '--/--', time: '--:--', relative: '' };
  }
  const now = new Date();
  const diffMs = dt.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);

  const time = dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const isToday =
    dt.getDate() === now.getDate() &&
    dt.getMonth() === now.getMonth() &&
    dt.getFullYear() === now.getFullYear();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    dt.getDate() === tomorrow.getDate() &&
    dt.getMonth() === tomorrow.getMonth() &&
    dt.getFullYear() === tomorrow.getFullYear();

  const date = isToday
    ? 'Oggi'
    : isTomorrow
    ? 'Domani'
    : dt.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });

  let relative = '';
  if (diffMin <= 0) {
    relative = 'LIVE / Iniziata';
  } else if (diffMin < 60) {
    relative = `tra ${diffMin}m`;
  } else if (diffMin < 1440) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    relative = m > 0 ? `tra ${h}h ${m}m` : `tra ${h}h`;
  } else {
    const d = Math.floor(diffMin / 1440);
    relative = `tra ${d}g`;
  }

  return { date, time, relative };
}

export function formatGap(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function sportLabel(sport: SportKey): string {
  switch (sport) {
    case 'football':
      return 'Calcio';
    case 'tennis':
      return 'Tennis';
    case 'basketball':
      return 'Basket';
  }
}

export function ratingTone(rating: number, mode: 'normal' | 'snr' | 'sr' | 'rf' = 'normal'): string {
  if (mode === 'snr') {
    if (rating >= 75) return 'text-brand-300';
    if (rating >= 68) return 'text-emerald-400';
    if (rating >= 60) return 'text-amber-300';
    return 'text-slate-400';
  }
  if (rating >= 100) return 'text-brand-200';
  if (rating >= 96) return 'text-emerald-400';
  if (rating >= 92) return 'text-amber-300';
  return 'text-rose-400';
}

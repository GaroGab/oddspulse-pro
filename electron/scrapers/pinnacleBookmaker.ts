import { matchesScrapeDateWindow } from '../../src/shared/dateRange';
import type {
  RawScrapedMarket,
  SelectionQuote,
  SportKey,
  TargetedScrapeFilter,
} from '../../src/shared/types';
import { fetchJson, isAbortError, throwIfAborted } from './httpClient';

const PIN_BASE = 'https://guest.api.arcadia.pinnacle.com/0.1/sports';

interface PinMatchup {
  id: number;
  type: string;
  isLive?: boolean;
  startTime: string;
  league?: { name?: string };
  participants?: Array<{
    alignment: 'home' | 'away' | 'neutral';
    name: string;
  }>;
  special?: unknown;
}

interface PinStraightMarket {
  matchupId: number;
  period: number;
  type: 'moneyline' | 'total' | 'spread';
  status?: string;
  isAlternate?: boolean;
  prices?: Array<{
    designation: 'home' | 'away' | 'draw' | 'over' | 'under';
    price: number; // American odds
    points?: number;
  }>;
}

function americanToDecimal(am: number): number | null {
  if (!Number.isFinite(am) || am === 0) return null;
  const dec = am > 0 ? 1 + am / 100 : 1 + 100 / Math.abs(am);
  if (dec <= 1.005 || dec > 500) return null;
  return Math.round(dec * 100) / 100;
}

const PIN_SPORTS: Array<{ sport: SportKey; sportId: number }> = [
  { sport: 'football', sportId: 29 },
  { sport: 'tennis', sportId: 33 },
  { sport: 'basketball', sportId: 4 },
];

import { matchesEventHints } from './matchLinker';

export async function scrapePinnacle(
  includeLive: boolean,
  filter?: TargetedScrapeFilter,
  signal?: AbortSignal
): Promise<{
  markets: RawScrapedMarket[];
  latencyMs: number;
}> {
  const started = Date.now();
  const markets: RawScrapedMarket[] = [];
  const nowMs = Date.now();
  let succeededSports = 0;
  let lastErr: unknown = null;

  const targetSports =
    filter?.sports && filter.sports.length > 0
      ? PIN_SPORTS.filter((s) => filter.sports!.includes(s.sport))
      : PIN_SPORTS;

  for (const sp of targetSports) {
    throwIfAborted(signal);
    try {
      const [{ data: matchups }, { data: straights }] = await Promise.all([
        fetchJson<PinMatchup[]>(`${PIN_BASE}/${sp.sportId}/matchups`, { timeoutMs: 14000, signal }),
        fetchJson<PinStraightMarket[]>(`${PIN_BASE}/${sp.sportId}/markets/straight`, {
          timeoutMs: 14000,
          signal,
        }),
      ]);

      const matchupMap = new Map<number, { home: string; away: string; league: string; start: string }>();
      for (const m of matchups ?? []) {
        if (m.type !== 'matchup' || m.special) continue;
        if (!includeLive && m.isLive) continue;
        if (!includeLive && new Date(m.startTime).getTime() < nowMs - 60_000) continue;
        if (filter?.dateWindow && !matchesScrapeDateWindow(m.startTime, filter.dateWindow)) {
          continue;
        }

        const parts = m.participants ?? [];
        const home = parts.find((p) => p.alignment === 'home')?.name ?? parts[0]?.name;
        const away = parts.find((p) => p.alignment === 'away')?.name ?? parts[1]?.name;
        if (!home || !away) continue;
        if (
          filter?.eventHints?.length &&
          !matchesEventHints(`${home} - ${away}`, home.trim(), away.trim(), sp.sport, filter.eventHints)
        ) {
          continue;
        }
        // Skip corners/bookings synthetic matchups on Pinnacle
        const combinedName = `${home} ${away}`.toLowerCase();
        if (
          combinedName.includes('(corners)') ||
          combinedName.includes('(bookings)') ||
          combinedName.includes('corners') ||
          combinedName.includes('bookings')
        ) {
          continue;
        }

        matchupMap.set(m.id, {
          home: home.trim(),
          away: away.trim(),
          league:
            m.league?.name ??
            (sp.sport === 'football' ? 'Calcio' : sp.sport === 'tennis' ? 'Tennis' : 'Basket'),
          start: m.startTime,
        });
      }

      // Deduplicate one moneyline and one total 2.5 per matchup
      const seenKeys = new Set<string>();

      for (const st of straights ?? []) {
        if (st.period !== 0) continue;
        if (st.status && st.status !== 'open') continue;
        const ev = matchupMap.get(st.matchupId);
        if (!ev) continue;

        if (st.type === 'moneyline') {
          const dedupKey = `${st.matchupId}:ML`;
          if (seenKeys.has(dedupKey)) continue;

          const sels: SelectionQuote[] = [];
          for (const pr of st.prices ?? []) {
            const dec = americanToDecimal(pr.price);
            if (!dec) continue;
            if (pr.designation === 'home')
              sels.push({ canonicalKey: 'HOME', label: `${ev.home} (1)`, backOdds: dec });
            else if (pr.designation === 'draw')
              sels.push({ canonicalKey: 'DRAW', label: 'Pareggio (X)', backOdds: dec });
            else if (pr.designation === 'away')
              sels.push({ canonicalKey: 'AWAY', label: `${ev.away} (2)`, backOdds: dec });
          }

          const expectedCount = sp.sport === 'football' ? 3 : 2;
          if (sels.length === expectedCount) {
            seenKeys.add(dedupKey);
            markets.push({
              sourceId: 'pinnacle',
              sourceName: 'Pinnacle',
              sourceKind: 'bookmaker',
              sport: sp.sport,
              league: ev.league,
              eventId: String(st.matchupId),
              eventName: `${ev.home} - ${ev.away}`,
              homeTeam: ev.home,
              awayTeam: ev.away,
              startTime: ev.start,
              marketType: sp.sport === 'football' ? '1X2' : 'H2H',
              marketLabel: sp.sport === 'football' ? 'Esito Finale 1X2' : 'Testa a Testa',
              selections: sels,
              eventUrl: 'https://www.pinnacle.com/',
              scrapedAt: Date.now(),
            });
          }
        } else if (sp.sport === 'football' && st.type === 'total') {
          const has25 = (st.prices ?? []).every((p) => p.points === 2.5);
          if (!has25 || (st.prices?.length ?? 0) !== 2) continue;

          const dedupKey = `${st.matchupId}:OU25`;
          if (seenKeys.has(dedupKey)) continue;

          const sels: SelectionQuote[] = [];
          for (const pr of st.prices ?? []) {
            const dec = americanToDecimal(pr.price);
            if (!dec) continue;
            if (pr.designation === 'over')
              sels.push({ canonicalKey: 'OVER_25', label: 'Over 2.5', backOdds: dec });
            else if (pr.designation === 'under')
              sels.push({ canonicalKey: 'UNDER_25', label: 'Under 2.5', backOdds: dec });
          }

          if (sels.length === 2) {
            seenKeys.add(dedupKey);
            markets.push({
              sourceId: 'pinnacle',
              sourceName: 'Pinnacle',
              sourceKind: 'bookmaker',
              sport: sp.sport,
              league: ev.league,
              eventId: String(st.matchupId),
              eventName: `${ev.home} - ${ev.away}`,
              homeTeam: ev.home,
              awayTeam: ev.away,
              startTime: ev.start,
              marketType: 'OVER_UNDER_25',
              marketLabel: 'Under/Over 2.5 Gol',
              selections: sels,
              eventUrl: 'https://www.pinnacle.com/',
              scrapedAt: Date.now(),
            });
          }
        }
      }
      succeededSports++;
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      lastErr = err;
    }
  }

  if (succeededSports === 0 && lastErr) {
    throw lastErr;
  }

  return { markets, latencyMs: Date.now() - started };
}

import { matchesScrapeDateWindow } from '../../src/shared/dateRange';
import type { RawScrapedMarket, SelectionQuote, TargetedScrapeFilter } from '../../src/shared/types';
import { fetchJson, isAbortError, throwIfAborted } from './httpClient';
import { matchesEventHints } from './matchLinker';

interface OddsApiEvent {
  id: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string;
      outcomes: Array<{ name: string; price: number }>;
    }>;
  }>;
}

const LEAGUES = [
  'soccer_italy_serie_a',
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
];

export async function scrapeTheOddsApiOptional(
  apiKey: string,
  filter?: TargetedScrapeFilter,
  signal?: AbortSignal
): Promise<{ markets: RawScrapedMarket[]; latencyMs: number }> {
  const started = Date.now();
  const markets: RawScrapedMarket[] = [];
  if (!apiKey || apiKey.trim().length < 8) {
    return { markets, latencyMs: 0 };
  }
  if (filter?.sports && !filter.sports.includes('football')) {
    return { markets, latencyMs: 0 };
  }

  for (const sportKey of LEAGUES) {
    throwIfAborted(signal);
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${encodeURIComponent(
        apiKey.trim()
      )}&regions=eu&markets=h2h&oddsFormat=decimal`;
      const { data } = await fetchJson<OddsApiEvent[]>(url, { timeoutMs: 10000, retries: 0, signal });

      for (const ev of data ?? []) {
        if (filter?.dateWindow && !matchesScrapeDateWindow(ev.commence_time, filter.dateWindow)) {
          continue;
        }
        if (
          filter?.eventHints?.length &&
          !matchesEventHints(
            `${ev.home_team} - ${ev.away_team}`,
            ev.home_team,
            ev.away_team,
            'football',
            filter.eventHints
          )
        ) {
          continue;
        }
        for (const bk of ev.bookmakers ?? []) {
          const h2h = bk.markets.find((m) => m.key === 'h2h');
          if (!h2h || h2h.outcomes.length < 2) continue;

          const sels: SelectionQuote[] = [];
          for (const o of h2h.outcomes) {
            if (o.name.toLowerCase() === 'draw') {
              sels.push({ canonicalKey: 'DRAW', label: 'Pareggio (X)', backOdds: o.price });
            } else if (o.name === ev.home_team) {
              sels.push({ canonicalKey: 'HOME', label: `${ev.home_team} (1)`, backOdds: o.price });
            } else if (o.name === ev.away_team) {
              sels.push({ canonicalKey: 'AWAY', label: `${ev.away_team} (2)`, backOdds: o.price });
            }
          }

          if (sels.length === 3) {
            markets.push({
              sourceId: 'the_odds_api',
              sourceName: `${bk.title} (API)`,
              sourceKind: 'bookmaker',
              sport: 'football',
              league: ev.sport_title,
              eventId: `${ev.id}_${bk.key}`,
              eventName: `${ev.home_team} - ${ev.away_team}`,
              homeTeam: ev.home_team,
              awayTeam: ev.away_team,
              startTime: ev.commence_time,
              marketType: '1X2',
              marketLabel: 'Esito Finale 1X2',
              selections: sels,
              scrapedAt: Date.now(),
            });
          }
        }
      }
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      // Ignore individual league errors
    }
  }

  return { markets, latencyMs: Date.now() - started };
}

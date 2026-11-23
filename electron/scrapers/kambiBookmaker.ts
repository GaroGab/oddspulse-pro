import type {
  RawScrapedMarket,
  SelectionQuote,
  SourceId,
  SportKey,
  TargetedScrapeFilter,
} from '../../src/shared/types';
import { fetchJson, sleep } from './httpClient';

interface KambiOutcome {
  label?: string;
  englishLabel?: string;
  type?: string; // OT_ONE, OT_CROSS, OT_TWO, OT_OVER, OT_UNDER
  line?: number; // e.g., 2500 for 2.5
  odds?: number; // decimal * 1000
  status?: string;
}

interface KambiBetOffer {
  criterion?: { label?: string; englishLabel?: string };
  betOfferType?: { name?: string; englishName?: string };
  outcomes?: KambiOutcome[];
  suspended?: boolean;
}

interface KambiEventEntry {
  event: {
    id: number;
    name: string;
    englishName?: string;
    homeName?: string;
    awayName?: string;
    start: string;
    group?: string;
    sport?: string;
    state?: string; // NOT_STARTED, STARTED
    path?: Array<{ name?: string; englishName?: string }>;
  };
  betOffers?: KambiBetOffer[];
}

interface KambiListResponse {
  events?: KambiEventEntry[];
}

export interface KambiBrandSpec {
  sourceId: SourceId;
  sourceName: string;
  kambiOperator: string;
  baseUrl: string;
}

export const KAMBI_BRANDS: Record<string, KambiBrandSpec> = {
  '888sport_it': {
    sourceId: '888sport_it',
    sourceName: '888sport.it',
    kambiOperator: '888it',
    baseUrl: 'https://www.888sport.it/#/event/',
  },
  leovegas_it: {
    sourceId: 'leovegas_it',
    sourceName: 'LeoVegas.it',
    kambiOperator: 'leoit',
    baseUrl: 'https://www.leovegas.it/scommesse#event/',
  },
  unibet: {
    sourceId: 'unibet',
    sourceName: 'Unibet',
    kambiOperator: 'ub',
    baseUrl: 'https://www.unibet.it/betting/sports/event/',
  },
  paf: {
    sourceId: 'paf',
    sourceName: 'Paf Sports',
    kambiOperator: 'paf',
    baseUrl: 'https://www.paf.com/betting#event/',
  },
};

const SPORTS: Array<{ sport: SportKey; kambiPath: string }> = [
  { sport: 'football', kambiPath: 'football' },
  { sport: 'tennis', kambiPath: 'tennis' },
  { sport: 'basketball', kambiPath: 'basketball' },
];

import { matchesEventHints } from './matchLinker';

export async function scrapeKambiBrand(
  spec: KambiBrandSpec,
  includeLive: boolean,
  filter?: TargetedScrapeFilter
): Promise<{ markets: RawScrapedMarket[]; latencyMs: number }> {
  const started = Date.now();
  const markets: RawScrapedMarket[] = [];
  let succeededSports = 0;
  let lastErr: unknown = null;

  const targetSports =
    filter?.sports && filter.sports.length > 0
      ? SPORTS.filter((s) => filter.sports!.includes(s.sport))
      : SPORTS;

  for (const sp of targetSports) {
    const url = `https://eu-offering-api.kambicdn.com/offering/v2018/${spec.kambiOperator}/listView/${sp.kambiPath}.json?lang=it_IT&market=IT&client_id=2&channel_id=1&useCombined=true`;
    try {
      const { data } = await fetchJson<KambiListResponse>(url, { timeoutMs: 12000, retries: 1 });
      const entries = data.events ?? [];

      for (const entry of entries) {
        const ev = entry.event;
        if (!ev || !ev.homeName || !ev.awayName) continue;
        if (!includeLive && ev.state && ev.state !== 'NOT_STARTED') continue;

        const homeTeam = ev.homeName.trim();
        const awayTeam = ev.awayName.trim();
        if (
          filter?.eventHints?.length &&
          !matchesEventHints(`${homeTeam} - ${awayTeam}`, homeTeam, awayTeam, sp.sport, filter.eventHints)
        ) {
          continue;
        }
        const league =
          ev.group ??
          ev.path?.[ev.path.length - 1]?.name ??
          (sp.sport === 'football' ? 'Calcio' : sp.sport === 'tennis' ? 'Tennis' : 'Basket');

        for (const bo of entry.betOffers ?? []) {
          if (bo.suspended) continue;
          const outcomes = (bo.outcomes ?? []).filter(
            (o) => (!o.status || o.status === 'OPEN') && o.odds && o.odds > 1005
          );
          if (outcomes.length < 2) continue;

          const boType = (bo.betOfferType?.englishName ?? bo.betOfferType?.name ?? '').toLowerCase();
          const crit = (bo.criterion?.englishLabel ?? bo.criterion?.label ?? '').toLowerCase();

          // 1X2 Football
          if (
            sp.sport === 'football' &&
            outcomes.length === 3 &&
            outcomes.some((o) => o.type === 'OT_ONE') &&
            outcomes.some((o) => o.type === 'OT_CROSS') &&
            outcomes.some((o) => o.type === 'OT_TWO') &&
            !crit.includes('half') &&
            !crit.includes('tempo')
          ) {
            const sels: SelectionQuote[] = [];
            for (const o of outcomes) {
              const dec = Math.round((o.odds! / 1000) * 100) / 100;
              if (o.type === 'OT_ONE')
                sels.push({ canonicalKey: 'HOME', label: `${homeTeam} (1)`, backOdds: dec });
              else if (o.type === 'OT_CROSS')
                sels.push({ canonicalKey: 'DRAW', label: 'Pareggio (X)', backOdds: dec });
              else if (o.type === 'OT_TWO')
                sels.push({ canonicalKey: 'AWAY', label: `${awayTeam} (2)`, backOdds: dec });
            }
            if (sels.length === 3) {
              markets.push({
                sourceId: spec.sourceId,
                sourceName: spec.sourceName,
                sourceKind: 'bookmaker',
                sport: sp.sport,
                league,
                eventId: String(ev.id),
                eventName: `${homeTeam} - ${awayTeam}`,
                homeTeam,
                awayTeam,
                startTime: ev.start,
                marketType: '1X2',
                marketLabel: 'Esito Finale 1X2',
                selections: sels,
                eventUrl: `${spec.baseUrl}${ev.id}`,
                scrapedAt: Date.now(),
              });
            }
            continue;
          }

          // Football Over/Under 2.5
          if (
            sp.sport === 'football' &&
            outcomes.length === 2 &&
            outcomes.some((o) => o.type === 'OT_OVER' && o.line === 2500) &&
            outcomes.some((o) => o.type === 'OT_UNDER' && o.line === 2500) &&
            !crit.includes('half') &&
            !crit.includes('tempo') &&
            !crit.includes('corner') &&
            !crit.includes('card')
          ) {
            const sels: SelectionQuote[] = [];
            for (const o of outcomes) {
              const dec = Math.round((o.odds! / 1000) * 100) / 100;
              if (o.type === 'OT_OVER')
                sels.push({ canonicalKey: 'OVER_25', label: 'Over 2.5', backOdds: dec });
              else if (o.type === 'OT_UNDER')
                sels.push({ canonicalKey: 'UNDER_25', label: 'Under 2.5', backOdds: dec });
            }
            if (sels.length === 2) {
              markets.push({
                sourceId: spec.sourceId,
                sourceName: spec.sourceName,
                sourceKind: 'bookmaker',
                sport: sp.sport,
                league,
                eventId: String(ev.id),
                eventName: `${homeTeam} - ${awayTeam}`,
                homeTeam,
                awayTeam,
                startTime: ev.start,
                marketType: 'OVER_UNDER_25',
                marketLabel: 'Under/Over 2.5 Gol',
                selections: sels,
                eventUrl: `${spec.baseUrl}${ev.id}`,
                scrapedAt: Date.now(),
              });
            }
            continue;
          }

          // Tennis & Basketball H2H (Moneyline / Testa a Testa)
          if (
            (sp.sport === 'tennis' || sp.sport === 'basketball') &&
            outcomes.length === 2 &&
            outcomes.some((o) => o.type === 'OT_ONE') &&
            outcomes.some((o) => o.type === 'OT_TWO') &&
            !boType.includes('handicap') &&
            !crit.includes('set') &&
            !crit.includes('quarter') &&
            !crit.includes('half') &&
            !crit.includes('quarto') &&
            !crit.includes('tempo')
          ) {
            const sels: SelectionQuote[] = [];
            for (const o of outcomes) {
              const dec = Math.round((o.odds! / 1000) * 100) / 100;
              if (o.type === 'OT_ONE')
                sels.push({ canonicalKey: 'HOME', label: `${homeTeam} (1)`, backOdds: dec });
              else if (o.type === 'OT_TWO')
                sels.push({ canonicalKey: 'AWAY', label: `${awayTeam} (2)`, backOdds: dec });
            }
            if (sels.length === 2) {
              markets.push({
                sourceId: spec.sourceId,
                sourceName: spec.sourceName,
                sourceKind: 'bookmaker',
                sport: sp.sport,
                league,
                eventId: String(ev.id),
                eventName: `${homeTeam} - ${awayTeam}`,
                homeTeam,
                awayTeam,
                startTime: ev.start,
                marketType: 'H2H',
                marketLabel: 'Testa a Testa',
                selections: sels,
                eventUrl: `${spec.baseUrl}${ev.id}`,
                scrapedAt: Date.now(),
              });
            }
          }
        }
      }
      succeededSports++;
    } catch (err) {
      lastErr = err;
    }
    // Gentle pause between sport requests to avoid Kambi 429
    await sleep(220);
  }

  if (succeededSports === 0 && lastErr) {
    throw lastErr;
  }

  return { markets, latencyMs: Date.now() - started };
}

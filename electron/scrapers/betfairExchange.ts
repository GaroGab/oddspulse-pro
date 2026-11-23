import type {
  MarketType,
  RawScrapedMarket,
  SelectionQuote,
  SportKey,
  TargetedScrapeFilter,
} from '../../src/shared/types';
import { fetchJson, sleep } from './httpClient';
import { matchesEventHints } from './matchLinker';

const SCAN_URL =
  'https://scan-inbf.betfair.it/www/sports/navigation/facet/v1/search?_ak=nzIFcwyWhrlwYMrh&alt=json';
const ERO_BASE =
  'https://ero.betfair.it/www/sports/exchange/readonly/v1/bymarket?_ak=nzIFcwyWhrlwYMrh&currencyCode=EUR&locale=it&rollupLimit=2&rollupModel=STAKE&types=MARKET_STATE,MARKET_DESCRIPTION,EVENT,RUNNER_DESCRIPTION,RUNNER_EXCHANGE_PRICES_BEST';

interface BetfairScanResult {
  eventId?: number;
  marketId?: string;
  competitionId?: number;
  eventTypeId?: number;
}

interface BetfairScanResponse {
  results?: BetfairScanResult[];
  attachments?: {
    competitions?: Record<string, { name?: string; competitionId?: number }>;
    events?: Record<string, { name?: string; openDate?: string; competitionId?: number }>;
  };
}

interface BetfairEroResponse {
  eventTypes?: Array<{
    eventTypeId: number;
    eventNodes?: Array<{
      eventId: number;
      event: {
        eventName: string;
        openDate: string;
        countryCode?: string;
      };
      marketNodes?: Array<{
        marketId: string;
        state?: {
          inplay?: boolean;
          status?: string;
          totalMatched?: number;
        };
        description?: {
          marketName?: string;
          marketType?: string;
          marketTime?: string;
        };
        runners?: Array<{
          selectionId: number;
          description?: {
            runnerName?: string;
          };
          exchange?: {
            availableToBack?: Array<{ price: number; size: number }>;
            availableToLay?: Array<{ price: number; size: number }>;
          };
        }>;
      }>;
    }>;
  }>;
}

function splitEventTeams(eventName: string): [string, string] | null {
  const separators = [' - ', ' v ', ' vs ', ' @ '];
  for (const sep of separators) {
    const idx = eventName.indexOf(sep);
    if (idx > 0) {
      return [eventName.slice(0, idx).trim(), eventName.slice(idx + sep.length).trim()];
    }
  }
  return null;
}

function mapBetfairMarket(
  sport: SportKey,
  bfMarketType: string
): { marketType: MarketType; marketLabel: string } | null {
  if (sport === 'football') {
    if (bfMarketType === 'MATCH_ODDS') return { marketType: '1X2', marketLabel: 'Esito Finale 1X2' };
    if (bfMarketType === 'OVER_UNDER_25')
      return { marketType: 'OVER_UNDER_25', marketLabel: 'Under/Over 2.5 Gol' };
    if (bfMarketType === 'BOTH_TEAMS_TO_SCORE')
      return { marketType: 'BTTS', marketLabel: 'Goal / NoGoal' };
    return null;
  }
  if (bfMarketType === 'MATCH_ODDS' || bfMarketType === 'MONEY_LINE') {
    return { marketType: 'H2H', marketLabel: 'Testa a Testa' };
  }
  return null;
}

function mapRunnerCanonicalKey(
  marketType: MarketType,
  runnerName: string,
  runnerIdx: number,
  homeTeam: string,
  awayTeam: string
): { key: string; label: string } | null {
  const rn = runnerName.trim();
  const rnLow = rn.toLowerCase();

  if (marketType === '1X2') {
    if (rnLow === 'pareggio' || rnLow === 'the draw' || rnLow === 'draw' || rnLow === 'x') {
      return { key: 'DRAW', label: 'Pareggio (X)' };
    }
    if (rnLow === homeTeam.toLowerCase() || runnerIdx === 0) {
      return { key: 'HOME', label: `${homeTeam} (1)` };
    }
    if (rnLow === awayTeam.toLowerCase() || runnerIdx === 1) {
      return { key: 'AWAY', label: `${awayTeam} (2)` };
    }
    return null;
  }

  if (marketType === 'H2H') {
    if (rnLow === homeTeam.toLowerCase() || runnerIdx === 0) {
      return { key: 'HOME', label: `${homeTeam} (1)` };
    }
    if (rnLow === awayTeam.toLowerCase() || runnerIdx === 1) {
      return { key: 'AWAY', label: `${awayTeam} (2)` };
    }
    return null;
  }

  if (marketType === 'OVER_UNDER_25') {
    if (rnLow.includes('over') || rnLow.includes('più') || rnLow.includes('piu')) {
      return { key: 'OVER_25', label: 'Over 2.5' };
    }
    if (rnLow.includes('under') || rnLow.includes('meno')) {
      return { key: 'UNDER_25', label: 'Under 2.5' };
    }
    return null;
  }

  if (marketType === 'BTTS') {
    if (rnLow === 'sì' || rnLow === 'si' || rnLow === 'yes' || rnLow === 'goal') {
      return { key: 'BTTS_YES', label: 'Goal (Sì)' };
    }
    if (rnLow === 'no' || rnLow === 'nogoal' || rnLow === 'no goal') {
      return { key: 'BTTS_NO', label: 'NoGoal (No)' };
    }
    return null;
  }

  return null;
}

const SPORT_CONFIGS: Array<{
  sport: SportKey;
  eventTypeId: number;
  marketTypeCodes: string[];
  maxResults: number;
}> = [
  {
    sport: 'football',
    eventTypeId: 1,
    marketTypeCodes: ['MATCH_ODDS', 'OVER_UNDER_25', 'BOTH_TEAMS_TO_SCORE'],
    maxResults: 120,
  },
  {
    sport: 'tennis',
    eventTypeId: 2,
    marketTypeCodes: ['MATCH_ODDS'],
    maxResults: 45,
  },
  {
    sport: 'basketball',
    eventTypeId: 7522,
    marketTypeCodes: ['MATCH_ODDS', 'MONEY_LINE'],
    maxResults: 45,
  },
];

export async function scrapeBetfairExchange(
  includeLive: boolean,
  filter?: TargetedScrapeFilter
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
      ? SPORT_CONFIGS.filter((sc) => filter.sports!.includes(sc.sport))
      : SPORT_CONFIGS;

  for (const sc of targetSports) {
    try {
      const scanPayload = {
        filter: {
          marketBettingTypes: ['ODDS'],
          productTypes: ['EXCHANGE'],
          marketTypeCodes: sc.marketTypeCodes,
          selectBy: 'MAXIMUM_TRADED',
          contentGroup: { language: 'it', regionCode: 'UK' },
          maxResults: sc.maxResults,
          eventTypeIds: [sc.eventTypeId],
        },
        facets: [
          { type: 'EVENT', maxValues: sc.maxResults },
          { type: 'COMPETITION', maxValues: 150 },
        ],
        currencyCode: 'EUR',
        locale: 'it',
      };

      const { data: scan } = await fetchJson<BetfairScanResponse>(SCAN_URL, {
        method: 'POST',
        body: scanPayload,
        timeoutMs: 12000,
      });

      const compById = new Map<number, string>();
      if (scan.attachments?.competitions) {
        for (const c of Object.values(scan.attachments.competitions)) {
          if (c.competitionId && c.name) compById.set(c.competitionId, c.name);
        }
      }

      const scanEvents = scan.attachments?.events ?? {};
      const eventCompMap = new Map<number, string>();
      const marketIds: string[] = [];
      for (const r of scan.results ?? []) {
        if (filter?.eventHints?.length && r.eventId !== undefined) {
          const evMeta = scanEvents[String(r.eventId)];
          if (
            evMeta?.name &&
            !matchesEventHints(evMeta.name, '', '', sc.sport, filter.eventHints)
          ) {
            continue;
          }
        }
        if (r.marketId) marketIds.push(r.marketId);
        if (r.eventId && r.competitionId && compById.has(r.competitionId)) {
          eventCompMap.set(r.eventId, compById.get(r.competitionId)!);
        }
      }

      // Fetch ERO prices in batches of 30
      const batchSize = 30;
      for (let i = 0; i < marketIds.length; i += batchSize) {
        const batch = marketIds.slice(i, i + batchSize);
        const eroUrl = `${ERO_BASE}&marketIds=${batch.join(',')}`;
        const { data: ero } = await fetchJson<BetfairEroResponse>(eroUrl, { timeoutMs: 12000 });

        for (const et of ero.eventTypes ?? []) {
          for (const evNode of et.eventNodes ?? []) {
            const evName = evNode.event?.eventName ?? '';
            const teams = splitEventTeams(evName);
            if (!teams) continue;
            const [homeTeam, awayTeam] = teams;
            const league =
              eventCompMap.get(evNode.eventId) ??
              (sc.sport === 'football'
                ? 'Calcio'
                : sc.sport === 'tennis'
                ? 'Tennis ATP/WTA'
                : 'Basket');

            for (const mn of evNode.marketNodes ?? []) {
              if (mn.state?.status && mn.state.status !== 'OPEN') continue;
              if (!includeLive && mn.state?.inplay) continue;

              const startTime = mn.description?.marketTime ?? evNode.event.openDate;
              if (!includeLive && new Date(startTime).getTime() < nowMs - 60_000) continue;

              const mapped = mapBetfairMarket(sc.sport, mn.description?.marketType ?? '');
              if (!mapped) continue;

              const selections: SelectionQuote[] = [];
              (mn.runners ?? []).forEach((rn, idx) => {
                const name = rn.description?.runnerName ?? '';
                const keyInfo = mapRunnerCanonicalKey(
                  mapped.marketType,
                  name,
                  idx,
                  homeTeam,
                  awayTeam
                );
                if (!keyInfo) return;

                const bestBack = rn.exchange?.availableToBack?.[0];
                const bestLay = rn.exchange?.availableToLay?.[0];
                if (!bestLay && !bestBack) return;

                selections.push({
                  canonicalKey: keyInfo.key,
                  label: keyInfo.label,
                  backOdds: bestBack?.price,
                  backLiquidity: bestBack?.size,
                  layOdds: bestLay?.price,
                  layLiquidity: bestLay?.size,
                });
              });

              if (selections.length >= 2) {
                markets.push({
                  sourceId: 'betfair_exchange',
                  sourceName: 'Betfair Exchange IT',
                  sourceKind: 'exchange',
                  sport: sc.sport,
                  league,
                  eventId: String(evNode.eventId),
                  eventName: `${homeTeam} - ${awayTeam}`,
                  homeTeam,
                  awayTeam,
                  startTime,
                  marketType: mapped.marketType,
                  marketLabel: mapped.marketLabel,
                  selections,
                  eventUrl: `https://www.betfair.it/exchange/plus/it/market/${mn.marketId}`,
                  scrapedAt: Date.now(),
                });
              }
            }
          }
        }
        if (i + batchSize < marketIds.length) {
          await sleep(120);
        }
      }
      succeededSports++;
    } catch (err) {
      lastErr = err;
    }
  }

  if (succeededSports === 0 && lastErr) {
    throw lastErr;
  }

  return { markets, latencyMs: Date.now() - started };
}

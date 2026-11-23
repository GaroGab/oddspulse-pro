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
const SMP_URL =
  'https://smp.betfair.it/www/sports/fixedodds/readonly/v1/getMarketPrices?_ak=nzIFcwyWhrlwYMrh&alt=json';

interface SbMarketMeta {
  marketId: string;
  eventId: number;
  competitionId?: number;
  marketName?: string;
  marketTime?: string;
  marketType?: string;
  inPlay?: boolean;
  runners?: Array<{
    selectionId: number;
    runnerName: string;
    sortPriority?: number;
    runnerStatus?: string;
  }>;
}

interface SbEventMeta {
  eventId: number;
  name: string;
  openDate: string;
  competitionId?: number;
}

interface SbScanResp {
  results?: Array<{ sportsbookMarketId?: string; eventId?: number }>;
  attachments?: {
    sportsBookMarkets?: Record<string, SbMarketMeta>;
    events?: Record<string, SbEventMeta>;
    competitions?: Record<string, { competitionId?: number; name?: string }>;
  };
}

interface SmpPriceRespItem {
  marketId: string;
  inplay?: boolean;
  runnerDetails?: Array<{
    selectionId: number;
    runnerStatus?: string;
    runnerOdds?: {
      decimalDisplayOdds?: { decimalOdds?: number };
      trueOdds?: { decimalOdds?: { decimalOdds?: number } };
    };
  }>;
}

function splitEventTeams(eventName: string): [string, string] | null {
  for (const sep of [' - ', ' v ', ' vs ', ' @ ']) {
    const idx = eventName.indexOf(sep);
    if (idx > 0) {
      return [eventName.slice(0, idx).trim(), eventName.slice(idx + sep.length).trim()];
    }
  }
  return null;
}

function mapSbMarket(
  sport: SportKey,
  mType: string
): { marketType: MarketType; marketLabel: string } | null {
  if (sport === 'football') {
    if (mType === 'MATCH_ODDS' || mType === 'WIN-DRAW-WIN')
      return { marketType: '1X2', marketLabel: 'Esito Finale 1X2' };
    if (mType === 'OVER_UNDER_25')
      return { marketType: 'OVER_UNDER_25', marketLabel: 'Under/Over 2.5 Gol' };
    if (mType === 'BOTH_TEAMS_TO_SCORE')
      return { marketType: 'BTTS', marketLabel: 'Goal / NoGoal' };
    return null;
  }
  if (mType === 'MATCH_ODDS' || mType === 'MONEY_LINE') {
    return { marketType: 'H2H', marketLabel: 'Testa a Testa' };
  }
  return null;
}

function mapRunner(
  marketType: MarketType,
  runnerName: string,
  idx: number,
  home: string,
  away: string
): { key: string; label: string } | null {
  const low = runnerName.trim().toLowerCase();
  if (marketType === '1X2') {
    if (low === 'pareggio' || low === 'draw' || low === 'the draw' || low === 'x') {
      return { key: 'DRAW', label: 'Pareggio (X)' };
    }
    if (low === home.toLowerCase() || idx === 0) return { key: 'HOME', label: `${home} (1)` };
    if (low === away.toLowerCase() || idx === 1) return { key: 'AWAY', label: `${away} (2)` };
    return null;
  }
  if (marketType === 'H2H') {
    if (low === home.toLowerCase() || idx === 0) return { key: 'HOME', label: `${home} (1)` };
    if (low === away.toLowerCase() || idx === 1) return { key: 'AWAY', label: `${away} (2)` };
    return null;
  }
  if (marketType === 'OVER_UNDER_25') {
    if (low.includes('over') || low.includes('più') || low.includes('piu'))
      return { key: 'OVER_25', label: 'Over 2.5' };
    if (low.includes('under') || low.includes('meno'))
      return { key: 'UNDER_25', label: 'Under 2.5' };
    return null;
  }
  if (marketType === 'BTTS') {
    if (low === 'sì' || low === 'si' || low === 'yes' || low === 'goal')
      return { key: 'BTTS_YES', label: 'Goal (Sì)' };
    if (low === 'no' || low === 'nogoal' || low === 'no goal')
      return { key: 'BTTS_NO', label: 'NoGoal (No)' };
    return null;
  }
  return null;
}

const SPORT_SPECS: Array<{
  sport: SportKey;
  eventTypeId: number;
  marketTypeCodes: string[];
  maxResults: number;
}> = [
  {
    sport: 'football',
    eventTypeId: 1,
    marketTypeCodes: ['MATCH_ODDS', 'OVER_UNDER_25', 'BOTH_TEAMS_TO_SCORE'],
    maxResults: 110,
  },
  {
    sport: 'tennis',
    eventTypeId: 2,
    marketTypeCodes: ['MATCH_ODDS'],
    maxResults: 40,
  },
  {
    sport: 'basketball',
    eventTypeId: 7522,
    marketTypeCodes: ['MATCH_ODDS', 'MONEY_LINE'],
    maxResults: 40,
  },
];

export async function scrapeBetfairSportsbook(
  includeLive: boolean,
  filter?: TargetedScrapeFilter
): Promise<{
  markets: RawScrapedMarket[];
  latencyMs: number;
}> {
  const started = Date.now();
  const markets: RawScrapedMarket[] = [];
  const nowIso = new Date().toISOString();
  let succeededSports = 0;
  let lastErr: unknown = null;

  const targetSpecs =
    filter?.sports && filter.sports.length > 0
      ? SPORT_SPECS.filter((sp) => filter.sports!.includes(sp.sport))
      : SPORT_SPECS;

  for (const sp of targetSpecs) {
    try {
      const payload = {
        filter: {
          productTypes: ['SPORTSBOOK'],
          marketTypeCodes: sp.marketTypeCodes,
          contentGroup: { language: 'it', regionCode: 'UK' },
          ...(includeLive ? {} : { marketStartingAfter: nowIso }),
          maxResults: sp.maxResults,
          eventTypeIds: [sp.eventTypeId],
        },
        facets: [
          { type: 'EVENT', maxValues: sp.maxResults },
          { type: 'COMPETITION', maxValues: 150 },
          { type: 'MARKET', maxValues: sp.maxResults },
        ],
        currencyCode: 'EUR',
        locale: 'it',
      };

      const { data: scan } = await fetchJson<SbScanResp>(SCAN_URL, {
        method: 'POST',
        body: payload,
        timeoutMs: 12000,
      });

      const sbMarkets = scan.attachments?.sportsBookMarkets ?? {};
      const eventsMap = scan.attachments?.events ?? {};
      const compsMap = scan.attachments?.competitions ?? {};

      const marketIds = Object.values(sbMarkets)
        .filter((m) => {
          if (!includeLive && m.inPlay) return false;
          if (filter?.eventHints?.length) {
            const ev = eventsMap[String(m.eventId)];
            if (ev?.name && !matchesEventHints(ev.name, '', '', sp.sport, filter.eventHints)) {
              return false;
            }
          }
          return true;
        })
        .map((m) => m.marketId);

      // Fetch fixed-odds prices in chunks of 40
      const priceMap = new Map<string, SmpPriceRespItem>();
      for (let i = 0; i < marketIds.length; i += 40) {
        const chunk = marketIds.slice(i, i + 40);
        const { data: prices } = await fetchJson<SmpPriceRespItem[]>(SMP_URL, {
          method: 'POST',
          body: { marketIds: chunk, currencyCode: 'EUR' },
          timeoutMs: 12000,
        });
        for (const p of prices ?? []) {
          priceMap.set(p.marketId, p);
        }
        if (i + 40 < marketIds.length) await sleep(100);
      }

      for (const m of Object.values(sbMarkets)) {
        if (!includeLive && m.inPlay) continue;
        const mapped = mapSbMarket(sp.sport, m.marketType ?? '');
        if (!mapped) continue;

        const ev = eventsMap[String(m.eventId)];
        if (!ev) continue;
        const teams = splitEventTeams(ev.name);
        if (!teams) continue;
        const [homeTeam, awayTeam] = teams;

        const priceObj = priceMap.get(m.marketId);
        if (!priceObj) continue;
        if (!includeLive && priceObj.inplay) continue;

        const oddsBySel = new Map<number, number>();
        for (const rd of priceObj.runnerDetails ?? []) {
          const dec =
            rd.runnerOdds?.decimalDisplayOdds?.decimalOdds ??
            rd.runnerOdds?.trueOdds?.decimalOdds?.decimalOdds;
          if (dec && dec > 1.005) {
            oddsBySel.set(rd.selectionId, Math.round(dec * 100) / 100);
          }
        }

        const selections: SelectionQuote[] = [];
        const sortedRunners = [...(m.runners ?? [])].sort(
          (a, b) => (a.sortPriority ?? 0) - (b.sortPriority ?? 0)
        );
        sortedRunners.forEach((rn, idx) => {
          if (rn.runnerStatus === 'REMOVED') return;
          const backOdds = oddsBySel.get(rn.selectionId);
          if (!backOdds) return;
          const mappedRunner = mapRunner(mapped.marketType, rn.runnerName, idx, homeTeam, awayTeam);
          if (!mappedRunner) return;
          selections.push({
            canonicalKey: mappedRunner.key,
            label: mappedRunner.label,
            backOdds,
          });
        });

        if (selections.length >= 2) {
          const compName =
            compsMap[String(m.competitionId ?? ev.competitionId ?? '')]?.name ??
            (sp.sport === 'football' ? 'Calcio' : sp.sport === 'tennis' ? 'Tennis' : 'Basket');

          markets.push({
            sourceId: 'betfair_sportsbook',
            sourceName: 'Betfair Sportsbook IT',
            sourceKind: 'bookmaker',
            sport: sp.sport,
            league: compName,
            eventId: String(ev.eventId),
            eventName: `${homeTeam} - ${awayTeam}`,
            homeTeam,
            awayTeam,
            startTime: m.marketTime ?? ev.openDate,
            marketType: mapped.marketType,
            marketLabel: mapped.marketLabel,
            selections,
            eventUrl: `https://www.betfair.it/sport/`,
            scrapedAt: Date.now(),
          });
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

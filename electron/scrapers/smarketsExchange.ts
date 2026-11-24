import { matchesScrapeDateWindow } from '../../src/shared/dateRange';
import type {
  MarketType,
  RawScrapedMarket,
  SelectionQuote,
  SportKey,
  TargetedScrapeFilter,
} from '../../src/shared/types';
import { fetchJson, isAbortError, sleep, throwIfAborted } from './httpClient';
import { matchesEventHints } from './matchLinker';

const SM_BASE = 'https://api.smarkets.com/v3';

interface SmEvent {
  id: string;
  name: string;
  start_datetime: string;
  type: string;
  state: string;
  full_slug?: string;
}

interface SmMarket {
  id: string;
  event_id: string;
  name: string;
  market_type?: { name?: string };
  state?: string;
}

interface SmContract {
  id: string;
  market_id: string;
  name: string;
  slug?: string;
}

interface SmQuoteSide {
  price: number; // basis points 1..9999 -> decimal odds = 10000 / price
  quantity: number; // payout in 1/10000 of currency
}

interface SmQuote {
  bids?: SmQuoteSide[]; // user can LAY against bids
  offers?: SmQuoteSide[]; // user can BACK against offers
}

function splitTeams(name: string): [string, string] | null {
  for (const sep of [' vs ', ' v ', ' - ', ' @ ']) {
    const idx = name.indexOf(sep);
    if (idx > 0) {
      return [name.slice(0, idx).trim(), name.slice(idx + sep.length).trim()];
    }
  }
  return null;
}

function parseSmMarketType(
  sport: SportKey,
  mName: string,
  mTypeName: string
): { marketType: MarketType; marketLabel: string } | null {
  const low = `${mName} ${mTypeName}`.toLowerCase();
  if (sport === 'football') {
    if (low.includes('full-time result') || low.includes('winner') && !low.includes('half') && !low.includes('no bet')) {
      return { marketType: '1X2', marketLabel: 'Esito Finale 1X2' };
    }
    if (low.includes('over/under 2.5') || low.includes('total goals 2.5')) {
      return { marketType: 'OVER_UNDER_25', marketLabel: 'Under/Over 2.5 Gol' };
    }
    if (low.includes('both teams to score') && !low.includes('half')) {
      return { marketType: 'BTTS', marketLabel: 'Goal / NoGoal' };
    }
    return null;
  }
  if (low.includes('winner') && !low.includes('set') && !low.includes('quarter') && !low.includes('half')) {
    return { marketType: 'H2H', marketLabel: 'Testa a Testa' };
  }
  return null;
}

function mapContract(
  marketType: MarketType,
  cName: string,
  idx: number,
  home: string,
  away: string
): { key: string; label: string } | null {
  const low = cName.trim().toLowerCase();
  if (marketType === '1X2') {
    if (low === 'draw' || low === 'pareggio') return { key: 'DRAW', label: 'Pareggio (X)' };
    if (low === home.toLowerCase() || idx === 0) return { key: 'HOME', label: `${home} (1)` };
    return { key: 'AWAY', label: `${away} (2)` };
  }
  if (marketType === 'H2H') {
    if (low === home.toLowerCase() || idx === 0) return { key: 'HOME', label: `${home} (1)` };
    return { key: 'AWAY', label: `${away} (2)` };
  }
  if (marketType === 'OVER_UNDER_25') {
    if (low.includes('over')) return { key: 'OVER_25', label: 'Over 2.5' };
    if (low.includes('under')) return { key: 'UNDER_25', label: 'Under 2.5' };
    return null;
  }
  if (marketType === 'BTTS') {
    if (low === 'yes') return { key: 'BTTS_YES', label: 'Goal (Sì)' };
    if (low === 'no') return { key: 'BTTS_NO', label: 'NoGoal (No)' };
    return null;
  }
  return null;
}

function leagueFromSlug(slug: string | undefined, sport: SportKey): string {
  if (!slug) {
    return sport === 'football' ? 'Calcio' : sport === 'tennis' ? 'Tennis' : 'Basket';
  }
  const parts = slug.split('/').filter(Boolean);
  // e.g. /sport/football/italy-serie-a/2026/...
  if (parts.length >= 3) {
    return parts[2]
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return sport === 'football' ? 'Calcio' : sport === 'tennis' ? 'Tennis' : 'Basket';
}

const SM_SPORTS: Array<{ sport: SportKey; smType: string; limit: number }> = [
  { sport: 'football', smType: 'football_match', limit: 60 },
  { sport: 'tennis', smType: 'tennis_match', limit: 30 },
  { sport: 'basketball', smType: 'basketball_match', limit: 30 },
];

export async function scrapeSmarketsExchange(
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
  const dateWindow = filter?.dateWindow;
  const windowAfterMs = dateWindow
    ? includeLive
      ? dateWindow.startMs
      : Math.max(nowMs, dateWindow.startMs)
    : null;
  if (dateWindow && windowAfterMs !== null && windowAfterMs > dateWindow.endMs) {
    return { markets, latencyMs: Date.now() - started };
  }

  const stateParam = includeLive ? 'state=upcoming&state=live' : 'state=upcoming';
  let succeededSports = 0;
  let lastErr: unknown = null;

  const targetSports =
    filter?.sports && filter.sports.length > 0
      ? SM_SPORTS.filter((cfg) => filter.sports!.includes(cfg.sport))
      : SM_SPORTS;

  for (const cfg of targetSports) {
    throwIfAborted(signal);
    try {
      const sortParam = dateWindow ? 'display_order,start_datetime,id' : 'start_datetime,id';
      const dateQuery =
        dateWindow && windowAfterMs !== null
          ? `&start_datetime_min=${encodeURIComponent(
              new Date(windowAfterMs).toISOString()
            )}&start_datetime_max=${encodeURIComponent(new Date(dateWindow.endMs).toISOString())}`
          : '';
      const firstUrl = `${SM_BASE}/events/?${stateParam}&type=${cfg.smType}&limit=${cfg.limit}&sort=${sortParam}${dateQuery}`;
      const rawEvents: SmEvent[] = [];
      const seenEvIds = new Set<string>();
      const maxPages = dateWindow && cfg.sport === 'football' ? 2 : 1;
      let nextUrl: string | null = firstUrl;

      for (let page = 0; page < maxPages && nextUrl; page++) {
        throwIfAborted(signal);
        const pageUrl: string = nextUrl;
        const pageRes: {
          data: { events?: SmEvent[]; pagination?: { next_page?: string | null } };
          latencyMs: number;
        } = await fetchJson<{
          events?: SmEvent[];
          pagination?: { next_page?: string | null };
        }>(pageUrl, { timeoutMs: 12000, signal });
        const evResp = pageRes.data;
        for (const ev of evResp.events ?? []) {
          const eid = String(ev.id);
          if (!seenEvIds.has(eid)) {
            seenEvIds.add(eid);
            rawEvents.push(ev);
          }
        }
        const np: string | null | undefined = evResp.pagination?.next_page;
        if (np && page + 1 < maxPages) {
          nextUrl = np.startsWith('http')
            ? np
            : `${SM_BASE}/events/${np.startsWith('?') ? np : `?${np}`}`;
          await sleep(100, signal);
        } else {
          nextUrl = null;
        }
      }

      const events = rawEvents.filter((e) => {
        if (!e.start_datetime) return false;
        if (dateWindow && !matchesScrapeDateWindow(e.start_datetime, dateWindow)) return false;
        const teams = splitTeams(e.name);
        if (!teams) return false;
        if (
          filter?.eventHints?.length &&
          !matchesEventHints(e.name, teams[0], teams[1], cfg.sport, filter.eventHints)
        ) {
          return false;
        }
        return true;
      });
      if (events.length === 0) {
        succeededSports++;
        continue;
      }

      const eventById = new Map<string, SmEvent>();
      for (const e of events) eventById.set(String(e.id), e);

      // Fetch markets in chunks of 25 events
      const selectedMarkets: Array<{
        market: SmMarket;
        mapped: { marketType: MarketType; marketLabel: string };
      }> = [];

      for (let i = 0; i < events.length; i += 25) {
        throwIfAborted(signal);
        const chunkIds = events
          .slice(i, i + 25)
          .map((e) => e.id)
          .join(',');
        const { data: mResp } = await fetchJson<{ markets?: SmMarket[] }>(
          `${SM_BASE}/events/${chunkIds}/markets/?popular=true`,
          { timeoutMs: 12000, signal }
        );
        for (const m of mResp.markets ?? []) {
          if (m.state && m.state !== 'open') continue;
          const mapped = parseSmMarketType(cfg.sport, m.name ?? '', m.market_type?.name ?? '');
          if (mapped) selectedMarkets.push({ market: m, mapped });
        }
        if (i + 25 < events.length) await sleep(120, signal);
      }

      // Fetch contracts & quotes in chunks of 30 markets
      for (let i = 0; i < selectedMarkets.length; i += 30) {
        throwIfAborted(signal);
        const slice = selectedMarkets.slice(i, i + 30);
        const mIds = slice.map((s) => s.market.id).join(',');

        const [{ data: cResp }, { data: qResp }] = await Promise.all([
          fetchJson<{ contracts?: SmContract[] }>(`${SM_BASE}/markets/${mIds}/contracts/`, {
            timeoutMs: 12000,
            signal,
          }),
          fetchJson<Record<string, SmQuote>>(`${SM_BASE}/markets/${mIds}/quotes/`, {
            timeoutMs: 12000,
            signal,
          }),
        ]);

        const contractsByMarket = new Map<string, SmContract[]>();
        for (const c of cResp.contracts ?? []) {
          const arr = contractsByMarket.get(String(c.market_id)) ?? [];
          arr.push(c);
          contractsByMarket.set(String(c.market_id), arr);
        }

        for (const { market, mapped } of slice) {
          const ev = eventById.get(String(market.event_id));
          if (!ev) continue;
          const teams = splitTeams(ev.name);
          if (!teams) continue;
          const [homeTeam, awayTeam] = teams;

          const contracts = contractsByMarket.get(String(market.id)) ?? [];
          const selections: SelectionQuote[] = [];

          contracts.forEach((c, idx) => {
            const q = qResp[String(c.id)];
            if (!q) return;

            const bestBid = q.bids?.[0]; // User lays against bids
            const bestOffer = q.offers?.[0]; // User backs against offers

            const layOdds =
              bestBid && bestBid.price > 0
                ? Math.round((10000 / bestBid.price) * 100) / 100
                : undefined;
            const layLiquidity =
              bestBid && bestBid.price > 0
                ? Math.round(((bestBid.quantity / 10000) * (bestBid.price / 10000)) * 100) / 100
                : undefined;

            const backOdds =
              bestOffer && bestOffer.price > 0
                ? Math.round((10000 / bestOffer.price) * 100) / 100
                : undefined;
            const backLiquidity =
              bestOffer && bestOffer.price > 0
                ? Math.round(((bestOffer.quantity / 10000) * (bestOffer.price / 10000)) * 100) /
                  100
                : undefined;

            if (!layOdds && !backOdds) return;
            const cInfo = mapContract(mapped.marketType, c.name, idx, homeTeam, awayTeam);
            if (!cInfo) return;

            selections.push({
              canonicalKey: cInfo.key,
              label: cInfo.label,
              backOdds,
              backLiquidity,
              layOdds,
              layLiquidity,
            });
          });

          if (selections.length >= 2) {
            markets.push({
              sourceId: 'smarkets_exchange',
              sourceName: 'Smarkets Exchange',
              sourceKind: 'exchange',
              sport: cfg.sport,
              league: leagueFromSlug(ev.full_slug, cfg.sport),
              eventId: String(ev.id),
              eventName: `${homeTeam} - ${awayTeam}`,
              homeTeam,
              awayTeam,
              startTime: ev.start_datetime,
              marketType: mapped.marketType,
              marketLabel: mapped.marketLabel,
              selections,
              eventUrl: ev.full_slug
                ? `https://smarkets.com/event/${ev.id}${ev.full_slug}`
                : 'https://smarkets.com/',
              scrapedAt: Date.now(),
            });
          }
        }
        if (i + 30 < selectedMarkets.length) await sleep(120, signal);
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

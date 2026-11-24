import { matchesScrapeDateWindow } from '../../src/shared/dateRange';
import type {
  MarketType,
  RawScrapedMarket,
  SelectionQuote,
  SportKey,
  TargetedScrapeFilter,
} from '../../src/shared/types';
import {
  appendCacheBuster,
  computeEffectiveScrapedAt,
  fetchText,
  fetchTextWithMeta,
  isAbortError,
  sleep,
  throwIfAborted,
} from './httpClient';
import { decompressFromBase64 } from './lzString';
import { matchesEventHints } from './matchLinker';

const MST_DATA_BASE = 'https://fe.mstxchange.com/data';
const MST_HEADERS: Record<string, string> = {
  Referer: 'https://fe.mstxchange.com/default.aspx?cID=62E01EFF-FD52-4D36-84C1-FF1EF0D413DD',
};

interface MstMenuEvent {
  m: string; // match_id
  da: string; // "Parma - Roma"
  dt: string; // "2026-11-21T18:00:00" (Europe/Rome local time)
  lv?: string; // "1" = live / inplay available, check startTime for prematch
  t?: string;
}

interface MstMenuComp {
  cm?: string;
  dm?: string;
  a?: MstMenuEvent | MstMenuEvent[];
}

interface MstMenuNation {
  dn?: string;
  m?: MstMenuComp | MstMenuComp[];
}

interface MstMenuSport {
  cs: string; // "1" Calcio, "2" Basket, "3" Tennis
  ds: string;
  n?: MstMenuNation | MstMenuNation[];
}

interface MstHomePayload {
  data?: {
    menu?: { d?: MstMenuSport[] };
    top?: { abbinate?: { rg?: Array<{ match_id?: string }> } };
    next?: { dis?: Array<{ avv?: Array<{ mi?: string }> }> };
    evidence?: { dis?: Array<{ avv?: Array<{ mi?: string }> }> };
  };
}

interface MstOfferLevel {
  p?: string; // "1" = top of book
  q?: string; // odds * 100 (e.g. "127" -> 1.27)
  i?: string; // liquidity in euro cents (e.g. "529500" -> €5295.00)
}

interface MstOfferRunner {
  c: string;
  d: string;
  off?: MstOfferLevel | MstOfferLevel[];
}

interface MstMarketData {
  data?: {
    idmatch?: string;
    idmarket?: string;
    cod?: string;
    sco?: {
      cod?: string;
      iad?: string;
      des?: string;
      data?: string;
    };
    offerte?: {
      stato_sogei?: string;
      stato_betflag?: string;
      punta?: { esi?: MstOfferRunner | MstOfferRunner[] }; // Existing Back orders -> User can LAY!
      banca?: { esi?: MstOfferRunner | MstOfferRunner[] }; // Existing Lay orders -> User can BACK!
    };
  };
}

function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

/**
 * Converts an Italy local ISO string ("2026-11-21T18:00:00") accurately to UTC ISO
 * honoring Europe/Rome CET (+1) and CEST (+2) daylight saving transitions.
 */
function romeLocalToUtcIso(dtStr: string): string {
  const m = dtStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(dtStr).toISOString();
  const [, y, mo, d, h, mi, s = '00'] = m;
  const guessUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  // Determine Europe/Rome offset at guessUtc
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(guessUtc));
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  const asUtcInRome = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour === 24 ? 0 : map.hour,
    map.minute,
    map.second
  );
  const offsetMs = asUtcInRome - guessUtc;
  return new Date(guessUtc - offsetMs).toISOString();
}

function splitTeams(da: string): [string, string] | null {
  for (const sep of [' - ', ' vs ', ' v ']) {
    const idx = da.indexOf(sep);
    if (idx > 0) {
      return [da.slice(0, idx).trim(), da.slice(idx + sep.length).trim()];
    }
  }
  return null;
}

function topOffer(
  off: MstOfferLevel | MstOfferLevel[] | undefined,
  side: 'lay' | 'back'
): { odds: number; liq: number } | null {
  const levels = asArray(off)
    .map((l) => ({
      p: l.p,
      q: Number(l.q),
      i: Number(l.i),
    }))
    .filter((l) => Number.isFinite(l.q) && l.q > 100 && Number.isFinite(l.i) && l.i > 0);
  if (levels.length === 0) return null;
  const p1 = levels.find((l) => l.p === '1');
  const best =
    p1 ??
    levels.reduce((acc, cur) =>
      side === 'lay' ? (cur.q < acc.q ? cur : acc) : cur.q > acc.q ? cur : acc
    );
  return {
    odds: Math.round(best.q) / 100,
    liq: Math.round(best.i) / 100,
  };
}

function mapBetflagMarket(
  sport: SportKey,
  cod: string,
  des: string,
  iad: string
): { marketType: MarketType; marketLabel: string } | null {
  if (sport === 'football') {
    if (cod === '3' || /esito finale 1x2/i.test(des)) {
      return { marketType: '1X2', marketLabel: 'Esito Finale 1X2' };
    }
    if (cod === '18' || /goal\s*\/\s*no\s*goal/i.test(des)) {
      return { marketType: 'BTTS', marketLabel: 'Goal / NoGoal' };
    }
    if ((cod === '7989' || /under and over/i.test(des)) && iad.trim() === '2.5') {
      return { marketType: 'OVER_UNDER_25', marketLabel: 'Under/Over 2.5 Gol' };
    }
    return null;
  }

  if (cod === '20540' || cod === '110' || /testa a testa/i.test(des)) {
    return { marketType: 'H2H', marketLabel: 'Testa a Testa' };
  }
  return null;
}

function mapBetflagSelection(
  marketType: MarketType,
  des: string,
  home: string,
  away: string
): { key: string; label: string } | null {
  const up = des.trim().toUpperCase();
  if (marketType === '1X2') {
    if (up === '1') return { key: 'HOME', label: `${home} (1)` };
    if (up === 'X') return { key: 'DRAW', label: 'Pareggio (X)' };
    if (up === '2') return { key: 'AWAY', label: `${away} (2)` };
    return null;
  }
  if (marketType === 'H2H') {
    if (up === '1') return { key: 'HOME', label: `${home} (1)` };
    if (up === '2') return { key: 'AWAY', label: `${away} (2)` };
    return null;
  }
  if (marketType === 'OVER_UNDER_25') {
    if (up === 'OVER') return { key: 'OVER_25', label: 'Over 2.5' };
    if (up === 'UNDER') return { key: 'UNDER_25', label: 'Under 2.5' };
    return null;
  }
  if (marketType === 'BTTS') {
    if (up === 'GOAL' || up === 'SI' || up === 'SÌ') return { key: 'BTTS_YES', label: 'Goal (Sì)' };
    if (up === 'NOGOAL' || up === 'NO GOAL' || up === 'NO')
      return { key: 'BTTS_NO', label: 'NoGoal (No)' };
    return null;
  }
  return null;
}

interface CandidateMatch {
  matchId: string;
  sport: SportKey;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  startMs: number;
  priority: number;
}

let cachedHomePayload: MstHomePayload | null = null;
let cachedHomeAt = 0;
const HOME_CACHE_TTL_MS = 90_000;

async function fetchBetflagHome(
  allowCache: boolean,
  signal?: AbortSignal
): Promise<MstHomePayload> {
  throwIfAborted(signal);
  if (allowCache && cachedHomePayload && Date.now() - cachedHomeAt < HOME_CACHE_TTL_MS) {
    return cachedHomePayload;
  }
  const homeRaw = (
    await fetchText(appendCacheBuster(`${MST_DATA_BASE}/home`), {
      headers: MST_HEADERS,
      noCacheHeaders: true,
      timeoutMs: 12000,
      signal,
    })
  )
    .trim()
    .replace(/^"|"$/g, '');
  const homeJson = decompressFromBase64(homeRaw);
  if (!homeJson) {
    throw new Error('Risposta LZString Betflag Exchange non valida');
  }
  const parsed = JSON.parse(homeJson) as MstHomePayload;
  cachedHomePayload = parsed;
  cachedHomeAt = Date.now();
  return parsed;
}

export async function scrapeBetflagExchange(
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

  const home = await fetchBetflagHome(Boolean(filter), signal);

  // Priority boost for top traded / featured / next matches
  const hotIds = new Set<string>();
  for (const r of asArray(home.data?.top?.abbinate?.rg)) {
    if (r.match_id) hotIds.add(String(r.match_id));
  }
  for (const dis of asArray(home.data?.next?.dis)) {
    for (const a of asArray(dis.avv)) if (a.mi) hotIds.add(String(a.mi));
  }
  for (const dis of asArray(home.data?.evidence?.dis)) {
    for (const a of asArray(dis.avv)) if (a.mi) hotIds.add(String(a.mi));
  }

  const sportCodeMap: Record<string, SportKey> = {
    '1': 'football',
    '2': 'basketball',
    '3': 'tennis',
  };

  const topLeagueRe =
    /Serie A|Serie B|Premier League|LaLiga|Liga|Bundesliga|Ligue 1|Champions|Europa|ATP|WTA|NBA|Eurolega/i;

  const candidates: CandidateMatch[] = [];
  const seenMatchIds = new Set<string>();

  for (const sp of asArray(home.data?.menu?.d)) {
    const sport = sportCodeMap[String(sp.cs)];
    if (!sport) continue;
    if (filter?.sports && filter.sports.length > 0 && !filter.sports.includes(sport)) continue;

    for (const nat of asArray(sp.n)) {
      const natName = (nat.dn ?? '').trim();
      for (const comp of asArray(nat.m)) {
        const compName = (comp.dm ?? '').trim();
        const league = natName && compName ? `${natName} - ${compName}` : compName || natName || sp.ds;

        for (const ev of asArray(comp.a)) {
          if (!ev.m || !ev.da || !ev.dt) continue;
          const matchId = String(ev.m);
          if (seenMatchIds.has(matchId)) continue;

          const teams = splitTeams(ev.da);
          if (!teams) continue;

          if (
            filter?.eventHints?.length &&
            !matchesEventHints(`${teams[0]} - ${teams[1]}`, teams[0], teams[1], sport, filter.eventHints)
          ) {
            continue;
          }

          const startTime = romeLocalToUtcIso(ev.dt);
          const startMs = new Date(startTime).getTime();
          if (!Number.isFinite(startMs)) continue;

          // Filter out started matches unless includeLive is true
          if (!includeLive && startMs < nowMs - 60_000) continue;
          if (filter?.dateWindow) {
            // Honor the requested future date window without the default 5-day horizon cap
            if (!matchesScrapeDateWindow(startMs, filter.dateWindow)) continue;
          } else {
            // Limit default near-term horizon to next 5 days for high relevance
            if (startMs > nowMs + 5 * 24 * 3600_000) continue;
          }

          seenMatchIds.add(matchId);
          let priority = 0;
          if (hotIds.has(matchId)) priority += 100;
          if (topLeagueRe.test(league)) priority += 50;
          if (sport === 'football') priority += 10;

          candidates.push({
            matchId,
            sport,
            league,
            homeTeam: teams[0],
            awayTeam: teams[1],
            startTime,
            startMs,
            priority,
          });
        }
      }
    }
  }

  // Sort by priority desc, then earliest kickoff asc; fetch top 85 matches with polite concurrency
  candidates.sort((a, b) => b.priority - a.priority || a.startMs - b.startMs);
  const targets = candidates.slice(0, 85);

  const CONCURRENCY = 5;
  let cursor = 0;

  const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
    while (cursor < targets.length) {
      throwIfAborted(signal);
      const ev = targets[cursor++];
      try {
        await sleep(35, signal);
        const { text: rawText, cacheAgeSec } = await fetchTextWithMeta(
          appendCacheBuster(`${MST_DATA_BASE}/colloddsbetsevent/${ev.matchId}`),
          {
            headers: MST_HEADERS,
            noCacheHeaders: true,
            timeoutMs: 9000,
            signal,
          }
        );
        const list = JSON.parse(rawText) as Array<{ e?: string }>;
        if (!Array.isArray(list)) continue;
        const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);

        for (const item of list) {
          if (!item?.e) continue;
          const jsonStr = decompressFromBase64(item.e);
          if (!jsonStr) continue;
          const parsed = JSON.parse(jsonStr) as MstMarketData;
          const d = parsed.data;
          if (!d?.offerte || !d.sco) continue;

          // Accept only open markets (stato_sogei === "2" && stato_betflag === "2")
          if (d.offerte.stato_sogei && d.offerte.stato_sogei !== '2') continue;
          if (d.offerte.stato_betflag && d.offerte.stato_betflag !== '2') continue;

          const mapped = mapBetflagMarket(
            ev.sport,
            String(d.sco.cod ?? d.cod ?? ''),
            d.sco.des ?? '',
            d.sco.iad ?? ''
          );
          if (!mapped) continue;

          // IMPORTANT: On MSTExchange order book:
          // - offerte.punta = existing Back orders on book => User can LAY against them!
          // - offerte.banca = existing Lay orders on book => User can BACK against them!
          const layMap = new Map<string, { odds: number; liq: number }>();
          for (const rn of asArray(d.offerte.punta?.esi)) {
            const top = topOffer(rn.off, 'lay');
            if (top) layMap.set(rn.d.trim().toUpperCase(), top);
          }

          const backMap = new Map<string, { odds: number; liq: number }>();
          for (const rn of asArray(d.offerte.banca?.esi)) {
            const top = topOffer(rn.off, 'back');
            if (top) backMap.set(rn.d.trim().toUpperCase(), top);
          }

          const allDes = new Set([...layMap.keys(), ...backMap.keys()]);
          const selections: SelectionQuote[] = [];

          for (const desKey of allDes) {
            const selInfo = mapBetflagSelection(mapped.marketType, desKey, ev.homeTeam, ev.awayTeam);
            if (!selInfo) continue;
            const lay = layMap.get(desKey);
            const back = backMap.get(desKey);
            if (!lay && !back) continue;

            selections.push({
              canonicalKey: selInfo.key,
              label: selInfo.label,
              backOdds: back?.odds,
              backLiquidity: back?.liq,
              layOdds: lay?.odds,
              layLiquidity: lay?.liq,
            });
          }

          if (selections.length >= 2) {
            markets.push({
              sourceId: 'betflag_exchange',
              sourceName: 'Betflag Exchange IT',
              sourceKind: 'exchange',
              sport: ev.sport,
              league: ev.league,
              eventId: ev.matchId,
              sourceMarketId: d.idmarket ? String(d.idmarket) : undefined,
              eventName: `${ev.homeTeam} - ${ev.awayTeam}`,
              homeTeam: ev.homeTeam,
              awayTeam: ev.awayTeam,
              startTime: ev.startTime,
              marketType: mapped.marketType,
              marketLabel: mapped.marketLabel,
              selections,
              eventUrl: `https://www.betflag.it/exchange`,
              scrapedAt,
              cacheAgeSec,
            });
          }
        }
      } catch (err) {
        if (signal?.aborted || isAbortError(err)) throw err;
        // Ignore single event fetch timeout
      }
    }
  });

  await Promise.all(workers);

  return { markets, latencyMs: Date.now() - started };
}

/**
 * Single-event live verification for Betflag Exchange IT (~150-300ms).
 */
export async function verifyBetflagExchangeEvent(params: {
  matchId: string;
  sport: SportKey;
  marketType: MarketType;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  signal?: AbortSignal;
}): Promise<{
  market: RawScrapedMarket | null;
  latencyMs: number;
  cacheAgeSec: number;
}> {
  const started = Date.now();
  const { text: rawText, cacheAgeSec } = await fetchTextWithMeta(
    appendCacheBuster(`${MST_DATA_BASE}/colloddsbetsevent/${encodeURIComponent(params.matchId)}`),
    {
      headers: MST_HEADERS,
      noCacheHeaders: true,
      timeoutMs: 7000,
      signal: params.signal,
    }
  );
  const list = JSON.parse(rawText) as Array<{ e?: string }>;
  if (!Array.isArray(list)) {
    return { market: null, latencyMs: Date.now() - started, cacheAgeSec };
  }

  const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);
  for (const item of list) {
    if (!item?.e) continue;
    const jsonStr = decompressFromBase64(item.e);
    if (!jsonStr) continue;
    const parsed = JSON.parse(jsonStr) as MstMarketData;
    const d = parsed.data;
    if (!d?.offerte || !d.sco) continue;
    if (d.offerte.stato_sogei && d.offerte.stato_sogei !== '2') continue;
    if (d.offerte.stato_betflag && d.offerte.stato_betflag !== '2') continue;

    const mapped = mapBetflagMarket(
      params.sport,
      String(d.sco.cod ?? d.cod ?? ''),
      d.sco.des ?? '',
      d.sco.iad ?? ''
    );
    if (!mapped || mapped.marketType !== params.marketType) continue;

    const layMap = new Map<string, { odds: number; liq: number }>();
    for (const rn of asArray(d.offerte.punta?.esi)) {
      const top = topOffer(rn.off, 'lay');
      if (top) layMap.set(rn.d.trim().toUpperCase(), top);
    }
    const backMap = new Map<string, { odds: number; liq: number }>();
    for (const rn of asArray(d.offerte.banca?.esi)) {
      const top = topOffer(rn.off, 'back');
      if (top) backMap.set(rn.d.trim().toUpperCase(), top);
    }

    const allDes = new Set([...layMap.keys(), ...backMap.keys()]);
    const selections: SelectionQuote[] = [];
    for (const desKey of allDes) {
      const selInfo = mapBetflagSelection(
        mapped.marketType,
        desKey,
        params.homeTeam,
        params.awayTeam
      );
      if (!selInfo) continue;
      const lay = layMap.get(desKey);
      const back = backMap.get(desKey);
      if (!lay && !back) continue;
      selections.push({
        canonicalKey: selInfo.key,
        label: selInfo.label,
        backOdds: back?.odds,
        backLiquidity: back?.liq,
        layOdds: lay?.odds,
        layLiquidity: lay?.liq,
      });
    }

    if (selections.length >= 2) {
      return {
        market: {
          sourceId: 'betflag_exchange',
          sourceName: 'Betflag Exchange IT',
          sourceKind: 'exchange',
          sport: params.sport,
          league: '',
          eventId: params.matchId,
          sourceMarketId: d.idmarket ? String(d.idmarket) : undefined,
          eventName: `${params.homeTeam} - ${params.awayTeam}`,
          homeTeam: params.homeTeam,
          awayTeam: params.awayTeam,
          startTime: params.startTime,
          marketType: mapped.marketType,
          marketLabel: mapped.marketLabel,
          selections,
          eventUrl: 'https://www.betflag.it/exchange',
          scrapedAt,
          cacheAgeSec,
        },
        latencyMs: Date.now() - started,
        cacheAgeSec,
      };
    }
  }

  return { market: null, latencyMs: Date.now() - started, cacheAgeSec };
}

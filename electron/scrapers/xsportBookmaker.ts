import {
  addDays,
  getDirettaDayOffsetsForWindow,
  matchesScrapeDateWindow,
} from '../../src/shared/dateRange';
import type {
  MarketType,
  RawScrapedMarket,
  SelectionQuote,
  SourceId,
  SportKey,
  TargetedScrapeFilter,
} from '../../src/shared/types';
import {
  appendCacheBuster,
  computeEffectiveScrapedAt,
  fetchJson,
  isAbortError,
  sleep,
  throwIfAborted,
} from './httpClient';
import { matchesEventHints } from './matchLinker';

export interface XSportBrandSpec {
  sourceId: SourceId;
  sourceName: string;
  domain: string;
  siteUrl: string;
  systemCode: string;
  supportsGetEvento: boolean;
}

export const XSPORT_BRANDS: Record<string, XSportBrandSpec> = {
  netbet_it: {
    sourceId: 'netbet_it',
    sourceName: 'NetBet.it',
    domain: 'https://scommesse1.netbet.it',
    siteUrl: 'https://www.netbet.it/scommesse/',
    systemCode: 'NETBET',
    supportsGetEvento: false,
  },
  stanleybet_it: {
    sourceId: 'stanleybet_it',
    sourceName: 'Stanleybet.it',
    domain: 'https://www.stanleybet.it',
    siteUrl: 'https://www.stanleybet.it/sport',
    systemCode: 'STANLEYBET',
    supportsGetEvento: true,
  },
};

const XSPORT_SPORTS: Array<{ sport: SportKey; idSport: number; idAggregata: number }> = [
  { sport: 'football', idSport: 1, idAggregata: 319 },
  { sport: 'basketball', idSport: 2, idAggregata: 377 },
  { sport: 'tennis', idSport: 5, idAggregata: 320 },
];

interface XSportEsito {
  ce?: number;
  q?: number; // decimal * 100
}

interface XSportScommessa {
  cs?: number;
  h?: number;
  hs?: string;
  d?: string;
  hid?: boolean;
  eqs?: XSportEsito[];
}

interface XSportAvvenimento {
  p?: number; // codicePalinsesto
  a?: number; // codiceAvvenimento
  dsl?: { IT?: string; ORIGINAL_FROM_DB?: string };
  ts?: string; // "YYYYMMDD HH:mm:ss" in Europe/Rome local time
  lv?: boolean;
  ant?: boolean;
  it?: number; // tournament id
  scs?: XSportScommessa[];
}

interface XSportPalinsestoResp {
  avs?: Record<string, XSportAvvenimento[]>;
  dts?: Record<string, string>;
}

interface XSportEventoResp {
  p?: number;
  a?: number;
  ts?: string;
  lv?: boolean;
  scs?: XSportScommessa[];
}

const ROME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Rome',
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * Converts Exalogic XSport timestamps ("YYYYMMDD HH:mm:ss", always Europe/Rome local time)
 * to exact UTC ISO 8601 strings, handling CET (+1) and CEST (+2) transitions accurately.
 */
export function parseRomeWallClockToIso(rawTs: string | undefined): string | null {
  if (!rawTs) return null;
  const m = rawTs.trim().match(/^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? '0');

  // Initial guess: treat wall clock as UTC, then measure how far ahead Europe/Rome is
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const computeOffsetMs = (probeMs: number): number => {
    const parts = ROME_FMT.formatToParts(new Date(probeMs));
    const map: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = Number(p.value);
    }
    const h = map.hour === 24 ? 0 : map.hour;
    const romeAsUtc = Date.UTC(map.year, map.month - 1, map.day, h, map.minute, map.second);
    return romeAsUtc - probeMs;
  };

  const off1 = computeOffsetMs(naiveUtcMs);
  let actualUtcMs = naiveUtcMs - off1;
  const off2 = computeOffsetMs(actualUtcMs);
  if (off2 !== off1) {
    actualUtcMs = naiveUtcMs - off2;
  }

  return new Date(actualUtcMs).toISOString();
}

function toYyyymmdd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function parseXSportOdd(q: number | undefined): number | null {
  if (typeof q !== 'number' || !Number.isFinite(q) || q <= 100 || q > 50000) return null;
  const dec = Math.round(q) / 100;
  return dec > 1.005 ? dec : null;
}

function splitXSportTeams(rawName: string | undefined): [string, string] | null {
  if (!rawName) return null;
  const normalized = rawName.replace(/\s+/g, ' ').trim();
  // Reject promotional date-suffixed specials like "Sporting Lisbona 25/11 - Fc Shaktar Donetsk 25/11"
  if (/\d{2}\/\d{2}\s*-|\d{2}\/\d{2}$/.test(normalized)) return null;
  const sepIdx = normalized.indexOf(' - ');
  if (sepIdx <= 0) return null;
  const home = normalized.slice(0, sepIdx).trim();
  const away = normalized.slice(sepIdx + 3).trim();
  if (!home || !away) return null;
  return [home, away];
}

function extractXSportMarkets(params: {
  spec: XSportBrandSpec;
  sport: SportKey;
  idSport: number;
  idAggregata: number;
  dateKey: string;
  league: string;
  pal: number;
  avv: number;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  scs: XSportScommessa[];
  scrapedAt: number;
  cacheAgeSec: number;
}): RawScrapedMarket[] {
  const {
    spec,
    sport,
    idSport,
    idAggregata,
    dateKey,
    league,
    pal,
    avv,
    homeTeam,
    awayTeam,
    startTime,
    scs,
    scrapedAt,
    cacheAgeSec,
  } = params;

  const out: RawScrapedMarket[] = [];
  const seen = new Set<MarketType>();
  const eventId = `${pal}-${avv}`;
  const sourceMetadata: Record<string, string> = {
    pal: String(pal),
    avv: String(avv),
    dateKey,
    idSport: String(idSport),
    idAggregata: String(idAggregata),
  };

  for (const sc of scs) {
    if (sc.hid) continue;
    const eqs = (sc.eqs ?? []).filter((e) => parseXSportOdd(e.q) !== null);
    if (eqs.length < 2) continue;

    // 1. Football 1X2 (cs === 3)
    if (sport === 'football' && sc.cs === 3 && !seen.has('1X2')) {
      const sels: SelectionQuote[] = [];
      for (const e of eqs) {
        const dec = parseXSportOdd(e.q)!;
        if (e.ce === 1) sels.push({ canonicalKey: 'HOME', label: `${homeTeam} (1)`, backOdds: dec });
        else if (e.ce === 2) sels.push({ canonicalKey: 'DRAW', label: 'Pareggio (X)', backOdds: dec });
        else if (e.ce === 3) sels.push({ canonicalKey: 'AWAY', label: `${awayTeam} (2)`, backOdds: dec });
      }
      if (sels.length === 3) {
        seen.add('1X2');
        out.push({
          sourceId: spec.sourceId,
          sourceName: spec.sourceName,
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId,
          sourceMetadata,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime,
          marketType: '1X2',
          marketLabel: 'Esito Finale 1X2',
          selections: sels,
          eventUrl: spec.siteUrl,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 2. Football Over/Under 2.5 (cs === 7989, h === 250; ADM standard: ce=1 UNDER, ce=2 OVER)
    if (
      sport === 'football' &&
      sc.cs === 7989 &&
      (sc.h === 250 || sc.hs === '250') &&
      !seen.has('OVER_UNDER_25')
    ) {
      const sels: SelectionQuote[] = [];
      for (const e of eqs) {
        const dec = parseXSportOdd(e.q)!;
        if (e.ce === 1) sels.push({ canonicalKey: 'UNDER_25', label: 'Under 2.5', backOdds: dec });
        else if (e.ce === 2) sels.push({ canonicalKey: 'OVER_25', label: 'Over 2.5', backOdds: dec });
      }
      if (sels.length === 2) {
        seen.add('OVER_UNDER_25');
        out.push({
          sourceId: spec.sourceId,
          sourceName: spec.sourceName,
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId,
          sourceMetadata,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime,
          marketType: 'OVER_UNDER_25',
          marketLabel: 'Under/Over 2.5 Gol',
          selections: sels,
          eventUrl: spec.siteUrl,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 3. Football BTTS (cs === 18; ADM standard: ce=1 GOAL, ce=2 NOGOAL)
    if (sport === 'football' && sc.cs === 18 && !seen.has('BTTS')) {
      const sels: SelectionQuote[] = [];
      for (const e of eqs) {
        const dec = parseXSportOdd(e.q)!;
        if (e.ce === 1) sels.push({ canonicalKey: 'BTTS_YES', label: 'Goal (Sì)', backOdds: dec });
        else if (e.ce === 2) sels.push({ canonicalKey: 'BTTS_NO', label: 'NoGoal (No)', backOdds: dec });
      }
      if (sels.length === 2) {
        seen.add('BTTS');
        out.push({
          sourceId: spec.sourceId,
          sourceName: spec.sourceName,
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId,
          sourceMetadata,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime,
          marketType: 'BTTS',
          marketLabel: 'Goal / NoGoal',
          selections: sels,
          eventUrl: spec.siteUrl,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 4. Basketball H2H (cs === 110: T/T incl. OT, never handicap cs=26 or 1X2 cs=8291)
    if (sport === 'basketball' && sc.cs === 110 && (sc.h ?? 0) === 0 && !seen.has('H2H')) {
      const sels: SelectionQuote[] = [];
      for (const e of eqs) {
        const dec = parseXSportOdd(e.q)!;
        if (e.ce === 1) sels.push({ canonicalKey: 'HOME', label: `${homeTeam} (1)`, backOdds: dec });
        else if (e.ce === 2) sels.push({ canonicalKey: 'AWAY', label: `${awayTeam} (2)`, backOdds: dec });
      }
      if (sels.length === 2) {
        seen.add('H2H');
        out.push({
          sourceId: spec.sourceId,
          sourceName: spec.sourceName,
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId,
          sourceMetadata,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime,
          marketType: 'H2H',
          marketLabel: 'Testa a Testa',
          selections: sels,
          eventUrl: spec.siteUrl,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 5. Tennis H2H (cs === 20540 or cs === 110: T/T match)
    if (
      sport === 'tennis' &&
      (sc.cs === 20540 || sc.cs === 110) &&
      (sc.h ?? 0) === 0 &&
      !seen.has('H2H')
    ) {
      const sels: SelectionQuote[] = [];
      for (const e of eqs) {
        const dec = parseXSportOdd(e.q)!;
        if (e.ce === 1) sels.push({ canonicalKey: 'HOME', label: `${homeTeam} (1)`, backOdds: dec });
        else if (e.ce === 2) sels.push({ canonicalKey: 'AWAY', label: `${awayTeam} (2)`, backOdds: dec });
      }
      if (sels.length === 2) {
        seen.add('H2H');
        out.push({
          sourceId: spec.sourceId,
          sourceName: spec.sourceName,
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId,
          sourceMetadata,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime,
          marketType: 'H2H',
          marketLabel: 'Testa a Testa',
          selections: sels,
          eventUrl: spec.siteUrl,
          scrapedAt,
          cacheAgeSec,
        });
      }
    }
  }

  return out;
}

export async function scrapeXSportBrand(
  spec: XSportBrandSpec,
  includeLive: boolean,
  filter?: TargetedScrapeFilter,
  signal?: AbortSignal
): Promise<{ markets: RawScrapedMarket[]; latencyMs: number }> {
  const started = Date.now();
  const nowMs = Date.now();
  const markets: RawScrapedMarket[] = [];
  const seenEventMarket = new Set<string>();
  let succeededCalls = 0;
  let lastErr: unknown = null;

  const dayOffsets = getDirettaDayOffsetsForWindow(filter?.dateWindow, nowMs, 7);
  if (dayOffsets.length === 0) {
    return { markets, latencyMs: Date.now() - started };
  }

  const targetSports =
    filter?.sports && filter.sports.length > 0
      ? XSPORT_SPORTS.filter((s) => filter.sports!.includes(s.sport))
      : XSPORT_SPORTS;

  const headers: Record<string, string> = {
    Origin: spec.domain,
    Referer: `${spec.domain}/`,
  };

  const today = new Date(nowMs);
  const jobs: Array<{ sportCfg: (typeof XSPORT_SPORTS)[number]; dateKey: string }> = [];
  for (const sportCfg of targetSports) {
    for (const off of dayOffsets) {
      jobs.push({ sportCfg, dateKey: toYyyymmdd(addDays(today, off)) });
    }
  }

  for (let i = 0; i < jobs.length; i++) {
    throwIfAborted(signal);
    const { sportCfg, dateKey } = jobs[i];
    const url = appendCacheBuster(
      `${spec.domain}/XSportDatastore/getPalinsestoDelGiorno?systemCode=${encodeURIComponent(
        spec.systemCode
      )}&lingua=IT&hash=&data=${dateKey}&idSport=${sportCfg.idSport}&idAggregata=${
        sportCfg.idAggregata
      }&timezone=0`
    );

    try {
      const { data, cacheAgeSec } = await fetchJson<XSportPalinsestoResp>(url, {
        headers,
        noCacheHeaders: true,
        timeoutMs: 11000,
        retries: 1,
        signal,
      });
      succeededCalls++;
      const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);
      const dts = data.dts ?? {};
      const avsList = Object.values(data.avs ?? {}).flat();

      for (const av of avsList) {
        if (!av || av.ant || !av.p || !av.a) continue;
        if (!includeLive && av.lv) continue;

        const leagueRaw = av.it !== undefined ? dts[`IT_${av.it}`] : undefined;
        const league = (
          leagueRaw ??
          (sportCfg.sport === 'football'
            ? 'Calcio'
            : sportCfg.sport === 'tennis'
            ? 'Tennis'
            : 'Basket')
        )
          .replace(/\s+/g, ' ')
          .trim();

        if (/super\s*quote|alta\s*quota|scommesse\s*speciali|maggiorat/i.test(league)) continue;

        const teams = splitXSportTeams(av.dsl?.IT ?? av.dsl?.ORIGINAL_FROM_DB);
        if (!teams) continue;
        const [homeTeam, awayTeam] = teams;

        const startTime = parseRomeWallClockToIso(av.ts);
        if (!startTime) continue;
        const startMs = Date.parse(startTime);
        if (!includeLive && startMs < nowMs - 60_000) continue;
        if (filter?.dateWindow && !matchesScrapeDateWindow(startMs, filter.dateWindow)) continue;

        if (
          filter?.eventHints?.length &&
          !matchesEventHints(`${homeTeam} - ${awayTeam}`, homeTeam, awayTeam, sportCfg.sport, filter.eventHints)
        ) {
          continue;
        }

        const extracted = extractXSportMarkets({
          spec,
          sport: sportCfg.sport,
          idSport: sportCfg.idSport,
          idAggregata: sportCfg.idAggregata,
          dateKey,
          league,
          pal: av.p,
          avv: av.a,
          homeTeam,
          awayTeam,
          startTime,
          scs: av.scs ?? [],
          scrapedAt,
          cacheAgeSec,
        });

        for (const m of extracted) {
          const dk = `${m.eventId}|${m.marketType}`;
          if (!seenEventMarket.has(dk)) {
            seenEventMarket.add(dk);
            markets.push(m);
          }
        }
      }
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      lastErr = err;
    }

    if (i < jobs.length - 1) {
      await sleep(90, signal);
    }
  }

  if (succeededCalls === 0 && lastErr) {
    throw lastErr;
  }

  return { markets, latencyMs: Date.now() - started };
}

/**
 * Fast (~75-150ms) single-event live verification on Exalogic XSportDatastore
 * (direct `getEvento` on Stanleybet, clean daily `getPalinsestoDelGiorno` fallback on NetBet).
 */
export async function verifyXSportEvent(params: {
  spec: XSportBrandSpec;
  eventId: string;
  sport: SportKey;
  marketType: MarketType;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  includeLive: boolean;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<{
  market: RawScrapedMarket | null;
  latencyMs: number;
  cacheAgeSec: number;
}> {
  const started = Date.now();
  const [palStr, avvStr] = params.eventId.split('-');
  const pal = Number(params.metadata?.pal ?? palStr);
  const avv = Number(params.metadata?.avv ?? avvStr);
  const spCfg = XSPORT_SPORTS.find((s) => s.sport === params.sport);
  if (!Number.isFinite(pal) || !Number.isFinite(avv) || !spCfg) {
    return { market: null, latencyMs: 0, cacheAgeSec: 0 };
  }

  const idSport = Number(params.metadata?.idSport ?? spCfg.idSport);
  const idAggregata = Number(params.metadata?.idAggregata ?? spCfg.idAggregata);
  const dateKey =
    params.metadata?.dateKey ??
    toYyyymmdd(new Date(Date.parse(params.startTime) || Date.now()));
  const headers: Record<string, string> = {
    Origin: params.spec.domain,
    Referer: `${params.spec.domain}/`,
  };

  // 1. Direct single-event endpoint when supported (Stanleybet: ~75ms)
  if (params.spec.supportsGetEvento) {
    try {
      const evUrl = appendCacheBuster(
        `${params.spec.domain}/XSportDatastore/getEvento?systemCode=${encodeURIComponent(
          params.spec.systemCode
        )}&lingua=IT&hash=&pal=${pal}&avv=${avv}&idAggregata=${idAggregata}&isLive=false`
      );
      const { data, cacheAgeSec } = await fetchJson<XSportEventoResp>(evUrl, {
        headers,
        noCacheHeaders: true,
        timeoutMs: 7000,
        retries: 0,
        signal: params.signal,
      });
      if (!params.includeLive && data.lv) {
        return { market: null, latencyMs: Date.now() - started, cacheAgeSec };
      }
      const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);
      const extracted = extractXSportMarkets({
        spec: params.spec,
        sport: params.sport,
        idSport,
        idAggregata,
        dateKey,
        league: '',
        pal,
        avv,
        homeTeam: params.homeTeam,
        awayTeam: params.awayTeam,
        startTime: parseRomeWallClockToIso(data.ts) ?? params.startTime,
        scs: data.scs ?? [],
        scrapedAt,
        cacheAgeSec,
      });
      return {
        market: extracted.find((m) => m.marketType === params.marketType) ?? null,
        latencyMs: Date.now() - started,
        cacheAgeSec,
      };
    } catch (err) {
      if (params.signal?.aborted || isAbortError(err)) throw err;
      // Fall through to daily palinsesto lookup
    }
  }

  // 2. Daily palinsesto lookup (primary for NetBet, fallback for Stanleybet)
  const palUrl = appendCacheBuster(
    `${params.spec.domain}/XSportDatastore/getPalinsestoDelGiorno?systemCode=${encodeURIComponent(
      params.spec.systemCode
    )}&lingua=IT&hash=&data=${dateKey}&idSport=${idSport}&idAggregata=${idAggregata}&timezone=0`
  );
  const { data, cacheAgeSec } = await fetchJson<XSportPalinsestoResp>(palUrl, {
    headers,
    noCacheHeaders: true,
    timeoutMs: 8000,
    retries: 0,
    signal: params.signal,
  });
  const avsList = Object.values(data.avs ?? {}).flat();
  const target = avsList.find((a) => a.p === pal && a.a === avv);
  if (!target || (!params.includeLive && target.lv)) {
    return { market: null, latencyMs: Date.now() - started, cacheAgeSec };
  }

  const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);
  const extracted = extractXSportMarkets({
    spec: params.spec,
    sport: params.sport,
    idSport,
    idAggregata,
    dateKey,
    league: '',
    pal,
    avv,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    startTime: parseRomeWallClockToIso(target.ts) ?? params.startTime,
    scs: target.scs ?? [],
    scrapedAt,
    cacheAgeSec,
  });

  return {
    market: extracted.find((m) => m.marketType === params.marketType) ?? null,
    latencyMs: Date.now() - started,
    cacheAgeSec,
  };
}

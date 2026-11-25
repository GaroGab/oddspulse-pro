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
  fetchJson,
  isAbortError,
  sleep,
  throwIfAborted,
} from './httpClient';
import { matchesEventHints, teamSimilarity } from './matchLinker';

const GD_ORIGIN = 'https://www.giocodigitale.it';
const GD_REFERER = 'https://www.giocodigitale.it/it/sports';
const GD_CLIENT_CONFIG_URL =
  'https://www.giocodigitale.it/it/api/clientconfig?browserUrl=http%3A%2F%2Fwww.giocodigitale.it%2Fit%2Fsports';
const GD_CDS_BASE = 'https://www.giocodigitale.it/cds-api/bettingoffer';
const FALLBACK_ACCESS_ID = 'YzE1NjEwYWUtMTAwNy00ODhjLWE5YjUtNzRhYjFkOWUxMGM4';
const ACCESS_ID_TTL_MS = 30 * 60_000;

const GD_HEADERS: Record<string, string> = {
  Origin: GD_ORIGIN,
  Referer: GD_REFERER,
};

let cachedAccessId: { value: string; fetchedAt: number } | null = null;

interface GdLocalizedText {
  value?: string;
}

interface GdParticipant {
  name?: GdLocalizedText;
}

interface GdOptionItem {
  id?: number;
  name?: GdLocalizedText;
  status?: string;
  visibility?: string;
  price?: { odds?: number };
  odds?: number;
  attr?: string;
  totalsPrefix?: string;
}

interface GdMarket {
  id?: number;
  templateId?: number;
  name?: GdLocalizedText;
  status?: string;
  visibility?: string;
  isMain?: boolean;
  attr?: string;
  options?: GdOptionItem[];
  results?: GdOptionItem[];
}

interface GdFixture {
  id: string;
  name?: GdLocalizedText;
  startDate?: string;
  stage?: string; // 'PreMatch' | 'Live'
  sport?: { id?: number; name?: GdLocalizedText };
  competition?: { id?: number; name?: GdLocalizedText };
  participants?: GdParticipant[];
  optionMarkets?: GdMarket[];
  games?: GdMarket[];
}

interface GdFixturesResponse {
  totalCount?: number;
  fixtures?: GdFixture[];
}

interface GdFixtureViewResponse {
  fixture?: GdFixture;
}

interface GdClientConfigResponse {
  msConnection?: {
    pushAccessId?: string;
    cdsFrontendUrl?: string;
    cdsUrlBase?: string;
  };
}

const GD_SPORTS: Array<{ sport: SportKey; sportId: number; maxPages: number }> = [
  { sport: 'football', sportId: 4, maxPages: 3 },
  { sport: 'tennis', sportId: 5, maxPages: 2 },
  { sport: 'basketball', sportId: 7, maxPages: 2 },
];

async function resolveGiocoDigitaleAccessId(
  signal?: AbortSignal,
  forceRefresh = false
): Promise<string> {
  if (!forceRefresh && cachedAccessId && Date.now() - cachedAccessId.fetchedAt < ACCESS_ID_TTL_MS) {
    return cachedAccessId.value;
  }
  try {
    const { data } = await fetchJson<GdClientConfigResponse>(GD_CLIENT_CONFIG_URL, {
      headers: {
        ...GD_HEADERS,
        'x-bwin-browser-url': 'http%3A%2F%2Fwww.giocodigitale.it%2Fit%2Fsports',
        'x-from-product': 'host-app',
        'x-bwin-sports-api': 'prod',
      },
      noCacheHeaders: true,
      timeoutMs: 9000,
      retries: 0,
      signal,
    });
    const fresh = data?.msConnection?.pushAccessId?.trim();
    if (fresh && fresh.length >= 16) {
      cachedAccessId = { value: fresh, fetchedAt: Date.now() };
      return fresh;
    }
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) throw err;
  }
  return cachedAccessId?.value ?? FALLBACK_ACCESS_ID;
}

function parseOdd(raw: number | undefined): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 1.005 || raw > 500) {
    return null;
  }
  return Math.round(raw * 100) / 100;
}

function isMarketVisible(m: GdMarket): boolean {
  const st = (m.status ?? m.visibility ?? '').toLowerCase();
  return !st || st === 'visible' || st === 'open';
}

function getVisibleOptions(m: GdMarket): Array<{ name: string; odds: number; totalsPrefix?: string }> {
  const raw = m.options?.length ? m.options : m.results ?? [];
  const out: Array<{ name: string; odds: number; totalsPrefix?: string }> = [];
  for (const o of raw) {
    const st = (o.status ?? o.visibility ?? '').toLowerCase();
    if (st && st !== 'visible' && st !== 'open') continue;
    const dec = parseOdd(o.price?.odds ?? o.odds);
    if (!dec) continue;
    out.push({
      name: (o.name?.value ?? '').trim(),
      odds: dec,
      totalsPrefix: o.totalsPrefix,
    });
  }
  return out;
}

function normalizeAttr(raw?: string): string {
  return (raw ?? '').trim().replace(',', '.');
}

function mapTwoWayTeam(
  optName: string,
  idx: number,
  homeTeam: string,
  awayTeam: string,
  sport: SportKey
): 'HOME' | 'AWAY' {
  const low = optName.toLowerCase();
  if (low === homeTeam.toLowerCase()) return 'HOME';
  if (low === awayTeam.toLowerCase()) return 'AWAY';
  const simH = teamSimilarity(optName, homeTeam, sport);
  const simA = teamSimilarity(optName, awayTeam, sport);
  if (simH > simA + 0.08 && simH >= 0.5) return 'HOME';
  if (simA > simH + 0.08 && simA >= 0.5) return 'AWAY';
  return idx === 0 ? 'HOME' : 'AWAY';
}

function extractGiocoDigitaleMarkets(params: {
  sport: SportKey;
  fix: GdFixture;
  scrapedAt: number;
  cacheAgeSec: number;
}): RawScrapedMarket[] {
  const { sport, fix, scrapedAt, cacheAgeSec } = params;
  const league = (
    fix.competition?.name?.value ??
    (sport === 'football' ? 'Calcio' : sport === 'tennis' ? 'Tennis' : 'Basket')
  ).trim();
  if (/scorecast|su richiesta|speciali|antepost/i.test(league)) return [];

  const parts = (fix.participants ?? [])
    .map((p) => (p.name?.value ?? '').trim())
    .filter(Boolean);
  let homeTeam = parts[0] ?? '';
  let awayTeam = parts[1] ?? '';
  if (!homeTeam || !awayTeam) {
    const rawName = fix.name?.value ?? '';
    const sepIdx = rawName.indexOf(' - ');
    if (sepIdx > 0) {
      homeTeam = rawName.slice(0, sepIdx).trim();
      awayTeam = rawName.slice(sepIdx + 3).trim();
    }
  }
  if (!homeTeam || !awayTeam || !fix.startDate) return [];
  if (/scorecast|richiesta/i.test(`${homeTeam} ${awayTeam}`)) return [];

  const allMarkets: GdMarket[] = [...(fix.optionMarkets ?? []), ...(fix.games ?? [])];
  if (allMarkets.length === 0) return [];

  const out: RawScrapedMarket[] = [];
  const seenTypes = new Set<MarketType>();
  const eventUrl = `${GD_ORIGIN}/it/sports/eventi/${encodeURIComponent(fix.id)}`;

  for (const m of allMarkets) {
    if (!isMarketVisible(m)) continue;
    const mName = (m.name?.value ?? '').trim();
    const mLow = mName.toLowerCase();
    const opts = getVisibleOptions(m);
    if (opts.length < 2) continue;

    // 1. Football 1X2 (strictly Full Time match result)
    if (
      sport === 'football' &&
      !seenTypes.has('1X2') &&
      opts.length === 3 &&
      /^(?:risultato della partita|esito finale(?:\s*1x2)?|1x2(?:\s*esito finale)?)$/i.test(mLow) &&
      !/tempo|half|handicap|gol|goal|over|under|doppia|segnare|corner|cartellin/i.test(mLow)
    ) {
      const sels: SelectionQuote[] = [];
      const used = new Set<string>();
      opts.forEach((o, idx) => {
        const ol = o.name.toLowerCase();
        let key: 'HOME' | 'DRAW' | 'AWAY' | null = null;
        if (ol === 'x' || ol === 'pareggio' || ol === 'parità' || ol === 'draw') {
          key = 'DRAW';
        } else if (ol === homeTeam.toLowerCase()) {
          key = 'HOME';
        } else if (ol === awayTeam.toLowerCase()) {
          key = 'AWAY';
        } else {
          const sh = teamSimilarity(o.name, homeTeam, sport);
          const sa = teamSimilarity(o.name, awayTeam, sport);
          if (sh >= 0.55 && sh > sa + 0.08) key = 'HOME';
          else if (sa >= 0.55 && sa > sh + 0.08) key = 'AWAY';
          else if (idx === 0) key = 'HOME';
          else if (idx === 1) key = 'DRAW';
          else if (idx === 2) key = 'AWAY';
        }
        if (key && !used.has(key)) {
          used.add(key);
          sels.push({
            canonicalKey: key,
            label:
              key === 'HOME'
                ? `${homeTeam} (1)`
                : key === 'AWAY'
                ? `${awayTeam} (2)`
                : 'Pareggio (X)',
            backOdds: o.odds,
          });
        }
      });

      if (sels.length === 3) {
        seenTypes.add('1X2');
        out.push({
          sourceId: 'giocodigitale_it',
          sourceName: 'Gioco Digitale',
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId: fix.id,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: fix.startDate,
          marketType: '1X2',
          marketLabel: 'Esito Finale 1X2',
          selections: sels,
          eventUrl,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 2. Football Over/Under 2.5 (strictly Match Total Goals 2.5)
    if (
      sport === 'football' &&
      !seenTypes.has('OVER_UNDER_25') &&
      opts.length === 2 &&
      /^(?:over\/under|under\/over|totale gol)$/i.test(mLow) &&
      !/tempo|half|squadra|casa|ospite|corner|cartellin|1x2| e /i.test(mLow)
    ) {
      const attrNorm = normalizeAttr(m.attr);
      const is25 =
        attrNorm === '2.5' ||
        (opts.every((o) => /2[.,]5/.test(o.name)) && !attrNorm);
      if (!is25) continue;

      const sels: SelectionQuote[] = [];
      for (const o of opts) {
        const pref = (o.totalsPrefix ?? '').toLowerCase();
        const ol = o.name.toLowerCase();
        if (pref === 'over' || ol.startsWith('over') || ol.includes('più di 2')) {
          sels.push({ canonicalKey: 'OVER_25', label: 'Over 2.5', backOdds: o.odds });
        } else if (pref === 'under' || ol.startsWith('under') || ol.includes('meno di 2')) {
          sels.push({ canonicalKey: 'UNDER_25', label: 'Under 2.5', backOdds: o.odds });
        }
      }
      if (sels.length === 2) {
        seenTypes.add('OVER_UNDER_25');
        out.push({
          sourceId: 'giocodigitale_it',
          sourceName: 'Gioco Digitale',
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId: fix.id,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: fix.startDate,
          marketType: 'OVER_UNDER_25',
          marketLabel: 'Under/Over 2.5 Gol',
          selections: sels,
          eventUrl,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 3. Football Both Teams To Score (Gol/Gol)
    if (
      sport === 'football' &&
      !seenTypes.has('BTTS') &&
      opts.length === 2 &&
      /^(?:gol\/gol|gol\/nogol|goal\/nogoal|entrambe le squadre segnano)$/i.test(mLow) &&
      !/tempo|half|doppia|1x2| e /i.test(mLow)
    ) {
      const sels: SelectionQuote[] = [];
      for (const o of opts) {
        const ol = o.name.toLowerCase();
        if (ol === 'sì' || ol === 'si' || ol === 'yes' || ol === 'goal' || ol === 'gol') {
          sels.push({ canonicalKey: 'BTTS_YES', label: 'Goal (Sì)', backOdds: o.odds });
        } else if (ol === 'no' || ol === 'nogoal' || ol === 'no goal' || ol === 'nogol') {
          sels.push({ canonicalKey: 'BTTS_NO', label: 'NoGoal (No)', backOdds: o.odds });
        }
      }
      if (sels.length === 2) {
        seenTypes.add('BTTS');
        out.push({
          sourceId: 'giocodigitale_it',
          sourceName: 'Gioco Digitale',
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId: fix.id,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: fix.startDate,
          marketType: 'BTTS',
          marketLabel: 'Goal / NoGoal',
          selections: sels,
          eventUrl,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 4. Tennis H2H (templateId 13018 / Vincitore partita)
    if (
      sport === 'tennis' &&
      !seenTypes.has('H2H') &&
      opts.length === 2 &&
      (m.templateId === 13018 ||
        /^(?:vincitore partita|testa a testa(?:\s*\(vincitore\))?|vincente incontro)$/i.test(mLow)) &&
      !/set|game|gioco|handicap|totale|over|under|risultato esatto/i.test(mLow)
    ) {
      const sels: SelectionQuote[] = [];
      const used = new Set<string>();
      opts.forEach((o, idx) => {
        const key = mapTwoWayTeam(o.name, idx, homeTeam, awayTeam, sport);
        if (!used.has(key)) {
          used.add(key);
          sels.push({
            canonicalKey: key,
            label: key === 'HOME' ? `${homeTeam} (1)` : `${awayTeam} (2)`,
            backOdds: o.odds,
          });
        }
      });
      if (sels.length === 2) {
        seenTypes.add('H2H');
        out.push({
          sourceId: 'giocodigitale_it',
          sourceName: 'Gioco Digitale',
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId: fix.id,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: fix.startDate,
          marketType: 'H2H',
          marketLabel: 'Testa a Testa',
          selections: sels,
          eventUrl,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 5. Basketball H2H (templateId 12762 / Testa a testa (vincitore), incl. OT, never 1X2 regulation)
    if (
      sport === 'basketball' &&
      !seenTypes.has('H2H') &&
      opts.length === 2 &&
      (m.templateId === 12762 ||
        /^(?:testa a testa\s*\(vincitore\)|testa a testa|vincente(?:\s*\(incl\.?\s*ts\))?)$/i.test(
          mLow
        )) &&
      !/1x2|regolamentar|quarto|tempo|half|handicap|totale|over|under|pari|dispari/i.test(mLow)
    ) {
      const sels: SelectionQuote[] = [];
      const used = new Set<string>();
      opts.forEach((o, idx) => {
        const key = mapTwoWayTeam(o.name, idx, homeTeam, awayTeam, sport);
        if (!used.has(key)) {
          used.add(key);
          sels.push({
            canonicalKey: key,
            label: key === 'HOME' ? `${homeTeam} (1)` : `${awayTeam} (2)`,
            backOdds: o.odds,
          });
        }
      });
      if (sels.length === 2) {
        seenTypes.add('H2H');
        out.push({
          sourceId: 'giocodigitale_it',
          sourceName: 'Gioco Digitale',
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId: fix.id,
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: fix.startDate,
          marketType: 'H2H',
          marketLabel: 'Testa a Testa',
          selections: sels,
          eventUrl,
          scrapedAt,
          cacheAgeSec,
        });
      }
    }
  }

  return out;
}

async function fetchCdsWithTokenRetry<T>(
  buildUrl: (accessId: string) => string,
  signal?: AbortSignal,
  timeoutMs = 11000
): Promise<{ data: T; latencyMs: number; cacheAgeSec: number }> {
  let accessId = await resolveGiocoDigitaleAccessId(signal);
  try {
    return await fetchJson<T>(appendCacheBuster(buildUrl(accessId)), {
      headers: GD_HEADERS,
      noCacheHeaders: true,
      timeoutMs,
      retries: 0,
      signal,
    });
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) {
      accessId = await resolveGiocoDigitaleAccessId(signal, true);
      return await fetchJson<T>(appendCacheBuster(buildUrl(accessId)), {
        headers: GD_HEADERS,
        noCacheHeaders: true,
        timeoutMs,
        retries: 0,
        signal,
      });
    }
    throw err;
  }
}

export async function scrapeGiocoDigitale(
  includeLive: boolean,
  filter?: TargetedScrapeFilter,
  signal?: AbortSignal
): Promise<{ markets: RawScrapedMarket[]; latencyMs: number }> {
  const started = Date.now();
  const nowMs = Date.now();
  const markets: RawScrapedMarket[] = [];
  const seenFixtureIds = new Set<string>();
  let succeededSports = 0;
  let lastErr: unknown = null;

  const targetSports =
    filter?.sports && filter.sports.length > 0
      ? GD_SPORTS.filter((s) => filter.sports!.includes(s.sport))
      : GD_SPORTS;

  const dateWindow = filter?.dateWindow;
  const fromIso = dateWindow
    ? new Date(includeLive ? dateWindow.startMs : Math.max(nowMs, dateWindow.startMs)).toISOString()
    : includeLive
    ? undefined
    : new Date(nowMs - 60_000).toISOString();
  const toIso = dateWindow
    ? new Date(dateWindow.endMs).toISOString()
    : new Date(nowMs + 72 * 3600_000).toISOString();

  if (fromIso && toIso && Date.parse(fromIso) > Date.parse(toIso)) {
    return { markets, latencyMs: Date.now() - started };
  }

  const pageSize = 60;

  for (const sp of targetSports) {
    throwIfAborted(signal);
    let sportOk = false;
    try {
      for (let page = 0; page < sp.maxPages; page++) {
        throwIfAborted(signal);
        const skip = page * pageSize;
        const { data, cacheAgeSec } = await fetchCdsWithTokenRetry<GdFixturesResponse>(
          (accessId) => {
            const qs = new URLSearchParams({
              'x-bwin-accessid': accessId,
              lang: 'it',
              country: 'IT',
              userCountry: 'IT',
              fixtureTypes: 'Standard',
              state: 'Latest',
              offerMapping: 'Filtered',
              offerCategories: 'Gridable',
              fixtureCategories: 'Gridable',
              sportIds: String(sp.sportId),
              isVirtual: 'false',
              skip: String(skip),
              take: String(pageSize),
            });
            if (fromIso) qs.set('from', fromIso);
            if (toIso) qs.set('to', toIso);
            return `${GD_CDS_BASE}/fixtures?${qs.toString()}`;
          },
          signal
        );

        sportOk = true;
        const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);
        const fixtures = data.fixtures ?? [];

        for (const fix of fixtures) {
          if (!fix.id || seenFixtureIds.has(fix.id)) continue;
          if (!includeLive && fix.stage && fix.stage !== 'PreMatch') continue;
          if (!fix.startDate) continue;
          const startMs = Date.parse(fix.startDate);
          if (!Number.isFinite(startMs)) continue;
          if (!includeLive && startMs < nowMs - 60_000) continue;
          if (dateWindow && !matchesScrapeDateWindow(startMs, dateWindow)) continue;

          const p0 = fix.participants?.[0]?.name?.value?.trim() ?? '';
          const p1 = fix.participants?.[1]?.name?.value?.trim() ?? '';
          if (
            filter?.eventHints?.length &&
            !matchesEventHints(fix.name?.value ?? `${p0} - ${p1}`, p0, p1, sp.sport, filter.eventHints)
          ) {
            continue;
          }

          seenFixtureIds.add(fix.id);
          markets.push(
            ...extractGiocoDigitaleMarkets({
              sport: sp.sport,
              fix,
              scrapedAt,
              cacheAgeSec,
            })
          );
        }

        if (fixtures.length < pageSize || (data.totalCount ?? 0) <= skip + pageSize) {
          break;
        }
        await sleep(80, signal);
      }
      if (sportOk) succeededSports++;
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

/**
 * Ultra-fast (~120ms) single-event live verification on Gioco Digitale Entain CDS fixture-view.
 */
export async function verifyGiocoDigitaleEvent(params: {
  eventId: string;
  sport: SportKey;
  marketType: MarketType;
  includeLive: boolean;
  signal?: AbortSignal;
}): Promise<{
  market: RawScrapedMarket | null;
  latencyMs: number;
  cacheAgeSec: number;
}> {
  const started = Date.now();
  if (!params.eventId) {
    return { market: null, latencyMs: 0, cacheAgeSec: 0 };
  }

  const { data, cacheAgeSec } = await fetchCdsWithTokenRetry<GdFixtureViewResponse>(
    (accessId) => {
      const qs = new URLSearchParams({
        'x-bwin-accessid': accessId,
        lang: 'it',
        country: 'IT',
        userCountry: 'IT',
        offerMapping: 'All',
        scoreboardMode: 'None',
        fixtureIds: params.eventId,
        state: 'Latest',
      });
      return `${GD_CDS_BASE}/fixture-view?${qs.toString()}`;
    },
    params.signal,
    7500
  );

  const fix = data?.fixture;
  if (!fix) {
    return { market: null, latencyMs: Date.now() - started, cacheAgeSec };
  }
  if (!params.includeLive && fix.stage && fix.stage !== 'PreMatch') {
    return { market: null, latencyMs: Date.now() - started, cacheAgeSec };
  }

  const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);
  const extracted = extractGiocoDigitaleMarkets({
    sport: params.sport,
    fix,
    scrapedAt,
    cacheAgeSec,
  });

  return {
    market: extracted.find((m) => m.marketType === params.marketType) ?? null,
    latencyMs: Date.now() - started,
    cacheAgeSec,
  };
}

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
  throwIfAborted,
} from './httpClient';
import { matchesEventHints } from './matchLinker';

const PS_API_BASE = 'https://betting.pokerstars.it/api/lettura-palinsesto-sport/palinsesto/prematch';
const PS_SITE_URL = 'https://www.pokerstars.it/scommesse';
const PS_HEADERS: Record<string, string> = {
  Origin: 'https://www.pokerstars.it',
  Referer: 'https://www.pokerstars.it/',
};

interface PsManifestazioneMeta {
  descrizione?: string;
  codiceDisciplina?: number;
  codiceManifestazione?: number;
  posizione?: number;
}

interface PsAlberaturaResp {
  manifestazioneMap?: Record<string, PsManifestazioneMeta>;
  manifestazioneListByDisciplinaOggiEDomani?: Record<string, string[]>;
  manifestazioneListByDisciplinaTutti?: Record<string, string[]>;
  eventsNumberByManifestazioneOggiEDomani?: Record<string, number>;
  eventsNumberByManifestazioneTutti?: Record<string, number>;
}

interface PsEsito {
  codiceEsito?: number;
  descrizione?: string;
  quota?: number; // decimal * 100
  stato?: number; // 1 = open
}

interface PsInfoAggiuntiva {
  codicePalinsesto?: number;
  codiceAvvenimento?: number;
  codiceScommessa?: number;
  idInfoAggiuntiva?: number;
  descrizione?: string;
  soglia?: string;
  esitoList?: PsEsito[];
}

interface PsAvvenimento {
  key?: string;
  descrizione?: string;
  data?: string; // ISO 8601 UTC
  codiceDisciplina?: number;
  codiceManifestazione?: number;
  codicePalinsesto?: number;
  codiceAvvenimento?: number;
  stato?: number; // 1 = open
}

interface PsSchedaResp {
  avvenimentoFeList?: PsAvvenimento[];
  avvenimentoFe?: PsAvvenimento;
  infoAggiuntivaMap?: Record<string, PsInfoAggiuntiva>;
}

const PS_DISCIPLINES: Array<{ sport: SportKey; codice: string; maxComps: number }> = [
  { sport: 'football', codice: '1', maxComps: 36 },
  { sport: 'basketball', codice: '2', maxComps: 14 },
  { sport: 'tennis', codice: '3', maxComps: 14 },
];

const TOP_LEAGUE_RE =
  /Serie A|Serie B|Coppa Italia|Premier League|Championship|LaLiga|La Liga|Liga|Bundesliga|Ligue 1|Eredivisie|Champions League|Europa League|Conference League|ATP|WTA|Coppa Davis|NBA|Eurolega|LBA|Serie A1/i;

let alberaturaCache: { fetchedAt: number; data: PsAlberaturaResp } | null = null;
const ALBERATURA_TTL_MS = 90_000;

function parsePsQuota(quota: number | undefined): number | null {
  if (typeof quota !== 'number' || !Number.isFinite(quota) || quota <= 100 || quota > 50000) {
    return null;
  }
  const dec = Math.round(quota) / 100;
  return dec > 1.005 ? dec : null;
}

function splitPsTeams(desc: string | undefined): [string, string] | null {
  if (!desc) return null;
  const idx = desc.indexOf(' - ');
  if (idx <= 0) return null;
  const home = desc.slice(0, idx).replace(/\s+/g, ' ').trim();
  const away = desc.slice(idx + 3).replace(/\s+/g, ' ').trim();
  if (!home || !away) return null;
  return [home, away];
}

function cleanLeagueName(raw: string | undefined, sport: SportKey): string {
  const cleaned = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return sport === 'football' ? 'Calcio' : sport === 'tennis' ? 'Tennis' : 'Basket';
  }
  return cleaned;
}

function extractPokerstarsEventMarkets(params: {
  sport: SportKey;
  league: string;
  manKey: string;
  ev: PsAvvenimento;
  infos: PsInfoAggiuntiva[];
  scrapedAt: number;
  cacheAgeSec: number;
}): RawScrapedMarket[] {
  const { sport, league, manKey, ev, infos, scrapedAt, cacheAgeSec } = params;
  if (ev.stato !== undefined && ev.stato !== 1) return [];
  if (!ev.data || !ev.codicePalinsesto || !ev.codiceAvvenimento) return [];

  const teams = splitPsTeams(ev.descrizione);
  if (!teams) return [];
  const [homeTeam, awayTeam] = teams;
  const eventId = `${ev.codicePalinsesto}-${ev.codiceAvvenimento}`;
  const out: RawScrapedMarket[] = [];
  const seen = new Set<MarketType>();

  for (const info of infos) {
    const activeEsiti = (info.esitoList ?? []).filter(
      (e) => (e.stato === undefined || e.stato === 1) && parsePsQuota(e.quota) !== null
    );
    if (activeEsiti.length < 2) continue;

    // 1. Football 1X2 (codiceScommessa === 3)
    if (sport === 'football' && info.codiceScommessa === 3 && !seen.has('1X2')) {
      const sels: SelectionQuote[] = [];
      for (const e of activeEsiti) {
        const dec = parsePsQuota(e.quota)!;
        const d = (e.descrizione ?? '').trim().toUpperCase();
        if (d === '1' || e.codiceEsito === 1) {
          sels.push({ canonicalKey: 'HOME', label: `${homeTeam} (1)`, backOdds: dec });
        } else if (d === 'X' || e.codiceEsito === 2) {
          sels.push({ canonicalKey: 'DRAW', label: 'Pareggio (X)', backOdds: dec });
        } else if (d === '2' || e.codiceEsito === 3) {
          sels.push({ canonicalKey: 'AWAY', label: `${awayTeam} (2)`, backOdds: dec });
        }
      }
      if (sels.length === 3) {
        seen.add('1X2');
        out.push({
          sourceId: 'pokerstars_it',
          sourceName: 'PokerStars.it',
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId,
          sourceMetadata: { manifestationKey: manKey },
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: ev.data,
          marketType: '1X2',
          marketLabel: 'Esito Finale 1X2',
          selections: sels,
          eventUrl: PS_SITE_URL,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 2. Football Over/Under 2.5 (codiceScommessa === 7989, idInfoAggiuntiva === 250 / soglia 2.5)
    if (
      sport === 'football' &&
      info.codiceScommessa === 7989 &&
      !seen.has('OVER_UNDER_25') &&
      (info.idInfoAggiuntiva === 250 ||
        (info.soglia ?? '').replace(',', '.').trim() === '2.5')
    ) {
      const sels: SelectionQuote[] = [];
      for (const e of activeEsiti) {
        const dec = parsePsQuota(e.quota)!;
        const d = (e.descrizione ?? '').trim().toUpperCase();
        if (d.includes('UNDER') || (!d && e.codiceEsito === 1)) {
          sels.push({ canonicalKey: 'UNDER_25', label: 'Under 2.5', backOdds: dec });
        } else if (d.includes('OVER') || (!d && e.codiceEsito === 2)) {
          sels.push({ canonicalKey: 'OVER_25', label: 'Over 2.5', backOdds: dec });
        }
      }
      if (sels.length === 2) {
        seen.add('OVER_UNDER_25');
        out.push({
          sourceId: 'pokerstars_it',
          sourceName: 'PokerStars.it',
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId,
          sourceMetadata: { manifestationKey: manKey },
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: ev.data,
          marketType: 'OVER_UNDER_25',
          marketLabel: 'Under/Over 2.5 Gol',
          selections: sels,
          eventUrl: PS_SITE_URL,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 3. Football BTTS (codiceScommessa === 18)
    if (sport === 'football' && info.codiceScommessa === 18 && !seen.has('BTTS')) {
      const sels: SelectionQuote[] = [];
      for (const e of activeEsiti) {
        const dec = parsePsQuota(e.quota)!;
        const d = (e.descrizione ?? '').trim().toUpperCase();
        if (d === 'GOAL' || d === 'GOL' || d === 'SI' || d === 'SÌ' || (!d && e.codiceEsito === 1)) {
          sels.push({ canonicalKey: 'BTTS_YES', label: 'Goal (Sì)', backOdds: dec });
        } else if (
          d === 'NOGOAL' ||
          d === 'NO GOAL' ||
          d === 'NOGOL' ||
          d === 'NO' ||
          (!d && e.codiceEsito === 2)
        ) {
          sels.push({ canonicalKey: 'BTTS_NO', label: 'NoGoal (No)', backOdds: dec });
        }
      }
      if (sels.length === 2) {
        seen.add('BTTS');
        out.push({
          sourceId: 'pokerstars_it',
          sourceName: 'PokerStars.it',
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId,
          sourceMetadata: { manifestationKey: manKey },
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: ev.data,
          marketType: 'BTTS',
          marketLabel: 'Goal / NoGoal',
          selections: sels,
          eventUrl: PS_SITE_URL,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 4. Basketball H2H (codiceScommessa === 110: T/T RISULTATO incl. OT)
    if (
      sport === 'basketball' &&
      info.codiceScommessa === 110 &&
      (info.idInfoAggiuntiva ?? 0) === 0 &&
      !seen.has('H2H')
    ) {
      const sels: SelectionQuote[] = [];
      for (const e of activeEsiti) {
        const dec = parsePsQuota(e.quota)!;
        const d = (e.descrizione ?? '').trim().toUpperCase();
        if (d === '1' || e.codiceEsito === 1) {
          sels.push({ canonicalKey: 'HOME', label: `${homeTeam} (1)`, backOdds: dec });
        } else if (d === '2' || e.codiceEsito === 2) {
          sels.push({ canonicalKey: 'AWAY', label: `${awayTeam} (2)`, backOdds: dec });
        }
      }
      if (sels.length === 2) {
        seen.add('H2H');
        out.push({
          sourceId: 'pokerstars_it',
          sourceName: 'PokerStars.it',
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId,
          sourceMetadata: { manifestationKey: manKey },
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: ev.data,
          marketType: 'H2H',
          marketLabel: 'Testa a Testa',
          selections: sels,
          eventUrl: PS_SITE_URL,
          scrapedAt,
          cacheAgeSec,
        });
      }
      continue;
    }

    // 5. Tennis H2H (codiceScommessa === 20540 or 110: T/T MATCH)
    if (
      sport === 'tennis' &&
      (info.codiceScommessa === 20540 || info.codiceScommessa === 110) &&
      (info.idInfoAggiuntiva ?? 0) === 0 &&
      !seen.has('H2H')
    ) {
      const sels: SelectionQuote[] = [];
      for (const e of activeEsiti) {
        const dec = parsePsQuota(e.quota)!;
        const d = (e.descrizione ?? '').trim().toUpperCase();
        if (d === '1' || e.codiceEsito === 1) {
          sels.push({ canonicalKey: 'HOME', label: `${homeTeam} (1)`, backOdds: dec });
        } else if (d === '2' || e.codiceEsito === 2) {
          sels.push({ canonicalKey: 'AWAY', label: `${awayTeam} (2)`, backOdds: dec });
        }
      }
      if (sels.length === 2) {
        seen.add('H2H');
        out.push({
          sourceId: 'pokerstars_it',
          sourceName: 'PokerStars.it',
          sourceKind: 'bookmaker',
          sport,
          league,
          eventId,
          sourceMetadata: { manifestationKey: manKey },
          eventName: `${homeTeam} - ${awayTeam}`,
          homeTeam,
          awayTeam,
          startTime: ev.data,
          marketType: 'H2H',
          marketLabel: 'Testa a Testa',
          selections: sels,
          eventUrl: PS_SITE_URL,
          scrapedAt,
          cacheAgeSec,
        });
      }
    }
  }

  return out;
}

async function getAlberatura(useCache: boolean, signal?: AbortSignal): Promise<PsAlberaturaResp> {
  if (useCache && alberaturaCache && Date.now() - alberaturaCache.fetchedAt < ALBERATURA_TTL_MS) {
    return alberaturaCache.data;
  }
  const url = appendCacheBuster(`${PS_API_BASE}/alberaturaPrematch?offerId=0`);
  const { data } = await fetchJson<PsAlberaturaResp>(url, {
    headers: PS_HEADERS,
    noCacheHeaders: true,
    timeoutMs: 11000,
    retries: 1,
    signal,
  });
  alberaturaCache = { fetchedAt: Date.now(), data };
  return data;
}

function selectManifestationKeys(
  alb: PsAlberaturaResp,
  codice: string,
  maxComps: number,
  needsFuture: boolean
): string[] {
  const manMap = alb.manifestazioneMap ?? {};
  const listNear = alb.manifestazioneListByDisciplinaOggiEDomani?.[codice] ?? [];
  const listAll = alb.manifestazioneListByDisciplinaTutti?.[codice] ?? [];
  const countsMap = needsFuture
    ? alb.eventsNumberByManifestazioneTutti ?? {}
    : alb.eventsNumberByManifestazioneOggiEDomani ?? alb.eventsNumberByManifestazioneTutti ?? {};

  const pool = Array.from(new Set(needsFuture ? [...listAll, ...listNear] : [...listNear, ...listAll]));
  const scored = pool
    .filter((k) => {
      const meta = manMap[k];
      const desc = meta?.descrizione ?? '';
      // Skip outright / antepost / special competitions
      if (/antepost|speciali|vincente\s+manifestazione|stagional|supercoppa\s+vincente/i.test(desc)) {
        return false;
      }
      return true;
    })
    .map((k) => {
      const meta = manMap[k];
      const desc = meta?.descrizione ?? '';
      const isTop = TOP_LEAGUE_RE.test(desc) ? 1 : 0;
      const inNear = listNear.includes(k) ? 1 : 0;
      const evCnt = countsMap[k] ?? 1;
      const pos = meta?.posizione ?? 9999;
      return { k, isTop, inNear, evCnt, pos };
    })
    .sort((a, b) => {
      if (b.isTop !== a.isTop) return b.isTop - a.isTop;
      if (!needsFuture && b.inNear !== a.inNear) return b.inNear - a.inNear;
      if (b.evCnt !== a.evCnt) return b.evCnt - a.evCnt;
      return a.pos - b.pos;
    });

  return scored.slice(0, maxComps).map((x) => x.k);
}

function groupInfosByEvent(infoMap: Record<string, PsInfoAggiuntiva> | undefined) {
  const byEv = new Map<string, PsInfoAggiuntiva[]>();
  if (!infoMap) return byEv;
  for (const info of Object.values(infoMap)) {
    if (!info.codicePalinsesto || !info.codiceAvvenimento) continue;
    const evKey = `${info.codicePalinsesto}-${info.codiceAvvenimento}`;
    const arr = byEv.get(evKey);
    if (arr) arr.push(info);
    else byEv.set(evKey, [info]);
  }
  return byEv;
}

export async function scrapePokerstars(
  includeLive: boolean,
  filter?: TargetedScrapeFilter,
  signal?: AbortSignal
): Promise<{ markets: RawScrapedMarket[]; latencyMs: number }> {
  const started = Date.now();
  const nowMs = Date.now();
  throwIfAborted(signal);

  const alb = await getAlberatura(Boolean(filter), signal);
  const manMap = alb.manifestazioneMap ?? {};
  const dateWindow = filter?.dateWindow;
  const needsFuture = Boolean(dateWindow && dateWindow.endMs > nowMs + 30 * 3600_000);

  const targetDisciplines =
    filter?.sports && filter.sports.length > 0
      ? PS_DISCIPLINES.filter((d) => filter.sports!.includes(d.sport))
      : PS_DISCIPLINES;

  const jobs: Array<{ sport: SportKey; manKey: string; league: string }> = [];
  for (const dis of targetDisciplines) {
    const keys = selectManifestationKeys(alb, dis.codice, dis.maxComps, needsFuture);
    for (const manKey of keys) {
      jobs.push({
        sport: dis.sport,
        manKey,
        league: cleanLeagueName(manMap[manKey]?.descrizione, dis.sport),
      });
    }
  }

  if (jobs.length === 0) {
    return { markets: [], latencyMs: Date.now() - started };
  }

  const markets: RawScrapedMarket[] = [];
  const seenEvMkt = new Set<string>();
  const CONCURRENCY = 8;
  let cursor = 0;
  let succeededJobs = 0;
  let lastErr: unknown = null;

  const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (cursor < jobs.length) {
      throwIfAborted(signal);
      const job = jobs[cursor++];
      try {
        const url = appendCacheBuster(
          `${PS_API_BASE}/v1/schedaManifestazione/0/${encodeURIComponent(
            job.manKey
          )}?offerId=0&metaTplEnabled=true&deep=true`
        );
        const { data, cacheAgeSec } = await fetchJson<PsSchedaResp>(url, {
          headers: PS_HEADERS,
          noCacheHeaders: true,
          timeoutMs: 10000,
          retries: 0,
          signal,
        });
        succeededJobs++;
        const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);
        const infosByEv = groupInfosByEvent(data.infoAggiuntivaMap);

        for (const ev of data.avvenimentoFeList ?? []) {
          if (!ev.data || !ev.codicePalinsesto || !ev.codiceAvvenimento) continue;
          const startMs = Date.parse(ev.data);
          if (!Number.isFinite(startMs)) continue;
          if (!includeLive && startMs < nowMs - 60_000) continue;
          if (dateWindow && !matchesScrapeDateWindow(startMs, dateWindow)) continue;

          const teams = splitPsTeams(ev.descrizione);
          if (!teams) continue;
          if (
            filter?.eventHints?.length &&
            !matchesEventHints(`${teams[0]} - ${teams[1]}`, teams[0], teams[1], job.sport, filter.eventHints)
          ) {
            continue;
          }

          const evKey = `${ev.codicePalinsesto}-${ev.codiceAvvenimento}`;
          const extracted = extractPokerstarsEventMarkets({
            sport: job.sport,
            league: job.league,
            manKey: job.manKey,
            ev,
            infos: infosByEv.get(evKey) ?? [],
            scrapedAt,
            cacheAgeSec,
          });
          for (const m of extracted) {
            const dk = `${m.eventId}|${m.marketType}`;
            if (!seenEvMkt.has(dk)) {
              seenEvMkt.add(dk);
              markets.push(m);
            }
          }
        }
      } catch (err) {
        if (signal?.aborted || isAbortError(err)) throw err;
        lastErr = err;
      }
    }
  });

  await Promise.all(workers);
  throwIfAborted(signal);

  if (succeededJobs === 0 && lastErr) {
    throw lastErr;
  }

  return { markets, latencyMs: Date.now() - started };
}

/**
 * Fast (~150-250ms) single-event live verification on PokerStars.it direct backend.
 */
export async function verifyPokerstarsEvent(params: {
  eventId: string;
  sport: SportKey;
  marketType: MarketType;
  manifestationKey?: string;
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

  const endpoint = params.manifestationKey
    ? `${PS_API_BASE}/v1/schedaManifestazione/0/${encodeURIComponent(
        params.manifestationKey
      )}?offerId=0&metaTplEnabled=true&deep=true`
    : `${PS_API_BASE}/v1/schedaAvvenimento/${encodeURIComponent(params.eventId)}?offerId=0`;

  const { data, cacheAgeSec } = await fetchJson<PsSchedaResp>(appendCacheBuster(endpoint), {
    headers: PS_HEADERS,
    noCacheHeaders: true,
    timeoutMs: 8000,
    retries: 0,
    signal: params.signal,
  });

  const scrapedAt = computeEffectiveScrapedAt(Date.now(), cacheAgeSec);
  const infosByEv = groupInfosByEvent(data.infoAggiuntivaMap);
  const targetEv =
    (data.avvenimentoFeList ?? []).find(
      (e) => `${e.codicePalinsesto}-${e.codiceAvvenimento}` === params.eventId
    ) ?? data.avvenimentoFe;

  if (!targetEv) {
    return { market: null, latencyMs: Date.now() - started, cacheAgeSec };
  }

  const extracted = extractPokerstarsEventMarkets({
    sport: params.sport,
    league: '',
    manKey: params.manifestationKey ?? '',
    ev: targetEv,
    infos: infosByEv.get(params.eventId) ?? Object.values(data.infoAggiuntivaMap ?? {}),
    scrapedAt,
    cacheAgeSec,
  });

  return {
    market: extracted.find((m) => m.marketType === params.marketType) ?? null,
    latencyMs: Date.now() - started,
    cacheAgeSec,
  };
}

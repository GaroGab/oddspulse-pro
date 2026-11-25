import { setMaxListeners } from 'events';
import {
  formatScrapeDateWindowLabel,
  matchesScrapeDateWindow,
} from '../../src/shared/dateRange';
import { quickRatings, round2 } from '../../src/shared/math';
import { computeConnectionDiagnostic } from '../../src/shared/networkHealth';
import { ADM_BATCH_SOURCES, KAMBI_SOURCES, XSPORT_SOURCES } from '../../src/shared/ratingWatch';
import {
  SOURCE_CATALOG,
  type AppSettings,
  type BackMarketGroup,
  type BackOutcomeQuote,
  type DutcherLeg,
  type DutcherRow,
  type LiveVerifySideResult,
  type MarketType,
  type OddsmatcherRow,
  type OddsDelta,
  type RawScrapedMarket,
  type ScrapeDateWindow,
  type ScrapeLogEntry,
  type ScrapeSnapshot,
  type SourceId,
  type SourceStatus,
  type SportKey,
  type TargetedScrapeFilter,
  type VerifyPuntaPuntaRequest,
  type VerifyPuntaPuntaResult,
  type VerifyRowQuotesRequest,
  type VerifyRowQuotesResult,
} from '../../src/shared/types';
import { refreshBetfairExchangeMarkets, scrapeBetfairExchange } from './betfairExchange';
import { scrapeBetfairSportsbook, verifyBetfairSportsbookMarket } from './betfairSportsbook';
import { scrapeBetflagExchange, verifyBetflagExchangeEvent } from './betflagExchange';
import { scrapeGiocoDigitale, verifyGiocoDigitaleEvent } from './giocoDigitaleBookmaker';
import { computeEffectiveScrapedAt, isAbortError, sleep } from './httpClient';
import {
  ITALIAN_ADM_BOOKMAKERS,
  prefetchDirettaSchedules,
  scrapeItalianAdmBookmakers,
  verifyItalianAdmEvent,
} from './italianAdmScraper';
import { KAMBI_BRANDS, scrapeKambiBrand, verifyKambiEvent } from './kambiBookmaker';
import { linkScrapedMarkets, matchesEventHints, type LinkedEventGroup } from './matchLinker';
import { scrapeTheOddsApiOptional } from './oddsApiOptional';
import { scrapePinnacle, verifyPinnacleMarket } from './pinnacleBookmaker';
import { scrapePokerstars, verifyPokerstarsEvent } from './pokerstarsBookmaker';
import {
  extractBestSmarketsPrices,
  refreshSmarketsQuotesByMarkets,
  scrapeSmarketsExchange,
} from './smarketsExchange';
import { scrapeXSportBrand, verifyXSportEvent, XSPORT_BRANDS } from './xsportBookmaker';

const SOURCE_META = new Map(SOURCE_CATALOG.map((s) => [s.id, s]));
const DATE_RANGE_CACHE_TTL_MS = 3 * 60_000;
const INACTIVE_DATE_RANGE_CACHE_TTL_MS = 90_000;
const MAX_DATE_RANGE_CACHE_ENTRIES = 3;
const EXCHANGE_RESYNC_MIN_AGE_MS = 4_000;

function maxMarketCacheAgeSec(markets: RawScrapedMarket[]): number {
  let maxAge = 0;
  for (const m of markets) {
    if (m.cacheAgeSec && m.cacheAgeSec > maxAge) maxAge = m.cacheAgeSec;
  }
  return maxAge;
}

function unswapSelectionKey(selectionKey: string, swapped?: boolean): string {
  if (!swapped) return selectionKey;
  if (selectionKey === 'HOME') return 'AWAY';
  if (selectionKey === 'AWAY') return 'HOME';
  return selectionKey;
}

interface DateRangeCacheEntry {
  window: ScrapeDateWindow;
  fetchedAt: number;
  markets: RawScrapedMarket[];
}

export class ScraperEngine {
  private sourceStatuses = new Map<SourceId, SourceStatus>();
  private logs: ScrapeLogEntry[] = [];
  private previousOdds = new Map<string, { back: number; lay: number }>();
  private lastBaseRawMarkets: RawScrapedMarket[] = [];
  private dateRangeRawByKey = new Map<string, DateRangeCacheEntry>();
  private activeDateWindow: ScrapeDateWindow | null = null;
  private lastSnapshot: ScrapeSnapshot;
  private isRunning = false;
  private isTargetedRunning = false;
  private isDateRangeRunning = false;
  private dateRangeTarget: { startDate: string; endDate: string } | null = null;
  private autoScrapeEnabled = true;
  private nextAutoRefreshAt: number | null = null;
  private activeCycleAbortController: AbortController | null = null;
  private activeCyclePromise: Promise<ScrapeSnapshot> | null = null;
  private dateRangeAbortController: AbortController | null = null;
  private dateRangeCyclePromise: Promise<ScrapeSnapshot> | null = null;
  private kambiLock: Promise<void> = Promise.resolve();
  private onUpdate?: (snapshot: ScrapeSnapshot) => void;
  private checkOnline: () => boolean;

  constructor(onUpdate?: (snapshot: ScrapeSnapshot) => void, checkOnline?: () => boolean) {
    this.onUpdate = onUpdate;
    this.checkOnline = checkOnline ?? (() => true);
    for (const cfg of SOURCE_CATALOG) {
      this.sourceStatuses.set(cfg.id, {
        id: cfg.id,
        name: cfg.name,
        shortName: cfg.shortName,
        kind: cfg.kind,
        color: cfg.color,
        enabled: cfg.enabled,
        state: cfg.enabled ? 'idle' : 'disabled',
        latencyMs: 0,
        eventsCount: 0,
        marketsCount: 0,
        lastScrapedAt: null,
        lastError: null,
        successCount: 0,
        errorCount: 0,
      });
    }

    const initSources = this.getSourcesList();
    this.lastSnapshot = {
      rows: [],
      dutcherRows: [],
      backMarketGroups: [],
      sources: initSources,
      logs: [],
      connection: computeConnectionDiagnostic({
        sources: initSources,
        isSystemOnline: this.checkOnline(),
        hasCompletedCycle: false,
      }),
      stats: {
        totalRawMarkets: 0,
        linkedEventsCount: 0,
        totalMatchesCount: 0,
        surebetsCount: 0,
        lastCycleDurationMs: 0,
        lastCompletedAt: null,
        isRunning: false,
        isDateRangeScraping: false,
        activeDateRange: null,
        autoScrapeEnabled: true,
        nextAutoRefreshAt: null,
      },
    };
  }

  public getSnapshot(): ScrapeSnapshot {
    return this.lastSnapshot;
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public getActiveDateWindow(): ScrapeDateWindow | null {
    return this.activeDateWindow;
  }

  public setActiveDateWindow(window: ScrapeDateWindow | null): ScrapeSnapshot {
    this.activeDateWindow = window;
    if (!window) {
      if (this.dateRangeAbortController) {
        this.dateRangeAbortController.abort();
        this.dateRangeAbortController = null;
      }
      this.isDateRangeRunning = false;
      this.dateRangeTarget = null;
    }
    this.emitPartial();
    return this.lastSnapshot;
  }

  public setAutoRefreshMeta(
    meta: { autoScrapeEnabled?: boolean; nextAutoRefreshAt?: number | null },
    emit = true
  ): ScrapeSnapshot {
    if (meta.autoScrapeEnabled !== undefined) {
      this.autoScrapeEnabled = meta.autoScrapeEnabled;
    }
    if (meta.nextAutoRefreshAt !== undefined) {
      this.nextAutoRefreshAt = meta.nextAutoRefreshAt;
    }
    this.lastSnapshot = {
      ...this.lastSnapshot,
      stats: {
        ...this.lastSnapshot.stats,
        autoScrapeEnabled: this.autoScrapeEnabled,
        nextAutoRefreshAt: this.nextAutoRefreshAt,
      },
    };
    if (emit) {
      this.onUpdate?.(this.lastSnapshot);
    }
    return this.lastSnapshot;
  }

  public async stopActiveCycle(): Promise<ScrapeSnapshot> {
    if (this.activeCycleAbortController) {
      this.activeCycleAbortController.abort();
    }
    if (this.dateRangeAbortController) {
      this.dateRangeAbortController.abort();
    }
    const pending: Promise<unknown>[] = [];
    if (this.activeCyclePromise) pending.push(this.activeCyclePromise);
    if (this.dateRangeCyclePromise) pending.push(this.dateRangeCyclePromise);
    if (pending.length > 0) {
      await Promise.race([Promise.allSettled(pending), sleep(1500).catch(() => {})]);
    }
    return this.lastSnapshot;
  }

  private getActiveDateRangeMeta(): { startDate: string; endDate: string } | null {
    if (this.dateRangeTarget) return this.dateRangeTarget;
    if (this.activeDateWindow) {
      return {
        startDate: this.activeDateWindow.startDate,
        endDate: this.activeDateWindow.endDate,
      };
    }
    return null;
  }

  private async withKambiLock<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal,
    fallback?: T
  ): Promise<T> {
    const prev = this.kambiLock;
    let release!: () => void;
    this.kambiLock = new Promise<void>((res) => {
      release = res;
    });
    try {
      await prev;
      if (signal?.aborted) {
        return fallback as T;
      }
      return await fn();
    } finally {
      release();
    }
  }

  private getSourcesList(): SourceStatus[] {
    return SOURCE_CATALOG.map((c) => this.sourceStatuses.get(c.id)!);
  }

  public syncEnabledSources(
    enabledSources: Partial<Record<SourceId, boolean>>,
    emit = true
  ): ScrapeSnapshot {
    let changed = false;
    for (const cfg of SOURCE_CATALOG) {
      const st = this.sourceStatuses.get(cfg.id);
      if (!st) continue;
      const enabled = enabledSources[cfg.id] ?? cfg.enabled;
      if (st.enabled !== enabled) {
        st.enabled = enabled;
        changed = true;
      }
      if (!enabled && st.state !== 'disabled') {
        st.state = 'disabled';
        changed = true;
      } else if (enabled && st.state === 'disabled') {
        st.state = 'idle';
        changed = true;
      }
    }
    if (changed) {
      if (emit) {
        this.emitPartial();
      } else {
        const sources = this.getSourcesList();
        this.lastSnapshot = {
          ...this.lastSnapshot,
          sources,
          connection: computeConnectionDiagnostic({
            sources,
            isSystemOnline: this.checkOnline(),
            hasCompletedCycle: this.lastSnapshot.stats.lastCompletedAt !== null,
          }),
        };
      }
    }
    return this.lastSnapshot;
  }

  private addLog(level: ScrapeLogEntry['level'], source: string, message: string) {
    const entry: ScrapeLogEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      level,
      source,
      message,
    };
    this.logs = [entry, ...this.logs].slice(0, 180);
  }

  private emitPartial() {
    const sources = this.getSourcesList();
    this.lastSnapshot = {
      ...this.lastSnapshot,
      sources,
      logs: [...this.logs],
      connection: computeConnectionDiagnostic({
        sources,
        isSystemOnline: this.checkOnline(),
        hasCompletedCycle: this.lastSnapshot.stats.lastCompletedAt !== null,
      }),
      stats: {
        ...this.lastSnapshot.stats,
        isRunning: this.isRunning,
        isDateRangeScraping: this.isDateRangeRunning,
        activeDateRange: this.getActiveDateRangeMeta(),
        autoScrapeEnabled: this.autoScrapeEnabled,
        nextAutoRefreshAt: this.nextAutoRefreshAt,
      },
    };
    this.onUpdate?.(this.lastSnapshot);
  }

  private async runSingleSource(
    id: SourceId,
    fn: () => Promise<{ markets: RawScrapedMarket[]; latencyMs: number }>,
    signal?: AbortSignal
  ): Promise<RawScrapedMarket[]> {
    if (signal?.aborted) return [];
    const st = this.sourceStatuses.get(id)!;
    const prevState = st.state;
    const prevLastError = st.lastError;
    st.state = 'scraping';
    st.lastError = null;
    this.emitPartial();

    try {
      const { markets, latencyMs } = await fn();
      if (signal?.aborted) {
        st.state = prevState;
        st.lastError = prevLastError;
        return [];
      }
      const uniqueEvents = new Set(markets.map((m) => m.eventId)).size;
      const cacheAgeSec = maxMarketCacheAgeSec(markets);
      st.state = 'ok';
      st.latencyMs = latencyMs;
      st.eventsCount = uniqueEvents;
      st.marketsCount = markets.length;
      st.lastScrapedAt = Date.now();
      st.lastCacheAgeSec = cacheAgeSec;
      st.successCount += 1;
      const cacheNote = cacheAgeSec >= 60 ? ` (cache feed ~${Math.round(cacheAgeSec / 60)}m)` : '';
      this.addLog(
        'success',
        st.shortName,
        `Recuperati ${markets.length} mercati su ${uniqueEvents} eventi in ${latencyMs}ms${cacheNote}`
      );
      this.emitPartial();
      return markets;
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) {
        st.state = prevState;
        st.lastError = prevLastError;
        return [];
      }
      const msg = err instanceof Error ? err.message : String(err);
      st.state = 'error';
      st.lastError = msg;
      st.errorCount += 1;
      this.addLog('warn', st.shortName, msg);
      this.emitPartial();
      return [];
    }
  }

  private storeDateRangeMarkets(dateWindow: ScrapeDateWindow, markets: RawScrapedMarket[]) {
    const key = `${dateWindow.startDate}__${dateWindow.endDate}`;
    this.dateRangeRawByKey.delete(key);
    this.dateRangeRawByKey.set(key, {
      window: dateWindow,
      fetchedAt: Date.now(),
      markets,
    });
    // Prune expired or overflow entries (keeping the active window if present)
    const nowMs = Date.now();
    const activeKey = this.activeDateWindow
      ? `${this.activeDateWindow.startDate}__${this.activeDateWindow.endDate}`
      : null;
    for (const [k, entry] of this.dateRangeRawByKey) {
      if (k !== activeKey && nowMs - entry.fetchedAt > DATE_RANGE_CACHE_TTL_MS) {
        this.dateRangeRawByKey.delete(k);
      }
    }
    while (this.dateRangeRawByKey.size > MAX_DATE_RANGE_CACHE_ENTRIES) {
      const oldestKey = [...this.dateRangeRawByKey.keys()].find((k) => k !== activeKey);
      if (!oldestKey) break;
      this.dateRangeRawByKey.delete(oldestKey);
    }
  }

  private collectCombinedRawMarkets(settings: AppSettings, nowMs = Date.now()): RawScrapedMarket[] {
    const activeKey = this.activeDateWindow
      ? `${this.activeDateWindow.startDate}__${this.activeDateWindow.endDate}`
      : null;
    for (const [k, entry] of this.dateRangeRawByKey) {
      const ttl = k === activeKey ? DATE_RANGE_CACHE_TTL_MS : INACTIVE_DATE_RANGE_CACHE_TTL_MS;
      if (nowMs - entry.fetchedAt > ttl) {
        this.dateRangeRawByKey.delete(k);
      }
    }

    const dedup = new Map<string, RawScrapedMarket>();
    const addMarket = (m: RawScrapedMarket) => {
      if (settings.enabledSources[m.sourceId] === false) return;
      if (!settings.includeLiveEvents) {
        const startMs = Date.parse(m.startTime);
        if (Number.isFinite(startMs) && startMs < nowMs - 30_000) return;
      }
      const key = `${m.sourceId}|${m.sourceName}|${m.eventId}|${m.marketType}`;
      const existing = dedup.get(key);
      if (!existing || m.scrapedAt >= existing.scrapedAt) {
        dedup.set(key, m);
      }
    };

    for (const m of this.lastBaseRawMarkets) addMarket(m);
    for (const entry of this.dateRangeRawByKey.values()) {
      for (const m of entry.markets) addMarket(m);
    }
    return [...dedup.values()];
  }

  private async runDateRangeSource(
    id: SourceId,
    fn: () => Promise<{ markets: RawScrapedMarket[]; latencyMs: number }>,
    signal?: AbortSignal
  ): Promise<RawScrapedMarket[]> {
    if (signal?.aborted) return [];
    const st = this.sourceStatuses.get(id)!;
    try {
      const { markets, latencyMs } = await fn();
      if (signal?.aborted) return [];
      const uniqueEvents = new Set(markets.map((m) => m.eventId)).size;
      st.state = 'ok';
      st.latencyMs = latencyMs;
      if (st.eventsCount === 0 && uniqueEvents > 0) {
        st.eventsCount = uniqueEvents;
        st.marketsCount = markets.length;
      }
      st.lastScrapedAt = Date.now();
      st.lastCacheAgeSec = maxMarketCacheAgeSec(markets);
      st.successCount += 1;
      return markets;
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) return [];
      const msg = err instanceof Error ? err.message : String(err);
      if (st.state !== 'ok') {
        st.state = 'error';
        st.lastError = msg;
      }
      st.errorCount += 1;
      this.addLog('warn', st.shortName, `Periodo futuro: ${msg}`);
      return [];
    }
  }

  /**
   * Re-polls live Exchange prices (Betfair EX & Smarkets) at the end of a multi-second cycle
   * so Exchange quotes are synchronized (<1s skew) with bookmakers that finished last.
   */
  private async resyncStaleExchangeQuotes(
    allRaw: RawScrapedMarket[],
    includeLive: boolean,
    signal?: AbortSignal
  ): Promise<void> {
    if (signal?.aborted) return;
    const nowMs = Date.now();
    const hasBookmakers = allRaw.some((m) => m.sourceKind === 'bookmaker');
    if (!hasBookmakers) return;

    const staleBfMarkets = allRaw.filter(
      (m) =>
        m.sourceId === 'betfair_exchange' &&
        Boolean(m.sourceMarketId) &&
        nowMs - m.scrapedAt >= EXCHANGE_RESYNC_MIN_AGE_MS
    );
    const staleSmMarkets = allRaw.filter(
      (m) =>
        m.sourceId === 'smarkets_exchange' &&
        Boolean(m.sourceMarketId) &&
        Boolean(m.sourceMetadata) &&
        nowMs - m.scrapedAt >= 6_000
    );

    if (staleBfMarkets.length === 0 && staleSmMarkets.length === 0) return;

    const bfIds = Array.from(
      new Set(staleBfMarkets.map((m) => m.sourceMarketId!).filter(Boolean))
    ).slice(0, 80);
    const smIds = Array.from(
      new Set(staleSmMarkets.map((m) => m.sourceMarketId!).filter(Boolean))
    ).slice(0, 30);

    const [bfRes, smRes] = await Promise.allSettled([
      bfIds.length > 0
        ? refreshBetfairExchangeMarkets({ marketIds: bfIds, includeLive, signal })
        : Promise.resolve(null),
      smIds.length > 0
        ? refreshSmarketsQuotesByMarkets({ marketIds: smIds, signal })
        : Promise.resolve(null),
    ]);

    if (signal?.aborted) return;

    let refreshedCount = 0;

    if (bfRes.status === 'fulfilled' && bfRes.value && bfRes.value.marketsByMarketId.size > 0) {
      const freshMap = bfRes.value.marketsByMarketId;
      for (const m of staleBfMarkets) {
        if (!m.sourceMarketId) continue;
        const fresh = freshMap.get(m.sourceMarketId);
        if (fresh) {
          m.selections = fresh.selections;
          m.scrapedAt = fresh.scrapedAt;
          m.cacheAgeSec = fresh.cacheAgeSec;
          refreshedCount++;
        }
      }
      const bfSt = this.sourceStatuses.get('betfair_exchange');
      if (bfSt) bfSt.lastScrapedAt = Date.now();
    }

    if (smRes.status === 'fulfilled' && smRes.value) {
      const qMap = smRes.value.quotesByContractId;
      const smScrapedAt = computeEffectiveScrapedAt(Date.now(), smRes.value.cacheAgeSec);
      for (const m of staleSmMarkets) {
        if (!m.sourceMetadata) continue;
        let touched = false;
        const nextSels = m.selections
          .map((sel) => {
            const cid = m.sourceMetadata?.[`cid_${sel.canonicalKey}`];
            if (!cid || !(cid in qMap)) return sel;
            const prices = extractBestSmarketsPrices(qMap[cid]);
            touched = true;
            return {
              ...sel,
              backOdds: prices.backOdds,
              backLiquidity: prices.backLiquidity,
              layOdds: prices.layOdds,
              layLiquidity: prices.layLiquidity,
            };
          })
          .filter((s) => Boolean(s.layOdds || s.backOdds));
        if (touched) {
          m.selections = nextSels;
          m.scrapedAt = smScrapedAt;
          m.cacheAgeSec = smRes.value.cacheAgeSec;
          refreshedCount++;
        }
      }
      const smSt = this.sourceStatuses.get('smarkets_exchange');
      if (smSt) smSt.lastScrapedAt = Date.now();
    }

    if (refreshedCount > 0) {
      this.addLog(
        'info',
        'SYNC',
        `Riallineati in tempo reale ${refreshedCount} mercati Exchange a fine ciclo per azzerare lo scarto temporale`
      );
    }
  }

  private async scrapeAllSources(
    settings: AppSettings,
    filter: TargetedScrapeFilter | undefined,
    signal: AbortSignal,
    mode: 'full' | 'date_range'
  ): Promise<RawScrapedMarket[]> {
    const includeLive = settings.includeLiveEvents;
    const allRaw: RawScrapedMarket[] = [];
    const runSource =
      mode === 'full'
        ? (
            id: SourceId,
            fn: () => Promise<{ markets: RawScrapedMarket[]; latencyMs: number }>
          ) => this.runSingleSource(id, fn, signal)
        : (
            id: SourceId,
            fn: () => Promise<{ markets: RawScrapedMarket[]; latencyMs: number }>
          ) => this.runDateRangeSource(id, fn, signal);

    const enabledAdmIds = ITALIAN_ADM_BOOKMAKERS.map((b) => b.sourceId).filter(
      (id) => settings.enabledSources[id]
    );

    // 0. Prefetch Diretta schedules immediately at t=0s in parallel with Exchanges
    const admSchedulePromise =
      enabledAdmIds.length > 0
        ? prefetchDirettaSchedules({ includeLive, filter, signal }).catch(() => undefined)
        : Promise.resolve(undefined);

    // 1. Kick off fast Exchanges (Betfair EX, Smarkets) and slower Betflag EX in parallel
    const fastExchangeTasks: Array<Promise<RawScrapedMarket[]>> = [];
    if (settings.enabledSources.betfair_exchange) {
      fastExchangeTasks.push(
        runSource('betfair_exchange', () => scrapeBetfairExchange(includeLive, filter, signal))
      );
    }
    if (settings.enabledSources.smarkets_exchange) {
      fastExchangeTasks.push(
        runSource('smarkets_exchange', () => scrapeSmarketsExchange(includeLive, filter, signal))
      );
    }

    const betflagExchangeTask: Promise<RawScrapedMarket[]> = settings.enabledSources.betflag_exchange
      ? runSource('betflag_exchange', () => scrapeBetflagExchange(includeLive, filter, signal))
      : Promise.resolve([]);

    // 2. Simultaneously kick off non-ADM bookmakers
    const otherBookieTasks: Array<Promise<RawScrapedMarket[]>> = [];
    if (settings.enabledSources.betfair_sportsbook) {
      otherBookieTasks.push(
        runSource('betfair_sportsbook', () => scrapeBetfairSportsbook(includeLive, filter, signal))
      );
    }
    if (settings.enabledSources.giocodigitale_it) {
      otherBookieTasks.push(
        runSource('giocodigitale_it', () => scrapeGiocoDigitale(includeLive, filter, signal))
      );
    }
    if (settings.enabledSources.pokerstars_it) {
      otherBookieTasks.push(
        runSource('pokerstars_it', () => scrapePokerstars(includeLive, filter, signal))
      );
    }
    for (const xid of XSPORT_SOURCES) {
      if (!settings.enabledSources[xid]) continue;
      const spec = XSPORT_BRANDS[xid];
      if (!spec) continue;
      otherBookieTasks.push(
        runSource(xid, () => scrapeXSportBrand(spec, includeLive, filter, signal))
      );
    }
    if (settings.enabledSources.pinnacle) {
      otherBookieTasks.push(
        runSource('pinnacle', () => scrapePinnacle(includeLive, filter, signal))
      );
    }
    if (settings.enabledSources.the_odds_api && settings.theOddsApiKey.trim()) {
      otherBookieTasks.push(
        runSource('the_odds_api', () =>
          scrapeTheOddsApiOptional(settings.theOddsApiKey, filter, signal)
        )
      );
    }

    // Kambi brands paced politely under a mutex so concurrent full & date-range cycles never trigger HTTP 429
    const kambiTask = this.withKambiLock(
      async (): Promise<RawScrapedMarket[]> => {
        const kambiIds: SourceId[] = ['888sport_it', 'leovegas_it', 'unibet', 'paf'];
        const results: RawScrapedMarket[] = [];
        for (const kid of kambiIds) {
          if (signal.aborted) break;
          if (!settings.enabledSources[kid]) continue;
          const spec = KAMBI_BRANDS[kid];
          if (!spec) continue;
          const mkts = await runSource(kid, () => scrapeKambiBrand(spec, includeLive, filter, signal));
          results.push(...mkts);
          if (signal.aborted) break;
          try {
            await sleep(mode === 'date_range' ? 180 : 240, signal);
          } catch (err) {
            if (signal.aborted || isAbortError(err)) break;
            throw err;
          }
        }
        return results;
      },
      signal,
      []
    );

    // 3. Wait only for fast Exchanges (or Betflag EX if neither Betfair nor Smarkets is enabled)
    //    so ADM scraping starts immediately without stalling on slow/blocked Betflag EX!
    let fastExchangeMarkets: RawScrapedMarket[] = [];
    let betflagAlreadyMerged = false;
    if (fastExchangeTasks.length > 0) {
      const fastChunks = await Promise.all(fastExchangeTasks);
      fastExchangeMarkets = fastChunks.flat();
      allRaw.push(...fastExchangeMarkets);
    } else if (settings.enabledSources.betflag_exchange) {
      fastExchangeMarkets = await betflagExchangeTask;
      allRaw.push(...fastExchangeMarkets);
      betflagAlreadyMerged = true;
    }

    const admTask = (async (): Promise<RawScrapedMarket[]> => {
      if (enabledAdmIds.length === 0 || signal.aborted) return [];
      const prevAdmStates = new Map<SourceId, { state: SourceStatus['state']; lastError: string | null }>();
      if (mode === 'full') {
        for (const id of enabledAdmIds) {
          const st = this.sourceStatuses.get(id)!;
          prevAdmStates.set(id, { state: st.state, lastError: st.lastError });
          st.state = 'scraping';
          st.lastError = null;
        }
        this.emitPartial();
      }

      try {
        const prefetchedSchedule = await admSchedulePromise;
        const { marketsBySource, latencyMs } = await scrapeItalianAdmBookmakers({
          exchangeMarkets: fastExchangeMarkets,
          enabledSourceIds: enabledAdmIds,
          includeLive,
          filter,
          prefetchedSchedule,
          signal,
        });

        if (signal.aborted) {
          if (mode === 'full') {
            for (const id of enabledAdmIds) {
              const st = this.sourceStatuses.get(id)!;
              const prev = prevAdmStates.get(id);
              if (prev) {
                st.state = prev.state;
                st.lastError = prev.lastError;
              }
            }
          }
          return [];
        }

        const combined: RawScrapedMarket[] = [];
        for (const id of enabledAdmIds) {
          const mkts = marketsBySource.get(id) ?? [];
          const st = this.sourceStatuses.get(id)!;
          const uniqueEvents = new Set(mkts.map((m) => m.eventId)).size;
          st.state = 'ok';
          st.latencyMs = latencyMs;
          if (mode === 'full' || (st.eventsCount === 0 && uniqueEvents > 0)) {
            st.eventsCount = uniqueEvents;
            st.marketsCount = mkts.length;
          }
          st.lastScrapedAt = Date.now();
          st.lastCacheAgeSec = maxMarketCacheAgeSec(mkts);
          st.successCount += 1;
          if (mode === 'full') {
            this.addLog(
              'success',
              st.shortName,
              `Recuperati ${mkts.length} mercati ADM su ${uniqueEvents} eventi in ${latencyMs}ms`
            );
          }
          combined.push(...mkts);
        }
        if (mode === 'full') {
          this.emitPartial();
        }
        return combined;
      } catch (err) {
        if (signal.aborted || isAbortError(err)) {
          if (mode === 'full') {
            for (const id of enabledAdmIds) {
              const st = this.sourceStatuses.get(id)!;
              const prev = prevAdmStates.get(id);
              if (prev) {
                st.state = prev.state;
                st.lastError = prev.lastError;
              }
            }
          }
          return [];
        }
        const msg = err instanceof Error ? err.message : String(err);
        for (const id of enabledAdmIds) {
          const st = this.sourceStatuses.get(id)!;
          if (mode === 'full' || st.state !== 'ok') {
            st.state = 'error';
            st.lastError = msg;
          }
          st.errorCount += 1;
        }
        this.addLog(
          mode === 'full' ? 'error' : 'warn',
          'ADM-IT',
          mode === 'full'
            ? `Errore scraping ADM: ${msg}`
            : `Errore scraping ADM periodo futuro: ${msg}`
        );
        if (mode === 'full') {
          this.emitPartial();
        }
        return [];
      }
    })();

    const remainingTasks: Array<Promise<RawScrapedMarket[]>> = [
      ...otherBookieTasks,
      kambiTask,
      admTask,
    ];
    if (!betflagAlreadyMerged) {
      remainingTasks.push(betflagExchangeTask);
    }

    const remainingSettled = await Promise.all(remainingTasks);
    if (signal.aborted) return [];
    for (const chunk of remainingSettled) allRaw.push(...chunk);

    // 4. End-of-cycle fast Exchange re-sync to eliminate intra-cycle skew when cycle took >4s
    await this.resyncStaleExchangeQuotes(allRaw, includeLive, signal);
    if (signal.aborted) return [];

    return allRaw;
  }

  private buildDerivedSnapshotData(
    allRaw: RawScrapedMarket[],
    settings: AppSettings
  ): {
    groups: LinkedEventGroup[];
    oddsmatcherRows: OddsmatcherRow[];
    dutcherRows: DutcherRow[];
    backMarketGroups: BackMarketGroup[];
    surebetsCount: number;
  } {
    const groups = linkScrapedMarkets(allRaw);
    const nextOddsCache = new Map<string, { back: number; lay: number }>();
    const oddsmatcherRows = this.buildOddsmatcherRowsFromGroups(groups, settings, nextOddsCache);
    const dutcherRows: DutcherRow[] = [];
    const backMarketGroups: BackMarketGroup[] = [];
    const nowCycle = Date.now();
    const formatSelLabel = (key: string, homeTeam: string, awayTeam: string): string =>
      key === 'HOME'
        ? `${homeTeam} (1)`
        : key === 'AWAY'
        ? `${awayTeam} (2)`
        : key === 'DRAW'
        ? 'Pareggio (X)'
        : key === 'OVER_25'
        ? 'Over 2.5'
        : key === 'UNDER_25'
        ? 'Under 2.5'
        : key === 'BTTS_YES'
        ? 'Goal (Sì)'
        : 'NoGoal (No)';

    for (const g of groups) {
      for (const [marketType, entries] of g.marketsByType) {
        const allBackSources = entries.filter(
          (e) => e.market.sourceKind === 'bookmaker' && e.selections.length >= 2
        );
        if (allBackSources.length >= 1) {
          const requiredKeys =
            marketType === '1X2'
              ? ['HOME', 'DRAW', 'AWAY']
              : marketType === 'OVER_UNDER_25'
              ? ['OVER_25', 'UNDER_25']
              : marketType === 'BTTS'
              ? ['BTTS_YES', 'BTTS_NO']
              : ['HOME', 'AWAY'];

          const marketLabel =
            marketType === '1X2'
              ? 'Esito Finale 1X2'
              : marketType === 'OVER_UNDER_25'
              ? 'Under/Over 2.5 Gol'
              : marketType === 'BTTS'
              ? 'Goal / NoGoal'
              : 'Testa a Testa';

          const bestLegs: DutcherLeg[] = [];
          const groupQuotes: BackOutcomeQuote[] = [];
          const dedupQuotes = new Map<string, BackOutcomeQuote>();
          const coveredKeys = new Set<string>();

          for (const key of requiredKeys) {
            let best: DutcherLeg | null = null;
            const selLabel = formatSelLabel(key, g.homeTeam, g.awayTeam);
            for (const src of allBackSources) {
              const sel = src.selections.find((s) => s.canonicalKey === key);
              if (!sel?.backOdds || sel.backOdds <= 1.01) continue;
              const meta = SOURCE_META.get(src.market.sourceId);
              const eventUrl = src.market.eventUrl ?? meta?.url;
              coveredKeys.add(key);

              const qKey = `${key}|${src.market.sourceId}`;
              const existingQ = dedupQuotes.get(qKey);
              if (
                !existingQ ||
                src.market.scrapedAt > existingQ.updatedAt ||
                (src.market.scrapedAt === existingQ.updatedAt && sel.backOdds > existingQ.odds)
              ) {
                dedupQuotes.set(qKey, {
                  selectionKey: key,
                  selectionLabel: selLabel,
                  bookmakerId: src.market.sourceId,
                  bookmakerName: src.market.sourceName,
                  odds: sel.backOdds,
                  eventUrl,
                  eventId: src.market.eventId,
                  marketId: src.market.sourceMarketId,
                  sourceMetadata: src.market.sourceMetadata,
                  swapped: src.swapped,
                  cacheAgeSec: src.market.cacheAgeSec ?? 0,
                  isAggregator: Boolean(src.market.isAggregator),
                  updatedAt: src.market.scrapedAt || nowCycle,
                });
              }

              if (!best || sel.backOdds > best.odds) {
                best = {
                  selectionKey: key,
                  selectionLabel: selLabel,
                  bookmakerId: src.market.sourceId,
                  bookmakerName: src.market.sourceName,
                  bookmakerColor: meta?.color ?? '#3b82f6',
                  odds: sel.backOdds,
                  bookmakerUrl: eventUrl,
                };
              }
            }
            if (best) bestLegs.push(best);
          }

          if (coveredKeys.size === requiredKeys.length) {
            groupQuotes.push(...dedupQuotes.values());
            const groupUpdatedAt =
              groupQuotes.length > 0
                ? Math.min(...groupQuotes.map((q) => q.updatedAt))
                : nowCycle;
            backMarketGroups.push({
              id: `${g.eventKey}|${marketType}`,
              eventKey: g.eventKey,
              sport: g.sport,
              league: g.league,
              eventName: g.eventName,
              homeTeam: g.homeTeam,
              awayTeam: g.awayTeam,
              startTime: g.startTime,
              marketType,
              marketLabel,
              outcomes: requiredKeys.map((key) => ({
                key,
                label: formatSelLabel(key, g.homeTeam, g.awayTeam),
              })),
              quotes: groupQuotes,
              updatedAt: groupUpdatedAt,
            });
          }

          if (allBackSources.length >= 2 && bestLegs.length === requiredKeys.length) {
            const impliedProbSum = bestLegs.reduce((acc, l) => acc + 1 / l.odds, 0);
            const rating = round2((1 / impliedProbSum) * 100);
            if (rating >= 75 && rating <= 118) {
              const legAges = bestLegs.map(
                (l) => dedupQuotes.get(`${l.selectionKey}|${l.bookmakerId}`)?.updatedAt ?? nowCycle
              );
              dutcherRows.push({
                id: `dutch|${g.eventKey}|${marketType}`,
                eventKey: g.eventKey,
                sport: g.sport,
                league: g.league,
                eventName: g.eventName,
                startTime: g.startTime,
                marketType,
                marketLabel,
                legs: bestLegs,
                impliedProbSum: Math.round(impliedProbSum * 10000) / 10000,
                rating,
                isSurebet: rating >= 100,
                updatedAt: Math.min(...legAges),
              });
            }
          }
        }
      }
    }

    this.previousOdds = nextOddsCache;
    oddsmatcherRows.sort((a, b) => b.ratingNormal - a.ratingNormal || b.liquidity - a.liquidity);
    dutcherRows.sort((a, b) => b.rating - a.rating);
    const surebetsCount = oddsmatcherRows.filter((r) => r.isSurebet).length;

    return { groups, oddsmatcherRows, dutcherRows, backMarketGroups, surebetsCount };
  }

  public async runCycle(settings: AppSettings): Promise<ScrapeSnapshot> {
    if (this.isRunning && this.activeCyclePromise) {
      return this.activeCyclePromise;
    }
    const promise = this._executeCycle(settings);
    this.activeCyclePromise = promise;
    try {
      return await promise;
    } finally {
      if (this.activeCyclePromise === promise) {
        this.activeCyclePromise = null;
      }
    }
  }

  public async runDateRangeCycle(
    settings: AppSettings,
    dateWindow: ScrapeDateWindow
  ): Promise<ScrapeSnapshot> {
    if (
      !dateWindow ||
      !dateWindow.startDate ||
      !dateWindow.endDate ||
      !Number.isFinite(dateWindow.startMs) ||
      !Number.isFinite(dateWindow.endMs) ||
      dateWindow.endMs < dateWindow.startMs
    ) {
      return this.lastSnapshot;
    }

    // Abort any older in-flight date-range scrape so rapid filter changes stay snappy and race-free
    if (this.dateRangeAbortController) {
      this.dateRangeAbortController.abort();
    }

    const abortController = new AbortController();
    setMaxListeners(128, abortController.signal);
    const signal = abortController.signal;
    this.dateRangeAbortController = abortController;
    this.activeDateWindow = dateWindow;
    this.isDateRangeRunning = true;
    this.dateRangeTarget = { startDate: dateWindow.startDate, endDate: dateWindow.endDate };

    const label = formatScrapeDateWindowLabel(dateWindow);
    const cycleStart = Date.now();

    const promise = (async (): Promise<ScrapeSnapshot> => {
      try {
        for (const cfg of SOURCE_CATALOG) {
          const st = this.sourceStatuses.get(cfg.id)!;
          const enabled = settings.enabledSources[cfg.id] ?? cfg.enabled;
          st.enabled = enabled;
          if (!enabled) st.state = 'disabled';
        }

        if (!this.checkOnline()) {
          this.addLog(
            'error',
            'PERIODO',
            `Connessione internet assente: impossibile cercare quote per il periodo ${label}.`
          );
          if (this.dateRangeAbortController === abortController) {
            this.isDateRangeRunning = false;
            this.dateRangeTarget = null;
          }
          this.emitPartial();
          return this.lastSnapshot;
        }

        this.addLog(
          'info',
          'PERIODO',
          `Avvio ricerca quote per il periodo ${label} su Exchange e Bookmaker...`
        );
        this.emitPartial();

        const rangeRaw = await this.scrapeAllSources(
          settings,
          { dateWindow },
          signal,
          'date_range'
        );

        if (signal.aborted) {
          return this.lastSnapshot;
        }

        this.storeDateRangeMarkets(dateWindow, rangeRaw);
        const combinedRaw = this.collectCombinedRawMarkets(settings);
        const { groups, oddsmatcherRows, dutcherRows, backMarketGroups, surebetsCount } =
          this.buildDerivedSnapshotData(combinedRaw, settings);

        const durationMs = Date.now() - cycleStart;
        const windowEventsCount = groups.filter((g) =>
          matchesScrapeDateWindow(g.startMs, dateWindow)
        ).length;
        const windowMatchesCount = oddsmatcherRows.filter((r) =>
          matchesScrapeDateWindow(r.startTime, dateWindow)
        ).length;
        const windowGroupsCount = backMarketGroups.filter((g) =>
          matchesScrapeDateWindow(g.startTime, dateWindow)
        ).length;

        this.addLog(
          windowMatchesCount > 0 || windowGroupsCount > 0 ? 'success' : 'info',
          'PERIODO',
          `Periodo ${label}: trovati ${windowEventsCount} eventi (${windowMatchesCount} quote Punta/Banca, ${windowGroupsCount} mercati Punta-Punta) in ${(
            durationMs / 1000
          ).toFixed(1)}s`
        );

        if (this.dateRangeAbortController === abortController) {
          this.isDateRangeRunning = false;
          this.dateRangeTarget = null;
        }

        const finalSources = this.getSourcesList();
        const finalConnection = computeConnectionDiagnostic({
          sources: finalSources,
          isSystemOnline: this.checkOnline(),
          hasCompletedCycle: true,
        });

        this.lastSnapshot = {
          rows: oddsmatcherRows,
          dutcherRows,
          backMarketGroups,
          sources: finalSources,
          logs: [...this.logs],
          connection: finalConnection,
          stats: {
            ...this.lastSnapshot.stats,
            totalRawMarkets: combinedRaw.length,
            linkedEventsCount: groups.length,
            totalMatchesCount: oddsmatcherRows.length,
            surebetsCount,
            lastCompletedAt: Date.now(),
            isRunning: this.isRunning,
            isDateRangeScraping: this.isDateRangeRunning,
            activeDateRange: this.getActiveDateRangeMeta(),
            autoScrapeEnabled: this.autoScrapeEnabled,
            nextAutoRefreshAt: this.nextAutoRefreshAt,
          },
        };
        this.onUpdate?.(this.lastSnapshot);
        return this.lastSnapshot;
      } finally {
        if (this.dateRangeAbortController === abortController) {
          this.dateRangeAbortController = null;
          if (this.isDateRangeRunning) {
            this.isDateRangeRunning = false;
            this.dateRangeTarget = null;
            this.emitPartial();
          }
        }
      }
    })();

    this.dateRangeCyclePromise = promise;
    try {
      return await promise;
    } finally {
      if (this.dateRangeCyclePromise === promise) {
        this.dateRangeCyclePromise = null;
      }
    }
  }

  private async _executeCycle(settings: AppSettings): Promise<ScrapeSnapshot> {
    if (this.isRunning) return this.lastSnapshot;
    const abortController = new AbortController();
    setMaxListeners(128, abortController.signal);
    const signal = abortController.signal;
    this.activeCycleAbortController = abortController;
    this.isRunning = true;
    const cycleStart = Date.now();

    try {
      for (const cfg of SOURCE_CATALOG) {
        const st = this.sourceStatuses.get(cfg.id)!;
        const enabled = settings.enabledSources[cfg.id] ?? cfg.enabled;
        st.enabled = enabled;
        if (!enabled) st.state = 'disabled';
      }

      // Fast-fail cleanly if the OS reports offline connectivity
      if (!this.checkOnline()) {
        for (const cfg of SOURCE_CATALOG) {
          const st = this.sourceStatuses.get(cfg.id)!;
          if (st.enabled) {
            st.state = 'error';
            st.lastError = 'Nessuna connessione internet rilevata';
            st.errorCount += 1;
          }
        }
        this.addLog(
          'error',
          'RETE',
          'Connessione internet assente: impossibile contattare bookmaker ed exchange.'
        );
        this.isRunning = false;
        const sources = this.getSourcesList();
        this.lastSnapshot = {
          ...this.lastSnapshot,
          sources,
          logs: [...this.logs],
          connection: computeConnectionDiagnostic({
            sources,
            isSystemOnline: false,
            hasCompletedCycle: true,
          }),
          stats: {
            ...this.lastSnapshot.stats,
            lastCycleDurationMs: Date.now() - cycleStart,
            lastCompletedAt: Date.now(),
            isRunning: false,
            isDateRangeScraping: this.isDateRangeRunning,
            activeDateRange: this.getActiveDateRangeMeta(),
            autoScrapeEnabled: this.autoScrapeEnabled,
            nextAutoRefreshAt: this.nextAutoRefreshAt,
          },
        };
        this.onUpdate?.(this.lastSnapshot);
        return this.lastSnapshot;
      }

      this.addLog(
        'info',
        'ENGINE',
        'Avvio ciclo di scraping live su Exchange e Bookmaker italiani ADM / EU...'
      );
      this.emitPartial();

      const baseRaw = await this.scrapeAllSources(settings, undefined, signal, 'full');
      if (signal.aborted) {
        this.isRunning = false;
        this.addLog('info', 'ENGINE', "Ciclo di scraping fermato dall'utente.");
        this.emitPartial();
        return this.lastSnapshot;
      }
      this.lastBaseRawMarkets = baseRaw;

      // Keep any actively filtered future date range refreshed during periodic/manual full cycles
      const activeWin = this.activeDateWindow;
      if (activeWin && activeWin.endMs >= Date.now() && !this.isDateRangeRunning && !signal.aborted) {
        const rangeRaw = await this.scrapeAllSources(
          settings,
          { dateWindow: activeWin },
          signal,
          'date_range'
        );
        if (signal.aborted) {
          this.isRunning = false;
          this.addLog('info', 'ENGINE', "Ciclo di scraping fermato dall'utente.");
          this.emitPartial();
          return this.lastSnapshot;
        }
        this.storeDateRangeMarkets(activeWin, rangeRaw);
      }

      const combinedRaw = this.collectCombinedRawMarkets(settings);
      const { groups, oddsmatcherRows, dutcherRows, backMarketGroups, surebetsCount } =
        this.buildDerivedSnapshotData(combinedRaw, settings);

      const durationMs = Date.now() - cycleStart;

      this.addLog(
        'info',
        'LINKER',
        `Abbinati ${oddsmatcherRows.length} match Punta/Banca (${surebetsCount} surebet >=100%) e ${dutcherRows.length} mercati Dutcher da ${groups.length} eventi in ${(durationMs / 1000).toFixed(1)}s`
      );

      this.isRunning = false;
      const finalSources = this.getSourcesList();
      const finalConnection = computeConnectionDiagnostic({
        sources: finalSources,
        isSystemOnline: this.checkOnline(),
        hasCompletedCycle: true,
      });

      if (finalConnection.health === 'offline') {
        this.addLog(
          'error',
          'RETE',
          `Problemi di connessione rilevati (${finalConnection.failedSourcesCount}/${finalConnection.enabledSourcesCount} fonti non raggiungibili): ${finalConnection.lastErrorSummary ?? 'verifica rete'}`
        );
      }

      this.lastSnapshot = {
        rows: oddsmatcherRows,
        dutcherRows,
        backMarketGroups,
        sources: finalSources,
        logs: [...this.logs],
        connection: finalConnection,
        stats: {
          totalRawMarkets: combinedRaw.length,
          linkedEventsCount: groups.length,
          totalMatchesCount: oddsmatcherRows.length,
          surebetsCount,
          lastCycleDurationMs: durationMs,
          lastCompletedAt: Date.now(),
          isRunning: false,
          isDateRangeScraping: this.isDateRangeRunning,
          activeDateRange: this.getActiveDateRangeMeta(),
          autoScrapeEnabled: this.autoScrapeEnabled,
          nextAutoRefreshAt: this.nextAutoRefreshAt,
        },
      };
      this.onUpdate?.(this.lastSnapshot);
      return this.lastSnapshot;
    } finally {
      if (this.activeCycleAbortController === abortController) {
        this.activeCycleAbortController = null;
      }
      if (this.isRunning) {
        this.isRunning = false;
        this.emitPartial();
      }
    }
  }

  private buildOddsmatcherRowsFromGroups(
    groups: LinkedEventGroup[],
    settings: AppSettings,
    nextOddsCache: Map<string, { back: number; lay: number }>
  ): OddsmatcherRow[] {
    const oddsmatcherRows: OddsmatcherRow[] = [];

    for (const g of groups) {
      for (const [marketType, entries] of g.marketsByType) {
        const exchanges = entries.filter((e) => e.market.sourceKind === 'exchange');
        const bookmakers = entries.filter((e) => e.market.sourceKind === 'bookmaker');

        if (exchanges.length === 0 || bookmakers.length === 0) continue;

        for (const bk of bookmakers) {
          const bkMeta = SOURCE_META.get(bk.market.sourceId);
          for (const ex of exchanges) {
            const exMeta = SOURCE_META.get(ex.market.sourceId);
            const commission =
              ex.market.sourceId === 'betfair_exchange'
                ? settings.betfairCommission
                : ex.market.sourceId === 'smarkets_exchange'
                ? settings.smarketsCommission
                : ex.market.sourceId === 'betflag_exchange'
                ? settings.betflagCommission
                : exMeta?.defaultCommission ?? 0.05;

            const exSelMap = new Map(ex.selections.map((s) => [s.canonicalKey, s]));

            for (const bSel of bk.selections) {
              if (!bSel.backOdds || bSel.backOdds <= 1.01) continue;
              const eSel = exSelMap.get(bSel.canonicalKey);
              if (!eSel || !eSel.layOdds || eSel.layOdds <= 1.01) continue;

              const ratio = bSel.backOdds / eSel.layOdds;
              if (ratio < 0.45 || ratio > 1.35) continue;

              const rowId = `${g.eventKey}|${marketType}|${bSel.canonicalKey}|${bk.market.sourceId}|${bk.market.sourceName}|${ex.market.sourceId}`;
              const prev = this.previousOdds.get(rowId);
              let backDelta: OddsDelta = 'same';
              let layDelta: OddsDelta = 'same';
              if (prev) {
                if (bSel.backOdds > prev.back + 0.001) backDelta = 'up';
                else if (bSel.backOdds < prev.back - 0.001) backDelta = 'down';
                if (eSel.layOdds > prev.lay + 0.001) layDelta = 'up';
                else if (eSel.layOdds < prev.lay - 0.001) layDelta = 'down';
              }
              nextOddsCache.set(rowId, { back: bSel.backOdds, lay: eSel.layOdds });

              const ratings = quickRatings(bSel.backOdds, eSel.layOdds, commission);

              const displaySelLabel =
                bSel.canonicalKey === 'HOME'
                  ? `${g.homeTeam} (1)`
                  : bSel.canonicalKey === 'AWAY'
                  ? `${g.awayTeam} (2)`
                  : bSel.canonicalKey === 'DRAW'
                  ? 'Pareggio (X)'
                  : bSel.canonicalKey === 'OVER_25'
                  ? 'Over 2.5'
                  : bSel.canonicalKey === 'UNDER_25'
                  ? 'Under 2.5'
                  : bSel.canonicalKey === 'BTTS_YES'
                  ? 'Goal (Sì)'
                  : bSel.canonicalKey === 'BTTS_NO'
                  ? 'NoGoal (No)'
                  : bSel.label;

              const bkScrapedAt = bk.market.scrapedAt || Date.now();
              const exScrapedAt = ex.market.scrapedAt || Date.now();

              oddsmatcherRows.push({
                id: rowId,
                eventKey: g.eventKey,
                sport: g.sport,
                league: g.league,
                eventName: g.eventName,
                homeTeam: g.homeTeam,
                awayTeam: g.awayTeam,
                startTime: g.startTime,
                marketType,
                marketLabel: ex.market.marketLabel || bk.market.marketLabel,
                selectionKey: bSel.canonicalKey,
                selectionLabel: displaySelLabel,
                bookmakerId: bk.market.sourceId,
                bookmakerName: bk.market.sourceName,
                bookmakerColor: bkMeta?.color ?? '#3b82f6',
                bookmakerUrl: bk.market.eventUrl ?? bkMeta?.url,
                bookmakerEventId: bk.market.eventId,
                bookmakerMarketId: bk.market.sourceMarketId,
                bookmakerMetadata: bk.market.sourceMetadata,
                bookmakerSwapped: bk.swapped,
                bookmakerScrapedAt: bkScrapedAt,
                bookmakerCacheAgeSec: bk.market.cacheAgeSec ?? 0,
                bookmakerIsAggregator: Boolean(bk.market.isAggregator),
                backOdds: bSel.backOdds,
                backDelta,
                exchangeId: ex.market.sourceId,
                exchangeName: ex.market.sourceName,
                exchangeColor: exMeta?.color ?? '#ffb80c',
                exchangeUrl: ex.market.eventUrl ?? exMeta?.url,
                exchangeEventId: ex.market.eventId,
                exchangeMarketId: ex.market.sourceMarketId,
                exchangeMetadata: ex.market.sourceMetadata,
                exchangeSwapped: ex.swapped,
                exchangeScrapedAt: exScrapedAt,
                exchangeCacheAgeSec: ex.market.cacheAgeSec ?? 0,
                layOdds: eSel.layOdds,
                layDelta,
                liquidity: round2(eSel.layLiquidity ?? 0),
                commission,
                ratingNormal: ratings.ratingNormal,
                ratingSnr: ratings.ratingSnr,
                rawRating: ratings.rawRating,
                isSurebet: ratings.isSurebet,
                updatedAt: Math.min(bkScrapedAt, exScrapedAt),
              });
            }
          }
        }
      }
    }

    return oddsmatcherRows;
  }

  /**
   * High-frequency targeted scrape executed only on the specific exchanges, bookmakers, sports,
   * and event hints required by active RatingWatches, then merged back into live snapshot.
   */
  public async runTargetedWatchCycle(
    settings: AppSettings,
    plan: {
      bookmakerIds: SourceId[];
      exchangeIds: SourceId[];
      sports?: SportKey[];
      dateWindow?: ScrapeDateWindow;
      eventHints?: TargetedScrapeFilter['eventHints'];
    }
  ): Promise<{
    skipped: boolean;
    targetedRows: OddsmatcherRow[];
    allRows: OddsmatcherRow[];
    hadRateLimit: boolean;
    durationMs: number;
  }> {
    if (this.isRunning || this.isTargetedRunning || !this.checkOnline()) {
      return {
        skipped: true,
        targetedRows: [],
        allRows: this.lastSnapshot.rows,
        hadRateLimit: false,
        durationMs: 0,
      };
    }

    this.isTargetedRunning = true;
    const cycleStart = Date.now();
    const filter: TargetedScrapeFilter = {
      sports: plan.sports,
      dateWindow: plan.dateWindow,
      eventHints: plan.eventHints,
    };

    const includeLive = settings.includeLiveEvents;
    let hadRateLimit = false;
    const targetedRaw: RawScrapedMarket[] = [];
    const succeededSources = new Set<SourceId>();

    const runSilent = async (
      id: SourceId,
      fn: () => Promise<{ markets: RawScrapedMarket[]; latencyMs: number }>
    ): Promise<RawScrapedMarket[]> => {
      const st = this.sourceStatuses.get(id);
      try {
        const { markets, latencyMs } = await fn();
        succeededSources.add(id);
        if (st) {
          st.state = 'ok';
          st.latencyMs = latencyMs;
          st.lastScrapedAt = Date.now();
          st.lastCacheAgeSec = maxMarketCacheAgeSec(markets);
          st.successCount += 1;
        }
        return markets;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('429')) hadRateLimit = true;
        if (st) {
          st.state = 'error';
          st.lastError = msg;
          st.errorCount += 1;
        }
        return [];
      }
    };

    try {
      const tasks: Array<Promise<RawScrapedMarket[]>> = [];
      const exchangeTasks: Array<Promise<RawScrapedMarket[]>> = [];

      // Exchanges in parallel
      for (const exId of plan.exchangeIds) {
        if (exId === 'betfair_exchange') {
          exchangeTasks.push(runSilent(exId, () => scrapeBetfairExchange(includeLive, filter)));
        } else if (exId === 'smarkets_exchange') {
          exchangeTasks.push(runSilent(exId, () => scrapeSmarketsExchange(includeLive, filter)));
        } else if (exId === 'betflag_exchange') {
          exchangeTasks.push(runSilent(exId, () => scrapeBetflagExchange(includeLive, filter)));
        }
      }

      const needsExchangeFeedForAdm =
        (!plan.eventHints || plan.eventHints.length === 0) && exchangeTasks.length > 0;

      // Direct non-ADM bookmakers
      if (plan.bookmakerIds.includes('betfair_sportsbook')) {
        tasks.push(
          runSilent('betfair_sportsbook', () => scrapeBetfairSportsbook(includeLive, filter))
        );
      }
      if (plan.bookmakerIds.includes('giocodigitale_it')) {
        tasks.push(
          runSilent('giocodigitale_it', () => scrapeGiocoDigitale(includeLive, filter))
        );
      }
      if (plan.bookmakerIds.includes('pokerstars_it')) {
        tasks.push(
          runSilent('pokerstars_it', () => scrapePokerstars(includeLive, filter))
        );
      }
      for (const xid of plan.bookmakerIds.filter((id) => XSPORT_SOURCES.has(id))) {
        const spec = XSPORT_BRANDS[xid];
        if (!spec) continue;
        tasks.push(runSilent(xid, () => scrapeXSportBrand(spec, includeLive, filter)));
      }
      if (plan.bookmakerIds.includes('pinnacle')) {
        tasks.push(runSilent('pinnacle', () => scrapePinnacle(includeLive, filter)));
      }
      if (plan.bookmakerIds.includes('the_odds_api') && settings.theOddsApiKey.trim()) {
        tasks.push(
          runSilent('the_odds_api', () =>
            scrapeTheOddsApiOptional(settings.theOddsApiKey, filter)
          )
        );
      }

      // Kambi brands paced sequentially with safety gap to prevent HTTP 429
      const kambiIds = plan.bookmakerIds.filter((id) => KAMBI_SOURCES.has(id));
      if (kambiIds.length > 0) {
        tasks.push(
          (async (): Promise<RawScrapedMarket[]> => {
            const out: RawScrapedMarket[] = [];
            for (let i = 0; i < kambiIds.length; i++) {
              const kid = kambiIds[i];
              const spec = KAMBI_BRANDS[kid];
              if (!spec) continue;
              const mkts = await runSilent(kid, () => scrapeKambiBrand(spec, includeLive, filter));
              out.push(...mkts);
              if (i < kambiIds.length - 1) await sleep(260);
            }
            return out;
          })()
        );
      }

      // ADM batch bookmakers: wait for Exchanges only for eventless/date-range watches so all competitions match
      const admIds = plan.bookmakerIds.filter((id) => ADM_BATCH_SOURCES.has(id));
      const runAdmTask = (exchangeMarkets: RawScrapedMarket[]): Promise<RawScrapedMarket[]> =>
        (async (): Promise<RawScrapedMarket[]> => {
          try {
            const { marketsBySource, latencyMs } = await scrapeItalianAdmBookmakers({
              exchangeMarkets,
              enabledSourceIds: admIds,
              includeLive,
              filter,
            });
            const out: RawScrapedMarket[] = [];
            for (const id of admIds) {
              const mkts = marketsBySource.get(id) ?? [];
              succeededSources.add(id);
              const st = this.sourceStatuses.get(id);
              if (st) {
                st.state = 'ok';
                st.latencyMs = latencyMs;
                st.lastScrapedAt = Date.now();
                st.lastCacheAgeSec = maxMarketCacheAgeSec(mkts);
                st.successCount += 1;
              }
              out.push(...mkts);
            }
            return out;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('429')) hadRateLimit = true;
            for (const id of admIds) {
              const st = this.sourceStatuses.get(id);
              if (st) {
                st.state = 'error';
                st.lastError = msg;
                st.errorCount += 1;
              }
            }
            return [];
          }
        })();

      if (needsExchangeFeedForAdm) {
        const exchangeChunks = await Promise.all(exchangeTasks);
        const exchangeMarkets = exchangeChunks.flat();
        targetedRaw.push(...exchangeMarkets);
        if (admIds.length > 0) {
          tasks.push(runAdmTask(exchangeMarkets));
        }
      } else {
        tasks.push(...exchangeTasks);
        if (admIds.length > 0) {
          tasks.push(runAdmTask([]));
        }
      }

      const settled = await Promise.all(tasks);
      for (const chunk of settled) targetedRaw.push(...chunk);

      // Re-sync exchange quotes if targeted cycle took >4s
      await this.resyncStaleExchangeQuotes(targetedRaw, includeLive);

      const groups = linkScrapedMarkets(targetedRaw);
      const nextOddsCache = new Map(this.previousOdds);
      const targetedRows = this.buildOddsmatcherRowsFromGroups(groups, settings, nextOddsCache);
      this.previousOdds = nextOddsCache;

      const freshIds = new Set(targetedRows.map((r) => r.id));
      const freshTriples = new Set(
        targetedRows.map((r) => `${r.eventKey}|${r.bookmakerId}|${r.exchangeId}`)
      );
      const hasEventHints = Boolean(plan.eventHints && plan.eventHints.length > 0);
      const sportScope =
        plan.sports && plan.sports.length > 0 ? new Set<SportKey>(plan.sports) : null;
      const nowMs = Date.now();

      const preserved = this.lastSnapshot.rows.filter((r) => {
        if (freshIds.has(r.id)) return false;
        if (freshTriples.has(`${r.eventKey}|${r.bookmakerId}|${r.exchangeId}`)) return false;
        // Evict already-started matches when live events are disabled
        if (!includeLive && Date.parse(r.startTime) < nowMs - 30_000) return false;
        // Evict ghost/suspended rows whose bookmaker+exchange pair was freshly re-scraped in scope
        if (succeededSources.has(r.bookmakerId) && succeededSources.has(r.exchangeId)) {
          const inSportScope = !sportScope || sportScope.has(r.sport);
          const inDateScope = !plan.dateWindow || matchesScrapeDateWindow(r.startTime, plan.dateWindow);
          if (inSportScope && inDateScope) {
            if (
              !hasEventHints ||
              matchesEventHints(r.eventName, r.homeTeam, r.awayTeam, r.sport, plan.eventHints)
            ) {
              return false;
            }
          }
        }
        return true;
      });
      const merged = [...preserved, ...targetedRows].sort(
        (a, b) => b.ratingNormal - a.ratingNormal || b.liquidity - a.liquidity
      );

      const durationMs = Date.now() - cycleStart;
      const srcCount = new Set([...plan.bookmakerIds, ...plan.exchangeIds]).size;
      this.addLog(
        'info',
        'RADAR',
        `Scansione mirata su ${srcCount} fonti: ${targetedRows.length} quote aggiornate in ${(
          durationMs / 1000
        ).toFixed(1)}s${hadRateLimit ? ' (rate-limit 429 rilevato)' : ''}`
      );

      const finalSources = this.getSourcesList();
      this.lastSnapshot = {
        ...this.lastSnapshot,
        rows: merged,
        sources: finalSources,
        logs: [...this.logs],
        connection: computeConnectionDiagnostic({
          sources: finalSources,
          isSystemOnline: this.checkOnline(),
          hasCompletedCycle: this.lastSnapshot.stats.lastCompletedAt !== null,
        }),
        stats: {
          ...this.lastSnapshot.stats,
          totalMatchesCount: merged.length,
          surebetsCount: merged.filter((r) => r.isSurebet).length,
        },
      };
      this.onUpdate?.(this.lastSnapshot);

      return {
        skipped: false,
        targetedRows,
        allRows: merged,
        hadRateLimit,
        durationMs,
      };
    } finally {
      this.isTargetedRunning = false;
    }
  }

  private async verifyBookmakerQuote(params: {
    sourceId: SourceId;
    sport: SportKey;
    eventId?: string;
    marketId?: string;
    metadata?: Record<string, string>;
    swapped?: boolean;
    homeTeam: string;
    awayTeam: string;
    startTime: string;
    marketType: MarketType;
    selectionKey: string;
    previousOdds: number;
    includeLive: boolean;
  }): Promise<LiveVerifySideResult> {
    const started = Date.now();
    const rawKey = unswapSelectionKey(params.selectionKey, params.swapped);

    if (params.sourceId === 'the_odds_api') {
      return {
        status: 'skipped',
        previousOdds: params.previousOdds,
        checkedAt: Date.now(),
        latencyMs: 0,
        isAggregator: true,
      };
    }

    try {
      // 1. Kambi brands (888sport, LeoVegas, Unibet, Paf) — ~50-150ms single event
      const kambiSpec = KAMBI_BRANDS[params.sourceId];
      if (kambiSpec) {
        if (!params.eventId) {
          return {
            status: 'skipped',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs: 0,
          };
        }
        const { market, latencyMs, cacheAgeSec } = await verifyKambiEvent({
          spec: kambiSpec,
          eventId: params.eventId,
          sport: params.sport,
          marketType: params.marketType,
          includeLive: params.includeLive,
        });
        const sel = market?.selections.find((s) => s.canonicalKey === rawKey);
        if (!sel?.backOdds || sel.backOdds <= 1.005) {
          return {
            status: 'suspended',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs,
            cacheAgeSec,
          };
        }
        const changed = Math.abs(sel.backOdds - params.previousOdds) >= 0.005;
        return {
          status: changed ? 'changed' : 'confirmed',
          previousOdds: params.previousOdds,
          liveOdds: sel.backOdds,
          checkedAt: computeEffectiveScrapedAt(Date.now(), cacheAgeSec),
          latencyMs,
          cacheAgeSec,
        };
      }

      // 2. Betfair Sportsbook IT — ~150ms single market
      if (params.sourceId === 'betfair_sportsbook') {
        if (!params.marketId || !params.metadata) {
          return {
            status: 'skipped',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs: 0,
          };
        }
        const { isOpen, oddsByKey, latencyMs, cacheAgeSec } = await verifyBetfairSportsbookMarket({
          marketId: params.marketId,
          selectionIdsByKey: params.metadata,
          includeLive: params.includeLive,
        });
        const liveOdds = oddsByKey[rawKey];
        if (!isOpen || !liveOdds || liveOdds <= 1.005) {
          return {
            status: 'suspended',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs,
            cacheAgeSec,
          };
        }
        const changed = Math.abs(liveOdds - params.previousOdds) >= 0.005;
        return {
          status: changed ? 'changed' : 'confirmed',
          previousOdds: params.previousOdds,
          liveOdds,
          checkedAt: computeEffectiveScrapedAt(Date.now(), cacheAgeSec),
          latencyMs,
          cacheAgeSec,
        };
      }

      // 3. Italian ADM bookmakers via Diretta GraphQL (Sisal, SNAI, Betflag, Eurobet, GoldBet, Lottomatica, Planetwin365, bet365, Betsson, DomusBet, DAZN Bet, WilliamHill) — ~180ms cache-busted GraphQL
      if (ADM_BATCH_SOURCES.has(params.sourceId)) {
        if (!params.eventId) {
          return {
            status: 'skipped',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs: 0,
            isAggregator: true,
          };
        }
        const { market, latencyMs, cacheAgeSec } = await verifyItalianAdmEvent({
          sourceId: params.sourceId,
          eventId: params.eventId,
          sport: params.sport,
          marketType: params.marketType,
          homeTeam: params.homeTeam,
          awayTeam: params.awayTeam,
          startTime: params.startTime,
          homeParticipantId: params.metadata?.homeParticipantId,
          awayParticipantId: params.metadata?.awayParticipantId,
        });
        const sel = market?.selections.find((s) => s.canonicalKey === rawKey);
        if (!sel?.backOdds || sel.backOdds <= 1.005) {
          return {
            status: 'suspended',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs,
            cacheAgeSec,
            isAggregator: true,
          };
        }
        const changed = Math.abs(sel.backOdds - params.previousOdds) >= 0.005;
        return {
          status: changed ? 'changed' : 'confirmed',
          previousOdds: params.previousOdds,
          liveOdds: sel.backOdds,
          checkedAt: computeEffectiveScrapedAt(Date.now(), cacheAgeSec),
          latencyMs,
          cacheAgeSec,
          isAggregator: true,
        };
      }

      // 3b. Gioco Digitale IT (direct Entain CDS fixture-view) — ~120ms
      if (params.sourceId === 'giocodigitale_it') {
        if (!params.eventId) {
          return {
            status: 'skipped',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs: 0,
          };
        }
        const { market, latencyMs, cacheAgeSec } = await verifyGiocoDigitaleEvent({
          eventId: params.eventId,
          sport: params.sport,
          marketType: params.marketType,
          includeLive: params.includeLive,
        });
        const sel = market?.selections.find((s) => s.canonicalKey === rawKey);
        if (!sel?.backOdds || sel.backOdds <= 1.005) {
          return {
            status: 'suspended',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs,
            cacheAgeSec,
          };
        }
        const changed = Math.abs(sel.backOdds - params.previousOdds) >= 0.005;
        return {
          status: changed ? 'changed' : 'confirmed',
          previousOdds: params.previousOdds,
          liveOdds: sel.backOdds,
          checkedAt: computeEffectiveScrapedAt(Date.now(), cacheAgeSec),
          latencyMs,
          cacheAgeSec,
        };
      }

      // 3c. PokerStars.it (direct Flutter/Sisal sportsbook API) — ~180ms
      if (params.sourceId === 'pokerstars_it') {
        if (!params.eventId) {
          return {
            status: 'skipped',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs: 0,
          };
        }
        const { market, latencyMs, cacheAgeSec } = await verifyPokerstarsEvent({
          eventId: params.eventId,
          sport: params.sport,
          marketType: params.marketType,
          manifestationKey: params.metadata?.manifestationKey,
        });
        const sel = market?.selections.find((s) => s.canonicalKey === rawKey);
        if (!sel?.backOdds || sel.backOdds <= 1.005) {
          return {
            status: 'suspended',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs,
            cacheAgeSec,
          };
        }
        const changed = Math.abs(sel.backOdds - params.previousOdds) >= 0.005;
        return {
          status: changed ? 'changed' : 'confirmed',
          previousOdds: params.previousOdds,
          liveOdds: sel.backOdds,
          checkedAt: computeEffectiveScrapedAt(Date.now(), cacheAgeSec),
          latencyMs,
          cacheAgeSec,
        };
      }

      // 3d. Exalogic XSport brands (NetBet.it, Stanleybet.it) — ~75-150ms
      const xsportSpec = XSPORT_BRANDS[params.sourceId];
      if (xsportSpec) {
        if (!params.eventId) {
          return {
            status: 'skipped',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs: 0,
          };
        }
        const { market, latencyMs, cacheAgeSec } = await verifyXSportEvent({
          spec: xsportSpec,
          eventId: params.eventId,
          sport: params.sport,
          marketType: params.marketType,
          homeTeam: params.homeTeam,
          awayTeam: params.awayTeam,
          startTime: params.startTime,
          includeLive: params.includeLive,
          metadata: params.metadata,
        });
        const sel = market?.selections.find((s) => s.canonicalKey === rawKey);
        if (!sel?.backOdds || sel.backOdds <= 1.005) {
          return {
            status: 'suspended',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs,
            cacheAgeSec,
          };
        }
        const changed = Math.abs(sel.backOdds - params.previousOdds) >= 0.005;
        return {
          status: changed ? 'changed' : 'confirmed',
          previousOdds: params.previousOdds,
          liveOdds: sel.backOdds,
          checkedAt: computeEffectiveScrapedAt(Date.now(), cacheAgeSec),
          latencyMs,
          cacheAgeSec,
        };
      }

      // 4. Pinnacle — public feed with transparent Cloudflare Age reporting
      if (params.sourceId === 'pinnacle') {
        if (!params.eventId) {
          return {
            status: 'skipped',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs: 0,
          };
        }
        const { isOpen, oddsByKey, latencyMs, cacheAgeSec } = await verifyPinnacleMarket({
          sport: params.sport,
          matchupId: params.eventId,
          marketType: params.marketType,
          includeLive: params.includeLive,
        });
        const liveOdds = oddsByKey[rawKey];
        if (!isOpen || !liveOdds || liveOdds <= 1.005) {
          return {
            status: 'suspended',
            previousOdds: params.previousOdds,
            checkedAt: Date.now(),
            latencyMs,
            cacheAgeSec,
          };
        }
        const changed = Math.abs(liveOdds - params.previousOdds) >= 0.005;
        return {
          status: changed ? 'changed' : 'confirmed',
          previousOdds: params.previousOdds,
          liveOdds,
          checkedAt: computeEffectiveScrapedAt(Date.now(), cacheAgeSec),
          latencyMs,
          cacheAgeSec,
        };
      }

      return {
        status: 'skipped',
        previousOdds: params.previousOdds,
        checkedAt: Date.now(),
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        status: 'error',
        previousOdds: params.previousOdds,
        checkedAt: Date.now(),
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async verifyExchangeQuote(params: {
    sourceId: SourceId;
    sport: SportKey;
    eventId?: string;
    marketId?: string;
    metadata?: Record<string, string>;
    swapped?: boolean;
    homeTeam: string;
    awayTeam: string;
    startTime: string;
    marketType: MarketType;
    selectionKey: string;
    previousOdds: number;
    previousLiquidity: number;
    includeLive: boolean;
  }): Promise<LiveVerifySideResult> {
    const started = Date.now();
    const rawKey = unswapSelectionKey(params.selectionKey, params.swapped);

    try {
      // 1. Betfair Exchange IT — ~150ms direct ERO bymarket
      if (params.sourceId === 'betfair_exchange') {
        if (!params.marketId) {
          return {
            status: 'skipped',
            previousOdds: params.previousOdds,
            previousLiquidity: params.previousLiquidity,
            checkedAt: Date.now(),
            latencyMs: 0,
          };
        }
        const { marketsByMarketId, latencyMs, cacheAgeSec } = await refreshBetfairExchangeMarkets({
          marketIds: [params.marketId],
          includeLive: params.includeLive,
        });
        const market = marketsByMarketId.get(params.marketId);
        const sel = market?.selections.find((s) => s.canonicalKey === rawKey);
        if (!sel?.layOdds || sel.layOdds <= 1.005) {
          return {
            status: 'suspended',
            previousOdds: params.previousOdds,
            previousLiquidity: params.previousLiquidity,
            checkedAt: Date.now(),
            latencyMs,
            cacheAgeSec,
          };
        }
        const liveLiq = round2(sel.layLiquidity ?? 0);
        const changed =
          Math.abs(sel.layOdds - params.previousOdds) >= 0.005 ||
          Math.abs(liveLiq - params.previousLiquidity) >= 1;
        return {
          status: changed ? 'changed' : 'confirmed',
          previousOdds: params.previousOdds,
          liveOdds: sel.layOdds,
          previousLiquidity: params.previousLiquidity,
          liveLiquidity: liveLiq,
          checkedAt: computeEffectiveScrapedAt(Date.now(), cacheAgeSec),
          latencyMs,
          cacheAgeSec,
        };
      }

      // 2. Smarkets Exchange — ~130ms direct /markets/{id}/quotes/
      if (params.sourceId === 'smarkets_exchange') {
        const contractId = params.metadata?.[`cid_${rawKey}`];
        if (!params.marketId || !contractId) {
          return {
            status: 'skipped',
            previousOdds: params.previousOdds,
            previousLiquidity: params.previousLiquidity,
            checkedAt: Date.now(),
            latencyMs: 0,
          };
        }
        const { quotesByContractId, latencyMs, cacheAgeSec } = await refreshSmarketsQuotesByMarkets(
          { marketIds: [params.marketId] }
        );
        const prices = extractBestSmarketsPrices(quotesByContractId[contractId]);
        if (!prices.layOdds || prices.layOdds <= 1.005) {
          return {
            status: 'suspended',
            previousOdds: params.previousOdds,
            previousLiquidity: params.previousLiquidity,
            checkedAt: Date.now(),
            latencyMs,
            cacheAgeSec,
          };
        }
        const liveLiq = round2(prices.layLiquidity ?? 0);
        const changed =
          Math.abs(prices.layOdds - params.previousOdds) >= 0.005 ||
          Math.abs(liveLiq - params.previousLiquidity) >= 1;
        return {
          status: changed ? 'changed' : 'confirmed',
          previousOdds: params.previousOdds,
          liveOdds: prices.layOdds,
          previousLiquidity: params.previousLiquidity,
          liveLiquidity: liveLiq,
          checkedAt: computeEffectiveScrapedAt(Date.now(), cacheAgeSec),
          latencyMs,
          cacheAgeSec,
        };
      }

      // 3. Betflag Exchange IT — ~180ms direct colloddsbetsevent
      if (params.sourceId === 'betflag_exchange') {
        if (!params.eventId) {
          return {
            status: 'skipped',
            previousOdds: params.previousOdds,
            previousLiquidity: params.previousLiquidity,
            checkedAt: Date.now(),
            latencyMs: 0,
          };
        }
        const { market, latencyMs, cacheAgeSec } = await verifyBetflagExchangeEvent({
          matchId: params.eventId,
          sport: params.sport,
          marketType: params.marketType,
          homeTeam: params.homeTeam,
          awayTeam: params.awayTeam,
          startTime: params.startTime,
        });
        const sel = market?.selections.find((s) => s.canonicalKey === rawKey);
        if (!sel?.layOdds || sel.layOdds <= 1.005) {
          return {
            status: 'suspended',
            previousOdds: params.previousOdds,
            previousLiquidity: params.previousLiquidity,
            checkedAt: Date.now(),
            latencyMs,
            cacheAgeSec,
          };
        }
        const liveLiq = round2(sel.layLiquidity ?? 0);
        const changed =
          Math.abs(sel.layOdds - params.previousOdds) >= 0.005 ||
          Math.abs(liveLiq - params.previousLiquidity) >= 1;
        return {
          status: changed ? 'changed' : 'confirmed',
          previousOdds: params.previousOdds,
          liveOdds: sel.layOdds,
          previousLiquidity: params.previousLiquidity,
          liveLiquidity: liveLiq,
          checkedAt: computeEffectiveScrapedAt(Date.now(), cacheAgeSec),
          latencyMs,
          cacheAgeSec,
        };
      }

      return {
        status: 'skipped',
        previousOdds: params.previousOdds,
        previousLiquidity: params.previousLiquidity,
        checkedAt: Date.now(),
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        status: 'error',
        previousOdds: params.previousOdds,
        previousLiquidity: params.previousLiquidity,
        checkedAt: Date.now(),
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Instant (~150-450ms) parallel live verification for a single Oddsmatcher row
   * (bookmaker + exchange simultaneously) and live patch back into the snapshot.
   */
  public async verifyRowQuotes(
    settings: AppSettings,
    req: VerifyRowQuotesRequest
  ): Promise<VerifyRowQuotesResult> {
    const started = Date.now();
    const existingRow = this.lastSnapshot.rows.find((r) => r.id === req.rowId);

    const [bookmaker, exchange] = await Promise.all([
      this.verifyBookmakerQuote({
        sourceId: req.bookmakerId,
        sport: req.sport,
        eventId: req.bookmakerEventId ?? existingRow?.bookmakerEventId,
        marketId: req.bookmakerMarketId ?? existingRow?.bookmakerMarketId,
        metadata: req.bookmakerMetadata ?? existingRow?.bookmakerMetadata,
        swapped: req.bookmakerSwapped ?? existingRow?.bookmakerSwapped,
        homeTeam: req.homeTeam,
        awayTeam: req.awayTeam,
        startTime: req.startTime,
        marketType: req.marketType,
        selectionKey: req.selectionKey,
        previousOdds: req.previousBackOdds,
        includeLive: settings.includeLiveEvents,
      }),
      this.verifyExchangeQuote({
        sourceId: req.exchangeId,
        sport: req.sport,
        eventId: req.exchangeEventId ?? existingRow?.exchangeEventId,
        marketId: req.exchangeMarketId ?? existingRow?.exchangeMarketId,
        metadata: req.exchangeMetadata ?? existingRow?.exchangeMetadata,
        swapped: req.exchangeSwapped ?? existingRow?.exchangeSwapped,
        homeTeam: req.homeTeam,
        awayTeam: req.awayTeam,
        startTime: req.startTime,
        marketType: req.marketType,
        selectionKey: req.selectionKey,
        previousOdds: req.previousLayOdds,
        previousLiquidity: req.previousLiquidity,
        includeLive: settings.includeLiveEvents,
      }),
    ]);

    const verifiedAt = Date.now();
    let updatedRow: OddsmatcherRow | undefined;

    if (existingRow) {
      if (bookmaker.status === 'suspended' || exchange.status === 'suspended') {
        const nextRows = this.lastSnapshot.rows.filter((r) => r.id !== req.rowId);
        this.lastSnapshot = {
          ...this.lastSnapshot,
          rows: nextRows,
          stats: {
            ...this.lastSnapshot.stats,
            totalMatchesCount: nextRows.length,
            surebetsCount: nextRows.filter((r) => r.isSurebet).length,
          },
        };
        this.onUpdate?.(this.lastSnapshot);
      } else if (bookmaker.liveOdds || exchange.liveOdds) {
        const nextBack = bookmaker.liveOdds ?? existingRow.backOdds;
        const nextLay = exchange.liveOdds ?? existingRow.layOdds;
        const nextLiq =
          exchange.liveLiquidity !== undefined ? exchange.liveLiquidity : existingRow.liquidity;
        const nextBkAt =
          bookmaker.status === 'confirmed' || bookmaker.status === 'changed'
            ? bookmaker.checkedAt
            : existingRow.bookmakerScrapedAt ?? existingRow.updatedAt;
        const nextExAt =
          exchange.status === 'confirmed' || exchange.status === 'changed'
            ? exchange.checkedAt
            : existingRow.exchangeScrapedAt ?? existingRow.updatedAt;

        const ratings = quickRatings(nextBack, nextLay, existingRow.commission);
        const backDelta: OddsDelta =
          nextBack > existingRow.backOdds + 0.001
            ? 'up'
            : nextBack < existingRow.backOdds - 0.001
            ? 'down'
            : 'same';
        const layDelta: OddsDelta =
          nextLay > existingRow.layOdds + 0.001
            ? 'up'
            : nextLay < existingRow.layOdds - 0.001
            ? 'down'
            : 'same';

        updatedRow = {
          ...existingRow,
          backOdds: nextBack,
          backDelta,
          layOdds: nextLay,
          layDelta,
          liquidity: nextLiq,
          ratingNormal: ratings.ratingNormal,
          ratingSnr: ratings.ratingSnr,
          rawRating: ratings.rawRating,
          isSurebet: ratings.isSurebet,
          bookmakerScrapedAt: nextBkAt,
          bookmakerCacheAgeSec: bookmaker.cacheAgeSec ?? existingRow.bookmakerCacheAgeSec,
          exchangeScrapedAt: nextExAt,
          exchangeCacheAgeSec: exchange.cacheAgeSec ?? existingRow.exchangeCacheAgeSec,
          updatedAt: Math.min(nextBkAt, nextExAt),
        };

        this.previousOdds.set(existingRow.id, { back: nextBack, lay: nextLay });
        const nextRows = this.lastSnapshot.rows.map((r) =>
          r.id === existingRow.id ? updatedRow! : r
        );
        this.lastSnapshot = {
          ...this.lastSnapshot,
          rows: nextRows,
          stats: {
            ...this.lastSnapshot.stats,
            surebetsCount: nextRows.filter((r) => r.isSurebet).length,
          },
        };
        this.onUpdate?.(this.lastSnapshot);
      }
    }

    return {
      rowId: req.rowId,
      verifiedAt,
      durationMs: verifiedAt - started,
      bookmaker,
      exchange,
      updatedRow,
    };
  }

  /**
   * Instant (~150-450ms) parallel live verification for all legs of a Punta-Punta matchup.
   */
  public async verifyPuntaPunta(
    settings: AppSettings,
    req: VerifyPuntaPuntaRequest
  ): Promise<VerifyPuntaPuntaResult> {
    const started = Date.now();
    const existingGroup = (this.lastSnapshot.backMarketGroups ?? []).find(
      (g) => g.id === req.groupId
    );

    const legResults = await Promise.all(
      req.legs.map(async (leg) => {
        const existingQuote = existingGroup?.quotes.find(
          (q) => q.selectionKey === leg.selectionKey && q.bookmakerId === leg.bookmakerId
        );
        const result = await this.verifyBookmakerQuote({
          sourceId: leg.bookmakerId,
          sport: req.sport,
          eventId: leg.eventId ?? existingQuote?.eventId,
          marketId: leg.marketId ?? existingQuote?.marketId,
          metadata: leg.sourceMetadata ?? existingQuote?.sourceMetadata,
          swapped: leg.swapped ?? existingQuote?.swapped,
          homeTeam: req.homeTeam,
          awayTeam: req.awayTeam,
          startTime: req.startTime,
          marketType: req.marketType,
          selectionKey: leg.selectionKey,
          previousOdds: leg.previousOdds,
          includeLive: settings.includeLiveEvents,
        });
        return {
          selectionKey: leg.selectionKey,
          bookmakerId: leg.bookmakerId,
          result,
        };
      })
    );

    if (existingGroup && this.lastSnapshot.backMarketGroups) {
      let mutated = false;
      const nextQuotes = existingGroup.quotes.map((q) => {
        const matched = legResults.find(
          (lr) => lr.selectionKey === q.selectionKey && lr.bookmakerId === q.bookmakerId
        );
        if (matched?.result.liveOdds) {
          mutated = true;
          return {
            ...q,
            odds: matched.result.liveOdds,
            cacheAgeSec: matched.result.cacheAgeSec ?? q.cacheAgeSec,
            updatedAt: matched.result.checkedAt,
          };
        }
        return q;
      });
      if (mutated) {
        const nextGroups = this.lastSnapshot.backMarketGroups.map((g) =>
          g.id === existingGroup.id
            ? {
                ...g,
                quotes: nextQuotes,
                updatedAt: Math.min(...nextQuotes.map((q) => q.updatedAt)),
              }
            : g
        );
        this.lastSnapshot = {
          ...this.lastSnapshot,
          backMarketGroups: nextGroups,
        };
        this.onUpdate?.(this.lastSnapshot);
      }
    }

    const verifiedAt = Date.now();
    return {
      groupId: req.groupId,
      verifiedAt,
      durationMs: verifiedAt - started,
      legs: legResults,
    };
  }
}

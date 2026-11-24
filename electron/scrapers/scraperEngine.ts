import { setMaxListeners } from 'events';
import {
  formatScrapeDateWindowLabel,
  matchesScrapeDateWindow,
} from '../../src/shared/dateRange';
import { quickRatings, round2 } from '../../src/shared/math';
import { computeConnectionDiagnostic } from '../../src/shared/networkHealth';
import { ADM_BATCH_SOURCES, KAMBI_SOURCES } from '../../src/shared/ratingWatch';
import {
  SOURCE_CATALOG,
  type AppSettings,
  type BackMarketGroup,
  type BackOutcomeQuote,
  type DutcherLeg,
  type DutcherRow,
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
} from '../../src/shared/types';
import { scrapeBetfairExchange } from './betfairExchange';
import { scrapeBetfairSportsbook } from './betfairSportsbook';
import { scrapeBetflagExchange } from './betflagExchange';
import { isAbortError, sleep } from './httpClient';
import {
  ITALIAN_ADM_BOOKMAKERS,
  scrapeItalianAdmBookmakers,
} from './italianAdmScraper';
import { KAMBI_BRANDS, scrapeKambiBrand } from './kambiBookmaker';
import { linkScrapedMarkets, type LinkedEventGroup } from './matchLinker';
import { scrapeTheOddsApiOptional } from './oddsApiOptional';
import { scrapePinnacle } from './pinnacleBookmaker';
import { scrapeSmarketsExchange } from './smarketsExchange';

const SOURCE_META = new Map(SOURCE_CATALOG.map((s) => [s.id, s]));
const DATE_RANGE_CACHE_TTL_MS = 15 * 60_000;
const MAX_DATE_RANGE_CACHE_ENTRIES = 4;

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
      st.state = 'ok';
      st.latencyMs = latencyMs;
      st.eventsCount = uniqueEvents;
      st.marketsCount = markets.length;
      st.lastScrapedAt = Date.now();
      st.successCount += 1;
      this.addLog(
        'success',
        st.shortName,
        `Recuperati ${markets.length} mercati su ${uniqueEvents} eventi in ${latencyMs}ms`
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
      if (k !== activeKey && nowMs - entry.fetchedAt > DATE_RANGE_CACHE_TTL_MS) {
        this.dateRangeRawByKey.delete(k);
      }
    }

    const dedup = new Map<string, RawScrapedMarket>();
    const addMarket = (m: RawScrapedMarket) => {
      if (settings.enabledSources[m.sourceId] === false) return;
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

    // 1. Kick off Exchanges first (we also feed their live events into the Italian ADM scraper!)
    const exchangeTasks: Array<Promise<RawScrapedMarket[]>> = [];
    if (settings.enabledSources.betfair_exchange) {
      exchangeTasks.push(
        runSource('betfair_exchange', () => scrapeBetfairExchange(includeLive, filter, signal))
      );
    }
    if (settings.enabledSources.smarkets_exchange) {
      exchangeTasks.push(
        runSource('smarkets_exchange', () => scrapeSmarketsExchange(includeLive, filter, signal))
      );
    }
    if (settings.enabledSources.betflag_exchange) {
      exchangeTasks.push(
        runSource('betflag_exchange', () => scrapeBetflagExchange(includeLive, filter, signal))
      );
    }

    // 2. Simultaneously kick off non-ADM bookmakers
    const otherBookieTasks: Array<Promise<RawScrapedMarket[]>> = [];
    if (settings.enabledSources.betfair_sportsbook) {
      otherBookieTasks.push(
        runSource('betfair_sportsbook', () => scrapeBetfairSportsbook(includeLive, filter, signal))
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
            await sleep(mode === 'date_range' ? 200 : 300, signal);
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

    // 3. Wait for Exchanges, then immediately launch Italian ADM batch (Sisal, SNAI, Betflag, Eurobet, GoldBet)
    const exchangeChunks = await Promise.all(exchangeTasks);
    const exchangeMarkets = exchangeChunks.flat();
    allRaw.push(...exchangeMarkets);

    const enabledAdmIds = ITALIAN_ADM_BOOKMAKERS.map((b) => b.sourceId).filter(
      (id) => settings.enabledSources[id]
    );

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
        const { marketsBySource, latencyMs } = await scrapeItalianAdmBookmakers({
          exchangeMarkets,
          enabledSourceIds: enabledAdmIds,
          includeLive,
          filter,
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

    const remainingSettled = await Promise.all([...otherBookieTasks, kambiTask, admTask]);
    if (signal.aborted) return [];
    for (const chunk of remainingSettled) allRaw.push(...chunk);
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
              if (!existingQ || sel.backOdds > existingQ.odds) {
                dedupQuotes.set(qKey, {
                  selectionKey: key,
                  selectionLabel: selLabel,
                  bookmakerId: src.market.sourceId,
                  bookmakerName: src.market.sourceName,
                  odds: sel.backOdds,
                  eventUrl,
                  updatedAt: nowCycle,
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
              updatedAt: nowCycle,
            });
          }

          if (allBackSources.length >= 2 && bestLegs.length === requiredKeys.length) {
            const impliedProbSum = bestLegs.reduce((acc, l) => acc + 1 / l.odds, 0);
            const rating = round2((1 / impliedProbSum) * 100);
            if (rating >= 75 && rating <= 118) {
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
                updatedAt: nowCycle,
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
    setMaxListeners(64, abortController.signal);
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
    setMaxListeners(64, abortController.signal);
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
                backOdds: bSel.backOdds,
                backDelta,
                exchangeId: ex.market.sourceId,
                exchangeName: ex.market.sourceName,
                exchangeColor: exMeta?.color ?? '#ffb80c',
                exchangeUrl: ex.market.eventUrl ?? exMeta?.url,
                layOdds: eSel.layOdds,
                layDelta,
                liquidity: round2(eSel.layLiquidity ?? 0),
                commission,
                ratingNormal: ratings.ratingNormal,
                ratingSnr: ratings.ratingSnr,
                rawRating: ratings.rawRating,
                isSurebet: ratings.isSurebet,
                updatedAt: Date.now(),
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

    const runSilent = async (
      id: SourceId,
      fn: () => Promise<{ markets: RawScrapedMarket[]; latencyMs: number }>
    ): Promise<RawScrapedMarket[]> => {
      const st = this.sourceStatuses.get(id);
      try {
        const { markets, latencyMs } = await fn();
        if (st) {
          st.state = 'ok';
          st.latencyMs = latencyMs;
          st.lastScrapedAt = Date.now();
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
              const st = this.sourceStatuses.get(id);
              if (st) {
                st.state = 'ok';
                st.latencyMs = latencyMs;
                st.lastScrapedAt = Date.now();
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

      const groups = linkScrapedMarkets(targetedRaw);
      const nextOddsCache = new Map(this.previousOdds);
      const targetedRows = this.buildOddsmatcherRowsFromGroups(groups, settings, nextOddsCache);
      this.previousOdds = nextOddsCache;

      const freshIds = new Set(targetedRows.map((r) => r.id));
      const freshTriples = new Set(
        targetedRows.map((r) => `${r.eventKey}|${r.bookmakerId}|${r.exchangeId}`)
      );
      const preserved = this.lastSnapshot.rows.filter(
        (r) =>
          !freshIds.has(r.id) &&
          !freshTriples.has(`${r.eventKey}|${r.bookmakerId}|${r.exchangeId}`)
      );
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
}

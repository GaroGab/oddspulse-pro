import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, resolveScrapeDateWindow, toLocalDateKey } from '../../src/shared/dateRange';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/shared/types';
import { isAbortError, ScrapeAbortedError, sleep } from './httpClient';
import { ScraperEngine } from './scraperEngine';

describe('ScraperEngine Stop & Restart Lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aborts sleep immediately when AbortSignal fires', async () => {
    const controller = new AbortController();
    const start = Date.now();
    setTimeout(() => controller.abort(), 20);

    await expect(sleep(5000, controller.signal)).rejects.toBeInstanceOf(ScrapeAbortedError);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(isAbortError(new ScrapeAbortedError())).toBe(true);
  });

  it('updates autoScrapeEnabled and nextAutoRefreshAt metadata on snapshot', () => {
    const updates: number[] = [];
    const engine = new ScraperEngine((snap) => {
      updates.push(snap.stats.nextAutoRefreshAt ?? -1);
    });

    const nextAt = Date.now() + 60_000;
    const activeSnap = engine.setAutoRefreshMeta({
      autoScrapeEnabled: true,
      nextAutoRefreshAt: nextAt,
    });
    expect(activeSnap.stats.autoScrapeEnabled).toBe(true);
    expect(activeSnap.stats.nextAutoRefreshAt).toBe(nextAt);

    const stoppedSnap = engine.setAutoRefreshMeta({
      autoScrapeEnabled: false,
      nextAutoRefreshAt: null,
    });
    expect(stoppedSnap.stats.autoScrapeEnabled).toBe(false);
    expect(stoppedSnap.stats.nextAutoRefreshAt).toBeNull();
    expect(updates).toEqual([nextAt, -1]);
  });

  it('aborts an active cycle cleanly without marking sources as failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
          return;
        }
        signal?.addEventListener(
          'abort',
          () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true }
        );
      });
    });

    const engine = new ScraperEngine(undefined, () => true);
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      enabledSources: {
        ...DEFAULT_SETTINGS.enabledSources,
        betfair_exchange: true,
        smarkets_exchange: false,
        betflag_exchange: false,
        sisal_it: false,
        snai_it: false,
        betflag_it: false,
        eurobet_it: false,
        goldbet_it: false,
        betfair_sportsbook: false,
        '888sport_it': false,
        leovegas_it: false,
        unibet: false,
        paf: false,
        pinnacle: false,
        the_odds_api: false,
      },
    };

    const cyclePromise = engine.runCycle(settings);
    expect(engine.getIsRunning()).toBe(true);

    await new Promise((r) => setTimeout(r, 25));
    const stoppedSnapshot = await engine.stopActiveCycle();
    await cyclePromise;

    expect(engine.getIsRunning()).toBe(false);
    expect(stoppedSnapshot.stats.isRunning).toBe(false);
    expect(stoppedSnapshot.stats.lastCompletedAt).toBeNull();

    const bf = stoppedSnapshot.sources.find((s) => s.id === 'betfair_exchange');
    expect(bf?.state).toBe('idle');
    expect(bf?.errorCount).toBe(0);
    expect(stoppedSnapshot.logs.some((l) => l.message.includes('fermato'))).toBe(true);
  });

  it('scrapes a future date window and merges future matches without erasing base cycle matches', async () => {
    const now = new Date();
    const todayKickoff = new Date(now.getTime() + 4 * 3600_000).toISOString();
    const futureDay5 = addDays(now, 5);
    const futureDay6 = addDays(now, 6);
    const futureKickoff = new Date(
      futureDay5.getFullYear(),
      futureDay5.getMonth(),
      futureDay5.getDate(),
      15,
      0,
      0
    ).toISOString();

    const dateWindow = resolveScrapeDateWindow({
      mode: 'range',
      startDate: toLocalDateKey(futureDay5),
      endDate: toLocalDateKey(futureDay6),
    })!;

    const seenBetfairFilters: Array<{ marketStartingAfter?: string; marketStartingBefore?: string }> = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();

      // Betfair Exchange scan endpoint
      if (url.includes('scan-inbf.betfair.it')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const flt = body.filter ?? {};
        seenBetfairFilters.push({
          marketStartingAfter: flt.marketStartingAfter,
          marketStartingBefore: flt.marketStartingBefore,
        });
        const isFootball = Array.isArray(flt.eventTypeIds) && flt.eventTypeIds[0] === 1;
        if (!isFootball) {
          return new Response(JSON.stringify({ results: [], attachments: {} }), { status: 200 });
        }
        const isFutureReq = Boolean(flt.marketStartingBefore);
        const eventId = isFutureReq ? 2002 : 1001;
        const marketId = isFutureReq ? '1.2002' : '1.1001';
        const name = isFutureReq ? 'Valencia - Osasuna' : 'Inter - Napoli';
        const openDate = isFutureReq ? futureKickoff : todayKickoff;
        return new Response(
          JSON.stringify({
            results: [{ eventId, marketId, competitionId: 10, eventTypeId: 1 }],
            attachments: {
              competitions: { '10': { competitionId: 10, name: isFutureReq ? 'LaLiga' : 'Serie A' } },
              events: { [String(eventId)]: { name, openDate, competitionId: 10 } },
            },
          }),
          { status: 200 }
        );
      }

      // Betfair Exchange ERO endpoint
      if (url.includes('ero.betfair.it')) {
        const isFutureReq = url.includes('1.2002');
        const eventId = isFutureReq ? 2002 : 1001;
        const marketId = isFutureReq ? '1.2002' : '1.1001';
        const home = isFutureReq ? 'Valencia' : 'Inter';
        const away = isFutureReq ? 'Osasuna' : 'Napoli';
        const openDate = isFutureReq ? futureKickoff : todayKickoff;
        return new Response(
          JSON.stringify({
            eventTypes: [
              {
                eventTypeId: 1,
                eventNodes: [
                  {
                    eventId,
                    event: { eventName: `${home} - ${away}`, openDate },
                    marketNodes: [
                      {
                        marketId,
                        state: { inplay: false, status: 'OPEN' },
                        description: { marketType: 'MATCH_ODDS', marketTime: openDate },
                        runners: [
                          {
                            selectionId: 1,
                            description: { runnerName: home },
                            exchange: {
                              availableToBack: [{ price: 2.0, size: 100 }],
                              availableToLay: [{ price: 2.04, size: 150 }],
                            },
                          },
                          {
                            selectionId: 2,
                            description: { runnerName: away },
                            exchange: {
                              availableToBack: [{ price: 3.6, size: 100 }],
                              availableToLay: [{ price: 3.7, size: 120 }],
                            },
                          },
                          {
                            selectionId: 3,
                            description: { runnerName: 'Pareggio' },
                            exchange: {
                              availableToBack: [{ price: 3.3, size: 100 }],
                              availableToLay: [{ price: 3.4, size: 120 }],
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }

      // Pinnacle matchups & straights
      if (url.includes('pinnacle.com/0.1/sports/29/matchups')) {
        return new Response(
          JSON.stringify([
            {
              id: 5001,
              type: 'matchup',
              isLive: false,
              startTime: todayKickoff,
              league: { name: 'Serie A' },
              participants: [
                { alignment: 'home', name: 'Inter' },
                { alignment: 'away', name: 'Napoli' },
              ],
            },
            {
              id: 5002,
              type: 'matchup',
              isLive: false,
              startTime: futureKickoff,
              league: { name: 'LaLiga' },
              participants: [
                { alignment: 'home', name: 'Valencia' },
                { alignment: 'away', name: 'Osasuna' },
              ],
            },
          ]),
          { status: 200 }
        );
      }

      if (url.includes('pinnacle.com/0.1/sports/29/markets/straight')) {
        return new Response(
          JSON.stringify([
            {
              matchupId: 5001,
              period: 0,
              type: 'moneyline',
              status: 'open',
              prices: [
                { designation: 'home', price: 102 },
                { designation: 'draw', price: 230 },
                { designation: 'away', price: 260 },
              ],
            },
            {
              matchupId: 5002,
              period: 0,
              type: 'moneyline',
              status: 'open',
              prices: [
                { designation: 'home', price: 102 },
                { designation: 'draw', price: 230 },
                { designation: 'away', price: 260 },
              ],
            },
          ]),
          { status: 200 }
        );
      }

      if (url.includes('pinnacle.com/0.1/sports/')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });

    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      enabledSources: {
        ...DEFAULT_SETTINGS.enabledSources,
        betfair_exchange: true,
        pinnacle: true,
        smarkets_exchange: false,
        betflag_exchange: false,
        sisal_it: false,
        snai_it: false,
        betflag_it: false,
        eurobet_it: false,
        goldbet_it: false,
        betfair_sportsbook: false,
        '888sport_it': false,
        leovegas_it: false,
        unibet: false,
        paf: false,
        the_odds_api: false,
      },
    };

    const engine = new ScraperEngine(undefined, () => true);

    // 1. Base cycle finds today's Inter - Napoli (Betfair EX didn't return day+5 without dateWindow)
    const baseSnap = await engine.runCycle(settings);
    expect(baseSnap.rows.some((r) => r.eventName.includes('Inter'))).toBe(true);
    expect(baseSnap.rows.some((r) => r.eventName.includes('Valencia'))).toBe(false);

    // 2. User filters to +5..+6 days -> triggers future date scrape
    const futureSnap = await engine.runDateRangeCycle(settings, dateWindow);
    expect(futureSnap.stats.isDateRangeScraping).toBe(false);
    expect(futureSnap.stats.activeDateRange).toEqual({
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
    });
    // Both near-term AND future matches are now present in snapshot!
    expect(futureSnap.rows.some((r) => r.eventName.includes('Inter'))).toBe(true);
    expect(futureSnap.rows.some((r) => r.eventName.includes('Valencia'))).toBe(true);
    expect(seenBetfairFilters.some((f) => Boolean(f.marketStartingBefore))).toBe(true);

    // 3. Clearing active date window clears metadata cleanly
    const clearedSnap = engine.setActiveDateWindow(null);
    expect(clearedSnap.stats.activeDateRange).toBeNull();
    expect(clearedSnap.stats.isDateRangeScraping).toBe(false);
  });

  it('runs autonomous Radar Rating targeted cycle with dateWindow even when general auto-scrape is stopped', async () => {
    const today = new Date();
    const futureDay = addDays(today, 5);
    const futureKey = toLocalDateKey(futureDay);
    const dateWindow = resolveScrapeDateWindow({
      mode: 'range',
      startDate: futureKey,
      endDate: futureKey,
    })!;
    const futureKickoff = new Date(
      futureDay.getFullYear(),
      futureDay.getMonth(),
      futureDay.getDate(),
      19,
      30,
      0
    ).toISOString();

    const capturedFilters: Array<{ marketStartingAfter?: string; marketStartingBefore?: string }> = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('scan-inbf.betfair.it')) {
        const parsed = init?.body ? JSON.parse(String(init.body)) : {};
        const f = parsed?.filter ?? {};
        capturedFilters.push({
          marketStartingAfter: f.marketStartingAfter,
          marketStartingBefore: f.marketStartingBefore,
        });
        if (!f.marketStartingBefore) {
          return new Response(JSON.stringify({ results: [], attachments: { events: {}, competitions: {} } }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            results: [{ eventId: 901, marketId: '1.901', competitionId: 109, eventTypeId: 1 }],
            attachments: {
              competitions: { '109': { competitionId: 109, name: 'Serie A' } },
              events: { '901': { name: 'Milan - Roma', openDate: futureKickoff, competitionId: 109 } },
            },
          }),
          { status: 200 }
        );
      }

      if (url.includes('ero.betfair.it')) {
        return new Response(
          JSON.stringify({
            eventTypes: [
              {
                eventTypeId: 1,
                eventNodes: [
                  {
                    eventId: 901,
                    event: { eventName: 'Milan - Roma', openDate: futureKickoff },
                    marketNodes: [
                      {
                        marketId: '1.901',
                        state: { inplay: false, status: 'OPEN' },
                        description: { marketType: 'MATCH_ODDS', marketTime: futureKickoff },
                        runners: [
                          {
                            selectionId: 1,
                            description: { runnerName: 'Milan' },
                            exchange: { availableToLay: [{ price: 2.02, size: 220 }] },
                          },
                          {
                            selectionId: 2,
                            description: { runnerName: 'Roma' },
                            exchange: { availableToLay: [{ price: 3.8, size: 150 }] },
                          },
                          {
                            selectionId: 3,
                            description: { runnerName: 'Pareggio' },
                            exchange: { availableToLay: [{ price: 3.4, size: 160 }] },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes('pinnacle.com/0.1/sports/29/matchups')) {
        return new Response(
          JSON.stringify([
            {
              id: 7701,
              type: 'matchup',
              isLive: false,
              startTime: futureKickoff,
              league: { name: 'Italy Serie A' },
              participants: [
                { alignment: 'home', name: 'Milan' },
                { alignment: 'away', name: 'Roma' },
              ],
            },
          ]),
          { status: 200 }
        );
      }

      if (url.includes('pinnacle.com/0.1/sports/29/markets/straight')) {
        return new Response(
          JSON.stringify([
            {
              matchupId: 7701,
              period: 0,
              type: 'moneyline',
              status: 'open',
              prices: [
                { designation: 'home', price: 110 },
                { designation: 'draw', price: 240 },
                { designation: 'away', price: 280 },
              ],
            },
          ]),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify([]), { status: 200 });
    });

    const engine = new ScraperEngine(undefined, () => true);
    engine.setAutoRefreshMeta({ autoScrapeEnabled: false, nextAutoRefreshAt: null }, false);

    const stoppedSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      autoScrapeEnabled: false,
    };

    const res = await engine.runTargetedWatchCycle(stoppedSettings, {
      bookmakerIds: ['pinnacle'],
      exchangeIds: ['betfair_exchange'],
      sports: ['football'],
      dateWindow,
      eventHints: [],
    });

    expect(res.skipped).toBe(false);
    expect(res.targetedRows.some((r) => r.eventName.includes('Milan'))).toBe(true);
    expect(capturedFilters.some((f) => Boolean(f.marketStartingBefore))).toBe(true);
    expect(engine.getSnapshot().stats.autoScrapeEnabled).toBe(false);
  });
});

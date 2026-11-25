import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, resolveScrapeDateWindow, toLocalDateKey } from '../../src/shared/dateRange';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type RawScrapedMarket,
  type SourceId,
} from '../../src/shared/types';
import { scrapeGiocoDigitale, verifyGiocoDigitaleEvent } from './giocoDigitaleBookmaker';
import {
  appendCacheBuster,
  computeEffectiveScrapedAt,
  isAbortError,
  parseCacheAgeSec,
  ScrapeAbortedError,
  sleep,
} from './httpClient';
import { scrapeItalianAdmBookmakers } from './italianAdmScraper';
import { KAMBI_BRANDS, scrapeKambiBrand } from './kambiBookmaker';
import { linkScrapedMarkets, teamSimilarity } from './matchLinker';
import { scrapePokerstars, verifyPokerstarsEvent } from './pokerstarsBookmaker';
import { ScraperEngine } from './scraperEngine';
import { scrapeSmarketsExchange } from './smarketsExchange';
import {
  parseRomeWallClockToIso,
  scrapeXSportBrand,
  verifyXSportEvent,
  XSPORT_BRANDS,
} from './xsportBookmaker';

function onlyEnabledSources(...enabled: SourceId[]): Record<SourceId, boolean> {
  const out = {} as Record<SourceId, boolean>;
  for (const key of Object.keys(DEFAULT_SETTINGS.enabledSources) as SourceId[]) {
    out[key] = false;
  }
  for (const id of enabled) {
    out[id] = true;
  }
  return out;
}

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
      enabledSources: onlyEnabledSources('betfair_exchange'),
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
      enabledSources: onlyEnabledSources('betfair_exchange', 'pinnacle'),
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

describe('Odds Alignment, Freshness & Live Verification', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tracks HTTP Age header accurately and appends cache-busters safely', () => {
    const h1 = new Headers({ Age: '420' });
    expect(parseCacheAgeSec(h1)).toBe(420);
    expect(parseCacheAgeSec(new Headers())).toBe(0);

    const now = 1_700_000_000_000;
    expect(computeEffectiveScrapedAt(now, 420)).toBe(now - 420_000);
    expect(computeEffectiveScrapedAt(now, 0)).toBe(now);

    expect(appendCacheBuster('https://example.com/a?x=1')).toMatch(/^https:\/\/example\.com\/a\?x=1&_t=\d+$/);
    expect(appendCacheBuster('https://example.com/a')).toMatch(/^https:\/\/example\.com\/a\?_t=\d+$/);
  });

  it('prevents cross-linking between senior, women, youth and reserve teams as well as Real vs Atletico Madrid', () => {
    expect(teamSimilarity('Roma', 'Roma Women', 'football')).toBe(0);
    expect(teamSimilarity('Roma', 'Roma (D)', 'football')).toBe(0);
    expect(teamSimilarity('Inter', 'Inter U21', 'football')).toBe(0);
    expect(teamSimilarity('Real Sociedad', 'Real Sociedad B', 'football')).toBe(0);
    expect(teamSimilarity('Borussia Dortmund', 'Borussia Dortmund II', 'football')).toBe(0);
    expect(teamSimilarity('Real Madrid', 'Club Atletico de Madrid', 'football')).toBeLessThan(0.65);

    const kickoff = new Date(Date.now() + 3 * 3600_000).toISOString();
    const mk = (
      sourceId: RawScrapedMarket['sourceId'],
      sourceName: string,
      homeTeam: string,
      awayTeam: string,
      odds: [number, number, number],
      scrapedAt: number
    ): RawScrapedMarket => ({
      sourceId,
      sourceName,
      sourceKind: 'bookmaker',
      sport: 'football',
      league: 'Serie A',
      eventId: `${sourceId}_${homeTeam}`,
      eventName: `${homeTeam} - ${awayTeam}`,
      homeTeam,
      awayTeam,
      startTime: kickoff,
      marketType: '1X2',
      marketLabel: 'Esito Finale 1X2',
      selections: [
        { canonicalKey: 'HOME', label: `${homeTeam} (1)`, backOdds: odds[0] },
        { canonicalKey: 'DRAW', label: 'Pareggio (X)', backOdds: odds[1] },
        { canonicalKey: 'AWAY', label: `${awayTeam} (2)`, backOdds: odds[2] },
      ],
      scrapedAt,
    });

    const groups = linkScrapedMarkets([
      mk('888sport_it', '888sport.it', 'Roma', 'Inter', [2.5, 3.2, 2.8], 1000),
      mk('pinnacle', 'Pinnacle', 'Roma Women', 'Inter Women', [1.4, 4.5, 6.0], 1000),
      mk('sisal_it', 'Sisal.it', 'AS Roma', 'Internazionale', [2.4, 3.3, 2.9], 1000),
      mk('sisal_it', 'Sisal.it', 'AS Roma', 'Internazionale', [2.65, 3.1, 2.75], 2000),
    ]);

    expect(groups).toHaveLength(2);
    const menGroup = groups.find((g) => g.homeTeam === 'Roma')!;
    const sisalEntry = menGroup.marketsByType
      .get('1X2')!
      .find((e) => e.market.sourceId === 'sisal_it')!;
    // Must prefer the fresher scrapedAt (2000 -> odds 2.65) over older duplicate (1000 -> odds 2.4)
    expect(sisalEntry.selections.find((s) => s.canonicalKey === 'HOME')?.backOdds).toBe(2.65);
  });

  it('aligns Smarkets US-ordered basketball Away@Home contracts cleanly without swapping sides', async () => {
    const kickoff = new Date(Date.now() + 2 * 3600_000).toISOString();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/events/?')) {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: '501',
                name: 'Belmont Bruins vs Akron Zips',
                start_datetime: kickoff,
                type: 'basketball_match',
                state: 'upcoming',
                full_slug: '/sport/basketball/ncaa/2026/belmont-vs-akron',
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/events/501/markets/')) {
        return new Response(
          JSON.stringify({
            markets: [
              {
                id: '9001',
                event_id: '501',
                name: 'Winner (including overtime)',
                market_type: { name: 'WINNER_2_WAY' },
                state: 'open',
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/markets/9001/contracts/')) {
        return new Response(
          JSON.stringify({
            contracts: [
              // AWAY appears first at display_order=0, HOME appears second at display_order=100
              {
                id: 'c_away',
                market_id: '9001',
                name: 'Belmont Bruins',
                slug: 'away',
                display_order: 0,
                hidden: false,
                state_or_outcome: 'open',
                contract_type: { name: 'AWAY' },
              },
              {
                id: 'c_home',
                market_id: '9001',
                name: 'Akron Zips',
                slug: 'home',
                display_order: 100,
                hidden: false,
                state_or_outcome: 'open',
                contract_type: { name: 'HOME' },
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/markets/9001/quotes/')) {
        return new Response(
          JSON.stringify({
            c_away: { bids: [{ price: 4000, quantity: 500000 }], offers: [{ price: 4200, quantity: 500000 }] }, // lay=2.50
            c_home: { bids: [{ price: 6250, quantity: 500000 }], offers: [{ price: 6400, quantity: 500000 }] }, // lay=1.60
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const res = await scrapeSmarketsExchange(false, { sports: ['basketball'] });
    expect(res.markets).toHaveLength(1);
    const m = res.markets[0];
    expect(m.homeTeam).toBe('Akron Zips');
    expect(m.awayTeam).toBe('Belmont Bruins');
    expect(m.selections.find((s) => s.canonicalKey === 'HOME')?.layOdds).toBe(1.6);
    expect(m.selections.find((s) => s.canonicalKey === 'AWAY')?.layOdds).toBe(2.5);
    expect(m.sourceMetadata?.cid_HOME).toBe('c_home');
    expect(m.sourceMetadata?.cid_AWAY).toBe('c_away');
  });

  it('uses cache-busting on Diretta ADM and extracts basketball FULL_TIME_OVER_TIME cleanly', async () => {
    const startSec = Math.floor((Date.now() + 3 * 3600_000) / 1000);
    const seenUrls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      seenUrls.push(url);
      if (url.includes('400.flashscore.ninja')) {
        return new Response(
          `ZA÷USA: NBA~AA÷evB1¬AB÷1¬AD÷${startSec}¬AE÷Boston Celtics¬AF÷Miami Heat¬JA÷pHome¬JB÷pAway~`,
          { status: 200 }
        );
      }
      if (url.includes('global.ds.lsapp.eu/odds/pq_graphql')) {
        return new Response(
          JSON.stringify({
            data: {
              findOddsByEventId: {
                odds: [
                  {
                    bookmakerId: 159,
                    bettingType: 'HOME_AWAY',
                    bettingScope: 'FULL_TIME',
                    odds: [
                      { eventParticipantId: 'pHome', value: '1.70', active: true, handicap: null, selection: null, bothTeamsToScore: null, result: 'NONE' },
                      { eventParticipantId: 'pAway', value: '2.30', active: true, handicap: null, selection: null, bothTeamsToScore: null, result: 'NONE' },
                    ],
                  },
                  {
                    bookmakerId: 159,
                    bettingType: 'HOME_AWAY',
                    bettingScope: 'FULL_TIME_OVER_TIME',
                    odds: [
                      { eventParticipantId: 'pHome', value: '1.58', active: true, handicap: null, selection: null, bothTeamsToScore: null, result: 'NONE' },
                      { eventParticipantId: 'pAway', value: '2.45', active: true, handicap: null, selection: null, bothTeamsToScore: null, result: 'NONE' },
                    ],
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { Age: '0' } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const res = await scrapeItalianAdmBookmakers({
      exchangeMarkets: [],
      enabledSourceIds: ['sisal_it'],
      includeLive: false,
      filter: { sports: ['basketball'], eventHints: [{ eventName: 'Boston Celtics - Miami Heat', sport: 'basketball' }] },
    });

    const sisalMkts = res.marketsBySource.get('sisal_it') ?? [];
    expect(sisalMkts).toHaveLength(1);
    expect(sisalMkts[0].marketType).toBe('H2H');
    // Must pick FULL_TIME_OVER_TIME (1.58 / 2.45) over FULL_TIME regulation (1.70 / 2.30)
    expect(sisalMkts[0].selections.find((s) => s.canonicalKey === 'HOME')?.backOdds).toBe(1.58);
    expect(sisalMkts[0].isAggregator).toBe(true);
    expect(seenUrls.some((u) => u.includes('pq_graphql') && u.includes('_t='))).toBe(true);
  });

  it('rejects Kambi non-Full-Time 3-way offers like First Goal and Team Totals', async () => {
    const kickoff = new Date(Date.now() + 2 * 3600_000).toISOString();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          events: [
            {
              event: {
                id: 9988,
                name: 'Milan - Lazio',
                homeName: 'Milan',
                awayName: 'Lazio',
                start: kickoff,
                group: 'Serie A',
                state: 'NOT_STARTED',
              },
              betOffers: [
                // Trap 1: First Goal (3-way OT_ONE/OT_CROSS/OT_TWO)
                {
                  betOfferType: { id: 2, englishName: 'Match' },
                  criterion: { id: 1001159750, englishLabel: 'First Goal (Draw: No Goals)' },
                  outcomes: [
                    { type: 'OT_ONE', odds: 1500, status: 'OPEN' },
                    { type: 'OT_CROSS', odds: 9500, status: 'OPEN' },
                    { type: 'OT_TWO', odds: 2400, status: 'OPEN' },
                  ],
                },
                // Valid Full Time 1X2
                {
                  betOfferType: { id: 2, englishName: 'Match' },
                  criterion: { id: 1001159858, englishLabel: 'Full Time' },
                  outcomes: [
                    { type: 'OT_ONE', odds: 2050, status: 'OPEN' },
                    { type: 'OT_CROSS', odds: 3400, status: 'OPEN' },
                    { type: 'OT_TWO', odds: 3600, status: 'OPEN' },
                  ],
                },
                // Trap 2: Home Team Total Goals 2.5
                {
                  betOfferType: { id: 6, englishName: 'Over/Under' },
                  criterion: { id: 9999, englishLabel: 'Total Goals by Home Team' },
                  outcomes: [
                    { type: 'OT_OVER', line: 2500, odds: 3800, status: 'OPEN' },
                    { type: 'OT_UNDER', line: 2500, odds: 1250, status: 'OPEN' },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 }
      );
    });

    const res = await scrapeKambiBrand(KAMBI_BRANDS['888sport_it'], false, { sports: ['football'] });
    expect(res.markets).toHaveLength(1);
    expect(res.markets[0].marketType).toBe('1X2');
    expect(res.markets[0].selections.find((s) => s.canonicalKey === 'HOME')?.backOdds).toBe(2.05);
  });

  it('verifies a single Oddsmatcher row live, patches changed odds, and detects suspended markets', async () => {
    const kickoff = new Date(Date.now() + 3 * 3600_000).toISOString();
    let verifyPhase: 'initial' | 'moved' | 'suspended' = 'initial';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.includes('scan-inbf.betfair.it')) {
        return new Response(
          JSON.stringify({
            results: [{ eventId: 1001, marketId: '1.1001', competitionId: 10, eventTypeId: 1 }],
            attachments: {
              competitions: { '10': { competitionId: 10, name: 'Serie A' } },
              events: { '1001': { name: 'Inter - Napoli', openDate: kickoff, competitionId: 10 } },
            },
          }),
          { status: 200 }
        );
      }

      if (url.includes('ero.betfair.it')) {
        const layInter = verifyPhase === 'moved' ? 2.18 : 2.12;
        const liqInter = verifyPhase === 'moved' ? 320 : 180;
        return new Response(
          JSON.stringify({
            eventTypes: [
              {
                eventTypeId: 1,
                eventNodes: [
                  {
                    eventId: 1001,
                    event: { eventName: 'Inter - Napoli', openDate: kickoff },
                    marketNodes: [
                      {
                        marketId: '1.1001',
                        state: { inplay: false, status: verifyPhase === 'suspended' ? 'SUSPENDED' : 'OPEN' },
                        description: { marketType: 'MATCH_ODDS', marketTime: kickoff },
                        runners: [
                          {
                            selectionId: 1,
                            description: { runnerName: 'Inter' },
                            state: { sortPriority: 1, status: 'ACTIVE' },
                            exchange: {
                              availableToBack: [{ price: 2.08, size: 100 }],
                              availableToLay: [{ price: layInter, size: liqInter }],
                            },
                          },
                          {
                            selectionId: 2,
                            description: { runnerName: 'Napoli' },
                            state: { sortPriority: 2, status: 'ACTIVE' },
                            exchange: {
                              availableToBack: [{ price: 3.5, size: 100 }],
                              availableToLay: [{ price: 3.65, size: 120 }],
                            },
                          },
                          {
                            selectionId: 3,
                            description: { runnerName: 'Pareggio' },
                            state: { sortPriority: 3, status: 'ACTIVE' },
                            exchange: {
                              availableToBack: [{ price: 3.3, size: 100 }],
                              availableToLay: [{ price: 3.45, size: 120 }],
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

      if (url.includes('kambicdn.com') && url.includes('listView/football')) {
        return new Response(
          JSON.stringify({
            events: [
              {
                event: {
                  id: 777,
                  name: 'Inter - Napoli',
                  homeName: 'Inter',
                  awayName: 'Napoli',
                  start: kickoff,
                  group: 'Serie A',
                  state: 'NOT_STARTED',
                },
                betOffers: [
                  {
                    betOfferType: { id: 2, englishName: 'Match' },
                    criterion: { id: 1001159858, englishLabel: 'Full Time' },
                    outcomes: [
                      { type: 'OT_ONE', odds: 2100, status: 'OPEN' },
                      { type: 'OT_CROSS', odds: 3400, status: 'OPEN' },
                      { type: 'OT_TWO', odds: 3600, status: 'OPEN' },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes('kambicdn.com') && url.includes('betoffer/event/777')) {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: 777,
                name: 'Inter - Napoli',
                homeName: 'Inter',
                awayName: 'Napoli',
                start: kickoff,
                group: 'Serie A',
                state: 'NOT_STARTED',
              },
            ],
            betOffers: [
              {
                betOfferType: { id: 2, englishName: 'Match' },
                criterion: { id: 1001159858, englishLabel: 'Full Time' },
                outcomes: [
                  { type: 'OT_ONE', odds: verifyPhase === 'moved' ? 2020 : 2100, status: 'OPEN' },
                  { type: 'OT_CROSS', odds: 3400, status: 'OPEN' },
                  { type: 'OT_TWO', odds: 3600, status: 'OPEN' },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    });

    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      enabledSources: onlyEnabledSources('betfair_exchange', '888sport_it'),
    };

    const engine = new ScraperEngine(undefined, () => true);
    const snap = await engine.runCycle(settings);
    const interHome = snap.rows.find((r) => r.selectionKey === 'HOME')!;
    expect(interHome).toBeDefined();
    expect(interHome.backOdds).toBe(2.1);
    expect(interHome.layOdds).toBe(2.12);
    expect(interHome.bookmakerEventId).toBe('777');
    expect(interHome.exchangeMarketId).toBe('1.1001');

    // 1. Live verify detects moved odds and updates snapshot immediately
    verifyPhase = 'moved';
    const movedRes = await engine.verifyRowQuotes(settings, {
      rowId: interHome.id,
      eventKey: interHome.eventKey,
      sport: interHome.sport,
      eventName: interHome.eventName,
      homeTeam: interHome.homeTeam,
      awayTeam: interHome.awayTeam,
      startTime: interHome.startTime,
      marketType: interHome.marketType,
      selectionKey: interHome.selectionKey,
      bookmakerId: interHome.bookmakerId,
      bookmakerName: interHome.bookmakerName,
      bookmakerEventId: interHome.bookmakerEventId,
      bookmakerSwapped: interHome.bookmakerSwapped,
      previousBackOdds: interHome.backOdds,
      exchangeId: interHome.exchangeId,
      exchangeName: interHome.exchangeName,
      exchangeMarketId: interHome.exchangeMarketId,
      exchangeSwapped: interHome.exchangeSwapped,
      previousLayOdds: interHome.layOdds,
      previousLiquidity: interHome.liquidity,
    });

    expect(movedRes.bookmaker.status).toBe('changed');
    expect(movedRes.bookmaker.liveOdds).toBe(2.02);
    expect(movedRes.exchange.status).toBe('changed');
    expect(movedRes.exchange.liveOdds).toBe(2.18);
    expect(movedRes.exchange.liveLiquidity).toBe(320);
    expect(movedRes.updatedRow?.backOdds).toBe(2.02);
    expect(movedRes.updatedRow?.layOdds).toBe(2.18);
    expect(engine.getSnapshot().rows.find((r) => r.id === interHome.id)?.backOdds).toBe(2.02);

    // 2. Live verify detects suspended exchange market and removes stale row from snapshot
    verifyPhase = 'suspended';
    const suspRes = await engine.verifyRowQuotes(settings, {
      rowId: interHome.id,
      eventKey: interHome.eventKey,
      sport: interHome.sport,
      eventName: interHome.eventName,
      homeTeam: interHome.homeTeam,
      awayTeam: interHome.awayTeam,
      startTime: interHome.startTime,
      marketType: interHome.marketType,
      selectionKey: interHome.selectionKey,
      bookmakerId: interHome.bookmakerId,
      bookmakerName: interHome.bookmakerName,
      bookmakerEventId: interHome.bookmakerEventId,
      bookmakerSwapped: interHome.bookmakerSwapped,
      previousBackOdds: 2.02,
      exchangeId: interHome.exchangeId,
      exchangeName: interHome.exchangeName,
      exchangeMarketId: interHome.exchangeMarketId,
      exchangeSwapped: interHome.exchangeSwapped,
      previousLayOdds: 2.18,
      previousLiquidity: 320,
    });

    expect(suspRes.exchange.status).toBe('suspended');
    expect(engine.getSnapshot().rows.some((r) => r.id === interHome.id)).toBe(false);
  });
});

describe('New Italian ADM Bookmakers (Diretta ADM, Gioco Digitale, PokerStars, NetBet, Stanleybet)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts Bet365, Betsson, DomusBet, DAZN Bet, Lottomatica, Planetwin365 and WilliamHill in one shared Diretta ADM batch', async () => {
    const startSec = Math.floor((Date.now() + 3 * 3600_000) / 1000);
    const admIds = [
      { id: 'bet365_it' as const, bkId: 419, homeOdd: '2.15' },
      { id: 'betsson_it' as const, bkId: 773, homeOdd: '2.12' },
      { id: 'domusbet_it' as const, bkId: 548, homeOdd: '2.10' },
      { id: 'daznbet_it' as const, bkId: 1185, homeOdd: '2.14' },
      { id: 'lottomatica_it' as const, bkId: 335, homeOdd: '2.11' },
      { id: 'planetwin365_it' as const, bkId: 467, homeOdd: '2.13' },
      { id: 'williamhill_it' as const, bkId: 372, homeOdd: '2.16' },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('400.flashscore.ninja')) {
        return new Response(
          `ZA÷ITALIA: Serie A~AA÷evAdm10¬AB÷1¬AD÷${startSec}¬AE÷Juventus¬AF÷Napoli¬JA÷pJuv¬JB÷pNap~`,
          { status: 200 }
        );
      }
      if (url.includes('global.ds.lsapp.eu/odds/pq_graphql')) {
        return new Response(
          JSON.stringify({
            data: {
              findOddsByEventId: {
                odds: admIds.map((b) => ({
                  bookmakerId: b.bkId,
                  bettingType: 'HOME_DRAW_AWAY',
                  bettingScope: 'FULL_TIME',
                  odds: [
                    { eventParticipantId: 'pJuv', value: b.homeOdd, active: true, handicap: null, selection: null, bothTeamsToScore: null, result: 'NONE' },
                    { eventParticipantId: null, value: '3.25', active: true, handicap: null, selection: null, bothTeamsToScore: null, result: 'NONE' },
                    { eventParticipantId: 'pNap', value: '3.40', active: true, handicap: null, selection: null, bothTeamsToScore: null, result: 'NONE' },
                  ],
                })),
              },
            },
          }),
          { status: 200, headers: { Age: '0' } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const res = await scrapeItalianAdmBookmakers({
      exchangeMarkets: [],
      enabledSourceIds: admIds.map((b) => b.id),
      includeLive: false,
      filter: { sports: ['football'], eventHints: [{ eventName: 'Juventus - Napoli', sport: 'football' }] },
    });

    for (const b of admIds) {
      const mkts = res.marketsBySource.get(b.id) ?? [];
      expect(mkts).toHaveLength(1);
      expect(mkts[0].marketType).toBe('1X2');
      expect(mkts[0].isAggregator).toBe(true);
      expect(mkts[0].selections.find((s) => s.canonicalKey === 'HOME')?.backOdds).toBe(Number(b.homeOdd));
    }
  });

  it('scrapes and live-verifies Gioco Digitale via direct Entain CDS API while rejecting non-Full-Time traps', async () => {
    const kickoff = new Date(Date.now() + 3 * 3600_000).toISOString();
    let verifyOdds = 2.08;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/clientconfig')) {
        return new Response(
          JSON.stringify({ msConnection: { pushAccessId: 'TEST_ACCESS_ID_1234567890' } }),
          { status: 200 }
        );
      }
      if (url.includes('/cds-api/bettingoffer/fixtures')) {
        return new Response(
          JSON.stringify({
            totalCount: 2,
            fixtures: [
              // Trap: Scorecast competition
              {
                id: '2:999',
                name: { value: 'Inter - Milan (Scorecast)' },
                startDate: kickoff,
                stage: 'PreMatch',
                competition: { name: { value: 'Serie A - Scorecast' } },
                participants: [{ name: { value: 'Inter' } }, { name: { value: 'Milan' } }],
                optionMarkets: [],
              },
              {
                id: '2:7919001',
                name: { value: 'Inter - Milan' },
                startDate: kickoff,
                stage: 'PreMatch',
                competition: { name: { value: 'Serie A' } },
                participants: [{ name: { value: 'Inter' } }, { name: { value: 'Milan' } }],
                optionMarkets: [
                  // Trap: 1st half result
                  {
                    id: 1,
                    name: { value: '1° tempo - risultato' },
                    status: 'Visible',
                    options: [
                      { name: { value: 'Inter' }, price: { odds: 2.8 }, status: 'Visible' },
                      { name: { value: 'X' }, price: { odds: 2.1 }, status: 'Visible' },
                      { name: { value: 'Milan' }, price: { odds: 4.0 }, status: 'Visible' },
                    ],
                  },
                  // Valid 1X2
                  {
                    id: 2,
                    name: { value: 'Risultato della partita' },
                    status: 'Visible',
                    options: [
                      { name: { value: 'Inter' }, price: { odds: 2.05 }, status: 'Visible' },
                      { name: { value: 'X' }, price: { odds: 3.3 }, status: 'Visible' },
                      { name: { value: 'Milan' }, price: { odds: 3.7 }, status: 'Visible' },
                    ],
                  },
                  // Valid O/U 2.5 (comma attr)
                  {
                    id: 3,
                    name: { value: 'Over/Under' },
                    attr: '2,5',
                    status: 'Visible',
                    options: [
                      { name: { value: 'Over 2,5' }, price: { odds: 1.92 }, status: 'Visible' },
                      { name: { value: 'Under 2,5' }, price: { odds: 1.84 }, status: 'Visible' },
                    ],
                  },
                  // Valid BTTS
                  {
                    id: 4,
                    name: { value: 'Gol/Gol' },
                    status: 'Visible',
                    options: [
                      { name: { value: 'Sì' }, price: { odds: 1.78 }, status: 'Visible' },
                      { name: { value: 'No' }, price: { odds: 1.95 }, status: 'Visible' },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/cds-api/bettingoffer/fixture-view')) {
        return new Response(
          JSON.stringify({
            fixture: {
              id: '2:7919001',
              name: { value: 'Inter - Milan' },
              startDate: kickoff,
              stage: 'PreMatch',
              competition: { name: { value: 'Serie A' } },
              participants: [{ name: { value: 'Inter' } }, { name: { value: 'Milan' } }],
              optionMarkets: [
                {
                  id: 2,
                  name: { value: 'Risultato della partita' },
                  status: 'Visible',
                  options: [
                    { name: { value: 'Inter' }, price: { odds: verifyOdds }, status: 'Visible' },
                    { name: { value: 'X' }, price: { odds: 3.3 }, status: 'Visible' },
                    { name: { value: 'Milan' }, price: { odds: 3.7 }, status: 'Visible' },
                  ],
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const scraped = await scrapeGiocoDigitale(false, { sports: ['football'] });
    expect(scraped.markets).toHaveLength(3);
    expect(scraped.markets.every((m) => m.sourceId === 'giocodigitale_it' && !m.isAggregator)).toBe(true);
    expect(scraped.markets.find((m) => m.marketType === '1X2')?.selections.find((s) => s.canonicalKey === 'HOME')?.backOdds).toBe(2.05);
    expect(scraped.markets.find((m) => m.marketType === 'OVER_UNDER_25')?.selections.find((s) => s.canonicalKey === 'OVER_25')?.backOdds).toBe(1.92);
    expect(scraped.markets.find((m) => m.marketType === 'BTTS')?.selections.find((s) => s.canonicalKey === 'BTTS_YES')?.backOdds).toBe(1.78);

    verifyOdds = 2.18;
    const ver = await verifyGiocoDigitaleEvent({
      eventId: '2:7919001',
      sport: 'football',
      marketType: '1X2',
      includeLive: false,
    });
    expect(ver.market?.selections.find((s) => s.canonicalKey === 'HOME')?.backOdds).toBe(2.18);
  });

  it('scrapes and live-verifies PokerStars.it direct sportsbook API across Football 1X2/OU2.5/BTTS', async () => {
    const kickoff = new Date(Date.now() + 3 * 3600_000).toISOString();
    let homeQuota = 225;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/alberaturaPrematch')) {
        return new Response(
          JSON.stringify({
            manifestazioneMap: {
              '1-209': { descrizione: 'ITA Serie A', codiceDisciplina: 1, codiceManifestazione: 209, posizione: 1 },
            },
            manifestazioneListByDisciplinaOggiEDomani: { '1': ['1-209'] },
            manifestazioneListByDisciplinaTutti: { '1': ['1-209'] },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/v1/schedaManifestazione/0/1-209')) {
        return new Response(
          JSON.stringify({
            avvenimentoFeList: [
              {
                key: '36481-100',
                descrizione: 'Roma - Lazio',
                data: kickoff,
                codiceDisciplina: 1,
                codiceManifestazione: 209,
                codicePalinsesto: 36481,
                codiceAvvenimento: 100,
                stato: 1,
              },
            ],
            infoAggiuntivaMap: {
              '36481-100-3-0': {
                codicePalinsesto: 36481,
                codiceAvvenimento: 100,
                codiceScommessa: 3,
                idInfoAggiuntiva: 0,
                descrizione: 'ESITO FINALE 1X2',
                esitoList: [
                  { codiceEsito: 1, descrizione: '1', quota: homeQuota, stato: 1 },
                  { codiceEsito: 2, descrizione: 'X', quota: 320, stato: 1 },
                  { codiceEsito: 3, descrizione: '2', quota: 330, stato: 1 },
                ],
              },
              '36481-100-7989-250': {
                codicePalinsesto: 36481,
                codiceAvvenimento: 100,
                codiceScommessa: 7989,
                idInfoAggiuntiva: 250,
                soglia: '2.5',
                esitoList: [
                  { codiceEsito: 1, descrizione: 'UNDER', quota: 185, stato: 1 },
                  { codiceEsito: 2, descrizione: 'OVER', quota: 195, stato: 1 },
                ],
              },
              '36481-100-18-0': {
                codicePalinsesto: 36481,
                codiceAvvenimento: 100,
                codiceScommessa: 18,
                idInfoAggiuntiva: 0,
                esitoList: [
                  { codiceEsito: 1, descrizione: 'GOAL', quota: 172, stato: 1 },
                  { codiceEsito: 2, descrizione: 'NOGOAL', quota: 205, stato: 1 },
                ],
              },
            },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const scraped = await scrapePokerstars(false, { sports: ['football'] });
    expect(scraped.markets).toHaveLength(3);
    const m1x2 = scraped.markets.find((m) => m.marketType === '1X2')!;
    expect(m1x2.eventId).toBe('36481-100');
    expect(m1x2.sourceMetadata?.manifestationKey).toBe('1-209');
    expect(m1x2.selections.find((s) => s.canonicalKey === 'HOME')?.backOdds).toBe(2.25);
    expect(scraped.markets.find((m) => m.marketType === 'OVER_UNDER_25')?.selections.find((s) => s.canonicalKey === 'UNDER_25')?.backOdds).toBe(1.85);
    expect(scraped.markets.find((m) => m.marketType === 'BTTS')?.selections.find((s) => s.canonicalKey === 'BTTS_YES')?.backOdds).toBe(1.72);

    homeQuota = 238;
    const ver = await verifyPokerstarsEvent({
      eventId: '36481-100',
      sport: 'football',
      marketType: '1X2',
      manifestationKey: '1-209',
    });
    expect(ver.market?.selections.find((s) => s.canonicalKey === 'HOME')?.backOdds).toBe(2.38);
  });

  it('converts Europe/Rome XSport timestamps across CET/CEST, skips Alta Quota specials, and verifies NetBet & Stanleybet', async () => {
    // CET (+1) in November, CEST (+2) in July
    expect(parseRomeWallClockToIso('20261125 20:30:00')).toBe('2026-11-25T19:30:00.000Z');
    expect(parseRomeWallClockToIso('20260715 20:30:00')).toBe('2026-07-15T18:30:00.000Z');

    const futureDate = addDays(new Date(), 1);
    const ymd = `${futureDate.getFullYear()}${String(futureDate.getMonth() + 1).padStart(2, '0')}${String(
      futureDate.getDate()
    ).padStart(2, '0')}`;
    const tsRome = `${ymd} 20:45:00`;
    let stanleyHome = 195;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/XSportDatastore/getPalinsestoDelGiorno')) {
        return new Response(
          JSON.stringify({
            dts: { IT_33: 'Serie A', IT_999: 'Alta Quota' },
            avs: {
              g1: [
                // Trap: date-suffixed Alta Quota special
                {
                  p: 36484,
                  a: 99999,
                  dsl: { IT: 'Inter 26/11 - Milan 26/11' },
                  ts: tsRome,
                  lv: false,
                  it: 999,
                  scs: [{ cs: 3, h: 0, eqs: [{ ce: 1, q: 300 }, { ce: 2, q: 320 }, { ce: 3, q: 250 }] }],
                },
                // Valid Serie A match
                {
                  p: 36481,
                  a: 55501,
                  dsl: { IT: 'Atalanta - Fiorentina' },
                  ts: tsRome,
                  lv: false,
                  it: 33,
                  scs: [
                    { cs: 3, h: 0, eqs: [{ ce: 1, q: stanleyHome }, { ce: 2, q: 345 }, { ce: 3, q: 390 }] },
                    { cs: 7989, h: 250, eqs: [{ ce: 1, q: 215 }, { ce: 2, q: 168 }] },
                    { cs: 18, h: 0, eqs: [{ ce: 1, q: 162 }, { ce: 2, q: 220 }] },
                  ],
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/XSportDatastore/getEvento')) {
        return new Response(
          JSON.stringify({
            p: 36481,
            a: 55501,
            ts: tsRome,
            lv: false,
            scs: [{ cs: 3, h: 0, eqs: [{ ce: 1, q: stanleyHome }, { ce: 2, q: 345 }, { ce: 3, q: 390 }] }],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const nbRes = await scrapeXSportBrand(XSPORT_BRANDS.netbet_it, false, { sports: ['football'] });
    expect(nbRes.markets).toHaveLength(3);
    expect(nbRes.markets.every((m) => m.eventName === 'Atalanta - Fiorentina')).toBe(true);
    expect(nbRes.markets.find((m) => m.marketType === 'OVER_UNDER_25')?.selections.find((s) => s.canonicalKey === 'UNDER_25')?.backOdds).toBe(2.15);
    expect(nbRes.markets.find((m) => m.marketType === 'OVER_UNDER_25')?.selections.find((s) => s.canonicalKey === 'OVER_25')?.backOdds).toBe(1.68);
    expect(nbRes.markets.find((m) => m.marketType === 'BTTS')?.selections.find((s) => s.canonicalKey === 'BTTS_YES')?.backOdds).toBe(1.62);

    stanleyHome = 205;
    const sbVer = await verifyXSportEvent({
      spec: XSPORT_BRANDS.stanleybet_it,
      eventId: '36481-55501',
      sport: 'football',
      marketType: '1X2',
      homeTeam: 'Atalanta',
      awayTeam: 'Fiorentina',
      startTime: parseRomeWallClockToIso(tsRome)!,
      includeLive: false,
      metadata: { pal: '36481', avv: '55501', dateKey: ymd, idSport: '1', idAggregata: '319' },
    });
    expect(sbVer.market?.selections.find((s) => s.canonicalKey === 'HOME')?.backOdds).toBe(2.05);

    const nbVer = await verifyXSportEvent({
      spec: XSPORT_BRANDS.netbet_it,
      eventId: '36481-55501',
      sport: 'football',
      marketType: '1X2',
      homeTeam: 'Atalanta',
      awayTeam: 'Fiorentina',
      startTime: parseRomeWallClockToIso(tsRome)!,
      includeLive: false,
      metadata: { pal: '36481', avv: '55501', dateKey: ymd, idSport: '1', idAggregata: '319' },
    });
    expect(nbVer.market?.selections.find((s) => s.canonicalKey === 'HOME')?.backOdds).toBe(2.05);
  });
});

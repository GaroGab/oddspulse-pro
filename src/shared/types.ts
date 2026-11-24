export type SportKey = 'football' | 'tennis' | 'basketball';

export type MarketType = '1X2' | 'OVER_UNDER_25' | 'BTTS' | 'H2H';

export type BetMode = 'normal' | 'snr' | 'sr' | 'rf';

export type SourceKind = 'bookmaker' | 'exchange';

export type SourceId =
  | 'betfair_exchange'
  | 'smarkets_exchange'
  | 'betflag_exchange'
  | 'sisal_it'
  | 'snai_it'
  | 'betflag_it'
  | 'eurobet_it'
  | 'goldbet_it'
  | 'betfair_sportsbook'
  | '888sport_it'
  | 'leovegas_it'
  | 'unibet'
  | 'paf'
  | 'pinnacle'
  | 'the_odds_api';

export interface SourceConfig {
  id: SourceId;
  name: string;
  shortName: string;
  kind: SourceKind;
  region: string;
  color: string;
  defaultCommission: number; // 0 for bookmakers, e.g. 0.045 for Betfair IT, 0.02 for Smarkets
  enabled: boolean;
  url: string;
  description: string;
}

export interface SelectionQuote {
  /** Canonical selection key: 'HOME' | 'DRAW' | 'AWAY' | 'OVER_25' | 'UNDER_25' | 'BTTS_YES' | 'BTTS_NO' */
  canonicalKey: string;
  /** Human-readable Italian label, e.g. "Inter", "Pareggio (X)", "Over 2.5" */
  label: string;
  backOdds?: number;
  backLiquidity?: number;
  layOdds?: number;
  layLiquidity?: number;
}

export interface RawScrapedMarket {
  sourceId: SourceId;
  sourceName: string;
  sourceKind: SourceKind;
  sport: SportKey;
  league: string;
  eventId: string;
  /** Optional provider-specific market identifier for ultra-fast direct live verification */
  sourceMarketId?: string;
  /** Optional provider-specific metadata (e.g. participant IDs) for direct verification */
  sourceMetadata?: Record<string, string>;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string; // ISO 8601 UTC
  marketType: MarketType;
  marketLabel: string;
  selections: SelectionQuote[];
  eventUrl?: string;
  /** Effective data freshness timestamp (adjusted backwards by upstream HTTP Age header if cached) */
  scrapedAt: number;
  /** Upstream CDN/proxy cache age in seconds reported via HTTP Age header (0 = real-time) */
  cacheAgeSec?: number;
  /** True when sourced through an odds aggregator (e.g. Diretta/Flashscore, Odds API) rather than the bookmaker directly */
  isAggregator?: boolean;
}

export type OddsDelta = 'up' | 'down' | 'same';

export interface OddsmatcherRow {
  id: string;
  eventKey: string;
  sport: SportKey;
  league: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  marketType: MarketType;
  marketLabel: string;
  selectionKey: string;
  selectionLabel: string;
  bookmakerId: SourceId;
  bookmakerName: string;
  bookmakerColor: string;
  bookmakerUrl?: string;
  bookmakerEventId?: string;
  bookmakerMarketId?: string;
  bookmakerMetadata?: Record<string, string>;
  bookmakerSwapped?: boolean;
  bookmakerScrapedAt?: number;
  bookmakerCacheAgeSec?: number;
  bookmakerIsAggregator?: boolean;
  backOdds: number;
  backDelta: OddsDelta;
  exchangeId: SourceId;
  exchangeName: string;
  exchangeColor: string;
  exchangeUrl?: string;
  exchangeEventId?: string;
  exchangeMarketId?: string;
  exchangeMetadata?: Record<string, string>;
  exchangeSwapped?: boolean;
  exchangeScrapedAt?: number;
  exchangeCacheAgeSec?: number;
  layOdds: number;
  layDelta: OddsDelta;
  liquidity: number;
  commission: number;
  /** Precomputed default normal rating (with exchange commission) */
  ratingNormal: number;
  /** Precomputed default SNR rating (freebet extraction %) */
  ratingSnr: number;
  /** Raw back/lay ratio % */
  rawRating: number;
  isSurebet: boolean;
  /** Conservative freshness timestamp: oldest of bookmaker & exchange quotes */
  updatedAt: number;
}

export interface DutcherLeg {
  selectionKey: string;
  selectionLabel: string;
  bookmakerId: SourceId;
  bookmakerName: string;
  bookmakerColor: string;
  odds: number;
  bookmakerUrl?: string;
}

export interface DutcherRow {
  id: string;
  eventKey: string;
  sport: SportKey;
  league: string;
  eventName: string;
  startTime: string;
  marketType: MarketType;
  marketLabel: string;
  legs: DutcherLeg[];
  impliedProbSum: number;
  rating: number; // (1 / impliedProbSum) * 100
  isSurebet: boolean;
  updatedAt: number;
}

export interface BackOutcomeQuote {
  selectionKey: string;
  selectionLabel: string;
  bookmakerId: SourceId;
  bookmakerName: string;
  odds: number;
  eventUrl?: string;
  eventId?: string;
  marketId?: string;
  sourceMetadata?: Record<string, string>;
  swapped?: boolean;
  cacheAgeSec?: number;
  isAggregator?: boolean;
  updatedAt: number;
}

export interface BackMarketGroup {
  id: string;
  eventKey: string;
  sport: SportKey;
  league: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  marketType: MarketType;
  marketLabel: string;
  outcomes: { key: string; label: string }[];
  quotes: BackOutcomeQuote[];
  updatedAt: number;
}

export type LiveVerifySideStatus = 'confirmed' | 'changed' | 'suspended' | 'error' | 'skipped';

export interface LiveVerifySideResult {
  status: LiveVerifySideStatus;
  previousOdds: number;
  liveOdds?: number;
  previousLiquidity?: number;
  liveLiquidity?: number;
  checkedAt: number;
  latencyMs: number;
  cacheAgeSec?: number;
  isAggregator?: boolean;
  error?: string;
}

export interface VerifyRowQuotesRequest {
  rowId: string;
  eventKey: string;
  sport: SportKey;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  marketType: MarketType;
  selectionKey: string;
  bookmakerId: SourceId;
  bookmakerName: string;
  bookmakerEventId?: string;
  bookmakerMarketId?: string;
  bookmakerMetadata?: Record<string, string>;
  bookmakerSwapped?: boolean;
  previousBackOdds: number;
  exchangeId: SourceId;
  exchangeName: string;
  exchangeEventId?: string;
  exchangeMarketId?: string;
  exchangeMetadata?: Record<string, string>;
  exchangeSwapped?: boolean;
  previousLayOdds: number;
  previousLiquidity: number;
}

export interface VerifyRowQuotesResult {
  rowId: string;
  verifiedAt: number;
  durationMs: number;
  bookmaker: LiveVerifySideResult;
  exchange: LiveVerifySideResult;
  updatedRow?: OddsmatcherRow;
}

export interface VerifyPuntaPuntaLegRequest {
  selectionKey: string;
  bookmakerId: SourceId;
  bookmakerName: string;
  eventId?: string;
  marketId?: string;
  sourceMetadata?: Record<string, string>;
  swapped?: boolean;
  previousOdds: number;
}

export interface VerifyPuntaPuntaRequest {
  groupId: string;
  eventKey: string;
  sport: SportKey;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  marketType: MarketType;
  legs: VerifyPuntaPuntaLegRequest[];
}

export interface VerifyPuntaPuntaResult {
  groupId: string;
  verifiedAt: number;
  durationMs: number;
  legs: Array<{
    selectionKey: string;
    bookmakerId: SourceId;
    result: LiveVerifySideResult;
  }>;
}

export interface SourceStatus {
  id: SourceId;
  name: string;
  shortName: string;
  kind: SourceKind;
  color: string;
  enabled: boolean;
  state: 'idle' | 'scraping' | 'ok' | 'error' | 'disabled';
  latencyMs: number;
  eventsCount: number;
  marketsCount: number;
  lastScrapedAt: number | null;
  lastCacheAgeSec?: number;
  lastError: string | null;
  successCount: number;
  errorCount: number;
}

export interface ScrapeLogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'success' | 'warn' | 'error';
  source: string;
  message: string;
}

export type NetworkHealth = 'idle' | 'online' | 'degraded' | 'offline';

export interface ConnectionDiagnostic {
  health: NetworkHealth;
  isSystemOnline: boolean;
  failedSourcesCount: number;
  activeSourcesCount: number;
  enabledSourcesCount: number;
  exchangesOnlineCount: number;
  bookmakersOnlineCount: number;
  lastErrorSummary: string | null;
}

export interface ScrapeDateWindow {
  startDate: string; // YYYY-MM-DD (local calendar day)
  endDate: string;   // YYYY-MM-DD (local calendar day)
  startMs: number;   // inclusive UTC epoch ms
  endMs: number;     // inclusive UTC epoch ms
}

export interface DateRangeValue {
  mode: 'all' | 'hours' | 'range';
  hours?: number;
  startDate: string | null; // YYYY-MM-DD (local calendar day)
  endDate: string | null;   // YYYY-MM-DD (local calendar day)
}

export interface ScrapeSnapshot {
  rows: OddsmatcherRow[];
  dutcherRows: DutcherRow[];
  backMarketGroups?: BackMarketGroup[];
  sources: SourceStatus[];
  logs: ScrapeLogEntry[];
  connection: ConnectionDiagnostic;
  stats: {
    totalRawMarkets: number;
    linkedEventsCount: number;
    totalMatchesCount: number;
    surebetsCount: number;
    lastCycleDurationMs: number;
    lastCompletedAt: number | null;
    isRunning: boolean;
    isDateRangeScraping?: boolean;
    activeDateRange?: { startDate: string; endDate: string } | null;
    autoScrapeEnabled?: boolean;
    nextAutoRefreshAt?: number | null;
  };
}

export interface SingleCalcInput {
  mode: BetMode;
  stake: number;
  backOdds: number;
  layOdds: number;
  commission: number; // e.g. 0.045
  refundAmount?: number; // for 'rf' mode
  refundRetention?: number; // 0..100, e.g. 70%
  /** -1 = full underlay, 0 = balanced, +1 = full overlay */
  balanceBias?: number;
}

export interface SingleCalcResult {
  layStake: number;
  balancedLayStake: number;
  underlayStake: number;
  overlayStake: number;
  liability: number;
  bookieWinProfit: number;
  exchangeWinProfit: number;
  expectedProfit: number;
  rating: number;
  rawRating: number;
}

export interface MultioddsLegInput {
  row: OddsmatcherRow;
  backOdds: number;
  layOdds: number;
  commission: number;
}

export interface MultioddsStep {
  legIndex: number;
  row: OddsmatcherRow;
  backOdds: number;
  layOdds: number;
  commission: number;
  layStake: number;
  liability: number;
  cumulativeLiability: number;
  profitIfLostHere: number;
  gapMinutesFromPrev: number | null;
}

export interface MultioddsPlan {
  id: string;
  bookmakerId: SourceId;
  bookmakerName: string;
  bookmakerColor: string;
  exchangeId: SourceId;
  exchangeName: string;
  legs: MultioddsStep[];
  combinedBackOdds: number;
  boostedBackOdds: number;
  effectiveCombinedLayOdds: number;
  rating: number;
  profitIfAllWin: number;
  guaranteedProfit: number;
  maxCumulativeLiability: number;
  minLiquidity: number;
  minGapMinutes: number;
  nonOverlapping: boolean;
}

export type SavedMultipleLegStatus = 'pending' | 'laid' | 'won_bookie' | 'lost_bookie';

export type SavedMultipleStatus = 'active' | 'completed';

export interface SavedMultipleLeg {
  id: string;
  eventKey: string;
  sport: SportKey;
  league: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  marketType: MarketType;
  marketLabel: string;
  selectionKey: string;
  selectionLabel: string;
  bookmakerId: SourceId;
  bookmakerName: string;
  bookmakerColor: string;
  exchangeId: SourceId;
  exchangeName: string;
  exchangeColor: string;
  initialBackOdds: number;
  backOdds: number;
  initialLayOdds: number;
  layOdds: number;
  liquidity: number;
  commission: number;
  status: SavedMultipleLegStatus;
  /** Actual placed lay stake when the user marks the leg as laid/settled */
  lockedLayStake?: number;
}

export interface SavedMultiplePlan {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  status: SavedMultipleStatus;
  mode: BetMode;
  stake: number;
  bonusBoostPct: number;
  refundAmount: number;
  refundRetention: number;
  minGapMinutes: number;
  bookmakerId: SourceId;
  bookmakerName: string;
  bookmakerColor: string;
  notes?: string;
  legs: SavedMultipleLeg[];
}

export type SavedMultiplePlanInput = Omit<SavedMultiplePlan, 'id' | 'createdAt' | 'updatedAt'>;

export interface TrackedBet {
  id: string;
  createdAt: number;
  eventName: string;
  league: string;
  sport: SportKey;
  marketLabel: string;
  selectionLabel: string;
  type: 'single' | 'multipla' | 'dutcher';
  mode: BetMode;
  bookmakerName: string;
  exchangeName: string;
  stake: number;
  backOdds: number;
  layOdds: number;
  layStake: number;
  liability: number;
  commission: number;
  expectedProfit: number;
  rating: number;
  status: 'pending' | 'won_bookie' | 'won_exchange' | 'refunded';
  realizedProfit: number;
  notes?: string;
}

export interface TargetedScrapeFilter {
  sports?: SportKey[];
  dateWindow?: ScrapeDateWindow;
  eventHints?: Array<{
    eventName: string;
    homeTeam?: string;
    awayTeam?: string;
    sport?: SportKey;
  }>;
}

export interface IgnoredWatchEvent {
  eventKey?: string;
  eventName: string;
  startTime?: string;
  ignoredAt: number;
}

export interface RatingWatchMatchSnapshot {
  rowId: string;
  eventKey?: string;
  eventName: string;
  league: string;
  startTime: string;
  marketType: MarketType;
  marketLabel: string;
  selectionKey: string;
  selectionLabel: string;
  bookmakerId: SourceId;
  bookmakerName: string;
  backOdds: number;
  exchangeId: SourceId;
  exchangeName: string;
  layOdds: number;
  liquidity: number;
  commission: number;
  rating: number;
  expectedProfit: number;
  matchedAt: number;
}

export interface RatingWatch {
  id: string;
  createdAt: number;
  updatedAt: number;
  enabled: boolean;
  eventKey?: string;
  eventName: string;
  sport?: SportKey;
  league?: string;
  leagues?: string[];
  startTime?: string;
  dateRange?: DateRangeValue;
  ignoredEvents?: IgnoredWatchEvent[];
  marketType: MarketType | 'ALL';
  selectionKey: string | 'ALL';
  bookmakerIds: SourceId[];
  exchangeIds: SourceId[];
  mode: BetMode;
  targetRating: number;
  refundRetention: number;
  minLiquidity: number;
  minBackOdds: number;
  maxBackOdds: number;
  autoPauseOnTrigger: boolean;
  cooldownSec: number;
  lastCheckedAt: number | null;
  lastBestMatch: RatingWatchMatchSnapshot | null;
  lastTriggeredAt: number | null;
  triggerCount: number;
}

export type RatingWatchInput = Omit<
  RatingWatch,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'lastCheckedAt'
  | 'lastBestMatch'
  | 'lastTriggeredAt'
  | 'triggerCount'
>;

export interface RatingWatchTriggerEvent {
  id: string;
  watchId: string;
  watchEventName: string;
  targetRating: number;
  mode: BetMode;
  match: RatingWatchMatchSnapshot;
  triggeredAt: number;
}

export interface RatingWatchEngineStatus {
  activeCount: number;
  totalCount: number;
  expiredCount: number;
  isPolling: boolean;
  intervalSec: number | null;
  backoffMultiplier: number;
  effectiveBookmakerIds: SourceId[];
  effectiveExchangeIds: SourceId[];
  nextCheckAt: number | null;
  lastCheckAt: number | null;
  lastCycleDurationMs: number;
  rateLimitReasons: string[];
}

export type TableDensity = 'compact' | 'comfortable' | 'spacious';

export type ThemeId = 'gold' | 'sapphire' | 'crimson' | 'emerald' | 'amethyst' | 'cyber';

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  subtitle: string;
  primaryHex: string;
  secondaryHex: string;
  bgHex: string;
  previewGradient: string;
}

export const THEME_CATALOG: ThemeMeta[] = [
  {
    id: 'gold',
    name: 'Ambra & Oro VIP',
    subtitle: 'Grafite caldo con oro e bronzo',
    primaryHex: '#f59e0b',
    secondaryHex: '#fb923c',
    bgHex: '#070609',
    previewGradient: 'linear-gradient(135deg, #fcd34d 0%, #f59e0b 50%, #ea580c 100%)',
  },
  {
    id: 'sapphire',
    name: 'Blu Elettrico & Zaffiro',
    subtitle: 'Blu notte con cobalto e indaco',
    primaryHex: '#38bdf8',
    secondaryHex: '#818cf8',
    bgHex: '#040712',
    previewGradient: 'linear-gradient(135deg, #7dd3fc 0%, #3b82f6 50%, #6366f1 100%)',
  },
  {
    id: 'crimson',
    name: 'Rosso Cremisi & Corallo',
    subtitle: 'Carbonio scuro con cremisi neon',
    primaryHex: '#fb7185',
    secondaryHex: '#fb923c',
    bgHex: '#0a0507',
    previewGradient: 'linear-gradient(135deg, #fda4af 0%, #f43f5e 50%, #f97316 100%)',
  },
  {
    id: 'emerald',
    name: 'Verde Smeraldo & Lime',
    subtitle: 'Nero foresta con smeraldo e lime',
    primaryHex: '#34d399',
    secondaryHex: '#a3e635',
    bgHex: '#040a07',
    previewGradient: 'linear-gradient(135deg, #6ee7b7 0%, #10b981 50%, #84cc16 100%)',
  },
  {
    id: 'amethyst',
    name: 'Viola Ametista & Fucsia',
    subtitle: 'Indaco profondo con viola e fucsia',
    primaryHex: '#c084fc',
    secondaryHex: '#f472b6',
    bgHex: '#080510',
    previewGradient: 'linear-gradient(135deg, #d8b4fe 0%, #a855f7 50%, #ec4899 100%)',
  },
  {
    id: 'cyber',
    name: 'Ciano & Viola Cyber',
    subtitle: 'Ossidiana con ciano elettrico',
    primaryHex: '#06f2d8',
    secondaryHex: '#8b5cf6',
    bgHex: '#04060d',
    previewGradient: 'linear-gradient(135deg, #67e8f9 0%, #06f2d8 50%, #8b5cf6 100%)',
  },
];

export interface DisplayInfo {
  currentWidth: number;
  currentHeight: number;
  workAreaWidth: number;
  workAreaHeight: number;
  scaleFactor: number;
  isMaximized: boolean;
  alwaysOnTop: boolean;
  zoomFactor: number;
}

export interface AppSettings {
  refreshIntervalSec: number; // 0 = manual, 30, 60, 120, 300
  autoScrapeEnabled: boolean; // true = automatic periodic scraping enabled, false = stopped/paused
  defaultStake: number;
  betfairCommission: number; // default 0.045 (4.5% Italy)
  smarketsCommission: number; // default 0.02 (2%)
  betflagCommission: number; // default 0.05 (5% standard, 2% promo)
  soundEnabled: boolean;
  includeLiveEvents: boolean;
  enabledSources: Record<SourceId, boolean>;
  theOddsApiKey: string;
  bankrollExchange: number;
  bankrollBookmakers: number;
  // Display & Window layout settings
  windowWidth: number;
  windowHeight: number;
  startMaximized: boolean;
  alwaysOnTop: boolean;
  uiScale: number; // 0.75..1.35
  sidebarCompact: boolean;
  showOddsmatcherKpis: boolean;
  tableDensity: TableDensity;
  drawerWidth: number; // 460..760 px
  animationsEnabled: boolean;
  theme: ThemeId;
}

export const SOURCE_CATALOG: SourceConfig[] = [
  {
    id: 'betfair_exchange',
    name: 'Betfair Exchange IT',
    shortName: 'Betfair EX',
    kind: 'exchange',
    region: 'IT',
    color: '#ffb80c',
    defaultCommission: 0.045,
    enabled: true,
    url: 'https://www.betfair.it/exchange/plus/it/calcio-scommesse-1',
    description: 'Exchange #1 in Italia — Quote Punta/Banca live e liquidità reale in Euro (Calcio, Tennis, Basket)',
  },
  {
    id: 'smarkets_exchange',
    name: 'Smarkets Exchange',
    shortName: 'Smarkets',
    kind: 'exchange',
    region: 'EU',
    color: '#00d084',
    defaultCommission: 0.02,
    enabled: true,
    url: 'https://smarkets.com/',
    description: 'Betting Exchange europeo al 2% di commissione con order book live e liquidità profonda',
  },
  {
    id: 'betflag_exchange',
    name: 'Betflag Exchange IT',
    shortName: 'Betflag EX',
    kind: 'exchange',
    region: 'IT (ADM)',
    color: '#38bdf8',
    defaultCommission: 0.05,
    enabled: true,
    url: 'https://www.betflag.it/exchange',
    description: 'Betting Exchange italiano ADM — Quote Punta/Banca live e liquidità reale in Euro (Calcio, Tennis, Basket)',
  },
  {
    id: 'sisal_it',
    name: 'Sisal.it',
    shortName: 'Sisal',
    kind: 'bookmaker',
    region: 'IT (ADM)',
    color: '#00b140',
    defaultCommission: 0,
    enabled: true,
    url: 'https://www.sisal.it/scommesse-matchpoint',
    description: 'Bookmaker italiano ADM — quote live Calcio (1X2, U/O 2.5, GG/NG), Tennis e Basket',
  },
  {
    id: 'snai_it',
    name: 'SNAI.it',
    shortName: 'SNAI',
    kind: 'bookmaker',
    region: 'IT (ADM)',
    color: '#f97316',
    defaultCommission: 0,
    enabled: true,
    url: 'https://www.snai.it/sport',
    description: 'Bookmaker storico italiano ADM — quote live Calcio (1X2, U/O 2.5, GG/NG), Tennis e Basket',
  },
  {
    id: 'betflag_it',
    name: 'Betflag.it',
    shortName: 'Betflag',
    kind: 'bookmaker',
    region: 'IT (ADM)',
    color: '#0ea5e9',
    defaultCommission: 0,
    enabled: true,
    url: 'https://www.betflag.it/sport',
    description: 'Sportsbook italiano ADM Betflag — quote Punta live su Calcio, Tennis e Basket',
  },
  {
    id: 'eurobet_it',
    name: 'Eurobet.it',
    shortName: 'Eurobet',
    kind: 'bookmaker',
    region: 'IT (ADM)',
    color: '#2563eb',
    defaultCommission: 0,
    enabled: true,
    url: 'https://www.eurobet.it/it/scommesse/',
    description: 'Bookmaker italiano ADM — quote live Calcio, Tennis e Basket',
  },
  {
    id: 'goldbet_it',
    name: 'GoldBet.it',
    shortName: 'GoldBet',
    kind: 'bookmaker',
    region: 'IT (ADM)',
    color: '#eab308',
    defaultCommission: 0,
    enabled: true,
    url: 'https://www.goldbet.it/scommesse/sport',
    description: 'Bookmaker italiano ADM — quote live Calcio, Tennis e Basket',
  },
  {
    id: 'betfair_sportsbook',
    name: 'Betfair Sportsbook IT',
    shortName: 'Betfair SB',
    kind: 'bookmaker',
    region: 'IT (ADM)',
    color: '#f59e0b',
    defaultCommission: 0,
    enabled: true,
    url: 'https://www.betfair.it/sport/',
    description: 'Sportsbook italiano ADM con 1X2, Under/Over 2.5, Goal/NoGoal, Tennis e Basket',
  },
  {
    id: '888sport_it',
    name: '888sport.it',
    shortName: '888sport',
    kind: 'bookmaker',
    region: 'IT (ADM)',
    color: '#ff6600',
    defaultCommission: 0,
    enabled: true,
    url: 'https://www.888sport.it/',
    description: 'Bookmaker ADM Italia su piattaforma Kambi con palinsesto Calcio, Tennis e Basket',
  },
  {
    id: 'leovegas_it',
    name: 'LeoVegas.it',
    shortName: 'LeoVegas',
    kind: 'bookmaker',
    region: 'IT (ADM)',
    color: '#ff8a1f',
    defaultCommission: 0,
    enabled: true,
    url: 'https://www.leovegas.it/scommesse',
    description: 'Bookmaker ADM Italia con quote competitive su campionati europei, Tennis e Basket',
  },
  {
    id: 'unibet',
    name: 'Unibet',
    shortName: 'Unibet',
    kind: 'bookmaker',
    region: 'EU',
    color: '#14b866',
    defaultCommission: 0,
    enabled: true,
    url: 'https://www.unibet.it/',
    description: 'Bookmaker internazionale con ampia copertura pre-match Calcio, Tennis e Basket',
  },
  {
    id: 'paf',
    name: 'Paf Sports',
    shortName: 'Paf',
    kind: 'bookmaker',
    region: 'EU',
    color: '#10b981',
    defaultCommission: 0,
    enabled: true,
    url: 'https://www.paf.com/',
    description: 'Bookmaker europeo con linee alternative e quote competitive su 1X2 e Totali',
  },
  {
    id: 'pinnacle',
    name: 'Pinnacle',
    shortName: 'Pinnacle',
    kind: 'bookmaker',
    region: 'INTL',
    color: '#3b82f6',
    defaultCommission: 0,
    enabled: true,
    url: 'https://www.pinnacle.com/',
    description: 'Bookmaker sharp leader mondiale a bassissimo aggio — riferimento chiave per surebet e value',
  },
  {
    id: 'the_odds_api',
    name: 'The Odds API (Extra)',
    shortName: 'OddsAPI',
    kind: 'bookmaker',
    region: 'OPZIONALE',
    color: '#a855f7',
    defaultCommission: 0,
    enabled: false,
    url: 'https://the-odds-api.com/',
    description: 'Connettore opzionale con API Key gratuita per aggiungere bookmaker EU/IT extra (William Hill, Betclic, Marathonbet, ecc.)',
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  refreshIntervalSec: 60,
  autoScrapeEnabled: true,
  defaultStake: 50,
  betfairCommission: 0.045,
  smarketsCommission: 0.02,
  betflagCommission: 0.05,
  soundEnabled: true,
  includeLiveEvents: false,
  enabledSources: {
    betfair_exchange: true,
    smarkets_exchange: true,
    betflag_exchange: true,
    sisal_it: true,
    snai_it: true,
    betflag_it: true,
    eurobet_it: true,
    goldbet_it: true,
    betfair_sportsbook: true,
    '888sport_it': true,
    leovegas_it: true,
    unibet: true,
    paf: true,
    pinnacle: true,
    the_odds_api: false,
  },
  theOddsApiKey: '',
  bankrollExchange: 1500,
  bankrollBookmakers: 1000,
  windowWidth: 1500,
  windowHeight: 940,
  startMaximized: false,
  alwaysOnTop: false,
  uiScale: 1,
  sidebarCompact: false,
  showOddsmatcherKpis: true,
  tableDensity: 'comfortable',
  drawerWidth: 520,
  animationsEnabled: true,
  theme: 'gold',
};

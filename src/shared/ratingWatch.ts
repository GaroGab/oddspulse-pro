import {
  addDays,
  matchesDateRange,
  resolveScrapeDateWindow,
  toLocalDateKey,
} from './dateRange';
import { calculateSingleMatch, quickRatings } from './math';
import {
  SOURCE_CATALOG,
  type AppSettings,
  type BetMode,
  type IgnoredWatchEvent,
  type MarketType,
  type OddsmatcherRow,
  type RatingWatch,
  type RatingWatchInput,
  type RatingWatchMatchSnapshot,
  type ScrapeDateWindow,
  type SourceId,
  type SportKey,
  type TargetedScrapeFilter,
} from './types';

export const ADM_BATCH_SOURCES = new Set<SourceId>([
  'sisal_it',
  'snai_it',
  'betflag_it',
  'eurobet_it',
  'goldbet_it',
  'lottomatica_it',
  'planetwin365_it',
  'bet365_it',
  'betsson_it',
  'domusbet_it',
  'daznbet_it',
  'williamhill_it',
]);

export const XSPORT_SOURCES = new Set<SourceId>(['netbet_it', 'stanleybet_it']);

export const KAMBI_SOURCES = new Set<SourceId>([
  '888sport_it',
  'leovegas_it',
  'unibet',
  'paf',
]);

const QUERY_STOP_TOKENS = new Set(['vs', 'v', 'fc', 'ac', 'as', 'sc', 'ss']);

export interface CompetitionPreset {
  value: string;
  label: string;
  sport: SportKey;
  hint: string;
  top?: boolean;
}

export const COMPETITION_PRESETS: CompetitionPreset[] = [
  // Calcio
  { value: 'Serie A', label: 'Serie A', sport: 'football', hint: 'Italia', top: true },
  { value: 'Serie B', label: 'Serie B', sport: 'football', hint: 'Italia', top: true },
  { value: 'Serie C', label: 'Serie C', sport: 'football', hint: 'Italia', top: false },
  { value: 'Coppa Italia', label: 'Coppa Italia', sport: 'football', hint: 'Italia', top: true },
  { value: 'Premier League', label: 'Premier League', sport: 'football', hint: 'Inghilterra', top: true },
  { value: 'Championship', label: 'Championship', sport: 'football', hint: 'Inghilterra', top: true },
  { value: 'FA Cup', label: 'FA Cup', sport: 'football', hint: 'Inghilterra', top: true },
  { value: 'LaLiga', label: 'LaLiga', sport: 'football', hint: 'Spagna', top: true },
  { value: 'LaLiga 2', label: 'LaLiga 2', sport: 'football', hint: 'Spagna', top: true },
  { value: 'Bundesliga', label: 'Bundesliga', sport: 'football', hint: 'Germania', top: true },
  { value: '2. Bundesliga', label: '2. Bundesliga', sport: 'football', hint: 'Germania', top: true },
  { value: 'Ligue 1', label: 'Ligue 1', sport: 'football', hint: 'Francia', top: true },
  { value: 'Ligue 2', label: 'Ligue 2', sport: 'football', hint: 'Francia', top: true },
  { value: 'Champions League', label: 'Champions League', sport: 'football', hint: 'UEFA', top: true },
  { value: 'Europa League', label: 'Europa League', sport: 'football', hint: 'UEFA', top: true },
  { value: 'Conference League', label: 'Conference League', sport: 'football', hint: 'UEFA', top: true },
  { value: 'Eredivisie', label: 'Eredivisie', sport: 'football', hint: 'Olanda', top: true },
  { value: 'Eerste Divisie', label: 'Eerste Divisie', sport: 'football', hint: 'Olanda', top: true },
  { value: 'Liga Portugal', label: 'Liga Portugal', sport: 'football', hint: 'Portogallo', top: true },
  { value: 'Liga Portugal 2', label: 'Liga Portugal 2', sport: 'football', hint: 'Portogallo', top: true },
  // Tennis
  { value: 'ATP', label: 'ATP Tour', sport: 'tennis', hint: 'Tennis Maschile', top: true },
  { value: 'WTA', label: 'WTA Tour', sport: 'tennis', hint: 'Tennis Femminile', top: true },
  { value: 'Challenger', label: 'ATP Challenger', sport: 'tennis', hint: 'Tennis', top: false },
  { value: 'Grand Slam', label: 'Grand Slam', sport: 'tennis', hint: 'Slam', top: true },
  {
    value: 'Tornei Internazionali',
    label: 'Tornei Internazionali',
    sport: 'tennis',
    hint: 'Davis / BJK / United Cup',
    top: true,
  },
  // Basket
  { value: 'NBA', label: 'NBA', sport: 'basketball', hint: 'Basket USA', top: true },
  { value: 'Eurolega', label: 'Eurolega', sport: 'basketball', hint: 'Basket Europa', top: true },
  { value: 'Serie A Basket', label: 'Serie A Basket (LBA)', sport: 'basketball', hint: 'Basket Italia', top: true },
];

export function getTopCompetitionValues(sport?: SportKey | 'ALL'): string[] {
  return COMPETITION_PRESETS.filter(
    (p) => Boolean(p.top) && (!sport || sport === 'ALL' || p.sport === sport)
  ).map((p) => p.value);
}

const GENERIC_SPORT_LEAGUES = new Set([
  'calcio',
  'football',
  'soccer',
  'tennis',
  'basket',
  'basketball',
]);

/**
 * Normalizes team/event text for accent-insensitive, case-insensitive matching.
 */
export function normalizeWatchQuery(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasPhrase(hayNorm: string, phraseNorm: string): boolean {
  if (!hayNorm || !phraseNorm) return false;
  const paddedHay = ` ${hayNorm} `;
  return paddedHay.includes(` ${phraseNorm} `);
}

function matchesCanonicalPreset(
  presetValue: string,
  rowLeague: string,
  rowSport?: SportKey
): boolean {
  const norm = normalizeWatchQuery(rowLeague);
  if (!norm) return false;

  const isBasket =
    rowSport === 'basketball' ||
    hasPhrase(norm, 'basket') ||
    hasPhrase(norm, 'basketball') ||
    hasPhrase(norm, 'lba') ||
    hasPhrase(norm, 'lega a');

  switch (presetValue) {
    case 'Serie A':
      if (isBasket) return false;
      if (
        hasPhrase(norm, 'brasile') ||
        hasPhrase(norm, 'brazil') ||
        hasPhrase(norm, 'ecuador') ||
        hasPhrase(norm, 'femminile') ||
        hasPhrase(norm, 'women')
      ) {
        return false;
      }
      return hasPhrase(norm, 'serie a');

    case 'Serie B':
      if (isBasket) return false;
      if (
        hasPhrase(norm, 'brasile') ||
        hasPhrase(norm, 'brazil') ||
        hasPhrase(norm, 'ecuador') ||
        hasPhrase(norm, 'femminile') ||
        hasPhrase(norm, 'women')
      ) {
        return false;
      }
      return hasPhrase(norm, 'serie b');

    case 'Serie C':
      if (isBasket) return false;
      return hasPhrase(norm, 'serie c');

    case 'Coppa Italia':
      if (isBasket) return false;
      if (hasPhrase(norm, 'femminile') || hasPhrase(norm, 'women')) return false;
      return hasPhrase(norm, 'coppa italia');

    case 'Premier League':
      if (
        hasPhrase(norm, 'russia') ||
        hasPhrase(norm, 'ucraina') ||
        hasPhrase(norm, 'ukraine') ||
        hasPhrase(norm, 'egitto') ||
        hasPhrase(norm, 'egypt') ||
        hasPhrase(norm, 'scozia') ||
        hasPhrase(norm, 'scotland') ||
        hasPhrase(norm, 'israele') ||
        hasPhrase(norm, 'kazakistan') ||
        hasPhrase(norm, 'armenia') ||
        hasPhrase(norm, 'canada') ||
        hasPhrase(norm, 'femminile') ||
        hasPhrase(norm, 'women')
      ) {
        return false;
      }
      return hasPhrase(norm, 'premier league');

    case 'Championship':
      if (
        hasPhrase(norm, 'scozia') ||
        hasPhrase(norm, 'scotland') ||
        hasPhrase(norm, 'femminile') ||
        hasPhrase(norm, 'women')
      ) {
        return false;
      }
      return hasPhrase(norm, 'championship');

    case 'FA Cup':
      if (hasPhrase(norm, 'femminile') || hasPhrase(norm, 'women')) return false;
      return hasPhrase(norm, 'fa cup');

    case 'LaLiga':
      if (
        hasPhrase(norm, 'laliga 2') ||
        hasPhrase(norm, 'la liga 2') ||
        hasPhrase(norm, 'laliga2') ||
        hasPhrase(norm, 'hypermotion') ||
        hasPhrase(norm, 'segunda') ||
        hasPhrase(norm, 'femminile') ||
        hasPhrase(norm, 'women')
      ) {
        return false;
      }
      return (
        hasPhrase(norm, 'laliga') ||
        hasPhrase(norm, 'la liga') ||
        (hasPhrase(norm, 'primera division') &&
          (hasPhrase(norm, 'spagna') || hasPhrase(norm, 'spain')))
      );

    case 'LaLiga 2':
      if (hasPhrase(norm, 'femminile') || hasPhrase(norm, 'women') || hasPhrase(norm, 'rfef')) {
        return false;
      }
      return (
        hasPhrase(norm, 'laliga 2') ||
        hasPhrase(norm, 'la liga 2') ||
        hasPhrase(norm, 'laliga2') ||
        hasPhrase(norm, 'hypermotion') ||
        (hasPhrase(norm, 'segunda division') && !hasPhrase(norm, 'b'))
      );

    case 'Bundesliga':
      if (
        hasPhrase(norm, '2 bundesliga') ||
        hasPhrase(norm, 'bundesliga 2') ||
        hasPhrase(norm, 'austria') ||
        hasPhrase(norm, 'frauen') ||
        hasPhrase(norm, 'femminile') ||
        hasPhrase(norm, 'women')
      ) {
        return false;
      }
      return hasPhrase(norm, 'bundesliga');

    case '2. Bundesliga':
      if (
        hasPhrase(norm, 'austria') ||
        hasPhrase(norm, 'frauen') ||
        hasPhrase(norm, 'femminile') ||
        hasPhrase(norm, 'women')
      ) {
        return false;
      }
      return hasPhrase(norm, '2 bundesliga') || hasPhrase(norm, 'bundesliga 2');

    case 'Ligue 1':
      if (
        hasPhrase(norm, 'algeria') ||
        hasPhrase(norm, 'tunisia') ||
        hasPhrase(norm, 'marocco') ||
        hasPhrase(norm, 'morocco') ||
        hasPhrase(norm, 'senegal') ||
        hasPhrase(norm, 'femminile') ||
        hasPhrase(norm, 'women')
      ) {
        return false;
      }
      return hasPhrase(norm, 'ligue 1');

    case 'Ligue 2':
      if (
        hasPhrase(norm, 'algeria') ||
        hasPhrase(norm, 'tunisia') ||
        hasPhrase(norm, 'marocco') ||
        hasPhrase(norm, 'morocco') ||
        hasPhrase(norm, 'senegal') ||
        hasPhrase(norm, 'femminile') ||
        hasPhrase(norm, 'women')
      ) {
        return false;
      }
      return hasPhrase(norm, 'ligue 2');

    case 'Champions League':
      if (
        isBasket ||
        hasPhrase(norm, 'afc') ||
        hasPhrase(norm, 'caf') ||
        hasPhrase(norm, 'concacaf') ||
        hasPhrase(norm, 'femminile') ||
        hasPhrase(norm, 'women')
      ) {
        return false;
      }
      return hasPhrase(norm, 'champions league');

    case 'Europa League':
      return hasPhrase(norm, 'europa league');

    case 'Conference League':
      return hasPhrase(norm, 'conference league');

    case 'Eredivisie':
      if (hasPhrase(norm, 'femminile') || hasPhrase(norm, 'women')) return false;
      return hasPhrase(norm, 'eredivisie');

    case 'Eerste Divisie':
      return hasPhrase(norm, 'eerste divisie') || hasPhrase(norm, 'keuken kampioen');

    case 'Liga Portugal':
      if (
        hasPhrase(norm, 'liga portugal 2') ||
        hasPhrase(norm, 'sabseg') ||
        hasPhrase(norm, 'meu super') ||
        hasPhrase(norm, 'segunda liga') ||
        hasPhrase(norm, 'femminile') ||
        hasPhrase(norm, 'women')
      ) {
        return false;
      }
      return hasPhrase(norm, 'liga portugal') || hasPhrase(norm, 'primeira liga');

    case 'Liga Portugal 2':
      return (
        hasPhrase(norm, 'liga portugal 2') ||
        hasPhrase(norm, 'sabseg') ||
        hasPhrase(norm, 'meu super') ||
        (hasPhrase(norm, 'segunda liga') &&
          (hasPhrase(norm, 'portogallo') || hasPhrase(norm, 'portugal')))
      );

    case 'ATP':
      if (hasPhrase(norm, 'challenger')) return false;
      return hasPhrase(norm, 'atp');

    case 'WTA':
      return hasPhrase(norm, 'wta');

    case 'Challenger':
      return hasPhrase(norm, 'challenger');

    case 'Grand Slam':
      return (
        hasPhrase(norm, 'grand slam') ||
        hasPhrase(norm, 'australian open') ||
        hasPhrase(norm, 'roland garros') ||
        hasPhrase(norm, 'french open') ||
        hasPhrase(norm, 'wimbledon') ||
        hasPhrase(norm, 'us open')
      );

    case 'Tornei Internazionali':
      return (
        hasPhrase(norm, 'tornei internazionali') ||
        hasPhrase(norm, 'davis cup') ||
        hasPhrase(norm, 'coppa davis') ||
        hasPhrase(norm, 'billie jean king') ||
        hasPhrase(norm, 'bjk cup') ||
        hasPhrase(norm, 'fed cup') ||
        hasPhrase(norm, 'united cup') ||
        hasPhrase(norm, 'laver cup') ||
        hasPhrase(norm, 'hopman cup') ||
        hasPhrase(norm, 'olimpiadi') ||
        hasPhrase(norm, 'olympic') ||
        hasPhrase(norm, 'masters 1000')
      );

    case 'NBA':
      if (hasPhrase(norm, 'wnba')) return false;
      return hasPhrase(norm, 'nba');

    case 'Eurolega':
      return hasPhrase(norm, 'eurolega') || hasPhrase(norm, 'euroleague');

    case 'Serie A Basket':
      return (
        isBasket &&
        (hasPhrase(norm, 'serie a') || hasPhrase(norm, 'lba') || hasPhrase(norm, 'lega a'))
      );

    default:
      return false;
  }
}

/**
 * Resolves a raw league string (e.g. "ITALIA: Serie A", "Italy Serie A") to a canonical
 * preset value if one matches, or returns the trimmed original league name.
 */
export function resolveCanonicalCompetition(
  rawLeague: string | undefined,
  sport?: SportKey
): string | undefined {
  const trimmed = rawLeague?.trim();
  if (!trimmed || trimmed === 'ALL') return undefined;
  const norm = normalizeWatchQuery(trimmed);
  if (!norm || GENERIC_SPORT_LEAGUES.has(norm)) return undefined;

  const exactPreset = COMPETITION_PRESETS.find(
    (p) => p.value.toLowerCase() === trimmed.toLowerCase() && (!sport || p.sport === sport)
  );
  if (exactPreset) return exactPreset.value;

  for (const preset of COMPETITION_PRESETS) {
    if (sport && preset.sport !== sport) continue;
    if (matchesCanonicalPreset(preset.value, trimmed, sport)) {
      return preset.value;
    }
  }
  return trimmed;
}

export function inferSportFromLeague(watchLeague: string | undefined): SportKey | undefined {
  if (!watchLeague) return undefined;
  const canonical = resolveCanonicalCompetition(watchLeague);
  const preset = COMPETITION_PRESETS.find((p) => p.value === canonical);
  return preset?.sport;
}

/**
 * Checks whether a candidate row's league matches the watch's competition filter.
 */
export function matchesWatchLeague(
  watchLeague: string | undefined,
  rowLeague: string,
  rowSport?: SportKey
): boolean {
  const trimmed = watchLeague?.trim();
  if (!trimmed || trimmed === 'ALL') return true;

  const canonicalWatch = resolveCanonicalCompetition(trimmed);
  if (!canonicalWatch) return true;

  const matchedPreset = COMPETITION_PRESETS.find((p) => p.value === canonicalWatch);
  if (matchedPreset) {
    if (rowSport && matchedPreset.sport !== rowSport) return false;
    return matchesCanonicalPreset(canonicalWatch, rowLeague, rowSport);
  }

  const normWatch = normalizeWatchQuery(trimmed);
  const normRow = normalizeWatchQuery(rowLeague);
  if (!normWatch) return true;
  if (!normRow) return false;
  if (normRow === normWatch || hasPhrase(normRow, normWatch)) return true;

  const tokens = tokenizeWatchPart(trimmed);
  if (tokens.length === 0) return normRow.includes(normWatch);
  return tokens.every((tok) => hasPhrase(normRow, tok) || normRow.includes(tok));
}

/**
 * Normalizes a watch's competition filter(s) into a deduplicated string array,
 * supporting both multi-select `leagues` and legacy single `league`.
 */
export function getWatchLeagues(
  watch: Pick<RatingWatch, 'league' | 'leagues'>
): string[] {
  if (Array.isArray(watch.leagues) && watch.leagues.length > 0) {
    return Array.from(
      new Set(
        watch.leagues
          .map((l) => l.trim())
          .filter((l) => Boolean(l) && l !== 'ALL')
      )
    );
  }
  const single = watch.league?.trim();
  if (single && single !== 'ALL') return [single];
  return [];
}

/**
 * Checks whether a candidate row's league matches at least one of the selected competitions.
 * When `watchLeagues` is empty or undefined, all competitions match.
 */
export function matchesWatchLeagues(
  watchLeagues: string[] | string | undefined,
  rowLeague: string,
  rowSport?: SportKey
): boolean {
  if (!watchLeagues) return true;
  const list = (Array.isArray(watchLeagues) ? watchLeagues : [watchLeagues])
    .map((l) => l.trim())
    .filter((l) => Boolean(l) && l !== 'ALL');
  if (list.length === 0) return true;
  return list.some((lg) => matchesWatchLeague(lg, rowLeague, rowSport));
}

function sportHintLabelIt(sport: SportKey): string {
  switch (sport) {
    case 'football':
      return 'Calcio';
    case 'tennis':
      return 'Tennis';
    case 'basketball':
      return 'Basket';
  }
}

/**
 * Builds deduplicated competition options combining `COMPETITION_PRESETS` and
 * any additional live competitions found in scraped rows/events, filtered by sport.
 */
export function buildCompetitionOptions(
  items: Array<{ eventKey?: string; league: string; sport: SportKey }>,
  sportFilter?: SportKey,
  activeLeagues: string[] = [],
  prioritizeWithEvents = false
): Array<{ value: string; label: string; hint?: string }> {
  const opts: Array<{ value: string; label: string; hint?: string }> = [];
  const seenValues = new Set<string>();
  const seenEventKeysPerLeague = new Map<string, Set<string>>();
  const extraDynamicLeagues = new Map<string, { label: string; sport: SportKey; count: number }>();

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (sportFilter && it.sport !== sportFilter) continue;
    const canonical = resolveCanonicalCompetition(it.league, it.sport);
    if (!canonical) continue;

    const evId = it.eventKey || `${it.sport}:${it.league}:${i}`;
    let evSet = seenEventKeysPerLeague.get(canonical);
    if (!evSet) {
      evSet = new Set<string>();
      seenEventKeysPerLeague.set(canonical, evSet);
    }
    const isNewEvent = !evSet.has(evId);
    if (isNewEvent) evSet.add(evId);

    const isPreset = COMPETITION_PRESETS.some((p) => p.value === canonical);
    if (!isPreset && isNewEvent) {
      const cur = extraDynamicLeagues.get(canonical);
      if (cur) {
        cur.count += 1;
      } else {
        extraDynamicLeagues.set(canonical, { label: canonical, sport: it.sport, count: 1 });
      }
    }
  }

  const presetEntries = COMPETITION_PRESETS.filter(
    (preset) => !sportFilter || preset.sport === sportFilter
  ).map((preset) => {
    const liveCnt = seenEventKeysPerLeague.get(preset.value)?.size ?? 0;
    return {
      value: preset.value,
      label: preset.label,
      hint: liveCnt > 0 ? `${preset.hint} · ${liveCnt}` : preset.hint,
      liveCnt,
    };
  });

  const sortedExtras = Array.from(extraDynamicLeagues.values()).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label)
  );

  if (prioritizeWithEvents) {
    const livePresets = presetEntries
      .filter((p) => p.liveCnt > 0)
      .sort((a, b) => b.liveCnt - a.liveCnt);
    for (const p of livePresets) {
      opts.push({ value: p.value, label: p.label, hint: p.hint });
      seenValues.add(p.value);
    }
    for (const ex of sortedExtras) {
      if (seenValues.has(ex.label)) continue;
      opts.push({
        value: ex.label,
        label: ex.label,
        hint: `${sportHintLabelIt(ex.sport)} · ${ex.count}`,
      });
      seenValues.add(ex.label);
    }
    for (const p of presetEntries) {
      if (seenValues.has(p.value)) continue;
      opts.push({ value: p.value, label: p.label, hint: p.hint });
      seenValues.add(p.value);
    }
  } else {
    for (const p of presetEntries) {
      opts.push({ value: p.value, label: p.label, hint: p.hint });
      seenValues.add(p.value);
    }
    for (const ex of sortedExtras) {
      if (seenValues.has(ex.label)) continue;
      opts.push({
        value: ex.label,
        label: ex.label,
        hint: `${sportHintLabelIt(ex.sport)} · ${ex.count}`,
      });
      seenValues.add(ex.label);
    }
  }

  for (const lg of activeLeagues) {
    const trimmed = lg.trim();
    if (!trimmed || trimmed === 'ALL' || seenValues.has(trimmed)) continue;
    opts.push({ value: trimmed, label: trimmed });
    seenValues.add(trimmed);
  }

  return opts;
}

/**
 * Counts how many distinct canonical competitions have at least one event in `items`.
 */
export function countAvailableCompetitions(
  items: Array<{ league: string; sport: SportKey }>,
  sportFilter?: SportKey
): number {
  const set = new Set<string>();
  for (const it of items) {
    if (sportFilter && it.sport !== sportFilter) continue;
    const canonical = resolveCanonicalCompetition(it.league, it.sport);
    if (canonical) set.add(canonical);
  }
  return set.size;
}

/**
 * Formats a list of selected labels (e.g. competitions) fitting as many items
 * as possible within `maxChars` before appending an incremental `+N` counter.
 */
export function formatFittingListSummary(items: string[], maxChars = 26): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  const full = items.join(', ');
  if (full.length <= maxChars) return full;

  let k = 1;
  for (let i = items.length - 1; i >= 1; i--) {
    const candidate = `${items.slice(0, i).join(', ')} +${items.length - i}`;
    if (candidate.length <= maxChars) {
      k = i;
      break;
    }
  }
  return `${items.slice(0, k).join(', ')} +${items.length - k}`;
}

/**
 * Returns true if the tracked event has already started beyond the 5-minute grace window
 * (unless live events are explicitly enabled by settings).
 */
export function isWatchExpired(
  watch: Pick<RatingWatch, 'startTime' | 'dateRange'>,
  nowMs = Date.now(),
  includeLiveEvents = false
): boolean {
  if (includeLiveEvents) return false;
  if (watch.startTime) {
    const startMs = new Date(watch.startTime).getTime();
    if (Number.isFinite(startMs) && startMs < nowMs - 5 * 60_000) return true;
  }
  if (!watch.startTime && watch.dateRange?.mode === 'range') {
    const win = resolveScrapeDateWindow(watch.dateRange);
    if (win && win.endMs < nowMs - 5 * 60_000) return true;
  }
  return false;
}

function tokenizeWatchPart(raw: string): string[] {
  return normalizeWatchQuery(raw)
    .split(' ')
    .filter((tok) => tok.length >= 2 && !QUERY_STOP_TOKENS.has(tok));
}

function splitEventTeamsText(raw: string): [string, string] | null {
  for (const sep of [' - ', ' vs ', ' v ', ' @ ']) {
    const idx = raw.indexOf(sep);
    if (idx > 0) {
      const a = raw.slice(0, idx).trim();
      const b = raw.slice(idx + sep.length).trim();
      if (a && b) return [a, b];
    }
  }
  return null;
}

/**
 * Extracts the canonical eventKey from a saved match snapshot (falling back to the rowId prefix).
 */
export function extractMatchEventKey(
  match: Pick<RatingWatchMatchSnapshot, 'rowId' | 'eventKey'>
): string | undefined {
  if (typeof match.eventKey === 'string' && match.eventKey.trim()) {
    return match.eventKey.trim();
  }
  if (typeof match.rowId === 'string' && match.rowId.includes('|')) {
    const prefix = match.rowId.split('|')[0]?.trim();
    if (prefix) return prefix;
  }
  return undefined;
}

function sameStartTimestamp(a?: string, b?: string): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  const msA = Date.parse(a);
  const msB = Date.parse(b);
  if (Number.isFinite(msA) && Number.isFinite(msB)) {
    return Math.abs(msA - msB) <= 60_000;
  }
  return false;
}

/**
 * Checks whether a candidate event matches a specific IgnoredWatchEvent entry.
 */
export function matchesIgnoredWatchEvent(
  ignored: Pick<IgnoredWatchEvent, 'eventKey' | 'eventName' | 'startTime'>,
  candidate: { eventKey?: string; eventName: string; startTime?: string }
): boolean {
  if (ignored.eventKey && candidate.eventKey && ignored.eventKey === candidate.eventKey) {
    return true;
  }
  const igName = normalizeWatchQuery(ignored.eventName);
  const candName = normalizeWatchQuery(candidate.eventName);
  if (!igName || !candName || igName !== candName) return false;
  return sameStartTimestamp(ignored.startTime, candidate.startTime);
}

/**
 * Returns true if the given row belongs to an event ignored on this watch.
 */
export function isRowIgnoredByWatch(
  watch: Pick<RatingWatch, 'ignoredEvents'>,
  candidate: { eventKey?: string; eventName: string; startTime?: string }
): boolean {
  if (!watch.ignoredEvents || watch.ignoredEvents.length === 0) return false;
  return watch.ignoredEvents.some((ig) => matchesIgnoredWatchEvent(ig, candidate));
}

/**
 * Sanitizes and deduplicates an untrusted list of ignored events.
 */
export function sanitizeIgnoredWatchEvents(raw: unknown): IgnoredWatchEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: IgnoredWatchEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<IgnoredWatchEvent>;
    const eventKey =
      typeof obj.eventKey === 'string' && obj.eventKey.trim() ? obj.eventKey.trim() : undefined;
    const eventName = String(obj.eventName ?? '').trim();
    const startTime =
      typeof obj.startTime === 'string' && obj.startTime.trim() ? obj.startTime.trim() : undefined;
    if (!eventKey && !eventName) continue;
    const candidate = {
      eventKey,
      eventName: eventName || eventKey || '',
      startTime,
      ignoredAt: Number.isFinite(obj.ignoredAt) ? Number(obj.ignoredAt) : Date.now(),
    };
    if (!out.some((existing) => matchesIgnoredWatchEvent(existing, candidate))) {
      out.push(candidate);
    }
  }
  return out;
}

/**
 * Adds a matched event to a watch's ignored list without duplicates.
 */
export function appendIgnoredWatchEvent(
  existing: IgnoredWatchEvent[] | undefined,
  match: Pick<RatingWatchMatchSnapshot, 'rowId' | 'eventKey' | 'eventName' | 'startTime'>,
  nowMs = Date.now()
): IgnoredWatchEvent[] {
  const list = Array.isArray(existing) ? existing : [];
  const eventKey = extractMatchEventKey(match);
  const eventName = String(match.eventName ?? '').trim();
  const startTime = match.startTime || undefined;
  if (!eventKey && !eventName) return list;
  const candidate: IgnoredWatchEvent = {
    eventKey,
    eventName: eventName || eventKey || '',
    startTime,
    ignoredAt: nowMs,
  };
  if (list.some((ig) => matchesIgnoredWatchEvent(ig, candidate))) {
    return list;
  }
  return [...list, candidate];
}

/**
 * Removes an ignored event from a watch's ignored list so it can match again.
 */
export function removeIgnoredWatchEvent(
  existing: IgnoredWatchEvent[] | undefined,
  target: Pick<IgnoredWatchEvent, 'eventKey' | 'eventName' | 'startTime'>
): IgnoredWatchEvent[] {
  if (!Array.isArray(existing) || existing.length === 0) return [];
  return existing.filter((ig) => !matchesIgnoredWatchEvent(ig, target));
}

/**
 * Matches a candidate OddsmatcherRow against a watch's event identity (exact key first,
 * then fuzzy token/team match, or wildcard match when no event filter is specified).
 */
export function matchesWatchEvent(
  watch: Pick<RatingWatch, 'eventKey' | 'eventName' | 'sport' | 'league' | 'leagues'>,
  row: OddsmatcherRow
): boolean {
  if (watch.sport && row.sport !== watch.sport) return false;
  const watchLeagues = getWatchLeagues(watch);
  if (watchLeagues.length > 0 && !matchesWatchLeagues(watchLeagues, row.league, row.sport)) {
    return false;
  }
  if (watch.eventKey && row.eventKey === watch.eventKey) return true;

  const queryNorm = normalizeWatchQuery(watch.eventName);
  if (!queryNorm) return true;

  const rowHay = normalizeWatchQuery(`${row.eventName} ${row.homeTeam} ${row.awayTeam}`);
  const rowHome = normalizeWatchQuery(row.homeTeam);
  const rowAway = normalizeWatchQuery(row.awayTeam);

  const pair = splitEventTeamsText(watch.eventName);
  if (pair) {
    const tA = tokenizeWatchPart(pair[0]);
    const tB = tokenizeWatchPart(pair[1]);
    if (tA.length > 0 && tB.length > 0) {
      const directOk =
        tA.every((tok) => rowHome.includes(tok) || rowHay.includes(tok)) &&
        tB.every((tok) => rowAway.includes(tok) || rowHay.includes(tok));
      const swappedOk =
        tA.every((tok) => rowAway.includes(tok) || rowHay.includes(tok)) &&
        tB.every((tok) => rowHome.includes(tok) || rowHay.includes(tok));
      if (directOk || swappedOk) return true;
    }
  }

  const tokens = tokenizeWatchPart(watch.eventName);
  if (tokens.length === 0) return rowHay.includes(queryNorm);
  return tokens.every((tok) => rowHay.includes(tok));
}

/**
 * Returns true when an Oddsmatcher row represents a surebet (normal rating >= 100%).
 */
export function isRowSurebet(
  row: Pick<OddsmatcherRow, 'isSurebet' | 'backOdds' | 'layOdds' | 'commission'>
): boolean {
  if (row.isSurebet) return true;
  return quickRatings(row.backOdds, row.layOdds, row.commission).isSurebet;
}

/**
 * Evaluates a single RatingWatch against current Oddsmatcher rows and determines
 * the best qualifying quote plus whether an alert should fire right now.
 */
export function evaluateRatingWatch(
  watch: RatingWatch,
  rows: OddsmatcherRow[],
  opts?: { nowMs?: number; includeLiveEvents?: boolean }
): {
  isExpired: boolean;
  bestMatch: RatingWatchMatchSnapshot | null;
  shouldTrigger: boolean;
} {
  const nowMs = opts?.nowMs ?? Date.now();
  const isExpired = isWatchExpired(watch, nowMs, Boolean(opts?.includeLiveEvents));
  if (isExpired) {
    return { isExpired: true, bestMatch: null, shouldTrigger: false };
  }

  const bookSet = watch.bookmakerIds.length > 0 ? new Set(watch.bookmakerIds) : null;
  const exSet = watch.exchangeIds.length > 0 ? new Set(watch.exchangeIds) : null;

  let bestMatch: RatingWatchMatchSnapshot | null = null;

  for (const row of rows) {
    if (watch.dateRange && watch.dateRange.mode !== 'all') {
      if (!matchesDateRange(row.startTime, watch.dateRange, nowMs)) continue;
    }
    if (isRowIgnoredByWatch(watch, row)) continue;
    if (!matchesWatchEvent(watch, row)) continue;
    if (watch.marketType !== 'ALL' && row.marketType !== watch.marketType) continue;
    if (watch.selectionKey !== 'ALL' && row.selectionKey !== watch.selectionKey) continue;
    if (bookSet && !bookSet.has(row.bookmakerId)) continue;
    if (exSet && !exSet.has(row.exchangeId)) continue;
    if (row.liquidity < watch.minLiquidity) continue;
    if (row.backOdds < watch.minBackOdds || row.backOdds > watch.maxBackOdds) continue;
    if (watch.excludeSurebets && isRowSurebet(row)) continue;

    const calc = calculateSingleMatch({
      mode: watch.mode,
      stake: 100,
      backOdds: row.backOdds,
      layOdds: row.layOdds,
      commission: row.commission,
      refundAmount: 100,
      refundRetention: watch.refundRetention,
      balanceBias: 0,
    });

    if (
      !bestMatch ||
      calc.rating > bestMatch.rating ||
      (Math.abs(calc.rating - bestMatch.rating) < 1e-6 && row.liquidity > bestMatch.liquidity)
    ) {
      bestMatch = {
        rowId: row.id,
        eventKey: row.eventKey,
        eventName: row.eventName,
        league: row.league,
        startTime: row.startTime,
        marketType: row.marketType,
        marketLabel: row.marketLabel,
        selectionKey: row.selectionKey,
        selectionLabel: row.selectionLabel,
        bookmakerId: row.bookmakerId,
        bookmakerName: row.bookmakerName,
        backOdds: row.backOdds,
        exchangeId: row.exchangeId,
        exchangeName: row.exchangeName,
        layOdds: row.layOdds,
        liquidity: row.liquidity,
        commission: row.commission,
        rating: calc.rating,
        expectedProfit: calc.expectedProfit,
        matchedAt: nowMs,
      };
    }
  }

  const cooldownMs = Math.max(10, watch.cooldownSec) * 1000;
  const inCooldown = Boolean(watch.lastTriggeredAt && nowMs - watch.lastTriggeredAt < cooldownMs);

  const shouldTrigger =
    watch.enabled &&
    bestMatch !== null &&
    bestMatch.rating >= watch.targetRating - 1e-6 &&
    !inCooldown;

  return {
    isExpired: false,
    bestMatch,
    shouldTrigger,
  };
}

export interface AdaptiveWatchPlan {
  activeWatches: RatingWatch[];
  expiredWatchIds: string[];
  bookmakerIds: SourceId[];
  exchangeIds: SourceId[];
  sports?: SportKey[];
  dateWindow?: ScrapeDateWindow;
  eventHints: NonNullable<TargetedScrapeFilter['eventHints']>;
  intervalSec: number | null;
  rateLimitReasons: string[];
}

function computeWatchPlanDateWindow(
  activeWatches: RatingWatch[],
  nowMs: number
): ScrapeDateWindow | undefined {
  const todayKey = toLocalDateKey(new Date(nowMs));
  const tomorrowKey = toLocalDateKey(addDays(new Date(nowMs), 1));

  let minStartDate: string | null = null;
  let maxEndDate: string | null = null;
  let hasUnrestrictedWatch = false;
  let hasDatedWatch = false;

  for (const w of activeWatches) {
    const dr = w.dateRange;
    if (!dr || dr.mode === 'all') {
      hasUnrestrictedWatch = true;
      continue;
    }

    if (dr.mode === 'range') {
      const win = resolveScrapeDateWindow(dr);
      if (!win) {
        hasUnrestrictedWatch = true;
        continue;
      }
      hasDatedWatch = true;
      if (!minStartDate || win.startDate < minStartDate) minStartDate = win.startDate;
      if (!maxEndDate || win.endDate > maxEndDate) maxEndDate = win.endDate;
    } else if (dr.mode === 'hours') {
      hasDatedWatch = true;
      const hrs = dr.hours ?? 24;
      const endKey = toLocalDateKey(new Date(nowMs + hrs * 3600_000));
      if (!minStartDate || todayKey < minStartDate) minStartDate = todayKey;
      if (!maxEndDate || endKey > maxEndDate) maxEndDate = endKey;
    }
  }

  if (!hasDatedWatch || !minStartDate || !maxEndDate) return undefined;

  if (hasUnrestrictedWatch) {
    if (maxEndDate <= tomorrowKey) return undefined;
    if (todayKey < minStartDate) minStartDate = todayKey;
  }

  return (
    resolveScrapeDateWindow({
      mode: 'range',
      startDate: minStartDate,
      endDate: maxEndDate,
    }) ?? undefined
  );
}

function computeIntervalForSources(
  bookmakerSet: Set<SourceId>,
  exchangeSet: Set<SourceId>
): { intervalSec: number; rateLimitReasons: string[] } {
  let admCount = 0;
  let kambiCount = 0;
  for (const b of bookmakerSet) {
    if (ADM_BATCH_SOURCES.has(b)) admCount++;
    if (KAMBI_SOURCES.has(b)) kambiCount++;
  }
  const nonAdmCount = bookmakerSet.size - admCount;
  const exCount = exchangeSet.size;

  // ADM sources share Diretta/GraphQL event queries, so marginal cost per additional ADM bookie is lower
  const effectiveLoad =
    nonAdmCount + exCount + (admCount > 0 ? 1 + (admCount - 1) * 0.5 : 0);

  let intervalSec = Math.min(
    45,
    Math.max(8, Math.round(8 + Math.max(0, effectiveLoad - 2) * 3.5))
  );
  const rateLimitReasons: string[] = [];

  if (kambiCount >= 2) {
    intervalSec = Math.max(intervalSec, 20);
    rateLimitReasons.push('Floor anti-429 Kambi (20s)');
  } else if (kambiCount === 1) {
    intervalSec = Math.max(intervalSec, 15);
    rateLimitReasons.push('Floor anti-429 Kambi (15s)');
  }

  if (bookmakerSet.has('the_odds_api')) {
    intervalSec = Math.max(intervalSec, 60);
    rateLimitReasons.push('Floor quota The Odds API (60s)');
  }

  return { intervalSec, rateLimitReasons };
}

/**
 * Computes the minimal set of sources, sports, event hints, and safe monotonic polling interval
 * required by all currently active (enabled & non-expired) rating watches.
 */
export function computeAdaptiveWatchPlan(
  watches: RatingWatch[],
  settings: AppSettings,
  nowMs = Date.now()
): AdaptiveWatchPlan {
  const expiredWatchIds: string[] = [];
  const activeWatches: RatingWatch[] = [];

  for (const w of watches) {
    if (isWatchExpired(w, nowMs, settings.includeLiveEvents)) {
      expiredWatchIds.push(w.id);
    } else if (w.enabled) {
      activeWatches.push(w);
    }
  }

  if (activeWatches.length === 0) {
    return {
      activeWatches: [],
      expiredWatchIds,
      bookmakerIds: [],
      exchangeIds: [],
      eventHints: [],
      intervalSec: null,
      rateLimitReasons: [],
    };
  }

  const enabledCatalogBookmakers = SOURCE_CATALOG.filter(
    (s) =>
      s.kind === 'bookmaker' &&
      (settings.enabledSources[s.id] ?? s.enabled) &&
      (s.id !== 'the_odds_api' || settings.theOddsApiKey.trim().length >= 8)
  ).map((s) => s.id);

  const enabledCatalogExchanges = SOURCE_CATALOG.filter(
    (s) => s.kind === 'exchange' && (settings.enabledSources[s.id] ?? s.enabled)
  ).map((s) => s.id);

  const bookmakerSet = new Set<SourceId>();
  const exchangeSet = new Set<SourceId>();
  const sportSet = new Set<SportKey>();
  let needsAllSports = false;

  const eventHints: NonNullable<TargetedScrapeFilter['eventHints']> = [];
  const seenHints = new Set<string>();
  let hasWildcardEventWatch = false;

  for (const w of activeWatches) {
    if (w.bookmakerIds.length === 0) {
      for (const b of enabledCatalogBookmakers) bookmakerSet.add(b);
    } else {
      for (const b of w.bookmakerIds) {
        if (b === 'the_odds_api' && settings.theOddsApiKey.trim().length < 8) continue;
        bookmakerSet.add(b);
      }
    }

    if (w.exchangeIds.length === 0) {
      for (const ex of enabledCatalogExchanges) exchangeSet.add(ex);
    } else {
      for (const ex of w.exchangeIds) exchangeSet.add(ex);
    }

    if (w.sport) {
      sportSet.add(w.sport);
    } else {
      const wLeagues = getWatchLeagues(w);
      if (wLeagues.length > 0) {
        const inferred = wLeagues.map((lg) => inferSportFromLeague(lg));
        if (inferred.every((sp): sp is SportKey => Boolean(sp))) {
          for (const sp of inferred) sportSet.add(sp);
        } else {
          needsAllSports = true;
        }
      } else {
        needsAllSports = true;
      }
    }

    const queryNorm = normalizeWatchQuery(w.eventName);
    if (!w.eventKey && !queryNorm) {
      hasWildcardEventWatch = true;
      continue;
    }

    const hintKey = `${queryNorm}|${w.sport ?? ''}`;
    if (!seenHints.has(hintKey)) {
      seenHints.add(hintKey);
      const pair = splitEventTeamsText(w.eventName);
      eventHints.push({
        eventName: w.eventName,
        homeTeam: pair?.[0],
        awayTeam: pair?.[1],
        sport: w.sport,
      });
    }
  }

  // Fallback to all enabled sources if a watch explicitly pinned sources that are unavailable (e.g. OddsAPI without key)
  if (bookmakerSet.size === 0) {
    for (const b of enabledCatalogBookmakers) bookmakerSet.add(b);
  }
  if (exchangeSet.size === 0) {
    for (const ex of enabledCatalogExchanges) exchangeSet.add(ex);
  }

  const { intervalSec, rateLimitReasons } = computeIntervalForSources(bookmakerSet, exchangeSet);
  const dateWindow = computeWatchPlanDateWindow(activeWatches, nowMs);

  return {
    activeWatches,
    expiredWatchIds,
    bookmakerIds: Array.from(bookmakerSet),
    exchangeIds: Array.from(exchangeSet),
    sports: needsAllSports || sportSet.size === 0 ? undefined : Array.from(sportSet),
    dateWindow,
    eventHints: hasWildcardEventWatch ? [] : eventHints,
    intervalSec,
    rateLimitReasons,
  };
}

/**
 * Estimates polling cadence for a single draft watch configuration inside the Radar Rating UI form.
 */
export function estimateSingleWatchInterval(
  draft: Pick<RatingWatchInput, 'bookmakerIds' | 'exchangeIds'>,
  settings: AppSettings
): { intervalSec: number; bookCount: number; exCount: number; rateLimitReasons: string[] } {
  const enabledBookies = SOURCE_CATALOG.filter(
    (s) =>
      s.kind === 'bookmaker' &&
      (settings.enabledSources[s.id] ?? s.enabled) &&
      (s.id !== 'the_odds_api' || settings.theOddsApiKey.trim().length >= 8)
  ).map((s) => s.id);

  const enabledExchanges = SOURCE_CATALOG.filter(
    (s) => s.kind === 'exchange' && (settings.enabledSources[s.id] ?? s.enabled)
  ).map((s) => s.id);

  const bookmakerSet = new Set<SourceId>(
    draft.bookmakerIds.length > 0 ? draft.bookmakerIds : enabledBookies
  );
  const exchangeSet = new Set<SourceId>(
    draft.exchangeIds.length > 0 ? draft.exchangeIds : enabledExchanges
  );

  const { intervalSec, rateLimitReasons } = computeIntervalForSources(bookmakerSet, exchangeSet);
  return {
    intervalSec,
    bookCount: bookmakerSet.size,
    exCount: exchangeSet.size,
    rateLimitReasons,
  };
}

export function getSelectionOptionsForMarket(
  marketType: MarketType | 'ALL'
): Array<{ value: string; label: string }> {
  const all = { value: 'ALL', label: 'Qualsiasi esito' };
  switch (marketType) {
    case '1X2':
      return [
        all,
        { value: 'HOME', label: '1 (Casa)' },
        { value: 'DRAW', label: 'X (Pareggio)' },
        { value: 'AWAY', label: '2 (Trasferta)' },
      ];
    case 'H2H':
      return [
        all,
        { value: 'HOME', label: '1 (Casa / Giocatore 1)' },
        { value: 'AWAY', label: '2 (Trasferta / Giocatore 2)' },
      ];
    case 'OVER_UNDER_25':
      return [
        all,
        { value: 'OVER_25', label: 'Over 2.5' },
        { value: 'UNDER_25', label: 'Under 2.5' },
      ];
    case 'BTTS':
      return [
        all,
        { value: 'BTTS_YES', label: 'Goal (Sì)' },
        { value: 'BTTS_NO', label: 'NoGoal (No)' },
      ];
    default:
      return [
        all,
        { value: 'HOME', label: '1 (Casa)' },
        { value: 'DRAW', label: 'X (Pareggio)' },
        { value: 'AWAY', label: '2 (Trasferta)' },
        { value: 'OVER_25', label: 'Over 2.5' },
        { value: 'UNDER_25', label: 'Under 2.5' },
        { value: 'BTTS_YES', label: 'Goal (Sì)' },
        { value: 'BTTS_NO', label: 'NoGoal (No)' },
      ];
  }
}

export function betModeLabelIt(mode: BetMode): string {
  switch (mode) {
    case 'normal':
      return 'Normale';
    case 'snr':
      return 'Freebet SNR';
    case 'sr':
      return 'Bonus SR';
    case 'rf':
      return 'Rimborso RF';
    case 'rollover':
      return 'Rollover';
  }
}

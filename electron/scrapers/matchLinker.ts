import type {
  MarketType,
  RawScrapedMarket,
  SelectionQuote,
  SportKey,
  TargetedScrapeFilter,
} from '../../src/shared/types';
import { normalizeWatchQuery } from '../../src/shared/ratingWatch';

const TEAM_ALIASES: Record<string, string> = {
  internazionale: 'inter',
  'inter milan': 'inter',
  'inter milano': 'inter',
  'ac milan': 'milan',
  'as roma': 'roma',
  'ss lazio': 'lazio',
  'juventus turin': 'juventus',
  juve: 'juventus',
  'hellas verona': 'verona',
  'cagliari calcio': 'cagliari',
  'como 1907': 'como',
  napoli: 'napoli',
  'atalanta bergamo': 'atalanta',
  fiorentina: 'fiorentina',
  'bayern monaco': 'bayern munich',
  'bayern munchen': 'bayern munich',
  'fc bayern': 'bayern munich',
  'borussia dortmund': 'dortmund',
  'borussia monchengladbach': 'monchengladbach',
  mgladbach: 'monchengladbach',
  'bayer leverkusen': 'leverkusen',
  'rb lipsia': 'leipzig',
  'rb leipzig': 'leipzig',
  lipsia: 'leipzig',
  'eintracht francoforte': 'eintracht frankfurt',
  francoforte: 'eintracht frankfurt',
  stoccarda: 'stuttgart',
  friburgo: 'freiburg',
  colonia: 'koln',
  cologne: 'koln',
  amburgo: 'hamburger',
  norimberga: 'nurnberg',
  nuremberg: 'nurnberg',
  magonza: 'mainz',
  augusta: 'augsburg',
  'st pauli': 'st pauli',
  siviglia: 'sevilla',
  'real madrid': 'real madrid',
  'real madrid cf': 'real madrid',
  'atletico madrid': 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
  'club atletico madrid': 'atletico madrid',
  'club atletico de madrid': 'atletico madrid',
  'atl madrid': 'atletico madrid',
  'real betis': 'betis',
  'real betis balompie': 'betis',
  'betis siviglia': 'betis',
  'real valladolid': 'valladolid',
  'real mallorca': 'mallorca',
  'real oviedo': 'oviedo',
  'real zaragoza': 'zaragoza',
  'barcellona': 'barcelona',
  'fc barcelona': 'barcelona',
  'athletic bilbao': 'athletic club',
  bilbao: 'athletic club',
  'celta vigo': 'celta',
  'celta de vigo': 'celta',
  maiorka: 'mallorca',
  maiorca: 'mallorca',
  marsiglia: 'marseille',
  'olympique marseille': 'marseille',
  'olympique de marseille': 'marseille',
  lione: 'lyon',
  'olympique lyonnais': 'lyon',
  nizza: 'nice',
  psg: 'paris saint germain',
  'paris sg': 'paris saint germain',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  'man city': 'manchester city',
  spurs: 'tottenham',
  'tottenham hotspur': 'tottenham',
  wolves: 'wolverhampton',
  'wolverhampton wanderers': 'wolverhampton',
  'nottm forest': 'nottingham forest',
  nottingham: 'nottingham forest',
  'west ham united': 'west ham',
  'newcastle united': 'newcastle',
  'leeds united': 'leeds',
  'sheffield utd': 'sheffield united',
  'sheffield wed': 'sheffield wednesday',
  'stella rossa': 'crvena zvezda',
  'red star belgrade': 'crvena zvezda',
  'stella rossa belgrado': 'crvena zvezda',
  'sporting lisbona': 'sporting cp',
  'sporting lisbon': 'sporting cp',
  porto: 'porto',
  benfica: 'benfica',
  'dinamo zagabria': 'dinamo zagreb',
  bruges: 'club brugge',
  'club bruges': 'club brugge',
  anversa: 'antwerp',
  'royal antwerp': 'antwerp',
  basilea: 'basel',
  zurigo: 'zurich',
  ginevra: 'servette',
  copenaghen: 'copenhagen',
  kobenhavn: 'copenhagen',
  stoccolma: 'stockholm',
  varsavia: 'warszawa',
  'legia varsavia': 'legia warszawa',
  cracovia: 'cracovia',
  sivasspor: 'sivasspor',
  fenerbahce: 'fenerbahce',
  galatasaray: 'galatasaray',
  besiktas: 'besiktas',
  olympiakos: 'olympiacos',
  panathinaikos: 'panathinaikos',
  salisburgo: 'salzburg',
  'red bull salzburg': 'salzburg',
  'rapid vienna': 'rapid wien',
  'austria vienna': 'austria wien',
  'sparta praga': 'sparta praha',
  'slavia praga': 'slavia praha',
  'viktoria plzen': 'plzen',
};

const NOISE_TOKENS = new Set([
  'fc', 'cf', 'sc', 'ac', 'as', 'us', 'ss', 'ssc', 'afc', 'bc', 'bk', 'fk', 'sk',
  'sv', 'tsv', 'vfb', 'vfl', 'fsv', 'bsc', 'tsg', 'cd', 'rc', 'rcd', 'sd', 'ud',
  'ca', 'de', 'la', 'el', 'the', 'calcio', 'club', 'sporting',
  'asd', 'ssd', 'uc', '1', '04', '05', '09', '1899', '1900', '1907', '1909', '1912',
  '1929',
]);

interface TeamCategory {
  isWomen: boolean;
  youthTag: string; // e.g. 'u19' | 'u21' | 'u23' | 'youth' | ''
  isReserve: boolean;
  key: string;
}

function extractTeamCategory(raw: string): TeamCategory {
  const clean = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const isWomen =
    /\b(women|woman|femminile|femminili|femenino|femenina|frauen|ladies|damen|feminines|femmes)\b/i.test(
      clean
    ) ||
    /\([dwf]\)\s*$/i.test(clean) ||
    /\s+[dwf]\s*$/i.test(clean);

  let youthTag = '';
  const uMatch = clean.match(/\b(?:u|under\s*[- ]?)(17|18|19|20|21|22|23)\b/i);
  if (uMatch) {
    youthTag = `u${uMatch[1]}`;
  } else if (/\b(primavera|youth|juniores)\b/i.test(clean)) {
    youthTag = 'youth';
  }

  const isReserve =
    /\b(reserves|reserve|riserve|futuro|next\s*gen|jong|castilla)\b/i.test(clean) ||
    /\s+(?:ii|iii|b)\s*$/i.test(clean);

  const key = `${isWomen ? 'W' : 'M'}:${youthTag || 'S'}:${isReserve ? 'R' : '1'}`;
  return { isWomen, youthTag, isReserve, key };
}

function areCategoriesCompatible(a: TeamCategory, b: TeamCategory, sport: SportKey): boolean {
  if (sport === 'tennis') return true;
  if (a.isWomen !== b.isWomen) return false;
  if (a.isReserve !== b.isReserve) return false;
  if (Boolean(a.youthTag) !== Boolean(b.youthTag)) return false;
  if (
    a.youthTag &&
    b.youthTag &&
    a.youthTag !== 'youth' &&
    b.youthTag !== 'youth' &&
    a.youthTag !== b.youthTag
  ) {
    return false;
  }
  return true;
}

export function normalizeTeamName(raw: string): string {
  let base = raw;
  if (raw.includes(',')) {
    const parts = raw.split(',').map((p) => p.trim());
    if (parts.length === 2 && parts[0] && parts[1]) {
      base = `${parts[1]} ${parts[0]}`;
    }
  }
  const s = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (TEAM_ALIASES[s]) return TEAM_ALIASES[s];

  const stripped = s
    .split(' ')
    .filter((tok) => tok.length > 0 && !NOISE_TOKENS.has(tok))
    .join(' ')
    .trim();

  const candidate = stripped || s;
  return TEAM_ALIASES[candidate] ?? candidate;
}

interface TeamProfile {
  norm: string;
  category: TeamCategory;
  tokens: string[];
  tokenSet: Set<string>;
  lastToken: string;
  firstInitial: string;
  bigrams: Map<string, number>;
  bigramTotal: number;
  indexKeys: string[];
}

function buildTeamProfile(raw: string): TeamProfile {
  const norm = normalizeTeamName(raw);
  const category = extractTeamCategory(raw);
  const tokens = norm.split(' ').filter(Boolean);
  const tokenSet = new Set(tokens);
  const clean = norm.replace(/\s+/g, '');
  const bigrams = new Map<string, number>();
  let bigramTotal = 0;

  if (clean.length < 2) {
    if (clean) {
      bigrams.set(clean, 1);
      bigramTotal = 1;
    }
  } else {
    for (let i = 0; i < clean.length - 1; i++) {
      const bg = clean.slice(i, i + 2);
      bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
      bigramTotal++;
    }
  }

  const indexKeys: string[] = [];
  for (const t of tokens) {
    if (t.length >= 3) {
      indexKeys.push(t.slice(0, 3));
      if (t.length >= 4) indexKeys.push(t);
    }
  }
  if (indexKeys.length === 0 && clean.length >= 2) {
    indexKeys.push(clean.slice(0, 3));
  }

  return {
    norm,
    category,
    tokens,
    tokenSet,
    lastToken: tokens[tokens.length - 1] ?? '',
    firstInitial: tokens[0]?.[0] ?? '',
    bigrams,
    bigramTotal,
    indexKeys,
  };
}

function profileSimilarity(a: TeamProfile, b: TeamProfile, sport: SportKey): number {
  if (!a.norm || !b.norm) return 0;
  if (!areCategoriesCompatible(a.category, b.category, sport)) return 0;
  if (a.norm === b.norm) return 1;
  if (a.norm.length >= 4 && b.norm.length >= 4 && (a.norm.includes(b.norm) || b.norm.includes(a.norm))) {
    return 0.92;
  }

  if (sport === 'tennis') {
    if (a.lastToken.length >= 4 && a.lastToken === b.lastToken) {
      if (!a.firstInitial || !b.firstInitial || a.firstInitial === b.firstInitial) {
        return 0.94;
      }
    }
  }

  let overlap = 0;
  const [smaller, larger] = a.bigrams.size <= b.bigrams.size ? [a.bigrams, b.bigrams] : [b.bigrams, a.bigrams];
  for (const [k, vS] of smaller) {
    const vL = larger.get(k);
    if (vL) overlap += Math.min(vS, vL);
  }
  const dice = (2 * overlap) / Math.max(1, a.bigramTotal + b.bigramTotal);

  let inter = 0;
  for (const t of a.tokenSet) if (b.tokenSet.has(t)) inter++;
  const jaccard = inter / Math.max(1, a.tokenSet.size + b.tokenSet.size - inter);

  return Math.max(dice, jaccard * 0.95);
}

export function teamSimilarity(rawA: string, rawB: string, sport: SportKey): number {
  return profileSimilarity(buildTeamProfile(rawA), buildTeamProfile(rawB), sport);
}

function splitTeamsGeneric(raw: string): [string, string] | null {
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
 * Checks whether a candidate raw event matches any tracked RatingWatch event hint.
 * Used by targeted scrapers to skip irrelevant detail/market/odds API calls.
 */
export function matchesEventHints(
  eventName: string,
  homeTeam: string,
  awayTeam: string,
  sport: SportKey,
  hints?: TargetedScrapeFilter['eventHints']
): boolean {
  if (!hints || hints.length === 0) return true;

  const fallbackPair = !homeTeam || !awayTeam ? splitTeamsGeneric(eventName) : null;
  const effHome = homeTeam || fallbackPair?.[0] || '';
  const effAway = awayTeam || fallbackPair?.[1] || '';
  const candNorm = normalizeWatchQuery(`${eventName} ${effHome} ${effAway}`);

  for (const hint of hints) {
    if (hint.sport && hint.sport !== sport) continue;

    const hintPair =
      hint.homeTeam && hint.awayTeam
        ? ([hint.homeTeam, hint.awayTeam] as [string, string])
        : splitTeamsGeneric(hint.eventName);

    if (hintPair && effHome && effAway) {
      const sh = teamSimilarity(effHome, hintPair[0], sport);
      const sa = teamSimilarity(effAway, hintPair[1], sport);
      if ((sh + sa) / 2 >= 0.72 && Math.min(sh, sa) >= 0.55) return true;

      const shSw = teamSimilarity(effHome, hintPair[1], sport);
      const saSw = teamSimilarity(effAway, hintPair[0], sport);
      if ((shSw + saSw) / 2 >= 0.72 && Math.min(shSw, saSw) >= 0.55) return true;
    }

    const tokens = normalizeWatchQuery(hint.eventName)
      .split(' ')
      .filter((t) => t.length >= 2 && t !== 'vs');
    if (tokens.length > 0 && tokens.every((t) => candNorm.includes(t))) {
      return true;
    }
  }

  return false;
}

export interface LinkedEventGroup {
  eventKey: string;
  sport: SportKey;
  league: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  startMs: number;
  marketsByType: Map<
    MarketType,
    Array<{
      market: RawScrapedMarket;
      swapped: boolean;
      selections: SelectionQuote[];
    }>
  >;
}

interface InternalGroup extends LinkedEventGroup {
  homeProf: TeamProfile;
  awayProf: TeamProfile;
}

function swapHomeAway(selections: SelectionQuote[]): SelectionQuote[] {
  return selections.map((s) => {
    if (s.canonicalKey === 'HOME') return { ...s, canonicalKey: 'AWAY' };
    if (s.canonicalKey === 'AWAY') return { ...s, canonicalKey: 'HOME' };
    return s;
  });
}

/**
 * Ultra-fast indexed event linker (< 50ms for 8,000+ scraped markets).
 * Stage 1: O(1) exact normalized hash match (direct & swapped).
 * Stage 2: Inverted prefix/token index restricted to ±95 min kickoff window + Dice/Jaccard similarity.
 */
export function linkScrapedMarkets(rawMarkets: RawScrapedMarket[]): LinkedEventGroup[] {
  const groups: InternalGroup[] = [];
  const exactIndex = new Map<string, InternalGroup[]>();
  const tokenIndex = new Map<string, InternalGroup[]>();
  const TIME_WINDOW_MS = 95 * 60 * 1000;

  const ordered = [...rawMarkets].sort((a, b) => {
    const score = (m: RawScrapedMarket) =>
      m.sourceId === 'betfair_exchange'
        ? 0
        : m.sourceId === 'betfair_sportsbook'
        ? 1
        : m.sourceId === '888sport_it'
        ? 2
        : 3;
    return score(a) - score(b) || b.scrapedAt - a.scrapedAt;
  });

  // Cache team profiles across duplicate markets of the same match
  const profCache = new Map<string, TeamProfile>();
  const getProf = (name: string): TeamProfile => {
    let p = profCache.get(name);
    if (!p) {
      p = buildTeamProfile(name);
      profCache.set(name, p);
    }
    return p;
  };

  for (const m of ordered) {
    const startMs = new Date(m.startTime).getTime();
    if (!Number.isFinite(startMs)) continue;

    const hProf = getProf(m.homeTeam);
    const aProf = getProf(m.awayTeam);
    if (!hProf.norm || !aProf.norm) continue;

    let bestGroup: InternalGroup | null = null;
    let bestSwapped = false;

    // Stage 1: Exact normalized O(1) lookup (direct, then swapped), enforcing category compatibility
    const directKey = `${m.sport}:${hProf.norm}__${aProf.norm}`;
    const directHits = exactIndex.get(directKey);
    if (directHits) {
      for (const g of directHits) {
        if (
          Math.abs(g.startMs - startMs) <= TIME_WINDOW_MS &&
          areCategoriesCompatible(g.homeProf.category, hProf.category, m.sport) &&
          areCategoriesCompatible(g.awayProf.category, aProf.category, m.sport)
        ) {
          bestGroup = g;
          bestSwapped = false;
          break;
        }
      }
    }

    if (!bestGroup) {
      const swapKey = `${m.sport}:${aProf.norm}__${hProf.norm}`;
      const swapHits = exactIndex.get(swapKey);
      if (swapHits) {
        for (const g of swapHits) {
          if (
            Math.abs(g.startMs - startMs) <= TIME_WINDOW_MS &&
            areCategoriesCompatible(g.homeProf.category, aProf.category, m.sport) &&
            areCategoriesCompatible(g.awayProf.category, hProf.category, m.sport)
          ) {
            bestGroup = g;
            bestSwapped = true;
            break;
          }
        }
      }
    }

    // Stage 2: Inverted token/prefix candidate lookup
    if (!bestGroup) {
      const candidates = new Set<InternalGroup>();
      const allKeys = [...hProf.indexKeys, ...aProf.indexKeys];
      for (const tk of allKeys) {
        const list = tokenIndex.get(`${m.sport}:${tk}`);
        if (list) {
          for (const g of list) {
            if (Math.abs(g.startMs - startMs) <= TIME_WINDOW_MS) {
              candidates.add(g);
            }
          }
        }
      }

      let bestScore = 0;
      for (const g of candidates) {
        const sh = profileSimilarity(g.homeProf, hProf, m.sport);
        const sa = profileSimilarity(g.awayProf, aProf, m.sport);
        const simDirect = (sh + sa) / 2;
        const minDirect = Math.min(sh, sa);

        if (simDirect >= 0.78 && minDirect >= 0.65 && simDirect > bestScore) {
          bestScore = simDirect;
          bestGroup = g;
          bestSwapped = false;
        }

        const shSw = profileSimilarity(g.homeProf, aProf, m.sport);
        const saSw = profileSimilarity(g.awayProf, hProf, m.sport);
        const simSwap = (shSw + saSw) / 2;
        const minSwap = Math.min(shSw, saSw);

        if (simSwap >= 0.82 && minSwap >= 0.7 && simSwap > bestScore) {
          bestScore = simSwap;
          bestGroup = g;
          bestSwapped = true;
        }
      }
    }

    if (!bestGroup) {
      const dayStr = new Date(startMs).toISOString().slice(0, 10);
      const eventKey = `${m.sport}:${dayStr}:${hProf.norm}__${aProf.norm}`;
      bestGroup = {
        eventKey,
        sport: m.sport,
        league: m.league,
        eventName: `${m.homeTeam} - ${m.awayTeam}`,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        startTime: m.startTime,
        startMs,
        homeProf: hProf,
        awayProf: aProf,
        marketsByType: new Map(),
      };
      groups.push(bestGroup);

      const dList = exactIndex.get(directKey) ?? [];
      dList.push(bestGroup);
      exactIndex.set(directKey, dList);

      const seenIdx = new Set<string>();
      for (const tk of [...hProf.indexKeys, ...aProf.indexKeys]) {
        const fullKey = `${m.sport}:${tk}`;
        if (seenIdx.has(fullKey)) continue;
        seenIdx.add(fullKey);
        const tList = tokenIndex.get(fullKey) ?? [];
        tList.push(bestGroup);
        tokenIndex.set(fullKey, tList);
      }
    }

    if (
      m.league &&
      (!bestGroup.league ||
        /^(calcio|football|soccer|tennis|basket|basketball)$/i.test(bestGroup.league.trim())) &&
      !/^(calcio|football|soccer|tennis|basket|basketball)$/i.test(m.league.trim())
    ) {
      bestGroup.league = m.league;
    }

    const alignedSelections = bestSwapped ? swapHomeAway(m.selections) : m.selections;
    const list = bestGroup.marketsByType.get(m.marketType) ?? [];
    const existingIdx = list.findIndex(
      (x) => x.market.sourceId === m.sourceId && x.market.sourceName === m.sourceName
    );
    if (existingIdx < 0) {
      list.push({ market: m, swapped: bestSwapped, selections: alignedSelections });
      bestGroup.marketsByType.set(m.marketType, list);
    } else if (m.scrapedAt > list[existingIdx].market.scrapedAt) {
      list[existingIdx] = { market: m, swapped: bestSwapped, selections: alignedSelections };
    }
  }

  return groups;
}

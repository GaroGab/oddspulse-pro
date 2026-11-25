import { formatFriendlyNetworkError } from './networkHealth';
import {
  SOURCE_CATALOG,
  type ScrapeSnapshot,
  type SourceId,
  type SourceKind,
  type SourceStatus,
} from './types';

export type SourceDisabledReasonKind = 'error' | 'scraper_disabled';

export interface SourceOption {
  id: string;
  name: string;
  disabled?: boolean;
  disabledKind?: SourceDisabledReasonKind;
  disabledReason?: string;
}

export const SCRAPER_DISABLED_BOOKMAKER_REASON =
  'Bookmaker deselezionato in Motore Scraping per la ricerca delle quote. Riattivalo dalla sezione Motore Scraping per poterlo selezionare nei filtri.';

export const SCRAPER_DISABLED_EXCHANGE_REASON =
  'Exchange deselezionato in Motore Scraping per la ricerca delle quote. Riattivalo dalla sezione Motore Scraping per poterlo selezionare nei filtri.';

export function formatSourceErrorReason(src: SourceStatus): string {
  const raw = src.lastError?.trim() || '';
  if (!raw) {
    return 'Errore nel recupero delle quote dal sito. Controlla Motore Scraping o riprova più tardi.';
  }
  const friendly = formatFriendlyNetworkError(raw);
  if (friendly.toLowerCase() === raw.toLowerCase() || friendly.includes(raw)) {
    return `Impossibile recuperare le quote: ${friendly}.`;
  }
  return `Impossibile recuperare le quote: ${friendly} (${raw}).`;
}

function optionDisabledSortRank(opt: SourceOption): number {
  if (!opt.disabled) return 0;
  return opt.disabledKind === 'scraper_disabled' ? 2 : 1;
}

function createSourceOptionResolver(
  kind: SourceKind,
  snapshotSources: SourceStatus[],
  enabledSources?: Partial<Record<SourceId, boolean>>
) {
  const catalogEntries = SOURCE_CATALOG.filter((x) => x.kind === kind);
  const catalogMap = new Map(catalogEntries.map((x) => [x.id as string, x]));
  const snapshotSourceMap = new Map(snapshotSources.map((s) => [s.id as string, s]));
  const scraperDisabledReason =
    kind === 'exchange' ? SCRAPER_DISABLED_EXCHANGE_REASON : SCRAPER_DISABLED_BOOKMAKER_REASON;

  const isSourceEnabledInScraper = (id: string, fallback = true): boolean => {
    if (enabledSources && Object.prototype.hasOwnProperty.call(enabledSources, id)) {
      const override = enabledSources[id as SourceId];
      if (typeof override === 'boolean') return override;
    }
    const snapSrc = snapshotSourceMap.get(id);
    if (snapSrc) return snapSrc.enabled;
    const catSrc = catalogMap.get(id);
    if (catSrc) return catSrc.enabled;
    return fallback;
  };

  const buildOption = (id: string, name: string, snapStatus?: SourceStatus): SourceOption => {
    const enabled = isSourceEnabledInScraper(id, snapStatus?.enabled ?? true);
    if (!enabled) {
      return {
        id,
        name,
        disabled: true,
        disabledKind: 'scraper_disabled',
        disabledReason: scraperDisabledReason,
      };
    }
    if (snapStatus && snapStatus.state === 'error') {
      return {
        id,
        name,
        disabled: true,
        disabledKind: 'error',
        disabledReason: formatSourceErrorReason(snapStatus),
      };
    }
    return { id, name };
  };

  return { catalogEntries, buildOption };
}

/**
 * Build bookmaker filter options combining live source status, scraper enabled flags
 * (marking deselected bookmakers or errored sites as disabled with an explanatory tooltip),
 * and any seen snapshot quotes.
 */
export function buildBookmakerSourceOptions(
  snapshot: Pick<ScrapeSnapshot, 'sources' | 'rows' | 'backMarketGroups' | 'dutcherRows'>,
  enabledSources?: Partial<Record<SourceId, boolean>>
): SourceOption[] {
  const { catalogEntries, buildOption } = createSourceOptionResolver(
    'bookmaker',
    snapshot.sources,
    enabledSources
  );

  const map = new Map<string, SourceOption>();
  for (const s of snapshot.sources) {
    if (s.kind !== 'bookmaker') continue;
    map.set(s.id, buildOption(s.id, s.name, s));
  }

  for (const r of snapshot.rows) {
    if (!map.has(r.bookmakerId)) {
      map.set(r.bookmakerId, buildOption(r.bookmakerId, r.bookmakerName));
    }
  }
  for (const g of snapshot.backMarketGroups ?? []) {
    for (const q of g.quotes) {
      if (!map.has(q.bookmakerId)) {
        map.set(q.bookmakerId, buildOption(q.bookmakerId, q.bookmakerName));
      }
    }
  }
  for (const dr of snapshot.dutcherRows ?? []) {
    for (const leg of dr.legs) {
      if (!map.has(leg.bookmakerId)) {
        map.set(leg.bookmakerId, buildOption(leg.bookmakerId, leg.bookmakerName));
      }
    }
  }

  if (map.size === 0) {
    for (const s of catalogEntries) {
      map.set(s.id, buildOption(s.id, s.name));
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => optionDisabledSortRank(a) - optionDisabledSortRank(b)
  );
}

/**
 * Build exchange filter options from snapshot sources and scraper enabled flags,
 * marking deselected exchanges or errored sites as disabled with an explanatory tooltip.
 */
export function buildExchangeSourceOptions(
  snapshot: Pick<ScrapeSnapshot, 'sources'>,
  enabledSources?: Partial<Record<SourceId, boolean>>
): SourceOption[] {
  const { catalogEntries, buildOption } = createSourceOptionResolver(
    'exchange',
    snapshot.sources,
    enabledSources
  );

  const exchangeSrcs = snapshot.sources.filter((x) => x.kind === 'exchange');
  const options =
    exchangeSrcs.length > 0
      ? exchangeSrcs.map((s) => buildOption(s.id, s.name, s))
      : catalogEntries.map((s) => buildOption(s.id, s.name));

  return options.sort((a, b) => optionDisabledSortRank(a) - optionDisabledSortRank(b));
}

import React from 'react';
import type { SourceId } from '../../shared/types';

import logo888Sport from '../assets/bookmakers/888sport_it.png';
import logoBet365 from '../assets/bookmakers/bet365_it.png';
import logoBetfairExchange from '../assets/bookmakers/betfair_exchange.png';
import logoBetfairSportsbook from '../assets/bookmakers/betfair_sportsbook.png';
import logoBetflagExchange from '../assets/bookmakers/betflag_exchange.png';
import logoBetflagIt from '../assets/bookmakers/betflag_it.png';
import logoBetsson from '../assets/bookmakers/betsson_it.png';
import logoDaznbet from '../assets/bookmakers/daznbet_it.png';
import logoDomusbet from '../assets/bookmakers/domusbet_it.png';
import logoEurobet from '../assets/bookmakers/eurobet_it.png';
import logoGiocodigitale from '../assets/bookmakers/giocodigitale_it.png';
import logoGoldbet from '../assets/bookmakers/goldbet_it.png';
import logoLeovegas from '../assets/bookmakers/leovegas_it.png';
import logoLottomatica from '../assets/bookmakers/lottomatica_it.png';
import logoNetbet from '../assets/bookmakers/netbet_it.png';
import logoPaf from '../assets/bookmakers/paf.png';
import logoPinnacle from '../assets/bookmakers/pinnacle.png';
import logoPlanetwin365 from '../assets/bookmakers/planetwin365_it.png';
import logoPokerstars from '../assets/bookmakers/pokerstars_it.png';
import logoSisal from '../assets/bookmakers/sisal_it.png';
import logoSmarkets from '../assets/bookmakers/smarkets_exchange.png';
import logoSnai from '../assets/bookmakers/snai_it.png';
import logoStanleybet from '../assets/bookmakers/stanleybet_it.png';
import logoTheOddsApi from '../assets/bookmakers/the_odds_api.png';
import logoUnibet from '../assets/bookmakers/unibet.png';
import logoWilliamhill from '../assets/bookmakers/williamhill_it.png';

const OFFICIAL_LOGOS: Record<SourceId, string> = {
  betfair_exchange: logoBetfairExchange,
  betfair_sportsbook: logoBetfairSportsbook,
  smarkets_exchange: logoSmarkets,
  betflag_exchange: logoBetflagExchange,
  betflag_it: logoBetflagIt,
  sisal_it: logoSisal,
  snai_it: logoSnai,
  eurobet_it: logoEurobet,
  goldbet_it: logoGoldbet,
  lottomatica_it: logoLottomatica,
  planetwin365_it: logoPlanetwin365,
  bet365_it: logoBet365,
  betsson_it: logoBetsson,
  domusbet_it: logoDomusbet,
  daznbet_it: logoDaznbet,
  williamhill_it: logoWilliamhill,
  giocodigitale_it: logoGiocodigitale,
  pokerstars_it: logoPokerstars,
  netbet_it: logoNetbet,
  stanleybet_it: logoStanleybet,
  '888sport_it': logo888Sport,
  leovegas_it: logoLeovegas,
  unibet: logoUnibet,
  paf: logoPaf,
  pinnacle: logoPinnacle,
  the_odds_api: logoTheOddsApi,
};

interface BookmakerIconProps {
  sourceId: SourceId | string;
  size?: number;
  className?: string;
}

/**
 * Official locally-bundled brand logos for all Italian ADM & EU bookmakers and exchanges.
 * Zero external network fetches at runtime — 100% offline-safe and CSP-compliant.
 */
export const BookmakerIcon: React.FC<BookmakerIconProps> = ({
  sourceId,
  size = 16,
  className = '',
}) => {
  const s = size;
  const logoSrc = OFFICIAL_LOGOS[sourceId as SourceId];

  if (logoSrc) {
    return (
      <img
        src={logoSrc}
        width={s}
        height={s}
        alt=""
        aria-hidden="true"
        draggable={false}
        decoding="async"
        style={{ width: s, height: s }}
        className={`inline-block shrink-0 select-none rounded-[4px] object-cover shadow-sm ring-1 ring-white/10 ${className}`}
      />
    );
  }

  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      className={`inline-block shrink-0 rounded-[4px] shadow-sm ${className}`}
      aria-hidden="true"
    >
      <rect width="24" height="24" rx="5" fill="#334155" />
      <circle cx="12" cy="12" r="5" fill="#94A3B8" />
    </svg>
  );
};

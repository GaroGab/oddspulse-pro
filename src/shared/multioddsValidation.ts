import type { OddsmatcherRow } from './types';

export type ManualMultipleValidationReason =
  | 'ok'
  | 'already_selected'
  | 'max_legs'
  | 'different_bookmaker'
  | 'same_event'
  | 'event_started'
  | 'invalid_odds'
  | 'time_gap'
  | 'no_liquidity';

export interface ManualMultipleValidation {
  eligible: boolean;
  reason: ManualMultipleValidationReason;
  shortLabel: string | null;
  detail: string | null;
  conflictStepIndex?: number; // 1-based chronological step index of conflicting leg
  gapMinutes?: number;
}

export interface ValidateCandidateOptions {
  minGapMinutes?: number;
  maxLegs?: number;
  nowMs?: number;
}

function formatShortGap(mins: number): string {
  const safe = Math.max(0, Math.round(mins));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Sorts selected multiple legs in strict chronological order (oldest startTime first).
 */
export function sortMultipleLegs(legs: OddsmatcherRow[]): OddsmatcherRow[] {
  return [...legs].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

/**
 * Validates whether a live event row can be added to a sequential Matched Betting multiple:
 * - Requires startTime at least `minGapMinutes` (default 120 = 2 hours) away from EVERY selected leg
 * - Enforces same bookmaker across all selections
 * - Rejects duplicate matches (same `eventKey`), already started events, invalid odds, or €0 liquidity
 */
export function validateManualMultipleCandidate(
  candidate: OddsmatcherRow,
  selectedLegs: OddsmatcherRow[],
  options: ValidateCandidateOptions = {}
): ManualMultipleValidation {
  const { minGapMinutes = 120, maxLegs = 8, nowMs = Date.now() } = options;
  const sorted = sortMultipleLegs(selectedLegs);

  if (sorted.some((l) => l.id === candidate.id)) {
    const idx = sorted.findIndex((l) => l.id === candidate.id) + 1;
    return {
      eligible: false,
      reason: 'already_selected',
      shortLabel: `Step ${idx}`,
      detail: `Questo esito è già inserito nella tua multipla allo Step ${idx}.`,
      conflictStepIndex: idx,
    };
  }

  if (sorted.length >= maxLegs) {
    return {
      eligible: false,
      reason: 'max_legs',
      shortLabel: `Max ${maxLegs} eventi`,
      detail: `Raggiunto il limite massimo di ${maxLegs} eventi in multipla.`,
    };
  }

  const candTs = new Date(candidate.startTime).getTime();
  if (!Number.isFinite(candTs) || candTs <= nowMs) {
    return {
      eligible: false,
      reason: 'event_started',
      shortLabel: 'Già iniziato',
      detail: "L'evento è già iniziato o l'orario di inizio non è valido per la bancata sequenziale.",
    };
  }

  if (
    candidate.backOdds <= 1.01 ||
    candidate.layOdds <= 1.01 ||
    candidate.layOdds <= candidate.commission
  ) {
    return {
      eligible: false,
      reason: 'invalid_odds',
      shortLabel: 'Quote non valide',
      detail: 'Quota Punta, Quota Banca o commissione non valide per la copertura.',
    };
  }

  if (candidate.liquidity <= 0) {
    return {
      eligible: false,
      reason: 'no_liquidity',
      shortLabel: 'Liquidità €0',
      detail: "Nessuna liquidità disponibile sull'Exchange per bancare questo esito.",
    };
  }

  if (sorted.length > 0 && candidate.bookmakerId !== sorted[0].bookmakerId) {
    return {
      eligible: false,
      reason: 'different_bookmaker',
      shortLabel: 'Book diverso',
      detail: `La multipla richiede lo stesso bookmaker (${sorted[0].bookmakerName}).`,
    };
  }

  const dupIdx = sorted.findIndex((l) => l.eventKey === candidate.eventKey);
  if (dupIdx !== -1) {
    return {
      eligible: false,
      reason: 'same_event',
      shortLabel: 'Stesso evento',
      detail: `Evento già presente allo Step ${dupIdx + 1}: non puoi inserire due esiti dello stesso match.`,
      conflictStepIndex: dupIdx + 1,
    };
  }

  if (minGapMinutes > 0 && sorted.length > 0) {
    const requiredMs = minGapMinutes * 60_000;
    let worstIdx = -1;
    let smallestDiffMs = Infinity;

    for (let i = 0; i < sorted.length; i++) {
      const legTs = new Date(sorted[i].startTime).getTime();
      const diffMs = Math.abs(candTs - legTs);
      if (diffMs < requiredMs && diffMs < smallestDiffMs) {
        smallestDiffMs = diffMs;
        worstIdx = i;
      }
    }

    if (worstIdx !== -1) {
      const gapMin = Math.round(smallestDiffMs / 60_000);
      const reqStr = formatShortGap(minGapMinutes);
      const gapStr = formatShortGap(gapMin);
      return {
        eligible: false,
        reason: 'time_gap',
        shortLabel: gapMin === 0 ? 'Stesso orario' : `Gap < ${reqStr} (${gapStr})`,
        detail: `Distanza ${gapStr} da Step ${worstIdx + 1} (${sorted[worstIdx].eventName}): servono almeno ${reqStr} tra eventi consecutivi.`,
        conflictStepIndex: worstIdx + 1,
        gapMinutes: gapMin,
      };
    }
  }

  return {
    eligible: true,
    reason: 'ok',
    shortLabel: null,
    detail: null,
  };
}

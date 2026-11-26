import { describe, expect, it } from 'vitest';
import { SOURCE_CATALOG, type SourceId } from './types';
import {
  EXCLUDED_WELCOME_SITES,
  WELCOME_BONUSES_LAST_UPDATED,
  WELCOME_BONUS_GUIDES,
} from './welcomeBonuses';
import {
  DEFAULT_SIMULATION_SCENARIOS,
  simulateThreeScenarios,
  simulateWelcomeBonus,
} from './welcomeBonusSimulator';

describe('Bonus Benvenuto — Copertura catalogo e simulatore', () => {
  it('copre il 100% dei siti giocabili in SOURCE_CATALOG (guide + esclusi)', () => {
    const playableSources = SOURCE_CATALOG.filter((s) => s.id !== 'the_odds_api').map((s) => s.id);
    const covered = new Set<SourceId>();

    for (const g of WELCOME_BONUS_GUIDES) {
      covered.add(g.sourceId);
      for (const rel of g.relatedSourceIds ?? []) {
        covered.add(rel);
      }
    }
    for (const ex of EXCLUDED_WELCOME_SITES) {
      covered.add(ex.sourceId);
    }

    const missing = playableSources.filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
  });

  it('ha data di aggiornamento valida e ID univoci per guide e step', () => {
    expect(WELCOME_BONUSES_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const guideIds = new Set<string>();
    for (const g of WELCOME_BONUS_GUIDES) {
      expect(guideIds.has(g.id)).toBe(false);
      guideIds.add(g.id);
      expect(g.steps.length).toBeGreaterThanOrEqual(3);

      const stepIds = new Set<string>();
      for (const s of g.steps) {
        expect(stepIds.has(s.id)).toBe(false);
        stepIds.add(s.id);
        expect(s.exactAction.trim().length).toBeGreaterThan(5);
      }

      if (g.category === 'casino_fallback') {
        expect(g.categoryReason && g.categoryReason.trim().length).toBeGreaterThan(30);
      }
    }
  });

  it('garantisce profitto atteso realistico strettamente positivo per tutte le guide selezionate', () => {
    for (const g of WELCOME_BONUS_GUIDES) {
      const sims = simulateThreeScenarios(g.simulationModel);
      expect(sims.realistic.netProfit, `${g.bookmakerName} realistico > 0`).toBeGreaterThan(0);
      expect(sims.optimal.netProfit, `${g.bookmakerName} ottimale >= realistico`).toBeGreaterThanOrEqual(
        sims.realistic.netProfit - 0.05
      );
      // Coerenza somma breakdown con netProfit
      const breakdownSum = sims.realistic.breakdown.reduce((acc, b) => acc + b.delta, 0);
      expect(Math.abs(breakdownSum - sims.realistic.netProfit)).toBeLessThan(0.15);
    }
  });

  it('produce risultati deterministici anche sulle simulazioni Monte Carlo casinò', () => {
    const betflag = WELCOME_BONUS_GUIDES.find((g) => g.sourceId === 'betflag_it')!;
    const run1 = simulateWelcomeBonus(betflag.simulationModel, DEFAULT_SIMULATION_SCENARIOS.realistic);
    const run2 = simulateWelcomeBonus(betflag.simulationModel, DEFAULT_SIMULATION_SCENARIOS.realistic);
    expect(run1.netProfit).toBe(run2.netProfit);
    expect(run1.roiPct).toBeNull(); // deposito 0€ -> rischio zero
    expect(run1.netProfit).toBeGreaterThan(100);
  });

  it('scala proporzionalmente il profitto e il bankroll per i bonus scalabili (es. bet365)', () => {
    const b365 = WELCOME_BONUS_GUIDES.find((g) => g.sourceId === 'bet365_it')!;
    const full = simulateWelcomeBonus(b365.simulationModel, DEFAULT_SIMULATION_SCENARIOS.realistic, {
      deposit: 500,
    });
    const small = simulateWelcomeBonus(b365.simulationModel, DEFAULT_SIMULATION_SCENARIOS.realistic, {
      deposit: 100,
    });
    expect(full.netProfit).toBeCloseTo(small.netProfit * 5, 0);
    expect(full.estimatedBankroll).toBeCloseTo(small.estimatedBankroll * 5, 0);
    expect(full.hasBustOutUpside).toBe(true);
    expect(full.worstCaseProfit).toBeGreaterThan(250);
    expect(full.netProfit).toBeGreaterThan(full.worstCaseProfit);
  });

  it('rileva correttamente la soglia critica di break-even su Betsson (6x multiple 3 eventi)', () => {
    const betsson = WELCOME_BONUS_GUIDES.find((g) => g.sourceId === 'betsson_it')!;
    const simGood = simulateWelcomeBonus(
      betsson.simulationModel,
      DEFAULT_SIMULATION_SCENARIOS.realistic,
      { deposit: 500, multiLegRatingPct: 96.5 }
    );
    const simBad = simulateWelcomeBonus(
      betsson.simulationModel,
      DEFAULT_SIMULATION_SCENARIOS.realistic,
      { deposit: 500, multiLegRatingPct: 94.0 }
    );
    expect(simGood.netProfit).toBeGreaterThan(100);
    expect(simBad.netProfit).toBeLessThan(0);
    expect(simGood.breakEvenLegRatingPct).not.toBeNull();
    expect(simGood.breakEvenLegRatingPct!).toBeGreaterThan(94.5);
    expect(simGood.breakEvenLegRatingPct!).toBeLessThan(96.0);
  });

  it('mantiene coerente il profitto SNAI tra catalogo e dettaglio con rollover variabile', () => {
    const snai = WELCOME_BONUS_GUIDES.find((g) => g.sourceId === 'snai_it')!;
    const catalogSim = simulateThreeScenarios(snai.simulationModel);
    const detailSimDefault = simulateThreeScenarios(snai.simulationModel, {
      deposit: snai.simulationModel.defaultDeposit,
      rolloverMultiplier: snai.simulationModel.variableRollover?.defaultValue,
    });
    expect(detailSimDefault.realistic.netProfit).toBe(catalogSim.realistic.netProfit);
    expect(detailSimDefault.conservative.netProfit).toBe(catalogSim.conservative.netProfit);
    expect(detailSimDefault.optimal.netProfit).toBe(catalogSim.optimal.netProfit);
  });
});

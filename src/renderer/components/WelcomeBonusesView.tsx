import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  BookOpen,
  Calculator,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  Dices,
  ExternalLink,
  FileWarning,
  Gift,
  Info,
  Layers,
  Maximize2,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Trophy,
  Wallet,
  X,
} from 'lucide-react';
import {
  SOURCE_CATALOG,
  type BetMode,
  type SourceId,
  type WelcomeBonusProgressEntry,
  type WelcomeBonusProgressMap,
  type WelcomeBonusProgressStatus,
} from '../../shared/types';
import {
  EXCLUDED_WELCOME_SITES,
  WELCOME_BONUSES_LAST_UPDATED,
  WELCOME_BONUS_GUIDES,
  type WelcomeBonusCategory,
  type WelcomeBonusDifficulty,
  type WelcomeBonusGuide,
  type WelcomeBonusStepPhase,
  type WelcomeBonusTier,
} from '../../shared/welcomeBonuses';
import {
  DEFAULT_SIMULATION_SCENARIOS,
  simulateThreeScenarios,
  simulateWelcomeBonus,
} from '../../shared/welcomeBonusSimulator';
import { formatEuro } from '../utils/format';
import { playCopyTick } from '../utils/sound';
import { AnimatedNumber } from './AnimatedNumber';
import { BookmakerIcon } from './BookmakerIcon';
import { CustomSelect } from './CustomSelect';
import { NumericInput } from './NumericInput';
import { SlidingPillTrack } from './SlidingPillTrack';

interface WelcomeBonusesViewProps {
  progressMap: WelcomeBonusProgressMap;
  soundEnabled: boolean;
  defaultExchangeCommission: number;
  onSaveProgress: (entry: WelcomeBonusProgressEntry) => void;
  onOpenTool: (
    target: 'oddsmatcher' | 'multiodds' | 'calculator',
    opts?: { mode?: BetMode }
  ) => void;
  onNotify?: (title: string, body: string) => void;
}

type CategoryFilter = 'all' | 'sport_exchange' | 'casino_fallback' | 'pending';
type SortKey = 'profit_desc' | 'roi_desc' | 'difficulty_asc' | 'deposit_asc';
type DetailTab = 'guide' | 'simulator' | 'terms';

const DIFFICULTY_RANK: Record<WelcomeBonusDifficulty, number> = {
  principiante: 1,
  intermedio: 2,
  avanzato: 3,
};

const DIFFICULTY_META: Record<
  WelcomeBonusDifficulty,
  { label: string; badgeClass: string }
> = {
  principiante: {
    label: 'Principiante',
    badgeClass: 'border-emerald-400/35 bg-emerald-500/15 text-emerald-300',
  },
  intermedio: {
    label: 'Intermedio',
    badgeClass: 'border-amber-400/35 bg-amber-500/15 text-amber-200',
  },
  avanzato: {
    label: 'Avanzato',
    badgeClass: 'border-rose-400/35 bg-rose-500/15 text-rose-200',
  },
};

const TIER_BADGE: Record<WelcomeBonusTier, string> = {
  S: 'border-brand-300/60 bg-brand-400/20 text-brand-200 shadow-[0_0_12px_-3px_rgb(var(--brand-400)/0.65)]',
  A: 'border-emerald-400/45 bg-emerald-500/15 text-emerald-300',
  B: 'border-sky-400/40 bg-sky-500/15 text-sky-300',
  C: 'border-slate-600/60 bg-slate-800/70 text-slate-300',
};

const PHASE_META: Record<WelcomeBonusStepPhase, { label: string; className: string }> = {
  setup: {
    label: 'Setup',
    className: 'border-slate-600/60 bg-slate-800/80 text-slate-300',
  },
  qualificante: {
    label: 'Qualificante',
    className: 'border-sky-400/40 bg-sky-500/15 text-sky-300',
  },
  sblocco: {
    label: 'Sblocco',
    className: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
  },
  conversione: {
    label: 'Conversione',
    className: 'border-brand-400/45 bg-brand-400/15 text-brand-200',
  },
  prelievo: {
    label: 'Prelievo',
    className: 'border-emerald-400/45 bg-emerald-500/15 text-emerald-300',
  },
};

const STATUS_META: Record<
  WelcomeBonusProgressStatus,
  { label: string; dotClass: string; pillClass: string }
> = {
  todo: {
    label: 'Da iniziare',
    dotClass: 'bg-slate-500',
    pillClass: 'border-slate-700/80 bg-slate-900/80 text-slate-300',
  },
  in_progress: {
    label: 'In corso',
    dotClass: 'bg-amber-400',
    pillClass: 'border-amber-400/45 bg-amber-500/15 text-amber-200',
  },
  completed: {
    label: 'Completato',
    dotClass: 'bg-emerald-400',
    pillClass: 'border-emerald-400/45 bg-emerald-500/15 text-emerald-300',
  },
};

const SOURCE_COLOR_MAP: Partial<Record<SourceId, string>> = Object.fromEntries(
  SOURCE_CATALOG.map((src) => [src.id, src.color])
);

function categoryBadge(cat: WelcomeBonusCategory): {
  label: string;
  className: string;
} {
  if (cat === 'exchange') {
    return {
      label: 'EXCHANGE',
      className: 'border-sky-400/40 bg-sky-500/15 text-sky-300',
    };
  }
  if (cat === 'casino_fallback') {
    return {
      label: 'CASINÒ +EV',
      className: 'border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-300',
    };
  }
  return {
    label: 'SPORT',
    className: 'border-brand-400/40 bg-brand-400/15 text-brand-200',
  };
}

function openExternalSafe(url: string): void {
  if (window.oddspulse?.openExternal) {
    void window.oddspulse.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export const WelcomeBonusesView: React.FC<WelcomeBonusesViewProps> = ({
  progressMap,
  soundEnabled,
  defaultExchangeCommission,
  onSaveProgress,
  onOpenTool,
  onNotify,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | WelcomeBonusDifficulty>('all');
  const [sortKey, setSortKey] = useState<SortKey>('profit_desc');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [openedGuideId, setOpenedGuideId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('guide');
  const [showExcludedModal, setShowExcludedModal] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const detailScrollRef = useRef<HTMLDivElement | null>(null);

  // Stato del simulatore interattivo (si resetta quando si apre una nuova offerta)
  const [simDeposit, setSimDeposit] = useState<number>(500);
  const [simSingleRating, setSimSingleRating] = useState<number>(96.5);
  const [simLegRating, setSimLegRating] = useState<number>(96.5);
  const [simCommission, setSimCommission] = useState<number>(
    Math.round(defaultExchangeCommission * 1000) / 10
  );
  const [simRollover, setSimRollover] = useState<number>(3);
  const [simCasinoScale, setSimCasinoScale] = useState<number>(1.0);

  // Precalcola i 3 scenari standard per tutte le guide (veloce + deterministico)
  const guideSimulations = useMemo(() => {
    const map = new Map<string, ReturnType<typeof simulateThreeScenarios>>();
    for (const guide of WELCOME_BONUS_GUIDES) {
      map.set(guide.id, simulateThreeScenarios(guide.simulationModel));
    }
    return map;
  }, []);

  const openedGuide: WelcomeBonusGuide | null = useMemo(() => {
    if (!openedGuideId) return null;
    return WELCOME_BONUS_GUIDES.find((g) => g.id === openedGuideId) ?? null;
  }, [openedGuideId]);

  // Sincronizza i parametri del simulatore quando si apre una guida in dettaglio
  useEffect(() => {
    if (!openedGuide) return;
    setSimDeposit(openedGuide.simulationModel.defaultDeposit);
    setSimSingleRating(DEFAULT_SIMULATION_SCENARIOS.realistic.singleRatingPct);
    setSimLegRating(DEFAULT_SIMULATION_SCENARIOS.realistic.multiLegRatingPct);
    setSimCommission(Math.round(defaultExchangeCommission * 1000) / 10);
    setSimRollover(openedGuide.simulationModel.variableRollover?.defaultValue ?? 3);
    setSimCasinoScale(1.0);
  }, [openedGuide, defaultExchangeCommission]);

  // Riporta lo scroll in alto al cambio offerta o tab nel dettaglio a schermo intero
  useEffect(() => {
    if (openedGuideId && detailScrollRef.current) {
      detailScrollRef.current.scrollTop = 0;
    }
  }, [openedGuideId, detailTab]);

  // Tasto ESC per chiudere la modale esclusi o tornare dalla scheda dettaglio ai banner
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showExcludedModal) {
        setShowExcludedModal(false);
        return;
      }
      if (!openedGuideId) return;
      const activeTag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
      setOpenedGuideId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openedGuideId, showExcludedModal]);

  // Statistiche globali per la barra superiore della prima pagina
  const globalStats = useMemo(() => {
    let totalConservative = 0;
    let totalRealistic = 0;
    let totalOptimal = 0;
    let sportCount = 0;
    let casinoCount = 0;
    let completedCount = 0;
    let remainingRealistic = 0;
    let realizedActualProfit = 0;

    for (const g of WELCOME_BONUS_GUIDES) {
      const sim = guideSimulations.get(g.id)!;
      totalConservative += sim.conservative.netProfit;
      totalRealistic += sim.realistic.netProfit;
      totalOptimal += sim.optimal.netProfit;

      if (g.category === 'casino_fallback') {
        casinoCount++;
      } else {
        sportCount++;
      }

      const prog = progressMap[g.id];
      if (prog?.status === 'completed') {
        completedCount++;
        realizedActualProfit +=
          prog.actualProfit !== null && Number.isFinite(prog.actualProfit)
            ? prog.actualProfit
            : sim.realistic.netProfit;
      } else {
        remainingRealistic += sim.realistic.netProfit;
      }
    }

    return {
      totalCount: WELCOME_BONUS_GUIDES.length,
      totalConservative,
      totalRealistic,
      totalOptimal,
      sportCount,
      casinoCount,
      completedCount,
      remainingRealistic,
      realizedActualProfit,
    };
  }, [guideSimulations, progressMap]);

  // Elenco banner filtrato e ordinato
  const filteredGuides = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return WELCOME_BONUS_GUIDES.filter((g) => {
      const prog = progressMap[g.id];
      if (categoryFilter === 'sport_exchange' && g.category === 'casino_fallback') return false;
      if (categoryFilter === 'casino_fallback' && g.category !== 'casino_fallback') return false;
      if (categoryFilter === 'pending' && prog?.status === 'completed') return false;
      if (difficultyFilter !== 'all' && g.difficulty !== difficultyFilter) return false;
      if (q) {
        const hay = [
          g.bookmakerName,
          g.headline,
          g.summary,
          g.promoCode ?? '',
          ...g.strategyTags,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const simA = guideSimulations.get(a.id)!.realistic;
      const simB = guideSimulations.get(b.id)!.realistic;
      if (sortKey === 'profit_desc') return simB.netProfit - simA.netProfit;
      if (sortKey === 'roi_desc') {
        const rA = simA.roiPct ?? 999999;
        const rB = simB.roiPct ?? 999999;
        return rB - rA;
      }
      if (sortKey === 'difficulty_asc') {
        const diffDelta = DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty];
        return diffDelta !== 0 ? diffDelta : simB.netProfit - simA.netProfit;
      }
      const depDelta = a.simulationModel.defaultDeposit - b.simulationModel.defaultDeposit;
      return depDelta !== 0 ? depDelta : simB.netProfit - simA.netProfit;
    });
  }, [categoryFilter, difficultyFilter, searchQuery, sortKey, progressMap, guideSimulations]);

  // Simulazioni del pannello dettaglio per la guida aperta
  const selectedThreeScenarios = useMemo(() => {
    if (!openedGuide) return null;
    return simulateThreeScenarios(openedGuide.simulationModel, {
      deposit: simDeposit,
      rolloverMultiplier: openedGuide.simulationModel.variableRollover ? simRollover : undefined,
    });
  }, [openedGuide, simDeposit, simRollover]);

  const customSimulation = useMemo(() => {
    if (!openedGuide) return null;
    return simulateWelcomeBonus(
      openedGuide.simulationModel,
      DEFAULT_SIMULATION_SCENARIOS.realistic,
      {
        deposit: simDeposit,
        singleRatingPct: simSingleRating,
        multiLegRatingPct: simLegRating,
        exchangeCommissionPct: simCommission,
        rolloverMultiplier: openedGuide.simulationModel.variableRollover ? simRollover : undefined,
        casinoVarianceScale: simCasinoScale,
      }
    );
  }, [
    openedGuide,
    simDeposit,
    simSingleRating,
    simLegRating,
    simCommission,
    simRollover,
    simCasinoScale,
  ]);

  const activeProgress: WelcomeBonusProgressEntry | null = useMemo(() => {
    if (!openedGuide) return null;
    const existing = progressMap[openedGuide.id];
    if (existing) return existing;
    return {
      guideId: openedGuide.id,
      status: 'todo',
      completedStepIds: [],
      actualProfit: null,
      updatedAt: 0,
    };
  }, [progressMap, openedGuide]);

  const handleOpenGuide = (guideId: string) => {
    setDetailTab('guide');
    setOpenedGuideId(guideId);
  };

  const handleCloseGuide = () => {
    setOpenedGuideId(null);
  };

  const handleToggleStep = (stepId: string) => {
    if (!openedGuide || !activeProgress) return;
    const exists = activeProgress.completedStepIds.includes(stepId);
    const nextSteps = exists
      ? activeProgress.completedStepIds.filter((id) => id !== stepId)
      : [...activeProgress.completedStepIds, stepId];

    let nextStatus: WelcomeBonusProgressStatus = activeProgress.status;
    if (nextSteps.length === openedGuide.steps.length) {
      nextStatus = 'completed';
    } else if (nextSteps.length > 0 && nextStatus === 'todo') {
      nextStatus = 'in_progress';
    } else if (nextSteps.length === 0 && nextStatus === 'in_progress') {
      nextStatus = 'todo';
    }

    onSaveProgress({
      ...activeProgress,
      guideId: openedGuide.id,
      status: nextStatus,
      completedStepIds: nextSteps,
      updatedAt: Date.now(),
    });
  };

  const handleSetStatus = (status: WelcomeBonusProgressStatus) => {
    if (!openedGuide || !activeProgress) return;
    const nextSteps =
      status === 'completed'
        ? openedGuide.steps.map((s) => s.id)
        : status === 'todo'
        ? []
        : activeProgress.completedStepIds;
    onSaveProgress({
      ...activeProgress,
      guideId: openedGuide.id,
      status,
      completedStepIds: nextSteps,
      updatedAt: Date.now(),
    });
  };

  const handleSetActualProfit = (val: number) => {
    if (!openedGuide || !activeProgress) return;
    onSaveProgress({
      ...activeProgress,
      guideId: openedGuide.id,
      actualProfit: val,
      updatedAt: Date.now(),
    });
  };

  const handleCopyPromoCode = (code: string) => {
    void navigator.clipboard?.writeText(code).catch(() => {});
    if (soundEnabled) playCopyTick();
    setCopiedCode(code);
    onNotify?.('Codice Promo Copiato', `Codice "${code}" copiato negli appunti.`);
    setTimeout(() => setCopiedCode((prev) => (prev === code ? null : prev)), 2000);
  };

  const handleResetSimulator = () => {
    if (!openedGuide) return;
    setSimDeposit(openedGuide.simulationModel.defaultDeposit);
    setSimSingleRating(DEFAULT_SIMULATION_SCENARIOS.realistic.singleRatingPct);
    setSimLegRating(DEFAULT_SIMULATION_SCENARIOS.realistic.multiLegRatingPct);
    setSimCommission(Math.round(defaultExchangeCommission * 1000) / 10);
    setSimRollover(openedGuide.simulationModel.variableRollover?.defaultValue ?? 3);
    setSimCasinoScale(1.0);
  };

  const progressPct =
    globalStats.totalCount > 0
      ? Math.round((globalStats.completedCount / globalStats.totalCount) * 100)
      : 0;

  // Navigazione rapida tra offerte in vista dettaglio a schermo intero
  const navList = useMemo(() => {
    if (!openedGuide) return filteredGuides;
    return filteredGuides.some((g) => g.id === openedGuide.id)
      ? filteredGuides
      : WELCOME_BONUS_GUIDES;
  }, [filteredGuides, openedGuide]);

  const currentNavIndex = openedGuide ? navList.findIndex((g) => g.id === openedGuide.id) : -1;
  const prevGuide = currentNavIndex > 0 ? navList[currentNavIndex - 1] : null;
  const nextGuide =
    currentNavIndex >= 0 && currentNavIndex < navList.length - 1
      ? navList[currentNavIndex + 1]
      : null;

  // =========================================================================
  // VISTA 2 — DETTAGLIO OFFERTA A SCHERMO INTERO NELLA PAGINA
  // =========================================================================
  if (openedGuide && selectedThreeScenarios && customSimulation && activeProgress) {
    const completedStepsCount = activeProgress.completedStepIds.length;
    const totalStepsCount = openedGuide.steps.length;
    const brandColor = SOURCE_COLOR_MAP[openedGuide.sourceId] ?? '#f59e0b';
    const cat = categoryBadge(openedGuide.category);
    const diff = DIFFICULTY_META[openedGuide.difficulty];

    return (
      <div
        key={`detail-${openedGuide.id}`}
        data-testid="bonus-fullscreen-detail"
        className="view-enter flex h-full min-h-0 flex-col overflow-hidden"
      >
        <div className="glass-panel relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
          {/* Accento colore brand superiore */}
          <div
            aria-hidden="true"
            style={{
              background: `linear-gradient(90deg, ${brandColor} 0%, ${brandColor}55 45%, transparent 100%)`,
            }}
            className="h-[2px] w-full shrink-0"
          />

          {/* Barra Navigazione + Azioni Rapide */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-950/75 px-5 py-2.5">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleCloseGuide}
                data-testid="back-to-bonuses"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 text-xs font-bold text-slate-200 transition-colors hover:border-brand-400/55 hover:bg-slate-800/90 hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-brand-300" />
                <span>Torna ai Bonus</span>
              </button>

              {navList.length > 1 && (
                <div className="inline-flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/75 p-0.5">
                  <button
                    type="button"
                    disabled={!prevGuide}
                    onClick={() => prevGuide && handleOpenGuide(prevGuide.id)}
                    title={prevGuide ? `Precedente: ${prevGuide.bookmakerName}` : 'Prima offerta'}
                    aria-label="Offerta precedente"
                    className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="px-1.5 font-mono text-[10px] font-semibold text-slate-400">
                    {currentNavIndex + 1}/{navList.length}
                  </span>
                  <button
                    type="button"
                    disabled={!nextGuide}
                    onClick={() => nextGuide && handleOpenGuide(nextGuide.id)}
                    title={nextGuide ? `Successiva: ${nextGuide.bookmakerName}` : 'Ultima offerta'}
                    aria-label="Offerta successiva"
                    className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Stato Avanzamento & Profitto Reale */}
              <div className="inline-flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
                {(['todo', 'in_progress', 'completed'] as WelcomeBonusProgressStatus[]).map(
                  (st) => {
                    const active = activeProgress.status === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        onClick={() => handleSetStatus(st)}
                        className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                          active
                            ? STATUS_META[st].pillClass + ' border'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {STATUS_META[st].label}
                      </button>
                    );
                  }
                )}
              </div>

              {activeProgress.status === 'completed' && (
                <div className="flex items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1">
                  <span className="text-[10px] font-semibold text-emerald-300">Reale (€):</span>
                  <NumericInput
                    value={
                      activeProgress.actualProfit ?? selectedThreeScenarios.realistic.netProfit
                    }
                    onChange={handleSetActualProfit}
                    min={0}
                    max={10000}
                    className="w-16 rounded border border-emerald-500/40 bg-slate-950/90 px-1.5 py-0.5 font-mono text-xs font-bold text-emerald-300 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={() => openExternalSafe(openedGuide.url)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-brand-400/45 bg-brand-400/15 px-3 py-1.5 text-xs font-bold text-brand-200 transition-colors hover:bg-brand-400/25 hover:text-white"
              >
                <span>Apri Sito</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Sticky Hero Header della Guida Aperta */}
          <div className="relative overflow-hidden border-b border-slate-800/80 bg-slate-950/55 px-6 py-4">
            <div
              aria-hidden="true"
              style={{
                background: `radial-gradient(circle at 0% 0%, ${brandColor}24 0%, transparent 55%)`,
              }}
              className="pointer-events-none absolute inset-0"
            />

            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-3.5">
                <BookmakerIcon
                  sourceId={openedGuide.sourceId}
                  size={48}
                  className="mt-0.5 shrink-0 rounded-xl"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-xl font-extrabold tracking-tight text-white">
                      {openedGuide.bookmakerName}
                    </h1>
                    <span
                      className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-extrabold ${TIER_BADGE[openedGuide.tier]}`}
                    >
                      TIER {openedGuide.tier}
                    </span>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${cat.className}`}
                    >
                      {cat.label}
                    </span>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${diff.badgeClass}`}
                    >
                      {diff.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-brand-200">{openedGuide.headline}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2.5 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-slate-500" />
                      {openedGuide.estimatedTimeLabel}
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1">
                      <Wallet className="h-3.5 w-3.5 text-slate-500" />
                      {openedGuide.simulationModel.defaultDeposit === 0
                        ? 'Deposito 0€ (Rischio Zero)'
                        : `Deposito consigliato: ${formatEuro(openedGuide.simulationModel.defaultDeposit)}`}
                    </span>
                    {openedGuide.promoCode && (
                      <>
                        <span>•</span>
                        <button
                          type="button"
                          onClick={() => handleCopyPromoCode(openedGuide.promoCode!)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-brand-400/45 bg-brand-400/15 px-2.5 py-0.5 font-mono text-[11px] font-bold text-brand-200 transition-colors hover:bg-brand-400/25"
                        >
                          <span>Codice: {openedGuide.promoCode}</span>
                          {copiedCode === openedGuide.promoCode ? (
                            <Check className="h-3 w-3 text-emerald-300" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Badge Profitto Atteso in Evidenza */}
              <div className="shrink-0 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-4 py-2.5 text-right">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">
                  Profitto Stimato
                </div>
                <div className="mt-0.5 whitespace-nowrap font-mono text-2xl font-extrabold leading-none text-emerald-400">
                  {formatEuro(selectedThreeScenarios.realistic.netProfit, true)}
                </div>
                <div className="mt-1 whitespace-nowrap font-mono text-[10px] text-slate-400">
                  Cons {formatEuro(selectedThreeScenarios.conservative.netProfit, true)} · Ott{' '}
                  {formatEuro(selectedThreeScenarios.optimal.netProfit, true)}
                </div>
              </div>
            </div>

            {/* Sub-Tabs */}
            <div className="relative mt-4 flex flex-wrap items-center justify-between gap-2">
              <SlidingPillTrack
                activeKey={detailTab}
                measureDep={completedStepsCount}
                pillClassName="rounded-lg border border-brand-400/45 bg-brand-400/20"
                className="inline-flex items-center gap-1 rounded-xl border border-slate-800/90 bg-slate-900/90 p-1"
              >
                <button
                  type="button"
                  data-pill-key="guide"
                  onClick={() => setDetailTab('guide')}
                  className={`relative z-10 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    detailTab === 'guide' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>
                    Guida Step-by-Step ({completedStepsCount}/{totalStepsCount})
                  </span>
                </button>
                <button
                  type="button"
                  data-pill-key="simulator"
                  onClick={() => setDetailTab('simulator')}
                  className={`relative z-10 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    detailTab === 'simulator'
                      ? 'text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Calculator className="h-3.5 w-3.5" />
                  <span>Simulatore Profitto</span>
                </button>
                <button
                  type="button"
                  data-pill-key="terms"
                  onClick={() => setDetailTab('terms')}
                  className={`relative z-10 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    detailTab === 'terms' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FileWarning className="h-3.5 w-3.5" />
                  <span>Termini &amp; Condizioni</span>
                </button>
              </SlidingPillTrack>

              <span className="rounded-md border border-slate-800 bg-slate-900/75 px-2.5 py-1 font-mono text-[10px] text-slate-400">
                Audit T&amp;C: {WELCOME_BONUSES_LAST_UPDATED}
              </span>
            </div>
          </div>

          {/* Body Scrollabile Full-Screen */}
          <div ref={detailScrollRef} className="flex-1 overflow-y-auto px-6 py-5">
            {/* ============================================================
                TAB 1: GUIDA STEP-BY-STEP
               ============================================================ */}
            {detailTab === 'guide' && (
              <div className="mx-auto max-w-6xl space-y-4 view-enter">
                {/* Banner Spiegazione Fallback Casinò */}
                {openedGuide.category === 'casino_fallback' && openedGuide.categoryReason && (
                  <div className="rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/10 p-4">
                    <div className="flex items-start gap-2.5">
                      <Dices className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-300" />
                      <div>
                        <div className="text-xs font-bold text-fuchsia-200">
                          Perché su {openedGuide.bookmakerName} è selezionato il Bonus Casinò +EV anziché lo Sport
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-300">
                          {openedGuide.categoryReason}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Riassunto Strategico + 3 Scenari di Profitto */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <div className="glass-card rounded-xl p-4 lg:col-span-6">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-300">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Strategia Consigliata</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-300">
                      {openedGuide.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {openedGuide.strategyTags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md border border-slate-700/80 bg-slate-900/80 px-2 py-0.5 text-[10px] font-semibold text-slate-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-400">
                      <span className="font-semibold text-slate-200">Registrazione: </span>
                      {openedGuide.registrationNote}
                    </div>
                  </div>

                  {/* 3 Scenari Simulati */}
                  <div className="glass-card flex flex-col justify-between rounded-xl p-4 lg:col-span-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Simulazione Profitto Netto (Dep.{' '}
                        {formatEuro(selectedThreeScenarios.realistic.depositUsed)})
                      </span>
                      <button
                        type="button"
                        onClick={() => setDetailTab('simulator')}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-300 hover:text-brand-200"
                      >
                        <span>Personalizza</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2.5">
                      {(
                        [
                          {
                            label: 'Conservativo',
                            sub: openedGuide.simulationModel.isPureCasino
                              ? 'Prudente'
                              : '94.5% / 95%',
                            res: selectedThreeScenarios.conservative,
                            tone:
                              selectedThreeScenarios.conservative.netProfit >= 0
                                ? 'text-slate-200'
                                : 'text-rose-400',
                            border: 'border-slate-800 bg-slate-950/70',
                          },
                          {
                            label: 'Realistico',
                            sub: openedGuide.simulationModel.isPureCasino
                              ? 'EV Monte Carlo'
                              : 'Rating 96.5%',
                            res: selectedThreeScenarios.realistic,
                            tone: 'text-emerald-400',
                            border: 'border-emerald-400/45 bg-emerald-500/10',
                          },
                          {
                            label: 'Ottimale',
                            sub: openedGuide.simulationModel.isPureCasino
                              ? 'Ottimizzato'
                              : 'Rating 98%',
                            res: selectedThreeScenarios.optimal,
                            tone: 'text-brand-300',
                            border: 'border-brand-400/35 bg-brand-400/10',
                          },
                        ] as const
                      ).map((sc) => (
                        <div
                          key={sc.label}
                          className={`rounded-xl border p-3 text-center ${sc.border}`}
                        >
                          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            {sc.label}
                          </div>
                          <div className={`mt-1 font-mono text-lg font-extrabold ${sc.tone}`}>
                            {formatEuro(sc.res.netProfit, true)}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-500">{sc.sub}</div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2.5 text-xs text-slate-400">
                      <span>
                        Bankroll Exchange:{' '}
                        <strong className="font-mono text-slate-200">
                          {selectedThreeScenarios.realistic.estimatedBankroll === 0
                            ? '0,00 € (Rischio Zero)'
                            : formatEuro(selectedThreeScenarios.realistic.estimatedBankroll)}
                        </strong>
                      </span>
                      <span>
                        ROI:{' '}
                        <strong className="font-mono text-emerald-300">
                          {selectedThreeScenarios.realistic.roiPct === null
                            ? '∞ (No Deposito)'
                            : `+${selectedThreeScenarios.realistic.roiPct.toFixed(1)}%`}
                        </strong>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Avviso Break-Even Rating se critico */}
                {selectedThreeScenarios.realistic.breakEvenLegRatingPct !== null &&
                  selectedThreeScenarios.realistic.breakEvenLegRatingPct >= 93.5 && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                      <div>
                        <span className="font-bold">Soglia Critica Rating: </span>
                        il punto di pareggio di questo bonus è{' '}
                        <span className="font-mono font-bold text-amber-200">
                          {selectedThreeScenarios.realistic.breakEvenLegRatingPct.toFixed(2)}%
                        </span>{' '}
                        per singola gamba. Piazza scommesse SOLO con rating superiore (ideale ≥
                        96.5%/gamba) utilizzando Multiodds / Oddsmatcher.
                      </div>
                    </div>
                  )}

                {/* Checklist Operativa Step-by-Step */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Procedura Operativa Step-by-Step
                    </h2>
                    <span className="font-mono text-xs text-slate-400">
                      {completedStepsCount} di {totalStepsCount} completati
                    </span>
                  </div>

                  {openedGuide.steps.map((step) => {
                    const checked = activeProgress.completedStepIds.includes(step.id);
                    const phase = PHASE_META[step.phase];
                    return (
                      <div
                        key={step.id}
                        className={`rounded-xl border p-4 transition-all ${
                          checked
                            ? 'border-emerald-500/35 bg-emerald-500/6'
                            : 'border-slate-800/90 bg-slate-950/65 hover:border-slate-700/90'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => handleToggleStep(step.id)}
                            aria-label={`Segna step ${step.stepNumber} come ${checked ? 'da fare' : 'completato'}`}
                            className="mt-0.5 shrink-0 text-slate-400 transition-transform hover:scale-110 hover:text-emerald-300"
                          >
                            {checked ? (
                              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                            ) : (
                              <Circle className="h-5 w-5 text-slate-600" />
                            )}
                          </button>

                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-[11px] font-bold text-brand-300">
                                  STEP {step.stepNumber}
                                </span>
                                <span
                                  className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${phase.className}`}
                                >
                                  {phase.label}
                                </span>
                                <h3
                                  className={`text-sm font-bold ${
                                    checked ? 'text-slate-400 line-through' : 'text-white'
                                  }`}
                                >
                                  {step.title}
                                </h3>
                              </div>

                              {step.toolAction && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (step.toolAction!.target === 'external') {
                                      openExternalSafe(step.toolAction!.url ?? openedGuide.url);
                                    } else {
                                      onOpenTool(step.toolAction!.target, {
                                        mode: step.toolAction!.presetMode,
                                      });
                                    }
                                  }}
                                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-brand-400/40 bg-brand-400/15 px-3 py-1 text-[11px] font-semibold text-brand-200 transition-colors hover:bg-brand-400/25 hover:text-white"
                                >
                                  {step.toolAction.target === 'external' ? (
                                    <ExternalLink className="h-3 w-3" />
                                  ) : step.toolAction.target === 'multiodds' ? (
                                    <Layers className="h-3 w-3" />
                                  ) : step.toolAction.target === 'calculator' ? (
                                    <Calculator className="h-3 w-3" />
                                  ) : (
                                    <SlidersHorizontal className="h-3 w-3" />
                                  )}
                                  <span>{step.toolAction.label}</span>
                                </button>
                              )}
                            </div>

                            {/* Azione Esatta */}
                            <div className="rounded-lg border border-brand-400/25 bg-brand-500/8 px-3.5 py-2 text-xs font-semibold text-slate-100">
                              {step.exactAction}
                            </div>

                            <p className="text-xs leading-relaxed text-slate-300">
                              {step.description}
                            </p>

                            {step.mathTip && (
                              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-[11px] text-emerald-200">
                                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                <span>{step.mathTip}</span>
                              </div>
                            )}

                            {step.warning && (
                              <div className="flex items-start gap-2 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                                <span>{step.warning}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ============================================================
                TAB 2: SIMULATORE PROFITTO INTERATTIVO
               ============================================================ */}
            {detailTab === 'simulator' && (
              <div className="mx-auto max-w-6xl space-y-4 view-enter">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  {/* Controlli Simulazione */}
                  <div className="glass-card space-y-4 rounded-xl p-5 lg:col-span-5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-brand-300">
                        Parametri Simulazione
                      </span>
                      <button
                        type="button"
                        onClick={handleResetSimulator}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:border-brand-400/50 hover:text-white"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Reset</span>
                      </button>
                    </div>

                    {/* Deposito Scalabile */}
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-300">Deposito Iniziale (€)</span>
                        <span className="font-mono text-xs font-bold text-brand-300">
                          {openedGuide.simulationModel.scalableDeposit
                            ? `Min ${openedGuide.simulationModel.minDeposit}€ – Max ${openedGuide.simulationModel.maxDeposit}€`
                            : 'Importo fisso promo'}
                        </span>
                      </div>
                      {openedGuide.simulationModel.scalableDeposit ? (
                        <div className="mt-2 flex items-center gap-3">
                          <input
                            type="range"
                            min={openedGuide.simulationModel.minDeposit}
                            max={openedGuide.simulationModel.maxDeposit}
                            step={5}
                            value={simDeposit}
                            onChange={(e) => setSimDeposit(Number(e.target.value))}
                            className="pulse-slider flex-1"
                          />
                          <NumericInput
                            value={simDeposit}
                            onChange={setSimDeposit}
                            min={openedGuide.simulationModel.minDeposit}
                            max={openedGuide.simulationModel.maxDeposit}
                            allowDecimal={false}
                            className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-right font-mono text-xs font-bold text-white focus:border-brand-400 focus:outline-none"
                          />
                        </div>
                      ) : (
                        <div className="mt-1.5 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-1.5 font-mono text-xs text-slate-300">
                          {formatEuro(openedGuide.simulationModel.defaultDeposit)}
                          {openedGuide.simulationModel.defaultDeposit === 0 &&
                            ' — Nessun deposito richiesto (rischio zero)'}
                        </div>
                      )}
                    </div>

                    {/* Rollover variabile */}
                    {openedGuide.simulationModel.variableRollover && (
                      <div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-300">
                            {openedGuide.simulationModel.variableRollover.label}
                          </span>
                          <span className="font-mono font-bold text-brand-300">{simRollover}x</span>
                        </div>
                        <input
                          type="range"
                          min={openedGuide.simulationModel.variableRollover.min}
                          max={openedGuide.simulationModel.variableRollover.max}
                          step={1}
                          value={simRollover}
                          onChange={(e) => setSimRollover(Number(e.target.value))}
                          className="pulse-slider mt-2 w-full"
                        />
                      </div>
                    )}

                    {/* Slider Rating Sport (se non è puro casinò) */}
                    {!openedGuide.simulationModel.isPureCasino ? (
                      <>
                        <div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-300">
                              Rating Medio Singole
                            </span>
                            <span className="font-mono font-bold text-emerald-300">
                              {simSingleRating.toFixed(1)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={90}
                            max={100}
                            step={0.5}
                            value={simSingleRating}
                            onChange={(e) => setSimSingleRating(Number(e.target.value))}
                            className="pulse-slider mt-2 w-full"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-300">
                              Rating Medio per Gamba (Multiple)
                            </span>
                            <span className="font-mono font-bold text-emerald-300">
                              {simLegRating.toFixed(1)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={90}
                            max={100}
                            step={0.5}
                            value={simLegRating}
                            onChange={(e) => setSimLegRating(Number(e.target.value))}
                            className="pulse-slider mt-2 w-full"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-300">
                              Commissione Exchange di Riferimento
                            </span>
                            <span className="font-mono font-bold text-slate-200">
                              {simCommission.toFixed(1)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={6}
                            step={0.5}
                            value={simCommission}
                            onChange={(e) => setSimCommission(Number(e.target.value))}
                            className="pulse-slider mt-2 w-full"
                          />
                        </div>
                      </>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-300">
                            Profilo Esecuzione Strategia Casinò 2-Fasi
                          </span>
                          <span className="font-mono font-bold text-fuchsia-300">
                            {simCasinoScale <= 0.85
                              ? 'Prudente'
                              : simCasinoScale >= 1.12
                              ? 'Ottimale'
                              : 'Standard'}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.7}
                          max={1.25}
                          step={0.05}
                          value={simCasinoScale}
                          onChange={(e) => setSimCasinoScale(Number(e.target.value))}
                          className="pulse-slider mt-2 w-full"
                        />
                        <p className="mt-1.5 text-[11px] text-slate-400">
                          Modella l’efficienza nel passaggio Fase 1 (alta volatilità) → Fase 2
                          (slot alto RTP) su simulazione Monte Carlo deterministica (2.500 prove).
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Risultati Simulazione Live */}
                  <div className="glass-card flex flex-col justify-between space-y-4 rounded-xl p-5 lg:col-span-7">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <div
                        className={`rounded-xl border p-3.5 ${
                          customSimulation.netProfit >= 0
                            ? 'border-emerald-400/45 bg-emerald-500/12'
                            : 'border-rose-500/50 bg-rose-500/12'
                        }`}
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Profitto Netto Atteso
                        </div>
                        <AnimatedNumber
                          value={customSimulation.netProfit}
                          formatter={(v) => formatEuro(v, true)}
                          className={`mt-1 block whitespace-nowrap font-mono text-xl font-extrabold ${
                            customSimulation.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        />
                        <div className="mt-0.5 text-[10px] text-slate-400">
                          {customSimulation.isProfitable
                            ? 'Operazione profittevole (+EV)'
                            : 'ATTENZIONE: in perdita con questi parametri!'}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          {customSimulation.hasBustOutUpside
                            ? 'Worst-Case (Rollover 100%)'
                            : 'Valore Estratto Lordo'}
                        </div>
                        <AnimatedNumber
                          value={
                            customSimulation.hasBustOutUpside
                              ? customSimulation.worstCaseProfit
                              : customSimulation.grossExtraction
                          }
                          formatter={(v) => formatEuro(v, true)}
                          className="mt-1 block whitespace-nowrap font-mono text-xl font-extrabold text-brand-300"
                        />
                        <div className="mt-0.5 text-[10px] text-slate-500">
                          {customSimulation.hasBustOutUpside
                            ? 'Senza svuotamento Bust-Out'
                            : `Costo qual.: -${formatEuro(customSimulation.qualifyingCost)}`}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          Bankroll &amp; ROI
                        </div>
                        <div className="mt-1 whitespace-nowrap font-mono text-xl font-extrabold text-white">
                          {customSimulation.estimatedBankroll === 0
                            ? '0,00 €'
                            : formatEuro(customSimulation.estimatedBankroll)}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-emerald-300">
                          ROI:{' '}
                          {customSimulation.roiPct === null
                            ? '∞ (Rischio 0€)'
                            : `${customSimulation.roiPct >= 0 ? '+' : ''}${customSimulation.roiPct.toFixed(1)}%`}
                        </div>
                      </div>
                    </div>

                    {/* Tabella Breakdown Euro per Euro */}
                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Dettaglio Calcolo Voce per Voce
                      </div>
                      <div className="space-y-1.5">
                        {customSimulation.breakdown.map((row, idx) => (
                          <div
                            key={`${row.label}_${idx}`}
                            className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/80 bg-slate-950/70 px-3.5 py-2"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold text-slate-100">
                                {row.label}
                              </div>
                              <div className="truncate text-[11px] text-slate-400">
                                {row.detail}
                              </div>
                            </div>
                            <span
                              className={`shrink-0 font-mono text-xs font-bold ${
                                row.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {formatEuro(row.delta, true)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Confronto Barre 4 Scenari */}
                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Confronto Scenari (Deposito {formatEuro(simDeposit)})
                      </div>
                      {(() => {
                        const bars = [
                          {
                            label: 'Conservativo',
                            val: selectedThreeScenarios.conservative.netProfit,
                            color: 'from-slate-500 to-slate-400',
                          },
                          {
                            label: 'Realistico',
                            val: selectedThreeScenarios.realistic.netProfit,
                            color: 'from-emerald-600 to-emerald-400',
                          },
                          {
                            label: 'Personalizzato',
                            val: customSimulation.netProfit,
                            color: 'from-brand-500 to-brand-300',
                          },
                          {
                            label: 'Ottimale',
                            val: selectedThreeScenarios.optimal.netProfit,
                            color: 'from-sky-500 to-cyan-300',
                          },
                        ];
                        const maxAbs = Math.max(10, ...bars.map((b) => Math.abs(b.val)));
                        return (
                          <div className="space-y-2">
                            {bars.map((bar) => (
                              <div key={bar.label} className="flex items-center gap-3 text-xs">
                                <span className="w-24 shrink-0 text-[11px] font-semibold text-slate-400">
                                  {bar.label}
                                </span>
                                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-900">
                                  <div
                                    style={{
                                      width: `${Math.max(3, Math.min(100, (Math.abs(bar.val) / maxAbs) * 100))}%`,
                                    }}
                                    className={`h-full rounded-full bg-gradient-to-r transition-all duration-300 ${
                                      bar.val < 0 ? 'from-rose-600 to-rose-400' : bar.color
                                    }`}
                                  />
                                </div>
                                <span
                                  className={`w-20 shrink-0 text-right font-mono text-xs font-bold ${
                                    bar.val >= 0 ? 'text-slate-100' : 'text-rose-400'
                                  }`}
                                >
                                  {formatEuro(bar.val, true)}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================
                TAB 3: TERMINI & CONDIZIONI APPROFONDITI
               ============================================================ */}
            {detailTab === 'terms' && (
              <div className="mx-auto max-w-6xl space-y-4 view-enter">
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
                  <div className="glass-card rounded-xl p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Struttura Bonus
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-100">
                      {openedGuide.termsSummary.bonusStructure}
                    </p>
                  </div>

                  <div className="glass-card rounded-xl p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Requisiti di Sblocco / Rollover
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-100">
                      {openedGuide.termsSummary.rolloverRule}
                    </p>
                  </div>

                  <div className="glass-card rounded-xl p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Quote Minime &amp; Tipologia Giocate
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-100">
                      {openedGuide.termsSummary.minOddsRule}
                    </p>
                  </div>

                  <div className="glass-card rounded-xl p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Scadenze &amp; Finestra Temporale
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-100">
                      {openedGuide.termsSummary.validityRule}
                    </p>
                  </div>

                  <div className="glass-card rounded-xl p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Cap di Conversione &amp; Limiti
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-100">
                      {openedGuide.termsSummary.conversionCap}
                    </p>
                  </div>

                  <div className="glass-card rounded-xl p-4">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Metodi di Pagamento Esclusi
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {openedGuide.termsSummary.excludedPayments.map((pm) => (
                        <span
                          key={pm}
                          className="rounded-md border border-rose-500/35 bg-rose-500/12 px-2 py-0.5 text-[11px] font-semibold text-rose-200"
                        >
                          {pm}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Trappole T&C Critiche */}
                <div className="rounded-xl border border-amber-400/35 bg-amber-500/8 p-4">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-200">
                    <AlertTriangle className="h-4 w-4 text-amber-300" />
                    <span>Trappole T&amp;C da Evitare</span>
                  </div>
                  <ul className="mt-2.5 space-y-2">
                    {openedGuide.termsSummary.criticalWarnings.map((w, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-xs leading-relaxed text-slate-200"
                      >
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-[11px] text-slate-400">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                  <span>
                    I termini promozionali ADM possono variare periodicamente (ultimo audit:{' '}
                    <strong className="text-slate-200">{WELCOME_BONUSES_LAST_UPDATED}</strong>).
                    Controlla sempre la nota informativa ufficiale su {openedGuide.bookmakerName}{' '}
                    immediatamente prima di effettuare il primo deposito.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VISTA 1 — PRIMA PAGINA: SOLO BANNER DEI BONUS SUI SITI
  // =========================================================================
  return (
    <div
      key="bonuses-banner-catalog"
      data-testid="bonuses-banner-catalog"
      className="view-enter flex h-full min-h-0 flex-col gap-3 overflow-hidden"
    >
      {/* Intestazione compatta + indicatori sintetici + Siti Esclusi */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-400/40 bg-brand-400/15 text-brand-300 shadow-[0_0_20px_-6px_rgb(var(--brand-400)/0.6)]">
            <Gift className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-extrabold tracking-tight text-white">
                Bonus Benvenuto
              </h1>
              <span className="rounded-md border border-brand-400/35 bg-brand-400/15 px-2 py-0.5 font-mono text-[10px] font-bold text-brand-200">
                {globalStats.totalCount} SITI
              </span>
              <span className="rounded-md border border-slate-700/80 bg-slate-900/80 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                Audit: {WELCOME_BONUSES_LAST_UPDATED}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Chip compatta Profitto Stimato */}
          <div
            title={`Conservativo: ${formatEuro(globalStats.totalConservative, true)} · Realistico: ${formatEuro(globalStats.totalRealistic, true)} · Ottimale: ${formatEuro(globalStats.totalOptimal, true)}`}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs"
          >
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span className="text-[11px] font-medium text-slate-300">Potenziale:</span>
            <AnimatedNumber
              value={globalStats.totalRealistic}
              formatter={(v) => formatEuro(v, true)}
              className="font-mono text-xs font-extrabold text-emerald-400"
            />
          </div>

          {/* Chip compatta Avanzamento */}
          <div
            title={
              globalStats.realizedActualProfit > 0
                ? `${formatEuro(globalStats.realizedActualProfit, true)} incassati`
                : `Restano ${formatEuro(globalStats.remainingRealistic, true)} stimati`
            }
            className="flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/80 px-2.5 py-1.5 text-xs"
          >
            <Trophy className="h-3.5 w-3.5 shrink-0 text-brand-300" />
            <span className="font-mono text-xs font-bold text-white">
              {globalStats.completedCount}
              <span className="text-slate-500">/{globalStats.totalCount}</span>
            </span>
            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-800">
              <div
                style={{ width: `${progressPct}%` }}
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-400 transition-all duration-300"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowExcludedModal(true)}
            data-testid="open-excluded-sites"
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:border-brand-400/45 hover:bg-slate-800/80 hover:text-white"
          >
            <Ban className="h-3.5 w-3.5 text-rose-400" />
            <span>Siti Esclusi ({EXCLUDED_WELCOME_SITES.length})</span>
          </button>
        </div>
      </div>

      {/* Toolbar Filtri + Ricerca */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2">
        <SlidingPillTrack
          activeKey={categoryFilter}
          measureDep={globalStats.completedCount}
          pillClassName="rounded-lg border border-brand-400/45 bg-brand-400/20 shadow-[0_0_16px_-6px_rgb(var(--brand-400)/0.7)]"
          className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-800/90 bg-slate-950/75 p-1"
        >
          {[
            { key: 'all', label: `Tutti (${globalStats.totalCount})` },
            { key: 'sport_exchange', label: `Sport & Exchange (${globalStats.sportCount})` },
            { key: 'casino_fallback', label: `Casinò +EV (${globalStats.casinoCount})` },
            {
              key: 'pending',
              label: `Da Completare (${globalStats.totalCount - globalStats.completedCount})`,
            },
          ].map((tab) => {
            const active = categoryFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                data-pill-key={tab.key}
                onClick={() => setCategoryFilter(tab.key as CategoryFilter)}
                className={`relative z-10 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </SlidingPillTrack>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cerca sito, codice, tag..."
              className="w-48 rounded-lg border border-slate-700/80 bg-slate-950/80 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-brand-400/60 focus:outline-none"
            />
          </div>

          <div className="w-36">
            <CustomSelect
              value={difficultyFilter}
              onChange={(v) => setDifficultyFilter(v as 'all' | WelcomeBonusDifficulty)}
              options={[
                { value: 'all', label: 'Difficoltà: Tutte' },
                { value: 'principiante', label: 'Principiante' },
                { value: 'intermedio', label: 'Intermedio' },
                { value: 'avanzato', label: 'Avanzato' },
              ]}
            />
          </div>

          <div className="w-40">
            <CustomSelect
              value={sortKey}
              onChange={(v) => setSortKey(v as SortKey)}
              options={[
                { value: 'profit_desc', label: 'Ordina: Profitto' },
                { value: 'roi_desc', label: 'Ordina: ROI %' },
                { value: 'difficulty_asc', label: 'Ordina: Più Facili' },
                { value: 'deposit_asc', label: 'Ordina: Deposito Min' },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Griglia Full-Width dei Banner Bonus dei Siti */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {filteredGuides.length === 0 ? (
          <div className="glass-panel flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 px-6 py-16 text-center">
            <Search className="h-8 w-8 text-slate-600" />
            <div className="mt-3 text-sm font-bold text-slate-200">
              Nessun bonus corrisponde ai filtri selezionati
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Modifica la ricerca o ripristina i filtri per visualizzare tutti i siti disponibili.
            </p>
            <button
              type="button"
              onClick={() => {
                setCategoryFilter('all');
                setDifficultyFilter('all');
                setSearchQuery('');
              }}
              className="mt-4 rounded-xl border border-brand-400/45 bg-brand-400/15 px-4 py-1.5 text-xs font-bold text-brand-200 transition-colors hover:bg-brand-400/25 hover:text-white"
            >
              Ripristina filtri
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 pb-2 lg:grid-cols-2 2xl:grid-cols-3">
            {filteredGuides.map((guide) => {
              const sim = guideSimulations.get(guide.id)!;
              const prog = progressMap[guide.id];
              const status: WelcomeBonusProgressStatus = prog?.status ?? 'todo';
              const cat = categoryBadge(guide.category);
              const diff = DIFFICULTY_META[guide.difficulty];
              const stepsDone = prog?.completedStepIds.length ?? 0;
              const stepPct =
                guide.steps.length > 0 ? Math.round((stepsDone / guide.steps.length) * 100) : 0;
              const brandColor = SOURCE_COLOR_MAP[guide.sourceId] ?? '#f59e0b';

              return (
                <article
                  key={guide.id}
                  data-testid={`bonus-card-${guide.sourceId}`}
                  className={`glass-card glass-card-hover relative flex flex-col justify-between overflow-hidden rounded-2xl border ${
                    status === 'completed'
                      ? 'border-emerald-500/35'
                      : status === 'in_progress'
                      ? 'border-amber-400/35'
                      : 'border-slate-800/90'
                  }`}
                >
                  {/* Barra superiore accento brand */}
                  <div
                    aria-hidden="true"
                    style={{
                      background: `linear-gradient(90deg, ${brandColor} 0%, ${brandColor}55 55%, transparent 100%)`,
                    }}
                    className="h-[3px] w-full shrink-0"
                  />

                  {/* Bagliore radiale leggero con tinta del sito */}
                  <div
                    aria-hidden="true"
                    style={{
                      background: `radial-gradient(circle at 0% 0%, ${brandColor}1f 0%, transparent 58%)`,
                    }}
                    className="pointer-events-none absolute inset-0"
                  />

                  <div className="relative flex flex-1 flex-col gap-3 p-4">
                    {/* Riga 1: Logo + Identità Sito + Profitto Atteso */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                        <BookmakerIcon
                          sourceId={guide.sourceId}
                          size={42}
                          className="shrink-0 rounded-xl"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <h2 className="truncate text-[15px] font-extrabold text-white">
                              {guide.bookmakerName}
                            </h2>
                            <span
                              className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-extrabold ${TIER_BADGE[guide.tier]}`}
                            >
                              TIER {guide.tier}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${cat.className}`}
                            >
                              {cat.label}
                            </span>
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${diff.badgeClass}`}
                            >
                              {diff.label}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-right">
                        <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-300/80">
                          Profitto
                        </div>
                        <div className="whitespace-nowrap font-mono text-lg font-extrabold leading-tight text-emerald-400">
                          {formatEuro(sim.realistic.netProfit, true)}
                        </div>
                        <div className="whitespace-nowrap font-mono text-[9px] text-slate-400">
                          {formatEuro(sim.conservative.netProfit, true)} /{' '}
                          {formatEuro(sim.optimal.netProfit, true)}
                        </div>
                      </div>
                    </div>

                    {/* Riga 2: Titolo Offerta Banner */}
                    <p className="line-clamp-2 min-h-[2.5rem] text-[13px] font-semibold leading-snug text-slate-100">
                      {guide.headline}
                    </p>

                    {/* Riga 3: Chip Informazioni Chiave */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/75 px-2 py-1 font-mono text-[10px] font-semibold text-slate-300">
                        <Wallet className="h-3 w-3 text-slate-500" />
                        {guide.simulationModel.defaultDeposit === 0
                          ? 'Dep. 0€ (Rischio Zero)'
                          : `Dep. ${guide.simulationModel.defaultDeposit}€`}
                      </span>

                      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/75 px-2 py-1 font-mono text-[10px] font-semibold text-emerald-300">
                        <TrendingUp className="h-3 w-3 text-emerald-400/80" />
                        {sim.realistic.roiPct === null
                          ? 'ROI ∞'
                          : `ROI +${sim.realistic.roiPct.toFixed(0)}%`}
                      </span>

                      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/75 px-2 py-1 text-[10px] text-slate-400">
                        <Clock className="h-3 w-3 text-slate-500" />
                        {guide.estimatedTimeLabel}
                      </span>

                      {guide.promoCode && (
                        <button
                          type="button"
                          onClick={() => handleCopyPromoCode(guide.promoCode!)}
                          title="Copia codice promozionale"
                          className="inline-flex items-center gap-1 rounded-lg border border-brand-400/40 bg-brand-400/12 px-2 py-1 font-mono text-[10px] font-bold text-brand-200 transition-colors hover:bg-brand-400/25"
                        >
                          <span>{guide.promoCode}</span>
                          {copiedCode === guide.promoCode ? (
                            <Check className="h-3 w-3 text-emerald-300" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Riga 4: Footer Stato + Button Apertura Offerta a Schermo Intero */}
                    <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${STATUS_META[status].dotClass}`}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-semibold text-slate-300">
                            {status === 'completed'
                              ? 'Completato'
                              : stepsDone > 0
                              ? `${stepsDone}/${guide.steps.length} step completati`
                              : STATUS_META[status].label}
                          </div>
                          {stepsDone > 0 && status !== 'completed' && (
                            <div className="mt-1 h-1 w-20 overflow-hidden rounded-full bg-slate-800">
                              <div
                                style={{ width: `${stepPct}%` }}
                                className="h-full rounded-full bg-amber-400 transition-all duration-300"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleOpenGuide(guide.id)}
                        data-testid={`open-bonus-detail-${guide.sourceId}`}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-brand-400/50 bg-gradient-to-r from-brand-500/25 to-brand-400/15 px-3.5 py-2 text-xs font-bold text-brand-100 shadow-[0_0_18px_-8px_rgb(var(--brand-400)/0.85)] transition-all hover:border-brand-300/80 hover:from-brand-500/35 hover:to-brand-400/25 hover:text-white active:scale-[0.98]"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                        <span>Dettagli Offerta</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Trasparenza: Siti Valutati ed Esclusi */}
      <AnimatePresence>
        {showExcludedModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setShowExcludedModal(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.16 }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-[var(--bg-modal-solid)] shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <Ban className="h-4 w-4 text-rose-400" />
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Siti Valutati ed Esclusi ({EXCLUDED_WELCOME_SITES.length})
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Tutti i siti dell’app sono stati analizzati (Sport + Casinò): questi sono stati scartati
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowExcludedModal(false)}
                  aria-label="Chiudi"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 space-y-2.5 overflow-y-auto p-5">
                {EXCLUDED_WELCOME_SITES.map((site) => (
                  <div
                    key={site.sourceId}
                    className="rounded-xl border border-slate-800 bg-slate-950/75 p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <BookmakerIcon sourceId={site.sourceId} size={24} className="shrink-0" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{site.siteName}</span>
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                              {site.region}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-rose-300">
                            {site.reasonShort}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 space-y-1 text-xs text-slate-300">
                      <div>
                        <span className="font-semibold text-slate-400">Analisi Sport: </span>
                        {site.sportAudit}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-400">Analisi Casinò: </span>
                        {site.casinoAudit}
                      </div>
                      {site.note && (
                        <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-sky-500/25 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-200">
                          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
                          <span>{site.note}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 p-3 text-[11px] text-slate-400">
                  <strong className="text-slate-200">Nota tecnica:</strong> `The Odds API` è un
                  aggregatore opzionale di quote via API e non un sito di scommesse. Gli operatori
                  con account unico (<em>Betfair Sportsbook + Exchange</em> e{' '}
                  <em>Betflag Sport + Exchange</em>) sono consolidati nelle rispettive guide
                  principali.
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

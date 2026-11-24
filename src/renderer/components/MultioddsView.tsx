import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookmarkCheck,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Layers,
  ListPlus,
  Lock,
  Percent,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { findBestMultiodds } from '../../shared/math';
import { buildSavedMultipleInputFromPlan } from '../../shared/savedMultiples';
import {
  SOURCE_CATALOG,
  type BetMode,
  type MultioddsPlan,
  type OddsmatcherRow,
  type SavedMultiplePlan,
  type SavedMultiplePlanInput,
  type ScrapeSnapshot,
  type TrackedBet,
} from '../../shared/types';
import { formatEuro, formatEventTime, formatGap, formatOdds, formatPct } from '../utils/format';
import { playCopyTick } from '../utils/sound';
import { AnimatedNumber } from './AnimatedNumber';
import { BookmakerIcon } from './BookmakerIcon';
import { ConnectionAlert } from './ConnectionAlert';
import { CustomSelect } from './CustomSelect';
import { ManualMultioddsBuilder } from './ManualMultioddsBuilder';
import { NumericInput } from './NumericInput';
import { SavedMultiplesView } from './SavedMultiplesView';
import { SlidingPillTrack } from './SlidingPillTrack';
import { SourceMultiSelect } from './SourceSelect';

interface MultioddsViewProps {
  snapshot: ScrapeSnapshot;
  isBrowserOnline: boolean;
  autoScrapeActive?: boolean;
  lockedRows: OddsmatcherRow[];
  savedMultiples?: SavedMultiplePlan[];
  soundEnabled: boolean;
  onUnlockRow: (rowId: string) => void;
  onClearLocks: () => void;
  onSaveTrackedBet: (bet: Omit<TrackedBet, 'id' | 'createdAt'>) => void;
  onSaveMultiplePlan?: (
    plan: SavedMultiplePlan | SavedMultiplePlanInput
  ) => Promise<SavedMultiplePlan | null> | SavedMultiplePlan | null | void;
  onDeleteSavedMultiple?: (id: string) => void;
  onRetryScrape: () => void;
  onRestartAutoScrape?: () => void;
  onOpenScrapers: () => void;
}

export const MultioddsView: React.FC<MultioddsViewProps> = ({
  snapshot,
  isBrowserOnline,
  autoScrapeActive = true,
  lockedRows,
  savedMultiples = [],
  soundEnabled,
  onUnlockRow,
  onClearLocks,
  onSaveTrackedBet,
  onSaveMultiplePlan,
  onDeleteSavedMultiple,
  onRetryScrape,
  onRestartAutoScrape,
  onOpenScrapers,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'manual' | 'saved' | 'auto'>('manual');
  const [focusSavedId, setFocusSavedId] = useState<string | null>(null);
  const [savedAutoIds, setSavedAutoIds] = useState<Set<string>>(new Set());
  const [legsCount, setLegsCount] = useState<number>(3);
  const [bookmakerIds, setBookmakerIds] = useState<string[]>([]);
  const [exchangeIds, setExchangeIds] = useState<string[]>([]);
  const [mode, setMode] = useState<BetMode>('normal');
  const [stake, setStake] = useState<number>(50);
  const [minLegOdds, setMinLegOdds] = useState<number>(1.25);
  const [maxLegOdds, setMaxLegOdds] = useState<number>(4.5);
  const [minCombinedOdds, setMinCombinedOdds] = useState<number>(2.5);
  const [maxCombinedOdds, setMaxCombinedOdds] = useState<number>(25);
  const [minLiquidity, setMinLiquidity] = useState<number>(10);
  const [minGapMinutes, setMinGapMinutes] = useState<number>(120);
  const [bonusBoostPct, setBonusBoostPct] = useState<number>(0);
  const [refundAmount, setRefundAmount] = useState<number>(25);
  const [refundRetention, setRefundRetention] = useState<number>(70);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [savedPlanIds, setSavedPlanIds] = useState<Set<string>>(new Set());

  const effectiveBookmakers = useMemo(
    () => (lockedRows.length > 0 ? [lockedRows[0].bookmakerId] : bookmakerIds),
    [lockedRows, bookmakerIds]
  );

  const bookmakerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of snapshot.rows) map.set(r.bookmakerId, r.bookmakerName);
    return Array.from(map.entries());
  }, [snapshot.rows]);

  const exchangeOptions = useMemo(
    () => SOURCE_CATALOG.filter((s) => s.kind === 'exchange'),
    []
  );

  const plans = useMemo(() => {
    if (snapshot.rows.length === 0) return [];
    return findBestMultiodds({
      rows: snapshot.rows,
      bookmakerIds: effectiveBookmakers,
      exchangeIds,
      legsCount: Math.max(legsCount, lockedRows.length),
      mode,
      stake,
      minLegOdds,
      maxLegOdds,
      minCombinedOdds,
      maxCombinedOdds,
      minLiquidity,
      minGapMinutes,
      bonusBoostPct,
      refundAmount,
      refundRetention,
      lockedRowIds: lockedRows.map((r) => r.id),
      maxResults: 35,
    });
  }, [
    snapshot.rows,
    effectiveBookmakers,
    exchangeIds,
    legsCount,
    lockedRows,
    mode,
    stake,
    minLegOdds,
    maxLegOdds,
    minCombinedOdds,
    maxCombinedOdds,
    minLiquidity,
    minGapMinutes,
    bonusBoostPct,
    refundAmount,
    refundRetention,
  ]);

  const copyLayStake = async (key: string, amount: number) => {
    try {
      await navigator.clipboard.writeText(amount.toFixed(2));
      setCopiedKey(key);
      if (soundEnabled) playCopyTick();
      setTimeout(() => setCopiedKey(null), 1400);
    } catch {
      // Ignore
    }
  };

  const handleSavePlan = (plan: MultioddsPlan) => {
    onSaveTrackedBet({
      eventName: plan.legs.map((l) => l.row.eventName).join(' + '),
      league: `Multipla ${plan.legs.length} Eventi`,
      sport: plan.legs[0].row.sport,
      marketLabel: `Sequenziale (Gap ${formatGap(plan.minGapMinutes)})`,
      selectionLabel: plan.legs.map((l) => l.row.selectionLabel).join(' / '),
      type: 'multipla',
      mode,
      bookmakerName: plan.bookmakerName,
      exchangeName: plan.exchangeName,
      stake,
      backOdds: plan.boostedBackOdds,
      layOdds: plan.effectiveCombinedLayOdds,
      layStake: plan.legs[0].layStake,
      liability: plan.maxCumulativeLiability,
      commission: plan.legs[0].commission,
      expectedProfit: plan.guaranteedProfit,
      rating: plan.rating,
      status: 'pending',
      realizedProfit: plan.guaranteedProfit,
      notes: `Multipla ${plan.legs.length} leg | Bonus +${bonusBoostPct}%`,
    });
    setSavedPlanIds((prev) => new Set(prev).add(plan.id));
    if (soundEnabled) playCopyTick();
  };

  const handleSaveAutoInteractivePlan = async (plan: MultioddsPlan) => {
    if (!onSaveMultiplePlan) return;
    const input = buildSavedMultipleInputFromPlan({
      plan,
      mode,
      stake,
      bonusBoostPct,
      refundAmount,
      refundRetention,
      minGapMinutes,
    });
    const created = await onSaveMultiplePlan(input);
    setSavedAutoIds((prev) => new Set(prev).add(plan.id));
    if (created && typeof created === 'object' && 'id' in created) {
      setFocusSavedId(created.id);
    }
    if (soundEnabled) playCopyTick();
  };

  const handleOpenSavedPlan = (planId?: string) => {
    if (planId) setFocusSavedId(planId);
    setActiveSubTab('saved');
  };

  const activeSavedCount = useMemo(
    () => savedMultiples.filter((p) => p.status !== 'completed').length,
    [savedMultiples]
  );

  const topPlan = plans[0];

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {/* Multiodds Subsection Switcher */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-brand-400 text-slate-950 shadow-glow-accent">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h1 className="font-display text-sm font-bold text-white">
              Multiodds Pro — Multiple & Bancata Sequenziale
            </h1>
            <p className="text-[10px] text-slate-400">
              Costruisci la tua multipla manualmente, salva e aggiorna progressivamente le quote o avvia la ricerca automatica.
            </p>
          </div>
        </div>

        <SlidingPillTrack
          activeKey={activeSubTab}
          measureDep={`${savedMultiples.length}_${activeSavedCount}_${plans.length}`}
          pillClassName="rounded-lg bg-gradient-to-r from-brand-300 to-accent-400 shadow-glow"
          className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/90 p-1"
        >
          <button
            type="button"
            data-pill-key="manual"
            data-testid="multiodds-subtab-manual"
            onClick={() => setActiveSubTab('manual')}
            className={`relative z-10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              activeSubTab === 'manual' ? 'text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            <ListPlus className="h-3.5 w-3.5" />
            Costruttore Manuale
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                activeSubTab === 'manual'
                  ? 'bg-slate-950/20 text-slate-950'
                  : 'bg-brand-400/15 text-brand-300'
              }`}
            >
              MANUALE
            </span>
          </button>

          <button
            type="button"
            data-pill-key="saved"
            data-testid="multiodds-subtab-saved"
            onClick={() => setActiveSubTab('saved')}
            className={`relative z-10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              activeSubTab === 'saved' ? 'text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            <BookmarkCheck className="h-3.5 w-3.5" />
            Multiple Salvate
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                activeSubTab === 'saved'
                  ? 'bg-slate-950/20 text-slate-950'
                  : activeSavedCount > 0
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {savedMultiples.length}
            </span>
          </button>

          <button
            type="button"
            data-pill-key="auto"
            data-testid="multiodds-subtab-auto"
            onClick={() => setActiveSubTab('auto')}
            className={`relative z-10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              activeSubTab === 'auto' ? 'text-slate-950' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Ottimizzatore Automatico
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                activeSubTab === 'auto'
                  ? 'bg-slate-950/20 text-slate-950'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {plans.length}
            </span>
          </button>
        </SlidingPillTrack>
      </div>

      {activeSubTab === 'manual' ? (
        <ManualMultioddsBuilder
          snapshot={snapshot}
          isBrowserOnline={isBrowserOnline}
          autoScrapeActive={autoScrapeActive}
          lockedRows={lockedRows}
          soundEnabled={soundEnabled}
          savedCount={savedMultiples.length}
          onSaveTrackedBet={onSaveTrackedBet}
          onSaveMultiplePlan={onSaveMultiplePlan}
          onOpenSavedList={handleOpenSavedPlan}
          onRetryScrape={onRetryScrape}
          onRestartAutoScrape={onRestartAutoScrape}
          onOpenScrapers={onOpenScrapers}
        />
      ) : activeSubTab === 'saved' ? (
        <SavedMultiplesView
          savedMultiples={savedMultiples}
          liveRows={snapshot.rows}
          soundEnabled={soundEnabled}
          initialSelectedId={focusSavedId}
          onSaveMultiplePlan={(p) => onSaveMultiplePlan?.(p)}
          onDeleteSavedMultiple={(id) => onDeleteSavedMultiple?.(id)}
          onSaveTrackedBet={onSaveTrackedBet}
          onCreateNew={() => setActiveSubTab('manual')}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          {/* Header & Top Metrics */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="glass-panel flex flex-col justify-between rounded-2xl p-3.5 lg:col-span-8">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-white">
                  Combinazioni Automatiche per Numero di Eventi
                </div>

                {/* Legs count pills */}
                <SlidingPillTrack
                  activeKey={String(legsCount)}
                  pillClassName="rounded-lg bg-gradient-to-r from-accent-400 to-brand-400"
                  className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/90 p-1"
                >
                  {[2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      data-pill-key={String(n)}
                      onClick={() => setLegsCount(n)}
                      className={`relative z-10 rounded-lg px-3 py-1 text-xs font-bold transition ${
                        legsCount === n ? 'text-slate-950' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {n} Eventi
                    </button>
                  ))}
                </SlidingPillTrack>
          </div>

          {/* Quick Promo Presets */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mr-1">
              Preset Promo Multiple:
            </span>
            <button
              onClick={() => {
                setLegsCount(3);
                setMode('normal');
                setMinLegOdds(1.4);
                setMaxLegOdds(4.0);
                setMinCombinedOdds(3.0);
                setMinGapMinutes(120);
                setBonusBoostPct(0);
              }}
              className="rounded-lg border border-accent-400/30 bg-accent-500/10 px-2.5 py-1 text-[10px] font-semibold text-accent-200 hover:bg-accent-500/20"
            >
              Tripla Promo (3x Q&ge;1.40)
            </button>
            <button
              onClick={() => {
                setLegsCount(4);
                setMode('normal');
                setMinLegOdds(1.3);
                setMaxLegOdds(3.5);
                setMinCombinedOdds(3.5);
                setMinGapMinutes(120);
                setBonusBoostPct(5);
              }}
              className="rounded-lg border border-brand-400/30 bg-brand-500/10 px-2.5 py-1 text-[10px] font-semibold text-brand-200 hover:bg-brand-500/20"
            >
              Quadrupla +5% Boost
            </button>
            <button
              onClick={() => {
                setLegsCount(2);
                setMode('normal');
                setMinLegOdds(1.5);
                setMaxLegOdds(4.0);
                setMinCombinedOdds(2.25);
                setMinGapMinutes(120);
                setBonusBoostPct(0);
              }}
              className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/20"
            >
              Raddoppio 2 Eventi
            </button>
            <button
              onClick={() => {
                setLegsCount(3);
                setMode('snr');
                setMinLegOdds(1.6);
                setMaxLegOdds(5.0);
                setMinCombinedOdds(5.0);
                setMinGapMinutes(120);
                setBonusBoostPct(0);
              }}
              className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/20"
            >
              Freebet Multipla SNR
            </button>
          </div>

          {/* Locked Legs Strip */}
          {lockedRows.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent-400/35 bg-accent-500/10 px-3 py-2">
              <span className="flex items-center gap-1 text-[11px] font-bold text-accent-200">
                <Lock className="h-3.5 w-3.5" /> Eventi Bloccati ({lockedRows.length}):
              </span>
              {lockedRows.map((lr) => (
                <span
                  key={lr.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-accent-400/40 bg-slate-950/80 px-2 py-0.5 text-[11px] text-slate-200"
                >
                  <span>{lr.eventName}</span>
                  <span className="font-mono text-brand-300">@{formatOdds(lr.backOdds)}</span>
                  <button
                    onClick={() => onUnlockRow(lr.id)}
                    className="text-slate-400 hover:text-rose-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button
                onClick={onClearLocks}
                className="ml-auto flex items-center gap-1 text-[11px] text-rose-300 hover:text-rose-200"
              >
                <Trash2 className="h-3 w-3" /> Sblocca tutti
              </button>
            </div>
          )}
        </div>

        {/* Best Combination Spotlight */}
        <div className="glass-card relative overflow-hidden rounded-2xl border-accent-400/30 p-4 lg:col-span-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-accent-300">
              Miglior Multipla Live
            </span>
            <Sparkles className="h-4 w-4 text-brand-300" />
          </div>
          {topPlan ? (
            <div className="mt-2">
              <div className="flex items-baseline gap-3">
                <AnimatedNumber
                  value={topPlan.rating}
                  formatter={(v) => formatPct(v)}
                  className="font-display text-3xl font-extrabold text-white"
                />
                <AnimatedNumber
                  value={topPlan.guaranteedProfit}
                  formatter={(v) => formatEuro(v, true)}
                  className={`font-mono text-sm font-bold ${
                    topPlan.guaranteedProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  {topPlan.bookmakerName} • Quota{' '}
                  <strong className="font-mono text-brand-300">
                    {formatOdds(topPlan.boostedBackOdds)}
                  </strong>
                </span>
                <span className="font-mono text-emerald-300">
                  {plans.length} comb. trovate
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-slate-400">
              Regola i filtri (es. quota minima o gap orario) per trovare combinazioni valide.
            </div>
          )}
        </div>
      </div>

      {/* Filters Panel */}
      <div className="glass-panel relative z-30 grid grid-cols-2 gap-2.5 rounded-2xl p-3.5 sm:grid-cols-4 lg:grid-cols-9">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">Modalità</label>
          <CustomSelect<BetMode>
            data-testid="multi-mode-select"
            className="mt-1"
            value={mode}
            minMenuWidth={170}
            onChange={setMode}
            options={[
              { value: 'normal', label: 'Normale (Qualif.)' },
              { value: 'snr', label: 'Freebet SNR' },
              { value: 'sr', label: 'Bonus SR' },
              { value: 'rf', label: 'Rimborso RF' },
            ]}
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">Puntata (€)</label>
          <NumericInput
            min={1}
            value={stake}
            onChange={setStake}
            placeholder="50"
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs font-bold text-brand-200 focus:border-brand-400 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">Bookmaker</label>
          <SourceMultiSelect
            data-testid="multi-bookmaker-select"
            values={effectiveBookmakers}
            disabled={lockedRows.length > 0}
            allLabel="Tutti (stesso book)"
            options={bookmakerOptions.map(([id, name]) => ({ id, name }))}
            onChange={setBookmakerIds}
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">Exchange</label>
          <SourceMultiSelect
            data-testid="multi-exchange-select"
            values={exchangeIds}
            allLabel="Tutti gli Exchange"
            options={exchangeOptions.map((ex) => ({ id: ex.id, name: ex.name }))}
            onChange={setExchangeIds}
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">
            Q. Singola Min/Max
          </label>
          <div className="mt-1 flex gap-1">
            <input
              type="number"
              step={0.05}
              value={minLegOdds}
              onChange={(e) => setMinLegOdds(parseFloat(e.target.value) || 1.05)}
              className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-1.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
            />
            <input
              type="number"
              step={0.5}
              value={maxLegOdds}
              onChange={(e) => setMaxLegOdds(parseFloat(e.target.value) || 10)}
              className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-1.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">
            Q. Totale Min/Max
          </label>
          <div className="mt-1 flex gap-1">
            <input
              type="number"
              step={0.25}
              value={minCombinedOdds}
              onChange={(e) => setMinCombinedOdds(parseFloat(e.target.value) || 1.5)}
              className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-1.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
            />
            <input
              type="number"
              step={1}
              value={maxCombinedOdds}
              onChange={(e) => setMaxCombinedOdds(parseFloat(e.target.value) || 50)}
              className="w-1/2 rounded-lg border border-slate-800 bg-slate-950 px-1.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">
            Gap Sequenziale
          </label>
          <CustomSelect<number>
            data-testid="multi-gap-select"
            className="mt-1"
            value={minGapMinutes}
            minMenuWidth={185}
            onChange={setMinGapMinutes}
            triggerClassName="text-emerald-300"
            options={[
              { value: 120, label: 'Min 2h (Consigliato)', dotColor: 'bg-emerald-400' },
              { value: 150, label: 'Min 2h 30m (Sicuro)', dotColor: 'bg-emerald-400' },
              { value: 180, label: 'Min 3h (Ampio)', dotColor: 'bg-brand-300' },
              { value: 60, label: 'Min 1h', dotColor: 'bg-amber-400' },
              { value: 0, label: 'Sovrapposti OK', dotColor: 'bg-slate-400' },
            ]}
          />
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">
            Bonus Multipla %
          </label>
          <div className="relative mt-1">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={bonusBoostPct}
              onChange={(e) => setBonusBoostPct(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-amber-300 focus:border-brand-400 focus:outline-none"
            />
            <Percent className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">
            Liquidità Min (€)
          </label>
          <input
            type="number"
            min={0}
            step={5}
            value={minLiquidity}
            onChange={(e) => setMinLiquidity(Math.max(0, parseFloat(e.target.value) || 0))}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-white focus:border-brand-400 focus:outline-none"
          />
        </div>

        {mode === 'rf' && (
          <>
            <div className="lg:col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-accent-300">
                Rimborso Multipla (€)
              </label>
              <input
                type="number"
                min={0}
                step={5}
                value={refundAmount}
                onChange={(e) => setRefundAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                className="mt-1 w-full rounded-lg border border-accent-500/40 bg-accent-600/30 px-2.5 py-1.5 font-mono text-xs text-white"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-accent-300">
                Ritenzione Bonus (%)
              </label>
              <input
                type="number"
                min={10}
                max={100}
                step={5}
                value={refundRetention}
                onChange={(e) => setRefundRetention(Math.max(0, parseFloat(e.target.value) || 0))}
                className="mt-1 w-full rounded-lg border border-accent-500/40 bg-accent-600/30 px-2.5 py-1.5 font-mono text-xs text-white"
              />
            </div>
          </>
        )}
      </div>

      {/* Results List */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {snapshot.rows.length === 0 &&
        !snapshot.stats.isRunning &&
        (!isBrowserOnline ||
          snapshot.connection.health === 'offline' ||
          snapshot.connection.failedSourcesCount > 0) ? (
          <div className="glass-panel h-full rounded-2xl">
            <ConnectionAlert
              snapshot={snapshot}
              isBrowserOnline={isBrowserOnline}
              variant="empty"
              onRetry={onRetryScrape}
              onOpenScrapers={onOpenScrapers}
            />
          </div>
        ) : plans.length === 0 ? (
          <div className="glass-panel flex h-full flex-col items-center justify-center gap-2 rounded-2xl p-10 text-center">
            <Layers className="h-9 w-9 text-slate-600" />
            <div className="text-sm font-semibold text-slate-300">
              {snapshot.rows.length === 0
                ? !autoScrapeActive && !snapshot.stats.isRunning
                  ? 'Aggiornamento automatico dello scraping fermo'
                  : 'In attesa delle quote live dallo scraper...'
                : 'Nessuna combinazione trovata con questi parametri'}
            </div>
            {snapshot.rows.length === 0 && !autoScrapeActive && !snapshot.stats.isRunning ? (
              <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                {onRestartAutoScrape && (
                  <button
                    type="button"
                    onClick={onRestartAutoScrape}
                    className="flex items-center gap-1.5 rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-3.5 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Riavvia Auto-Scraping
                  </button>
                )}
                <button
                  type="button"
                  onClick={onRetryScrape}
                  className="flex items-center gap-1.5 rounded-xl border border-brand-400/40 bg-brand-500/15 px-3.5 py-1.5 text-xs font-bold text-brand-200 hover:bg-brand-500/25"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Scansiona Ora
                </button>
              </div>
            ) : (
              <p className="max-w-md text-xs text-slate-500">
                Suggerimento: prova ad abbassare la Quota Singola Minima (es. 1.20), ridurre la Quota Totale Minima o impostare Gap Sequenziale su 60m / Sovrapposti OK.
              </p>
            )}
          </div>
        ) : (
          plans.map((plan, idx) => {
            const isExpanded = expandedId === plan.id || (expandedId === null && idx === 0);
            const isSaved = savedPlanIds.has(plan.id);
            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.03, 0.25) }}
                className={`glass-card overflow-hidden rounded-2xl border transition-colors ${
                  isExpanded
                    ? 'border-accent-400/45 shadow-[0_0_32px_-12px_rgb(var(--accent-500)/0.4)]'
                    : 'border-slate-800/80 hover:border-brand-400/30'
                }`}
              >
                {/* Plan Summary Header */}
                <div
                  onClick={() => setExpandedId(isExpanded ? '__none__' : plan.id)}
                  className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3.5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div
                      className={`flex h-11 min-w-[74px] shrink-0 flex-col items-center justify-center rounded-xl border px-2.5 font-mono ${
                        plan.rating >= 100
                          ? 'surebet-badge text-brand-100'
                          : plan.rating >= 90
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-amber-500/35 bg-amber-500/10 text-amber-300'
                      }`}
                    >
                      <span className="text-sm font-extrabold">{formatPct(plan.rating)}</span>
                      <span className="text-[9px] uppercase opacity-75">Rating</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold text-white"
                          style={{
                            backgroundColor: `${plan.bookmakerColor}28`,
                            border: `1px solid ${plan.bookmakerColor}66`,
                          }}
                        >
                          <BookmakerIcon sourceId={plan.bookmakerId} size={22} className="rounded-[5px]" />
                          {plan.bookmakerName}
                        </span>
                        <span className="font-mono text-xs font-bold text-brand-200">
                          Quota Tot: {formatOdds(plan.boostedBackOdds)}
                          {bonusBoostPct > 0 && (
                            <span className="ml-1 text-[10px] text-amber-300">
                              (base {formatOdds(plan.combinedBackOdds)} +{bonusBoostPct}%)
                            </span>
                          )}
                        </span>
                        <span className="text-slate-600">•</span>
                        <span className="font-mono text-xs text-rose-300">
                          Banca Eff.: {formatOdds(plan.effectiveCombinedLayOdds)}
                        </span>
                        {plan.nonOverlapping && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                            <ShieldCheck className="h-3 w-3" />
                            Non Sovrapposti • Gap min {formatGap(plan.minGapMinutes)}
                          </span>
                        )}
                      </div>

                      {/* Compact Leg Pills */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300">
                        {plan.legs.map((step, sIdx) => (
                          <React.Fragment key={step.row.id}>
                            <span className="rounded-md border border-slate-800 bg-slate-950/80 px-2 py-0.5">
                              <span className="text-slate-400">#{step.legIndex}</span>{' '}
                              <span className="font-semibold text-white">{step.row.eventName}</span>{' '}
                              <span className="text-brand-300">({step.row.selectionLabel})</span>{' '}
                              <span className="font-mono text-blue-300">@{formatOdds(step.backOdds)}</span>
                            </span>
                            {sIdx < plan.legs.length - 1 && (
                              <span className="text-[10px] text-slate-500">→</span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right KPIs */}
                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <div className="text-[10px] uppercase text-slate-500">Profitto Garantito</div>
                      <div
                        className={`font-mono text-base font-extrabold tabular-nums ${
                          plan.guaranteedProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatEuro(plan.guaranteedProfit, true)}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] uppercase text-slate-500">Max Resp. Exchange</div>
                      <div className="font-mono text-xs font-bold text-slate-200 tabular-nums">
                        {formatEuro(plan.maxCumulativeLiability)}
                      </div>
                    </div>

                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400">
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </div>
                </div>

                {/* Expanded Sequential Lay Schedule & Scenario Matrix */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-t border-slate-800/80 bg-black/35 p-4"
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-brand-200">
                          <Clock className="h-4 w-4 text-accent-400" />
                          Piano di Bancata Sequenziale (Banca l&apos;evento successivo solo se il precedente vince!)
                        </div>
                        <div className="flex items-center gap-2">
                          {onSaveMultiplePlan && (
                            <button
                              type="button"
                              onClick={() => {
                                if (savedAutoIds.has(plan.id)) {
                                  setActiveSubTab('saved');
                                } else {
                                  void handleSaveAutoInteractivePlan(plan);
                                }
                              }}
                              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                                savedAutoIds.has(plan.id)
                                  ? 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                                  : 'bg-gradient-to-r from-brand-300 to-accent-400 text-slate-950 hover:brightness-110'
                              }`}
                            >
                              <BookmarkCheck className="h-3.5 w-3.5" />
                              {savedAutoIds.has(plan.id) ? 'Salvato · Apri' : 'Salva Piano'}
                            </button>
                          )}
                          <button
                            onClick={() => handleSavePlan(plan)}
                            disabled={isSaved}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                              isSaved
                                ? 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                                : 'border border-slate-700 bg-slate-900 text-slate-200 hover:border-brand-400/50 hover:text-white'
                            }`}
                          >
                            {isSaved ? <Check className="h-3.5 w-3.5" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
                            {isSaved ? 'Nel Tracker' : 'Salva nel Tracker'}
                          </button>
                        </div>
                      </div>

                      {/* Chronological Step Cards */}
                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                        {plan.legs.map((step) => {
                          const tm = formatEventTime(step.row.startTime);
                          const copyId = `${plan.id}_${step.legIndex}`;
                          return (
                            <div
                              key={copyId}
                              className="relative rounded-xl border border-slate-800 bg-slate-900/75 p-3"
                            >
                              <div className="flex items-center justify-between">
                                <span className="rounded-md bg-accent-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-accent-200 border border-accent-400/35">
                                  STEP {step.legIndex}
                                </span>
                                <span className="font-mono text-[11px] text-slate-400">
                                  {tm.date} <strong className="text-brand-300">{tm.time}</strong>
                                  {step.gapMinutesFromPrev !== null && (
                                    <span className="ml-1.5 text-emerald-400">
                                      (+{formatGap(step.gapMinutesFromPrev)})
                                    </span>
                                  )}
                                </span>
                              </div>

                              <div className="mt-2 truncate text-xs font-bold text-white">
                                {step.row.eventName}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {step.row.marketLabel} •{' '}
                                <span className="font-semibold text-brand-200">
                                  {step.row.selectionLabel}
                                </span>
                              </div>

                              <div className="mt-2.5 flex items-center justify-between rounded-lg bg-slate-950/80 px-2.5 py-2">
                                <div>
                                  <div className="text-[10px] text-slate-500">
                                    Banca su {step.row.exchangeName} @{formatOdds(step.layOdds)}
                                  </div>
                                  <div className="font-mono text-base font-extrabold text-white">
                                    {formatEuro(step.layStake)}
                                  </div>
                                </div>
                                <button
                                  onClick={() => void copyLayStake(copyId, step.layStake)}
                                  className="flex items-center gap-1 rounded-lg border border-brand-400/35 bg-brand-500/15 px-2.5 py-1 text-[10px] font-bold text-brand-200 hover:bg-brand-400 hover:text-slate-950"
                                >
                                  {copiedKey === copyId ? (
                                    <Check className="h-3 w-3" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                  {copiedKey === copyId ? 'OK' : 'Copia'}
                                </button>
                              </div>

                              <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
                                <div>
                                  <div className="text-slate-500">Resp. Step</div>
                                  <div className="font-mono font-semibold text-rose-300">
                                    {formatEuro(step.liability)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-slate-500">Liquidità</div>
                                  <div className="font-mono font-semibold text-slate-300">
                                    {formatEuro(step.row.liquidity)}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-slate-500">Se perde qui</div>
                                  <div
                                    className={`font-mono font-bold ${
                                      step.profitIfLostHere >= -0.005
                                        ? 'text-emerald-400'
                                        : 'text-rose-400'
                                    }`}
                                  >
                                    {formatEuro(step.profitIfLostHere, true)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Outcome Neutrality Proof Bar */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
                          <span className="font-semibold text-emerald-300">
                            Matrice Esiti Neutrale:
                          </span>
                          {plan.legs.map((s) => (
                            <span key={s.legIndex} className="font-mono">
                              Persa Step {s.legIndex}:{' '}
                              <strong
                                className={
                                  s.profitIfLostHere >= -0.005 ? 'text-emerald-400' : 'text-rose-300'
                                }
                              >
                                {formatEuro(s.profitIfLostHere, true)}
                              </strong>
                            </span>
                          ))}
                          <span className="font-mono">
                            Tutte Vinte:{' '}
                            <strong
                              className={
                                plan.profitIfAllWin >= -0.005 ? 'text-emerald-400' : 'text-rose-300'
                              }
                            >
                              {formatEuro(plan.profitIfAllWin, true)}
                            </strong>
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-slate-400">
                          Bankroll Exchange max: <strong className="text-white">{formatEuro(plan.maxCumulativeLiability)}</strong>
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })
        )}
      </div>
        </div>
      )}
    </div>
  );
};

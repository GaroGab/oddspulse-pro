import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkCheck,
  BookmarkPlus,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  Layers,
  ListPlus,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { computeAutoRolloverRating } from '../../shared/math';
import {
  evaluateSavedMultiplePlan,
  findLiveRowForSavedLeg,
  syncLiveOddsForSavedPlan,
} from '../../shared/savedMultiples';
import type {
  BetMode,
  OddsmatcherRow,
  RolloverWalletRule,
  SavedMultipleLegStatus,
  SavedMultiplePlan,
  SavedMultiplePlanInput,
  TrackedBet,
} from '../../shared/types';
import { formatEuro, formatEventTime, formatGap, formatOdds, formatPct } from '../utils/format';
import { playCopyTick } from '../utils/sound';
import { AnimatedNumber } from './AnimatedNumber';
import { BookmakerIcon } from './BookmakerIcon';
import { CustomSelect } from './CustomSelect';
import { NumericInput } from './NumericInput';
import { RolloverParamsPanel } from './RolloverParamsPanel';
import { SlidingPillTrack } from './SlidingPillTrack';

interface SavedMultiplesViewProps {
  savedMultiples: SavedMultiplePlan[];
  liveRows: OddsmatcherRow[];
  soundEnabled: boolean;
  initialSelectedId?: string | null;
  onSaveMultiplePlan: (
    plan: SavedMultiplePlan | SavedMultiplePlanInput
  ) => Promise<SavedMultiplePlan | null> | SavedMultiplePlan | null | void;
  onDeleteSavedMultiple: (id: string) => void;
  onSaveTrackedBet: (bet: Omit<TrackedBet, 'id' | 'createdAt'>) => void;
  onCreateNew: () => void;
}

type StatusFilter = 'all' | 'active' | 'completed';

const STATUS_ACTIONS: Array<{
  id: SavedMultipleLegStatus;
  label: string;
  activeCls: string;
}> = [
  {
    id: 'pending',
    label: 'Da Bancare',
    activeCls: 'border-brand-400/60 bg-brand-400/20 text-brand-200',
  },
  {
    id: 'laid',
    label: 'Bancato',
    activeCls: 'border-sky-400/60 bg-sky-500/20 text-sky-200',
  },
  {
    id: 'won_bookie',
    label: 'Vinto Book',
    activeCls: 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200',
  },
  {
    id: 'lost_bookie',
    label: 'Perso Book',
    activeCls: 'border-rose-400/60 bg-rose-500/20 text-rose-200',
  },
];

export const SavedMultiplesView: React.FC<SavedMultiplesViewProps> = React.memo(
  ({
    savedMultiples,
    liveRows,
    soundEnabled,
    initialSelectedId,
    onSaveMultiplePlan,
    onDeleteSavedMultiple,
    onSaveTrackedBet,
    onCreateNew,
  }) => {
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [search, setSearch] = useState<string>('');
    const [selectedId, setSelectedId] = useState<string | null>(
      () => initialSelectedId ?? savedMultiples[0]?.id ?? null
    );
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [copiedPlan, setCopiedPlan] = useState<boolean>(false);
    const [syncNote, setSyncNote] = useState<string | null>(null);
    const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set());
    const [autoEstimatedRating, setAutoEstimatedRating] = useState<boolean>(false);

    useEffect(() => {
      if (initialSelectedId && savedMultiples.some((p) => p.id === initialSelectedId)) {
        setSelectedId(initialSelectedId);
      }
    }, [initialSelectedId, savedMultiples]);

    useEffect(() => {
      if (savedMultiples.length === 0) {
        setSelectedId(null);
      } else if (!selectedId || !savedMultiples.some((p) => p.id === selectedId)) {
        setSelectedId(savedMultiples[0].id);
      }
    }, [savedMultiples, selectedId]);

    const evaluatedMap = useMemo(() => {
      const m = new Map<string, ReturnType<typeof evaluateSavedMultiplePlan>>();
      for (const p of savedMultiples) {
        m.set(p.id, evaluateSavedMultiplePlan(p));
      }
      return m;
    }, [savedMultiples]);

    const counts = useMemo(() => {
      let active = 0;
      let completed = 0;
      for (const p of savedMultiples) {
        if (p.status === 'completed') completed++;
        else active++;
      }
      return { all: savedMultiples.length, active, completed };
    }, [savedMultiples]);

    const filteredPlans = useMemo(() => {
      const q = search.trim().toLowerCase();
      return savedMultiples.filter((p) => {
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        if (q) {
          const hay = `${p.name} ${p.bookmakerName} ${p.legs
            .map((l) => `${l.eventName} ${l.selectionLabel} ${l.exchangeName}`)
            .join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    }, [savedMultiples, statusFilter, search]);

    const selectedPlan = useMemo(
      () => savedMultiples.find((p) => p.id === selectedId) ?? filteredPlans[0] ?? null,
      [savedMultiples, selectedId, filteredPlans]
    );

    const selectedEval = useMemo(
      () => (selectedPlan ? evaluatedMap.get(selectedPlan.id) ?? evaluateSavedMultiplePlan(selectedPlan) : null),
      [selectedPlan, evaluatedMap]
    );

    const autoRatingEstimate = useMemo(() => {
      const scopedRows = selectedPlan
        ? liveRows.filter((r) => r.bookmakerId === selectedPlan.bookmakerId)
        : liveRows;
      return computeAutoRolloverRating({
        rows: scopedRows.length > 0 ? scopedRows : liveRows,
      });
    }, [liveRows, selectedPlan]);

    const commitUpdate = (nextPlan: SavedMultiplePlan) => {
      void onSaveMultiplePlan(nextPlan);
    };

    const handleLegFieldChange = (
      legId: string,
      patch: Partial<SavedMultiplePlan['legs'][number]>
    ) => {
      if (!selectedPlan) return;
      commitUpdate({
        ...selectedPlan,
        legs: selectedPlan.legs.map((l) => (l.id === legId ? { ...l, ...patch } : l)),
      });
    };

    const handleSetLegStatus = (
      legId: string,
      nextStatus: SavedMultipleLegStatus,
      recommendedStake: number
    ) => {
      if (!selectedPlan) return;
      commitUpdate({
        ...selectedPlan,
        legs: selectedPlan.legs.map((l) => {
          if (l.id !== legId) return l;
          if (nextStatus === 'pending') {
            const { lockedLayStake: _omit, ...rest } = l;
            return { ...rest, status: 'pending' };
          }
          return {
            ...l,
            status: nextStatus,
            lockedLayStake:
              typeof l.lockedLayStake === 'number' && Number.isFinite(l.lockedLayStake)
                ? l.lockedLayStake
                : recommendedStake,
          };
        }),
      });
      if (soundEnabled) playCopyTick();
    };

    const handleSyncLive = () => {
      if (!selectedPlan) return;
      const { nextPlan, updatedCount } = syncLiveOddsForSavedPlan(selectedPlan, liveRows);
      if (updatedCount > 0) {
        commitUpdate(nextPlan);
        setSyncNote(
          `${updatedCount} ${updatedCount === 1 ? 'quota aggiornata' : 'quote aggiornate'} dai feed live`
        );
        if (soundEnabled) playCopyTick();
      } else {
        setSyncNote('Nessuna variazione live rilevata sugli step in attesa');
      }
      setTimeout(() => setSyncNote(null), 2800);
    };

    const copyLayStake = async (key: string, amount: number) => {
      try {
        await navigator.clipboard.writeText(amount.toFixed(2));
        setCopiedKey(key);
        if (soundEnabled) playCopyTick();
        setTimeout(() => setCopiedKey(null), 1400);
      } catch {
        // Ignore clipboard error
      }
    };

    const handleCopyFullPlan = async () => {
      if (!selectedPlan || !selectedEval) return;
      const lines = [
        `[${selectedPlan.name} • ${selectedPlan.bookmakerName} • ${selectedPlan.mode.toUpperCase()}] Puntata €${selectedPlan.stake.toFixed(
          2
        )} | Quota Tot ${selectedEval.boostedBackOdds.toFixed(
          2
        )} | Rating ${selectedEval.rating.toFixed(2)}% | Profitto ${formatEuro(
          selectedEval.projectedProfit,
          true
        )}`,
        ...selectedEval.steps.map(
          (s) =>
            `STEP ${s.legIndex} [${s.leg.status}]: ${s.leg.eventName} (${s.leg.selectionLabel} @${s.leg.backOdds.toFixed(
              2
            )}) -> Banca €${s.layStake.toFixed(2)} @${s.leg.layOdds.toFixed(2)} su ${
              s.leg.exchangeName
            } (Resp €${s.liability.toFixed(2)})`
        ),
      ];
      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        setCopiedPlan(true);
        if (soundEnabled) playCopyTick();
        setTimeout(() => setCopiedPlan(false), 1800);
      } catch {
        // Ignore clipboard error
      }
    };

    const handleSendToTracker = () => {
      if (!selectedPlan || !selectedEval || selectedEval.steps.length === 0) return;
      const first = selectedEval.steps[0];
      const trackerStatus: TrackedBet['status'] =
        selectedEval.settledOutcome === 'won_all'
          ? 'won_bookie'
          : selectedEval.settledOutcome === 'lost_at_leg'
          ? 'won_exchange'
          : 'pending';

      onSaveTrackedBet({
        eventName: selectedEval.steps.map((s) => s.leg.eventName).join(' + '),
        league: selectedPlan.name,
        sport: first.leg.sport,
        marketLabel: `Sequenziale (${selectedEval.steps.length} step · Gap ${formatGap(
          selectedEval.minGapMinutes
        )})`,
        selectionLabel: selectedEval.steps.map((s) => s.leg.selectionLabel).join(' / '),
        type: 'multipla',
        mode: selectedPlan.mode,
        bookmakerName: selectedPlan.bookmakerName,
        exchangeName: Array.from(new Set(selectedEval.steps.map((s) => s.leg.exchangeName))).join(
          ' + '
        ),
        stake: selectedPlan.stake,
        backOdds: selectedEval.boostedBackOdds,
        layOdds: first.leg.layOdds,
        layStake: first.layStake,
        liability: selectedEval.maxCumulativeLiability,
        commission: first.leg.commission,
        expectedProfit: selectedEval.projectedProfit,
        rating: selectedEval.rating,
        status: trackerStatus,
        realizedProfit: selectedEval.projectedProfit,
        notes: `${selectedPlan.name} | Bonus +${selectedPlan.bonusBoostPct}%`,
      });
      setTrackedIds((prev) => new Set(prev).add(selectedPlan.id));
      if (soundEnabled) playCopyTick();
    };

    if (savedMultiples.length === 0) {
      return (
        <div
          data-testid="saved-multiples-empty"
          className="glass-panel flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl p-8 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-400/40 bg-brand-400/15 text-brand-300 shadow-glow">
            <BookmarkCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-white">
              Nessuna Multipla Salvata
            </h2>
            <p className="mt-1 max-w-md text-xs text-slate-400">
              Costruisci una multipla nel{' '}
              <strong className="text-slate-200">Costruttore Manuale</strong> (o nell&apos;Ottimizzatore)
              e clicca <strong className="text-brand-300">Salva Piano</strong> per tenerla sotto
              controllo, aggiornare progressivamente le quote prima di ogni evento e ricalcolare le
              bancate successive.
            </p>
          </div>
          <button
            type="button"
            data-testid="saved-empty-create-btn"
            onClick={onCreateNew}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-4 py-2 text-xs font-extrabold text-slate-950 shadow-glow transition hover:brightness-110"
          >
            <ListPlus className="h-4 w-4" />
            Vai al Costruttore Manuale
          </button>
        </div>
      );
    }

    return (
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-12">
        {/* LEFT COLUMN: Saved Plans List */}
        <div className="glass-panel flex min-h-0 flex-col overflow-hidden rounded-2xl lg:col-span-4">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <BookmarkCheck className="h-4 w-4 text-brand-300" />
              <h2 className="font-display text-sm font-bold text-white">Piani Salvati</h2>
              <span className="rounded-md border border-brand-400/35 bg-brand-400/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-200">
                {savedMultiples.length}
              </span>
            </div>
            <button
              type="button"
              onClick={onCreateNew}
              className="flex items-center gap-1 rounded-lg border border-brand-400/35 bg-brand-500/15 px-2.5 py-1 text-[11px] font-bold text-brand-200 transition hover:bg-brand-400 hover:text-slate-950"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuova
            </button>
          </div>

          <div className="space-y-2 border-b border-slate-800/80 bg-slate-950/50 p-2.5">
            <SlidingPillTrack
              activeKey={statusFilter}
              measureDep={`${counts.all}_${counts.active}_${counts.completed}`}
              pillClassName="rounded-lg border border-brand-400/40 bg-brand-500/20"
              className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950/90 p-0.5"
            >
              {(
                [
                  { id: 'all', label: `Tutte (${counts.all})` },
                  { id: 'active', label: `Attive (${counts.active})` },
                  { id: 'completed', label: `Chiuse (${counts.completed})` },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  data-pill-key={f.id}
                  data-testid={`saved-filter-${f.id}`}
                  onClick={() => setStatusFilter(f.id)}
                  className={`relative z-10 rounded-lg border border-transparent py-1 text-[11px] font-semibold transition ${
                    statusFilter === f.id ? 'text-brand-200' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </SlidingPillTrack>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca piano, evento o bookmaker..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950/85 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-brand-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
            {filteredPlans.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                Nessuna multipla corrisponde ai filtri selezionati.
              </div>
            ) : (
              filteredPlans.map((p) => {
                const ev = evaluatedMap.get(p.id)!;
                const isSelected = selectedPlan?.id === p.id;
                const dt = new Date(p.createdAt);
                const dateStr = `${dt.toLocaleDateString('it-IT', {
                  day: '2-digit',
                  month: 'short',
                })} ${dt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;

                return (
                  <div
                    key={p.id}
                    data-testid={`saved-multi-item-${p.id}`}
                    onClick={() => setSelectedId(p.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(p.id);
                      }
                    }}
                    className={`group cursor-pointer rounded-xl border p-2.5 transition ${
                      isSelected
                        ? 'border-brand-400/65 bg-brand-500/[0.13] shadow-[0_0_24px_-12px_rgb(var(--brand-400)/0.6)]'
                        : 'border-slate-800/90 bg-slate-900/55 hover:border-slate-700 hover:bg-slate-900/85'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <BookmakerIcon
                          sourceId={p.bookmakerId}
                          size={24}
                          className="rounded-md"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-white">{p.name}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                            <span>{p.bookmakerName}</span>
                            <span>•</span>
                            <span>{dateStr}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        data-testid={`saved-multi-delete-${p.id}`}
                        aria-label={`Elimina ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSavedMultiple(p.id);
                        }}
                        className="rounded-md p-1 text-slate-500 opacity-75 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-800/70 pt-2 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        {p.status === 'completed' ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              ev.settledOutcome === 'won_all'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {ev.settledOutcome === 'won_all' ? 'Chiusa · Vinta' : 'Chiusa · Exchange'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-brand-400/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-brand-300">
                            {ev.laidLegsCount}/{ev.steps.length} STEP
                          </span>
                        )}
                        <span className="rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[9px] uppercase text-slate-300">
                          {p.mode}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 font-mono font-bold">
                        <span
                          className={
                            ev.rating >= 100
                              ? 'text-brand-300'
                              : ev.rating >= 90
                              ? 'text-emerald-400'
                              : 'text-amber-300'
                          }
                        >
                          {formatPct(ev.rating)}
                        </span>
                        <span
                          className={
                            ev.projectedProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                          }
                        >
                          {formatEuro(ev.projectedProfit, true)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Progressive Plan Editor & Sequential Lay Schedule */}
        {selectedPlan && selectedEval && (
          <div className="glass-panel flex min-h-0 flex-col overflow-hidden rounded-2xl lg:col-span-8">
            {/* Plan Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <BookmakerIcon
                  sourceId={selectedPlan.bookmakerId}
                  size={26}
                  className="rounded-md"
                />
                <div className="relative min-w-0 flex-1">
                  <Pencil className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    data-testid="saved-plan-name-input"
                    value={selectedPlan.name}
                    onChange={(e) => commitUpdate({ ...selectedPlan, name: e.target.value })}
                    className="w-full rounded-lg border border-transparent bg-transparent py-0.5 pl-1 pr-6 font-display text-sm font-bold text-white transition hover:border-slate-800 focus:border-brand-400/60 focus:bg-slate-950/80 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-testid="saved-multi-sync-live"
                  onClick={handleSyncLive}
                  className="flex items-center gap-1.5 rounded-xl border border-brand-400/40 bg-brand-500/15 px-2.5 py-1.5 text-[11px] font-bold text-brand-200 transition hover:bg-brand-400 hover:text-slate-950"
                  title="Sincronizza le quote Exchange live sugli step ancora Da Bancare"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Aggiorna Quote Live
                </button>

                <button
                  type="button"
                  onClick={() => void handleCopyFullPlan()}
                  className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:border-brand-400/45 hover:text-white"
                >
                  {copiedPlan ? (
                    <ClipboardCheck className="h-3.5 w-3.5 text-emerald-300" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-brand-300" />
                  )}
                  {copiedPlan ? 'Copiato!' : 'Copia'}
                </button>

                <button
                  type="button"
                  onClick={handleSendToTracker}
                  disabled={trackedIds.has(selectedPlan.id)}
                  className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-bold transition ${
                    trackedIds.has(selectedPlan.id)
                      ? 'border border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
                      : 'border border-slate-700 bg-slate-900 text-slate-200 hover:border-brand-400/45 hover:text-white'
                  }`}
                >
                  {trackedIds.has(selectedPlan.id) ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <BookmarkPlus className="h-3.5 w-3.5 text-brand-300" />
                  )}
                  {trackedIds.has(selectedPlan.id) ? 'Nel Tracker' : 'Tracker'}
                </button>
              </div>
            </div>

            {syncNote && (
              <div className="border-b border-brand-400/30 bg-brand-500/10 px-4 py-1.5 text-[11px] font-medium text-brand-200">
                {syncNote}
              </div>
            )}

            {/* Plan Parameters + KPI Strip */}
            <div className="border-b border-slate-800/80 bg-slate-950/50 px-4 py-2.5 space-y-2.5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div>
                  <label className="text-[9px] uppercase tracking-wider text-slate-500">
                    Modalità
                  </label>
                  <CustomSelect<BetMode>
                    size="sm"
                    className="mt-0.5"
                    minMenuWidth={150}
                    value={selectedPlan.mode}
                    onChange={(m) => {
                      if (m === 'rollover') {
                        commitUpdate({
                          ...selectedPlan,
                          mode: m,
                          realBalance: selectedPlan.realBalance ?? 100,
                          bonusBalance: selectedPlan.bonusBalance ?? 100,
                          rolloverRemaining: selectedPlan.rolloverRemaining ?? 500,
                          estimatedRating:
                            selectedPlan.estimatedRating ?? autoRatingEstimate.estimatedRating,
                          rolloverWalletRule: selectedPlan.rolloverWalletRule ?? 'mixed',
                        });
                      } else {
                        commitUpdate({ ...selectedPlan, mode: m });
                      }
                    }}
                    options={[
                      { value: 'normal', label: 'Normale' },
                      { value: 'snr', label: 'Freebet SNR' },
                      { value: 'sr', label: 'Bonus SR' },
                      { value: 'rf', label: 'Rimborso RF' },
                      { value: 'rollover', label: 'Rollover' },
                    ]}
                  />
                </div>

                <div>
                  <label className="text-[9px] uppercase tracking-wider text-slate-500">
                    Puntata (€)
                  </label>
                  <NumericInput
                    min={1}
                    value={selectedPlan.stake}
                    onChange={(v) => commitUpdate({ ...selectedPlan, stake: v })}
                    className="mt-0.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[11px] font-bold text-brand-200 focus:border-brand-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[9px] uppercase tracking-wider text-slate-500">
                    Bonus (%)
                  </label>
                  <NumericInput
                    min={0}
                    max={100}
                    value={selectedPlan.bonusBoostPct}
                    onChange={(v) => commitUpdate({ ...selectedPlan, bonusBoostPct: v })}
                    className="mt-0.5 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[11px] font-bold text-amber-300 focus:border-brand-400 focus:outline-none"
                  />
                </div>

                {selectedPlan.mode === 'rf' ? (
                  <>
                    <div>
                      <label className="text-[9px] uppercase tracking-wider text-accent-300">
                        Rimborso (€)
                      </label>
                      <NumericInput
                        min={0}
                        value={selectedPlan.refundAmount}
                        onChange={(v) => commitUpdate({ ...selectedPlan, refundAmount: v })}
                        className="mt-0.5 w-full rounded-lg border border-accent-500/40 bg-slate-950 px-2 py-1 font-mono text-[11px] font-bold text-white focus:border-accent-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase tracking-wider text-accent-300">
                        Ritenzione (%)
                      </label>
                      <NumericInput
                        min={0}
                        max={100}
                        value={selectedPlan.refundRetention}
                        onChange={(v) => commitUpdate({ ...selectedPlan, refundRetention: v })}
                        className="mt-0.5 w-full rounded-lg border border-accent-500/40 bg-slate-950 px-2 py-1 font-mono text-[11px] font-bold text-white focus:border-accent-400 focus:outline-none"
                      />
                    </div>
                  </>
                ) : (
                  <div className="col-span-2 flex items-end justify-end pb-0.5">
                    {selectedEval.nonOverlapping && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
                        <ShieldCheck className="h-3 w-3" />
                        Sequenza valida • Gap min {formatGap(selectedEval.minGapMinutes)}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {selectedPlan.mode === 'rollover' && (
                <RolloverParamsPanel
                  compact
                  testIdPrefix="saved-rollover"
                  stake={selectedPlan.stake}
                  realBalance={selectedPlan.realBalance ?? 100}
                  bonusBalance={selectedPlan.bonusBalance ?? 100}
                  rolloverRemaining={selectedPlan.rolloverRemaining ?? 500}
                  estimatedRating={
                    selectedPlan.estimatedRating ?? autoRatingEstimate.estimatedRating
                  }
                  autoEstimatedRating={autoEstimatedRating}
                  autoRatingInfo={autoRatingEstimate}
                  walletRule={(selectedPlan.rolloverWalletRule ?? 'mixed') as RolloverWalletRule}
                  rolloverDetails={selectedEval.rollover}
                  onChangeStake={(v) => commitUpdate({ ...selectedPlan, stake: v })}
                  onChangeRealBalance={(v) => commitUpdate({ ...selectedPlan, realBalance: v })}
                  onChangeBonusBalance={(v) => commitUpdate({ ...selectedPlan, bonusBalance: v })}
                  onChangeRolloverRemaining={(v) =>
                    commitUpdate({ ...selectedPlan, rolloverRemaining: v })
                  }
                  onChangeEstimatedRating={(v) => {
                    setAutoEstimatedRating(false);
                    commitUpdate({ ...selectedPlan, estimatedRating: v });
                  }}
                  onToggleAutoRating={(nextAuto) => {
                    setAutoEstimatedRating(nextAuto);
                    if (nextAuto) {
                      commitUpdate({
                        ...selectedPlan,
                        estimatedRating: autoRatingEstimate.estimatedRating,
                      });
                    }
                  }}
                  onChangeWalletRule={(rule) =>
                    commitUpdate({ ...selectedPlan, rolloverWalletRule: rule })
                  }
                />
              )}

              {/* Hero KPI Summary */}
              <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-brand-400/30 bg-gradient-to-r from-brand-500/10 via-slate-900/70 to-accent-500/10 px-3.5 py-2 sm:grid-cols-4">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-400">
                    Rating Attuale
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <AnimatedNumber
                      value={selectedEval.rating}
                      durationMs={200}
                      formatter={(v) => formatPct(v)}
                      className={`font-mono text-base font-extrabold ${
                        selectedEval.rating >= 100
                          ? 'text-brand-300'
                          : selectedEval.rating >= 90
                          ? 'text-emerald-400'
                          : 'text-amber-300'
                      }`}
                    />
                    {Math.abs(selectedEval.ratingDelta) >= 0.01 && (
                      <span
                        data-testid="saved-plan-rating-delta"
                        className={`font-mono text-[10px] font-bold ${
                          selectedEval.ratingDelta > 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        ({selectedEval.ratingDelta > 0 ? '+' : ''}
                        {selectedEval.ratingDelta.toFixed(2)}%)
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-400">
                    {selectedPlan.status === 'completed' ? 'Profitto Finale' : 'Profitto Proiettato'}
                  </div>
                  <AnimatedNumber
                    value={selectedEval.projectedProfit}
                    durationMs={200}
                    formatter={(v) => formatEuro(v, true)}
                    className={`font-mono text-base font-extrabold ${
                      selectedEval.projectedProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  />
                </div>

                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-400">
                    Quota Multipla
                  </div>
                  <div className="font-mono text-base font-extrabold text-blue-300">
                    {formatOdds(selectedEval.boostedBackOdds)}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-400">
                    Resp. Impegnata / Max
                  </div>
                  <div className="font-mono text-xs font-extrabold text-rose-300">
                    {formatEuro(selectedEval.committedLiability)}{' '}
                    <span className="text-slate-500 font-normal">
                      / {formatEuro(selectedEval.maxCumulativeLiability)}
                    </span>
                  </div>
                </div>
              </div>

              {selectedEval.rollover && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-400/25 bg-brand-500/[0.06] px-3 py-1.5 text-[10px]">
                  <span className="font-semibold text-brand-200">
                    Rollover: €{selectedEval.rollover.rolloverBefore.toFixed(0)} →{' '}
                    <strong className="text-white">
                      {selectedEval.rollover.completesRolloverOnThisBet
                        ? 'Completato'
                        : `€${selectedEval.rollover.rolloverAfter.toFixed(0)}`}
                    </strong>
                  </span>
                  <span className="text-slate-400">
                    Match Rating:{' '}
                    <strong className="font-mono text-emerald-300">
                      {selectedEval.rollover.matchRating.toFixed(2)}%
                    </strong>
                  </span>
                  <span className="font-mono text-slate-400">
                    Costo futuro V/P: -{formatEuro(selectedEval.rollover.futureRolloverCostIfWin)} /{' '}
                    {selectedEval.rollover.clearsRolloverOnLose
                      ? 'Azzera (€0)'
                      : `-${formatEuro(selectedEval.rollover.futureRolloverCostIfLose)}`}
                  </span>
                </div>
              )}
            </div>

            {/* Scrollable Progressive Steps */}
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3.5">
              {selectedEval.steps.map((step, idx) => {
                const tm = formatEventTime(step.leg.startTime);
                const isNextPending = idx === selectedEval.nextPendingIndex;
                const liveMatch =
                  step.leg.status === 'pending'
                    ? findLiveRowForSavedLeg(step.leg, liveRows)
                    : undefined;
                const hasLiveLayDiff =
                  liveMatch && Math.abs(liveMatch.layOdds - step.leg.layOdds) >= 0.01;
                const layChanged =
                  Math.abs(step.leg.layOdds - step.leg.initialLayOdds) >= 0.005;
                const backChanged =
                  Math.abs(step.leg.backOdds - step.leg.initialBackOdds) >= 0.005;
                const copyId = `saved_${selectedPlan.id}_${step.leg.id}`;

                return (
                  <div
                    key={step.leg.id}
                    data-testid={`saved-step-${step.legIndex}`}
                    className={`rounded-xl border p-3 transition ${
                      step.skipped
                        ? 'border-slate-800/60 bg-slate-950/45 opacity-55'
                        : isNextPending
                        ? 'border-brand-400/60 bg-slate-900/90 shadow-[0_0_24px_-12px_rgb(var(--brand-400)/0.45)]'
                        : step.leg.status === 'won_bookie'
                        ? 'border-emerald-500/35 bg-emerald-950/10'
                        : step.leg.status === 'lost_bookie'
                        ? 'border-rose-500/45 bg-rose-950/15'
                        : 'border-sky-500/35 bg-slate-900/75'
                    }`}
                  >
                    {/* Step Top Row */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-extrabold ${
                            isNextPending
                              ? 'border-brand-300 bg-brand-400 text-slate-950'
                              : 'border-accent-400/35 bg-accent-500/20 text-accent-200'
                          }`}
                        >
                          STEP {step.legIndex}
                        </span>
                        {isNextPending && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-brand-400/40 bg-brand-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-brand-200">
                            <Sparkles className="h-2.5 w-2.5" />
                            Prossimo da Bancare
                          </span>
                        )}
                        {step.skipped && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                            <XCircle className="h-3 w-3 text-rose-400" />
                            Non necessaria (chiusa allo Step {selectedEval.lostAtIndex + 1})
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-slate-400">
                          {tm.date} <strong className="text-brand-300">{tm.time}</strong>
                          {step.gapMinutesFromPrev !== null && (
                            <span className="ml-1.5 text-emerald-400">
                              (+{formatGap(step.gapMinutesFromPrev)})
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px]">
                        <BookmakerIcon
                          sourceId={step.leg.exchangeId}
                          size={18}
                          className="rounded-[4px]"
                        />
                        <span className="font-medium text-slate-300">{step.leg.exchangeName}</span>
                      </div>
                    </div>

                    {/* Event + Selection */}
                    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-white">{step.leg.eventName}</div>
                        <div className="text-[11px] text-slate-400">
                          {step.leg.marketLabel} •{' '}
                          <strong className="text-brand-200">{step.leg.selectionLabel}</strong>
                        </div>
                      </div>

                      {hasLiveLayDiff && liveMatch && (
                        <button
                          type="button"
                          onClick={() =>
                            handleLegFieldChange(step.leg.id, {
                              layOdds: liveMatch.layOdds,
                              liquidity: liveMatch.liquidity,
                            })
                          }
                          className="flex items-center gap-1 rounded-lg border border-amber-400/45 bg-amber-500/15 px-2 py-1 font-mono text-[10px] font-bold text-amber-200 transition hover:bg-amber-400 hover:text-slate-950"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Live ora @{formatOdds(liveMatch.layOdds)} (Applica)
                        </button>
                      )}
                    </div>

                    {!step.skipped && (
                      <>
                        {/* Progressive Editable Odds & Lay Stake Grid */}
                        <div className="mt-2.5 grid grid-cols-1 gap-2 md:grid-cols-12">
                          {/* Back Odds */}
                          <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 p-2 md:col-span-3">
                            <div className="flex items-center justify-between text-[10px] text-blue-300">
                              <span>Quota Punta</span>
                              {backChanged && (
                                <span className="font-mono text-[9px] text-slate-400">
                                  era {formatOdds(step.leg.initialBackOdds)}
                                </span>
                              )}
                            </div>
                            <NumericInput
                              data-testid={`saved-step-${step.legIndex}-back`}
                              min={1.01}
                              value={step.leg.backOdds}
                              onChange={(v) =>
                                handleLegFieldChange(step.leg.id, { backOdds: v })
                              }
                              className="mt-1 w-full rounded border border-blue-500/30 bg-slate-950/90 px-2 py-1 font-mono text-xs font-bold text-blue-100 focus:border-blue-400 focus:outline-none"
                            />
                          </div>

                          {/* Lay Odds with quick steppers */}
                          <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-2 md:col-span-4">
                            <div className="flex items-center justify-between text-[10px] text-rose-300">
                              <span>Quota Banca (Exch)</span>
                              {layChanged && (
                                <span className="font-mono text-[9px] text-amber-300">
                                  era {formatOdds(step.leg.initialLayOdds)}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-1">
                              <button
                                type="button"
                                aria-label="Riduci quota banca"
                                onClick={() =>
                                  handleLegFieldChange(step.leg.id, {
                                    layOdds: Math.max(
                                      1.01,
                                      Math.round((step.leg.layOdds - 0.02) * 100) / 100
                                    ),
                                  })
                                }
                                className="flex h-7 w-6 shrink-0 items-center justify-center rounded border border-rose-500/30 bg-slate-950/80 text-rose-300 hover:bg-rose-500/20"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <NumericInput
                                data-testid={`saved-step-${step.legIndex}-lay`}
                                min={1.01}
                                value={step.leg.layOdds}
                                onChange={(v) =>
                                  handleLegFieldChange(step.leg.id, { layOdds: v })
                                }
                                className="w-full rounded border border-rose-500/30 bg-slate-950/90 px-2 py-1 text-center font-mono text-xs font-extrabold text-rose-100 focus:border-rose-400 focus:outline-none"
                              />
                              <button
                                type="button"
                                aria-label="Aumenta quota banca"
                                onClick={() =>
                                  handleLegFieldChange(step.leg.id, {
                                    layOdds: Math.round((step.leg.layOdds + 0.02) * 100) / 100,
                                  })
                                }
                                className="flex h-7 w-6 shrink-0 items-center justify-center rounded border border-rose-500/30 bg-slate-950/80 text-rose-300 hover:bg-rose-500/20"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </div>

                          {/* Recalculated / Locked Lay Stake */}
                          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/90 px-2.5 py-2 md:col-span-5">
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="text-[10px] text-slate-400">
                                {step.isLocked
                                  ? 'Bancata Piazzata (€)'
                                  : `Da Bancare @${formatOdds(step.leg.layOdds)}`}
                              </div>
                              {step.isLocked ? (
                                <NumericInput
                                  data-testid={`saved-step-${step.legIndex}-locked-stake`}
                                  min={0}
                                  value={step.layStake}
                                  onChange={(v) =>
                                    handleLegFieldChange(step.leg.id, { lockedLayStake: v })
                                  }
                                  className="mt-0.5 w-28 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-sm font-extrabold text-white focus:border-brand-400 focus:outline-none"
                                />
                              ) : (
                                <div
                                  data-testid={`saved-step-${step.legIndex}-lay-stake`}
                                  className="font-mono text-base font-extrabold text-white"
                                >
                                  {formatEuro(step.layStake)}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => void copyLayStake(copyId, step.layStake)}
                              className="flex shrink-0 items-center gap-1 rounded-lg border border-brand-400/35 bg-brand-500/15 px-2.5 py-1.5 text-[10px] font-bold text-brand-200 transition hover:bg-brand-400 hover:text-slate-950"
                            >
                              {copiedKey === copyId ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              {copiedKey === copyId ? 'OK' : 'Copia'}
                            </button>
                          </div>
                        </div>

                        {/* Status Controls + Accounting Telemetry */}
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
                          <div className="flex flex-wrap items-center gap-1">
                            {STATUS_ACTIONS.map((act) => {
                              const isActive = step.leg.status === act.id;
                              return (
                                <button
                                  key={act.id}
                                  type="button"
                                  data-testid={`saved-step-${step.legIndex}-status-${act.id}`}
                                  onClick={() =>
                                    handleSetLegStatus(
                                      step.leg.id,
                                      act.id,
                                      step.recommendedLayStake
                                    )
                                  }
                                  className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition ${
                                    isActive
                                      ? act.activeCls
                                      : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                                  }`}
                                >
                                  {act.id === 'won_bookie' && isActive && (
                                    <CheckCircle2 className="mr-1 inline h-3 w-3" />
                                  )}
                                  {act.label}
                                </button>
                              );
                            })}
                          </div>

                          <div className="flex items-center gap-3 font-mono text-[10px] text-slate-400">
                            <span>
                              Comm:{' '}
                              <strong className="text-slate-200">
                                {(step.leg.commission * 100).toFixed(1)}%
                              </strong>
                            </span>
                            <span>
                              Resp:{' '}
                              <strong className="text-rose-300">{formatEuro(step.liability)}</strong>
                            </span>
                            <span>
                              Se perde qui:{' '}
                              <strong
                                className={
                                  step.profitIfLostHere >= -0.005
                                    ? 'text-emerald-400'
                                    : 'text-rose-400'
                                }
                              >
                                {formatEuro(step.profitIfLostHere, true)}
                              </strong>
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {/* Balanced Scenario Matrix */}
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-2.5 text-[11px] text-slate-300">
                <div className="mb-1 flex items-center gap-1.5 font-semibold text-emerald-300">
                  <Clock className="h-3.5 w-3.5" />
                  Matrice Esiti Ricalcolata in Tempo Reale:
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
                  {selectedEval.steps
                    .filter((s) => !s.skipped)
                    .map((s) => (
                      <span key={s.leg.id}>
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
                  {selectedEval.lostAtIndex === -1 && (
                    <span>
                      Tutte Vinte:{' '}
                      <strong
                        className={
                          selectedEval.profitIfAllWin >= -0.005
                            ? 'text-emerald-400'
                            : 'text-rose-300'
                        }
                      >
                        {formatEuro(selectedEval.profitIfAllWin, true)}
                      </strong>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

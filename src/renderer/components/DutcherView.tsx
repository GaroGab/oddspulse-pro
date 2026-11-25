import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Flame,
  Scale,
  Search,
  Table2,
  Zap,
} from 'lucide-react';
import type { DateRangeValue } from '../../shared/dateRange';
import { calculateDutcher } from '../../shared/math';
import type { PuntaPuntaCandidateRow } from '../../shared/puntaPuntaMatcher';
import type {
  BetMode,
  DutcherRow,
  MarketType,
  ScrapeSnapshot,
  SportKey,
  TableDensity,
  TrackedBet,
} from '../../shared/types';
import { formatEuro, formatEventTime, formatOdds, formatPct, sportLabel } from '../utils/format';
import { playCopyTick } from '../utils/sound';
import { AnimatedNumber } from './AnimatedNumber';
import { AutoScrapePausedState } from './AutoScrapePausedState';
import { BookmakerIcon } from './BookmakerIcon';
import { ConnectionAlert } from './ConnectionAlert';
import { CustomSelect } from './CustomSelect';
import { NumericInput } from './NumericInput';
import { PuntaPuntaDrawer } from './PuntaPuntaDrawer';
import { PuntaPuntaMatcher } from './PuntaPuntaMatcher';
import { SlidingPillTrack } from './SlidingPillTrack';

interface DutcherViewProps {
  snapshot: ScrapeSnapshot;
  isBrowserOnline: boolean;
  autoScrapeActive?: boolean;
  soundEnabled: boolean;
  defaultStake?: number;
  tableDensity?: TableDensity;
  defaultShowKpis?: boolean;
  onSaveTrackedBet: (bet: Omit<TrackedBet, 'id' | 'createdAt'>) => void;
  onDateRangeFilterChange?: (
    next: DateRangeValue,
    opts?: { pendingEnd?: boolean; force?: boolean }
  ) => void;
  onRetryScrape: () => void;
  onRestartAutoScrape?: () => void;
  onOpenScrapers: () => void;
}

export const DutcherView: React.FC<DutcherViewProps> = ({
  snapshot,
  isBrowserOnline,
  autoScrapeActive = true,
  soundEnabled,
  defaultStake = 100,
  tableDensity = 'comfortable',
  defaultShowKpis = true,
  onSaveTrackedBet,
  onDateRangeFilterChange,
  onRetryScrape,
  onRestartAutoScrape,
  onOpenScrapers,
}) => {
  const [subTab, setSubTab] = useState<'auto' | 'matcher'>('auto');
  const [search, setSearch] = useState('');
  const [sport, setSport] = useState<SportKey | 'ALL'>('ALL');
  const [market, setMarket] = useState<MarketType | 'ALL'>('ALL');
  const [onlySurebets, setOnlySurebets] = useState(false);
  const [stake, setStake] = useState(defaultStake);
  const [anchorMode, setAnchorMode] = useState<'total' | 'leg0_normal' | 'leg0_snr'>('total');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Punta-Punta Oddsmatcher sub-section state
  const [matcherMode, setMatcherMode] = useState<BetMode>('normal');
  const [matcherAnchorMode, setMatcherAnchorMode] = useState<'leg0' | 'total'>('leg0');
  const [matcherRefundAmount, setMatcherRefundAmount] = useState<number>(defaultStake);
  const [matcherRefundRetention, setMatcherRefundRetention] = useState<number>(70);
  const [showMatcherKpis, setShowMatcherKpis] = useState<boolean>(defaultShowKpis);
  const [selectedMatcherRow, setSelectedMatcherRow] = useState<PuntaPuntaCandidateRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.dutcherRows.filter((d) => {
      if (sport !== 'ALL' && d.sport !== sport) return false;
      if (market !== 'ALL' && d.marketType !== market) return false;
      if (onlySurebets && !d.isSurebet) return false;
      if (q) {
        const hay = `${d.eventName} ${d.league} ${d.legs.map((l) => l.bookmakerName).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [snapshot.dutcherRows, search, sport, market, onlySurebets]);

  const surebetsCount = useMemo(
    () => snapshot.dutcherRows.filter((d) => d.isSurebet).length,
    [snapshot.dutcherRows]
  );

  const handleCopy = async (id: string, val: number) => {
    try {
      await navigator.clipboard.writeText(val.toFixed(2));
      setCopiedId(id);
      if (soundEnabled) playCopyTick();
      setTimeout(() => setCopiedId(null), 1300);
    } catch {
      // Ignore
    }
  };

  const handleSave = (row: DutcherRow) => {
    const calc = calculateDutcher({ row, stake, anchorMode });
    onSaveTrackedBet({
      eventName: row.eventName,
      league: row.league,
      sport: row.sport,
      marketLabel: row.marketLabel,
      selectionLabel: row.legs.map((l) => `${l.selectionLabel} @${l.odds}`).join(' | '),
      type: 'dutcher',
      mode: anchorMode === 'leg0_snr' ? 'snr' : 'normal',
      bookmakerName: row.legs[0].bookmakerName,
      exchangeName: row.legs.slice(1).map((l) => l.bookmakerName).join(' + '),
      stake: calc.totalOutlay,
      backOdds: row.legs[0].odds,
      layOdds: row.legs[1]?.odds ?? 1,
      layStake: calc.stakes[1] ?? 0,
      liability: calc.totalOutlay,
      commission: 0,
      expectedProfit: calc.guaranteedProfit,
      rating: calc.rating,
      status: 'pending',
      realizedProfit: calc.guaranteedProfit,
      notes: `Dutcher ${row.legs.length}-way`,
    });
    setSavedIds((prev) => new Set(prev).add(row.id));
    if (soundEnabled) playCopyTick();
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {/* Top Header + Subtab Switcher */}
      <div className="glass-panel flex flex-col gap-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-300 to-accent-400 text-slate-950 shadow-glow">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-base font-bold text-white">
                {subTab === 'auto'
                  ? 'Dutcher & Surebet Scanner (Bookmaker vs Bookmaker)'
                  : 'Oddsmatcher Punta-Punta (Confronto Manuale Bookmaker)'}
              </h1>
              <p className="text-[11px] text-slate-400">
                {subTab === 'auto'
                  ? 'Copertura a 2 o 3 esiti senza Exchange confrontando in tempo reale le quote migliori tra tutti i bookmaker.'
                  : 'Confronta manualmente qualsiasi bookmaker Punta 1 con le coperture migliori usando tutti i filtri e le modalità dell\'Oddsmatcher.'}
              </p>
            </div>
          </div>

          <SlidingPillTrack
            activeKey={subTab}
            pillClassName="rounded-lg bg-brand-500 shadow-[0_0_14px_rgba(245,158,11,0.35)]"
            className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/90 p-1"
          >
            <button
              type="button"
              data-pill-key="auto"
              data-testid="dutcher-subtab-auto"
              onClick={() => setSubTab('auto')}
              className={`relative z-10 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                subTab === 'auto' ? 'font-bold text-slate-950' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              Scanner Automatico
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                  subTab === 'auto'
                    ? 'bg-slate-950/20 text-slate-950'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                {snapshot.dutcherRows.length}
              </span>
            </button>
            <button
              type="button"
              data-pill-key="matcher"
              data-testid="dutcher-subtab-matcher"
              onClick={() => setSubTab('matcher')}
              className={`relative z-10 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                subTab === 'matcher' ? 'font-bold text-slate-950' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              Oddsmatcher Punta-Punta
            </button>
          </SlidingPillTrack>
        </div>

        {subTab === 'auto' && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
            <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setOnlySurebets((v) => !v)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
              onlySurebets
                ? 'surebet-badge text-brand-100'
                : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
            }`}
          >
            <Flame className="h-3.5 w-3.5" />
            Surebet ({surebetsCount})
          </button>

          <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-xs">
            <span className="text-slate-400">
              {anchorMode === 'total' ? 'Budget Totale €' : 'Puntata Esito 1 €'}
            </span>
            <NumericInput
              min={1}
              value={stake}
              onChange={setStake}
              placeholder="100"
              className="w-16 bg-transparent font-mono font-bold text-brand-200 focus:outline-none"
            />
          </div>

          <CustomSelect<'total' | 'leg0_normal' | 'leg0_snr'>
            data-testid="dutcher-anchor-select"
            className="w-52"
            value={anchorMode}
            minMenuWidth={210}
            onChange={setAnchorMode}
            triggerClassName="rounded-xl"
            options={[
              { value: 'total', label: 'Distribuisci Budget Totale' },
              { value: 'leg0_normal', label: 'Puntata Fissa su Esito 1' },
              { value: 'leg0_snr', label: 'Freebet SNR su Esito 1' },
            ]}
          />
            </div>
          </div>
        )}
      </div>

      {subTab === 'auto' ? (
        <>
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SlidingPillTrack
            activeKey={sport}
            pillClassName="rounded-lg bg-slate-800 shadow-inner"
            className="flex rounded-xl border border-slate-800 bg-slate-950/70 p-0.5"
          >
            {(
              [
                { id: 'ALL', label: 'Tutti' },
                { id: 'football', label: 'Calcio' },
                { id: 'tennis', label: 'Tennis' },
                { id: 'basketball', label: 'Basket' },
              ] as Array<{ id: SportKey | 'ALL'; label: string }>
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                data-pill-key={s.id}
                onClick={() => setSport(s.id)}
                className={`relative z-10 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  sport === s.id ? 'text-brand-300' : 'text-slate-400 hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </SlidingPillTrack>

          <CustomSelect<MarketType | 'ALL'>
            data-testid="dutcher-market-select"
            className="w-48"
            value={market}
            minMenuWidth={210}
            onChange={setMarket}
            triggerClassName="rounded-xl"
            options={[
              { value: 'ALL', label: 'Tutti i mercati' },
              { value: '1X2', label: 'Esito Finale 1X2 (3-way)' },
              { value: 'OVER_UNDER_25', label: 'Under/Over 2.5 (2-way)' },
              { value: 'BTTS', label: 'Goal/NoGoal (2-way)' },
              { value: 'H2H', label: 'Testa a Testa (2-way)' },
            ]}
          />
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca evento o bookmaker..."
            className="w-60 rounded-xl border border-slate-800 bg-slate-950/80 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-brand-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Dutcher Cards */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
        {snapshot.dutcherRows.length === 0 &&
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
        ) : snapshot.dutcherRows.length === 0 && !autoScrapeActive && !snapshot.stats.isRunning ? (
          <div className="glass-panel h-full rounded-2xl">
            <AutoScrapePausedState
              description="Riavvia l'aggiornamento automatico o esegui una scansione manuale per calcolare gli abbinamenti Dutcher."
              onRetryScrape={onRetryScrape}
              onRestartAutoScrape={onRestartAutoScrape}
            />
          </div>
        ) : filtered.slice(0, 60).map((row, idx) => {
          const calc = calculateDutcher({ row, stake, anchorMode });
          const isExpanded = expandedId === row.id || (expandedId === null && idx === 0);
          const tm = formatEventTime(row.startTime);
          const isSaved = savedIds.has(row.id);

          return (
            <motion.div
              key={row.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx * 0.02, 0.2) }}
              className={`glass-card overflow-hidden rounded-2xl border transition ${
                row.isSurebet
                  ? 'border-brand-400/45 shadow-[0_0_24px_-10px_rgb(var(--brand-400)/0.35)]'
                  : 'border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div
                onClick={() => setExpandedId(isExpanded ? '__none__' : row.id)}
                className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    className={`flex h-11 min-w-[74px] shrink-0 flex-col items-center justify-center rounded-xl border px-2 font-mono ${
                      row.isSurebet
                        ? 'surebet-badge text-brand-100'
                        : row.rating >= 97
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-700 bg-slate-900 text-amber-300'
                    }`}
                  >
                    <span className="text-sm font-extrabold">{formatPct(calc.rating)}</span>
                    <span className="text-[9px] uppercase opacity-75">
                      {row.isSurebet ? 'SUREBET' : `${row.legs.length}-WAY`}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{row.eventName}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-300">
                        {sportLabel(row.sport)}
                      </span>
                      <span className="text-[11px] text-slate-400">{row.league}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-mono text-brand-300">
                        {tm.date} {tm.time}
                      </span>
                      <span className="text-slate-600">•</span>
                      <span className="text-slate-300">{row.marketLabel}</span>
                      <span className="text-slate-600">•</span>
                      {row.legs.map((l) => (
                        <span
                          key={l.selectionKey}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950/80 px-2 py-0.5 font-mono text-[10px]"
                        >
                          <BookmakerIcon sourceId={l.bookmakerId} size={18} />
                          <span className="text-slate-300">{l.selectionLabel}:</span>{' '}
                          <strong className="text-brand-200">@{formatOdds(l.odds)}</strong>{' '}
                          <span style={{ color: l.bookmakerColor }}>({l.bookmakerName})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  <div className="text-right">
                    <div className="text-[10px] uppercase text-slate-500">Profitto Garantito</div>
                    <AnimatedNumber
                      value={calc.guaranteedProfit}
                      formatter={(v) => formatEuro(v, true)}
                      className={`font-mono text-sm font-extrabold ${
                        calc.guaranteedProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    />
                  </div>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400">
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="border-t border-slate-800/80 bg-black/35 p-4"
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      {row.legs.map((leg, i) => {
                        const cid = `${row.id}_${i}`;
                        return (
                          <div
                            key={leg.selectionKey}
                            className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold text-white"
                                style={{
                                  backgroundColor: `${leg.bookmakerColor}28`,
                                  border: `1px solid ${leg.bookmakerColor}66`,
                                }}
                              >
                                <BookmakerIcon sourceId={leg.bookmakerId} size={22} className="rounded-[5px]" />
                                {leg.bookmakerName}
                              </span>
                              <span className="font-mono text-sm font-extrabold text-brand-300">
                                @{formatOdds(leg.odds)}
                              </span>
                            </div>

                            <div className="mt-2 text-xs font-semibold text-white">
                              {leg.selectionLabel}
                            </div>

                            <div className="mt-2.5 flex items-center justify-between rounded-lg bg-slate-950/80 px-2.5 py-2">
                              <div>
                                <div className="text-[10px] text-slate-500">
                                  {anchorMode === 'leg0_snr' && i === 0
                                    ? 'Freebet SNR'
                                    : 'Puntata Esatta'}
                                </div>
                                <div className="font-mono text-base font-extrabold text-white">
                                  {formatEuro(calc.stakes[i])}
                                </div>
                              </div>
                              <button
                                onClick={() => void handleCopy(cid, calc.stakes[i])}
                                className="flex items-center gap-1 rounded-lg border border-brand-400/35 bg-brand-500/15 px-2 py-1 text-[10px] font-bold text-brand-200 hover:bg-brand-400 hover:text-slate-950"
                              >
                                {copiedId === cid ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                                {copiedId === cid ? 'OK' : 'Copia'}
                              </button>
                            </div>

                            <div className="mt-2 flex justify-between text-[11px] text-slate-400">
                              <span>Vincita: {formatEuro(calc.returns[i])}</span>
                              <span
                                className={`font-mono font-bold ${
                                  calc.profits[i] >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {formatEuro(calc.profits[i], true)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-800/60 pt-3 text-xs">
                      <span className="text-slate-400">
                        Esborso reale totale:{' '}
                        <strong className="font-mono text-white">{formatEuro(calc.totalOutlay)}</strong> •
                        Lavagna (Overround):{' '}
                        <strong className="font-mono text-brand-300">
                          {(row.impliedProbSum * 100).toFixed(2)}%
                        </strong>
                      </span>
                      <button
                        onClick={() => handleSave(row)}
                        disabled={isSaved}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                          isSaved
                            ? 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                            : 'bg-gradient-to-r from-brand-300 to-accent-400 text-slate-950 hover:brightness-110'
                        }`}
                      >
                        {isSaved ? <Check className="h-3.5 w-3.5" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
                        {isSaved ? 'Salvato nel Tracker' : 'Salva nel Tracker'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <PuntaPuntaMatcher
            snapshot={snapshot}
            isBrowserOnline={isBrowserOnline}
            autoScrapeActive={autoScrapeActive}
            mode={matcherMode}
            stake={stake}
            anchorMode={matcherAnchorMode}
            refundAmount={matcherRefundAmount}
            refundRetention={matcherRefundRetention}
            tableDensity={tableDensity}
            showKpis={showMatcherKpis}
            onChangeMode={setMatcherMode}
            onChangeStake={setStake}
            onChangeAnchorMode={setMatcherAnchorMode}
            onChangeRefundAmount={setMatcherRefundAmount}
            onChangeRefundRetention={setMatcherRefundRetention}
            onSelectRow={setSelectedMatcherRow}
            onToggleKpis={() => setShowMatcherKpis((v) => !v)}
            onDateRangeFilterChange={onDateRangeFilterChange}
            onRetryScrape={onRetryScrape}
            onRestartAutoScrape={onRestartAutoScrape}
            onOpenScrapers={onOpenScrapers}
          />
        </div>
      )}

      <PuntaPuntaDrawer
        row={selectedMatcherRow}
        initialMode={matcherMode}
        initialStake={stake}
        initialAnchorMode={matcherAnchorMode}
        initialRefundAmount={matcherRefundAmount}
        initialRefundRetention={matcherRefundRetention}
        soundEnabled={soundEnabled}
        dutcherRows={snapshot.dutcherRows}
        onClose={() => setSelectedMatcherRow(null)}
        onSaveTrackedBet={onSaveTrackedBet}
      />
    </div>
  );
};

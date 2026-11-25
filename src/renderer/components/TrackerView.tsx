import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, CheckCircle2, Clock, Trash2, TrendingUp, Wallet } from 'lucide-react';
import { THEME_CATALOG, type ThemeId, type TrackedBet } from '../../shared/types';
import { betModeLabelIt } from '../../shared/ratingWatch';
import { formatEuro, formatOdds, formatPct } from '../utils/format';
import { AnimatedNumber } from './AnimatedNumber';
import { CustomSelect } from './CustomSelect';

interface TrackerViewProps {
  bets: TrackedBet[];
  theme: ThemeId;
  onUpdateStatus: (id: string, status: TrackedBet['status'], realizedProfit: number) => void;
  onDelete: (id: string) => void;
}

export const TrackerView: React.FC<TrackerViewProps> = ({
  bets,
  theme,
  onUpdateStatus,
  onDelete,
}) => {
  const themeMeta = THEME_CATALOG.find((t) => t.id === theme) ?? THEME_CATALOG[0];
  const stats = useMemo(() => {
    let realized = 0;
    let pendingExpected = 0;
    let totalStake = 0;
    let ratingSum = 0;

    for (const b of bets) {
      totalStake += b.stake;
      ratingSum += b.rating;
      if (b.status === 'pending') pendingExpected += b.expectedProfit;
      else realized += b.realizedProfit;
    }

    return {
      realized,
      pendingExpected,
      totalStake,
      avgRating: bets.length > 0 ? ratingSum / bets.length : 0,
      count: bets.length,
    };
  }, [bets]);

  const equityCurve = useMemo(() => {
    const chrono = [...bets].reverse();
    let cum = 0;
    return chrono.map((b, i) => {
      cum += b.status === 'pending' ? b.expectedProfit : b.realizedProfit;
      return {
        idx: `#${i + 1}`,
        label: b.eventName.slice(0, 18),
        profitto: Math.round(cum * 100) / 100,
      };
    });
  }, [bets]);

  const byBookmaker = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of bets) {
      const val = b.status === 'pending' ? b.expectedProfit : b.realizedProfit;
      map.set(b.bookmakerName, (map.get(b.bookmakerName) ?? 0) + val);
    }
    return Array.from(map.entries()).map(([name, profitto]) => ({
      name,
      profitto: Math.round(profitto * 100) / 100,
    }));
  }, [bets]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-4"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Profitto Realizzato</span>
            <Wallet className="h-4 w-4 text-emerald-400" />
          </div>
          <AnimatedNumber
            value={stats.realized}
            formatter={(v) => formatEuro(v, true)}
            className={`mt-1.5 block font-display text-2xl font-extrabold ${
              stats.realized >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card rounded-2xl p-4"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>In Corso (Atteso)</span>
            <Clock className="h-4 w-4 text-brand-400" />
          </div>
          <AnimatedNumber
            value={stats.pendingExpected}
            formatter={(v) => formatEuro(v, true)}
            className="mt-1.5 block font-display text-2xl font-extrabold text-brand-300"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card rounded-2xl p-4"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Rating Medio</span>
            <TrendingUp className="h-4 w-4 text-accent-400" />
          </div>
          <AnimatedNumber
            value={stats.avgRating}
            formatter={(v) => formatPct(v)}
            className="mt-1.5 block font-display text-2xl font-extrabold text-white"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="glass-card rounded-2xl p-4"
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Operazioni Salvate</span>
            <BarChart3 className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="font-display text-2xl font-extrabold text-white">{stats.count}</span>
            <span className="font-mono text-xs text-slate-400">
              Vol: {formatEuro(stats.totalStake)}
            </span>
          </div>
        </motion.div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="glass-panel rounded-2xl p-4 lg:col-span-7">
          <h3 className="mb-3 font-display text-sm font-bold text-white">
            Curva Profitto Cumulativo (€)
          </h3>
          <div className="h-52 w-full">
            {equityCurve.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                Salva le tue giocate dall&apos;Oddsmatcher, Multiodds o Dutcher per visualizzare la curva profitti.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityCurve}>
                  <defs>
                    <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={themeMeta.primaryHex} stopOpacity={0.48} />
                      <stop offset="95%" stopColor={themeMeta.primaryHex} stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                  <XAxis dataKey="idx" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: themeMeta.bgHex,
                      border: `1px solid ${themeMeta.primaryHex}66`,
                      borderRadius: '12px',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="profitto"
                    stroke={themeMeta.primaryHex}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#profitGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-4 lg:col-span-5">
          <h3 className="mb-3 font-display text-sm font-bold text-white">
            Profitto per Bookmaker (€)
          </h3>
          <div className="h-52 w-full">
            {byBookmaker.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                Nessun dato bookmaker ancora registrato.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byBookmaker}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: themeMeta.bgHex,
                      border: `1px solid ${themeMeta.secondaryHex}66`,
                      borderRadius: '12px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="profitto" fill={themeMeta.secondaryHex} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Operations Ledger */}
      <div className="glass-panel flex-1 overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3">
          <h3 className="font-display text-sm font-bold text-white">
            Registro Operazioni Matched Betting
          </h3>
          <span className="text-xs text-slate-400">
            Salvato automaticamente in locale su disco
          </span>
        </div>

        {bets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
            <CheckCircle2 className="h-8 w-8 text-slate-600" />
            <div className="text-sm font-semibold text-slate-300">Nessuna operazione registrata</div>
            <p className="text-xs text-slate-500">
              Apri il Calcolatore su qualsiasi riga dell&apos;Oddsmatcher e clicca &quot;Salva nel Tracker&quot;.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-950/70 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Data</th>
                  <th className="px-4 py-2.5">Tipo / Modalità</th>
                  <th className="px-4 py-2.5">Evento & Selezione</th>
                  <th className="px-4 py-2.5">Book vs Exch</th>
                  <th className="px-4 py-2.5 text-right">Puntata / Banca</th>
                  <th className="px-4 py-2.5 text-right">Esito (€)</th>
                  <th className="px-4 py-2.5">Stato</th>
                  <th className="px-4 py-2.5 text-right">Elimina</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {bets.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-800/30">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-slate-400">
                      {new Date(b.createdAt).toLocaleDateString('it-IT', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <span className="rounded bg-accent-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent-200">
                        {b.type}
                      </span>{' '}
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                        {betModeLabelIt(b.mode)}
                      </span>
                    </td>
                    <td className="max-w-[260px] px-4 py-2.5">
                      <div className="truncate font-semibold text-white">{b.eventName}</div>
                      <div className="truncate text-[10px] text-brand-300">{b.selectionLabel}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-slate-300">
                      {b.bookmakerName} @{formatOdds(b.backOdds)} / {b.exchangeName} @{formatOdds(b.layOdds)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-[11px]">
                      <div className="text-white">{formatEuro(b.stake)}</div>
                      <div className="text-slate-400">Banca: {formatEuro(b.layStake)}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono font-bold">
                      <span
                        className={
                          b.realizedProfit >= -0.005 ? 'text-emerald-400' : 'text-rose-400'
                        }
                      >
                        {formatEuro(b.realizedProfit, true)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <CustomSelect<TrackedBet['status']>
                        size="sm"
                        className="w-36"
                        minMenuWidth={170}
                        value={b.status}
                        onChange={(val) => onUpdateStatus(b.id, val, b.expectedProfit)}
                        options={[
                          { value: 'pending', label: 'In Corso', dotColor: 'bg-amber-400' },
                          { value: 'won_bookie', label: 'Vinta Bookmaker', dotColor: 'bg-emerald-400' },
                          { value: 'won_exchange', label: 'Vinta Exchange', dotColor: 'bg-sky-400' },
                          { value: 'refunded', label: 'Rimborsata', dotColor: 'bg-violet-400' },
                        ]}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <button
                        onClick={() => onDelete(b.id)}
                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-300"
                        title="Elimina operazione"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

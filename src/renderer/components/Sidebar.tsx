import React from 'react';
import {
  BarChart3,
  BellRing,
  Calculator,
  ChevronLeft,
  Gift,
  Layers,
  Radar,
  Scale,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import type { ScrapeSnapshot, TrackedBet } from '../../shared/types';
import { formatEuro } from '../utils/format';

export type NavTab =
  | 'oddsmatcher'
  | 'multiodds'
  | 'dutcher'
  | 'calculator'
  | 'bonuses'
  | 'watches'
  | 'scrapers'
  | 'tracker'
  | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  compact: boolean;
  onToggleCompact: () => void;
  onSelectTab: (tab: NavTab) => void;
  snapshot: ScrapeSnapshot;
  trackedBets: TrackedBet[];
  lockedMultiCount: number;
  activeWatchesCount?: number;
  activeAlertsCount?: number;
  welcomeBonusesCompleted?: number;
  welcomeBonusesTotal?: number;
}

const SIDEBAR_OPEN_WIDTH = 244;
const SIDEBAR_COMPACT_WIDTH = 80;
const NAV_ITEM_HEIGHT = 46;
const NAV_ITEM_GAP = 4;
const NAV_ITEM_STEP = NAV_ITEM_HEIGHT + NAV_ITEM_GAP;

export const Sidebar: React.FC<SidebarProps> = React.memo(
  ({
    activeTab,
    compact,
    onToggleCompact,
    onSelectTab,
    snapshot,
    trackedBets,
    lockedMultiCount,
    activeWatchesCount = 0,
    activeAlertsCount = 0,
    welcomeBonusesCompleted = 0,
    welcomeBonusesTotal = 0,
  }) => {
    const totalProfit = trackedBets.reduce(
      (sum, b) => sum + (b.status === 'pending' ? 0 : b.realizedProfit),
      0
    );
    const okSources = snapshot.sources.filter((s) => s.state === 'ok').length;
    const enabledSources = snapshot.sources.filter((s) => s.enabled).length;
    const failedSources = snapshot.sources.filter((s) => s.enabled && s.state === 'error').length;
    const dutcherSurebets = snapshot.dutcherRows.filter((d) => d.isSurebet).length;

    const items: Array<{
      id: NavTab;
      label: string;
      subtitle: string;
      icon: React.ReactNode;
      badge?: React.ReactNode;
      badgeText?: string;
      dotColor?: string;
    }> = [
      {
        id: 'oddsmatcher',
        label: 'Oddsmatcher',
        subtitle: 'Punta & Banca Live',
        icon: <SlidersHorizontal className="h-4 w-4" />,
        badgeText: snapshot.rows.length > 0 ? String(snapshot.rows.length) : undefined,
        badge:
          snapshot.rows.length > 0 ? (
            <span className="rounded-md bg-brand-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-300">
              {snapshot.rows.length}
            </span>
          ) : undefined,
      },
      {
        id: 'multiodds',
        label: 'Multiodds',
        subtitle: 'Multiple & Sequenziale',
        icon: <Layers className="h-4 w-4" />,
        badgeText: lockedMultiCount > 0 ? `${lockedMultiCount} LOCK` : 'AUTO',
        dotColor: lockedMultiCount > 0 ? 'bg-accent-400' : undefined,
        badge:
          lockedMultiCount > 0 ? (
            <span className="rounded-md bg-accent-500/25 px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent-200 border border-accent-400/40">
              {lockedMultiCount} LOCK
            </span>
          ) : (
            <span className="rounded-md bg-accent-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent-300">
              AUTO
            </span>
          ),
      },
      {
        id: 'dutcher',
        label: 'Dutcher & Arbs',
        subtitle: 'Bookie vs Bookie',
        icon: <Scale className="h-4 w-4" />,
        badgeText:
          dutcherSurebets > 0
            ? `${dutcherSurebets} ARB`
            : snapshot.dutcherRows.length > 0
            ? String(snapshot.dutcherRows.length)
            : undefined,
        dotColor: dutcherSurebets > 0 ? 'bg-emerald-400' : undefined,
        badge:
          dutcherSurebets > 0 ? (
            <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
              {dutcherSurebets} ARB
            </span>
          ) : snapshot.dutcherRows.length > 0 ? (
            <span className="rounded-md bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              {snapshot.dutcherRows.length}
            </span>
          ) : undefined,
      },
      {
        id: 'calculator',
        label: 'Calcolatore',
        subtitle: 'Banca & Punta-Punta',
        icon: <Calculator className="h-4 w-4" />,
        badgeText: 'PRO',
        badge: (
          <span className="rounded-md bg-brand-400/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-300">
            PRO
          </span>
        ),
      },
      {
        id: 'bonuses',
        label: 'Bonus Benvenuto',
        subtitle: 'Guide & Simulatore',
        icon: <Gift className="h-4 w-4" />,
        badgeText:
          welcomeBonusesTotal > 0
            ? `${welcomeBonusesCompleted}/${welcomeBonusesTotal}`
            : undefined,
        dotColor:
          welcomeBonusesTotal > 0 && welcomeBonusesCompleted === welcomeBonusesTotal
            ? 'bg-emerald-400'
            : 'bg-brand-400',
        badge:
          welcomeBonusesTotal > 0 ? (
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                welcomeBonusesCompleted === welcomeBonusesTotal
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-brand-400/15 text-brand-300'
              }`}
            >
              {welcomeBonusesCompleted}/{welcomeBonusesTotal}
            </span>
          ) : undefined,
      },
      {
        id: 'watches',
        label: 'Radar Rating',
        subtitle: 'Alert & Monitoraggio',
        icon: <BellRing className="h-4 w-4" />,
        badgeText:
          activeAlertsCount > 0
            ? `${activeAlertsCount} HIT`
            : activeWatchesCount > 0
            ? `${activeWatchesCount} ON`
            : undefined,
        dotColor:
          activeAlertsCount > 0
            ? 'bg-rose-400'
            : activeWatchesCount > 0
            ? 'bg-emerald-400'
            : undefined,
        badge:
          activeAlertsCount > 0 ? (
            <span className="animate-pulse rounded-md border border-rose-400/50 bg-rose-500/25 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-200">
              {activeAlertsCount} HIT
            </span>
          ) : activeWatchesCount > 0 ? (
            <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
              {activeWatchesCount} ON
            </span>
          ) : undefined,
      },
      {
        id: 'scrapers',
        label: 'Motore Scraping',
        subtitle: 'Fonti & Telemetria',
        icon: <Radar className="h-4 w-4" />,
        badgeText: `${okSources}/${enabledSources}`,
        dotColor: failedSources > 0 ? 'bg-rose-400' : okSources > 0 ? 'bg-emerald-400' : undefined,
        badge: (
          <span
            className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
              failedSources > 0 && okSources === 0
                ? 'bg-rose-500/20 text-rose-300'
                : okSources > 0
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-amber-500/15 text-amber-300'
            }`}
          >
            {okSources}/{enabledSources}
          </span>
        ),
      },
      {
        id: 'tracker',
        label: 'Tracker Profitti',
        subtitle: 'Storico & Analytics',
        icon: <BarChart3 className="h-4 w-4" />,
        badgeText: trackedBets.length > 0 ? formatEuro(totalProfit, true) : undefined,
        badge:
          trackedBets.length > 0 ? (
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                totalProfit >= 0
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-rose-500/15 text-rose-300'
              }`}
            >
              {formatEuro(totalProfit, true)}
            </span>
          ) : undefined,
      },
      {
        id: 'settings',
        label: 'Impostazioni',
        subtitle: 'Schermata & Layout',
        icon: <Settings className="h-4 w-4" />,
      },
    ];

    const exchangeSources = snapshot.sources.filter((s) => s.kind === 'exchange');
    const activeIndex = Math.max(
      0,
      items.findIndex((item) => item.id === activeTab)
    );

    return (
      <aside
        style={{ width: compact ? SIDEBAR_COMPACT_WIDTH : SIDEBAR_OPEN_WIDTH }}
        className="sidebar-rail relative z-40 flex shrink-0 flex-col justify-between border-r border-slate-800/80 bg-[var(--bg-modal-solid)] py-3 pl-3 pr-[11px]"
      >
        {/* Floating Edge Collapse/Expand Handle (pure CSS transform) */}
        <button
          type="button"
          onClick={onToggleCompact}
          aria-label={compact ? 'Espandi barra laterale' : 'Riduci barra laterale'}
          data-testid="toggle-sidebar"
          title={
            compact
              ? 'Espandi barra laterale (mostra nomi sezioni)'
              : 'Riduci barra laterale (solo icone)'
          }
          className="absolute -right-3 top-4 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-brand-400/40 bg-[var(--bg-modal-solid)] text-brand-300 shadow-[0_2px_12px_rgba(0,0,0,0.65)] transition-transform duration-150 hover:scale-110 hover:border-brand-300 hover:bg-brand-500/20 hover:text-brand-100 active:scale-95"
        >
          <ChevronLeft
            className={`h-3.5 w-3.5 transition-transform duration-200 ease-out ${
              compact ? 'rotate-180' : 'rotate-0'
            }`}
          />
        </button>

        {/* Top Section Header + Navigation List */}
        <div>
          {/* Fixed-height header label that fades cleanly without layout shift */}
          <div className="mb-1 h-5 overflow-hidden px-2">
            <div
              className={`sidebar-label whitespace-nowrap pt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 ${
                compact ? '-translate-x-2 opacity-0' : 'translate-x-0 opacity-100'
              }`}
            >
              Terminale Matched Betting
            </div>
          </div>

          {/* Navigation Section Buttons + GPU-composited sliding active highlight pill */}
          <div className="relative flex flex-col gap-1">
            <div
              aria-hidden="true"
              data-testid="sidebar-active-pill"
              style={{ transform: `translate3d(0, ${activeIndex * NAV_ITEM_STEP}px, 0)` }}
              className="sidebar-active-pill pointer-events-none absolute inset-x-0 top-0 z-0 h-[46px] rounded-xl border border-brand-400/35 bg-gradient-to-r from-brand-500/20 via-brand-500/10 to-accent-500/15 shadow-[0_0_24px_-8px_rgb(var(--brand-400)/0.45)]"
            />

            {items.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  aria-label={item.label}
                  className={`group relative z-10 flex h-[46px] w-full items-center rounded-xl border border-transparent px-2.5 text-left transition-colors duration-150 hover:z-20 ${
                    isActive
                      ? 'text-white'
                      : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                  }`}
                >
                {/* Unclipped icon box + clipped flex-1 label slot */}
                <div className="relative z-10 flex w-full items-center">
                  <div
                    className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150 ${
                      isActive
                        ? 'border-brand-400/45 bg-brand-400/15 text-brand-300'
                        : 'border-slate-800 bg-slate-900/80 text-slate-400 group-hover:border-slate-700 group-hover:text-slate-200'
                    }`}
                  >
                    {item.icon}
                    {item.dotColor && (
                      <span
                        className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-[#0b090e] transition-all duration-150 ${
                          item.dotColor
                        } ${compact ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}`}
                      />
                    )}
                  </div>

                  {/* Label + Badge: clipped slot shrinks smoothly to 0px */}
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div
                      aria-hidden={compact}
                      className={`sidebar-label ml-3 flex items-center justify-between gap-2 whitespace-nowrap ${
                        compact ? '-translate-x-2 opacity-0' : 'translate-x-0 opacity-100'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold leading-tight">
                          {item.label}
                        </div>
                        <div className="truncate text-[10px] text-slate-500">{item.subtitle}</div>
                      </div>
                      {item.badge && <div className="shrink-0">{item.badge}</div>}
                    </div>
                  </div>
                </div>

                {/* Floating hover tooltip only when collapsed to icons-only */}
                {compact && (
                  <div
                    data-testid={`sidebar-tooltip-${item.id}`}
                    className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-50 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-xl border border-brand-400/40 bg-[var(--bg-modal-solid)] px-3 py-1.5 opacity-0 shadow-[0_12px_32px_rgba(0,0,0,0.85)] transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100"
                  >
                    <div>
                      <div className="text-xs font-bold text-white">{item.label}</div>
                      <div className="text-[10px] text-slate-400">{item.subtitle}</div>
                    </div>
                    {item.badgeText && (
                      <span className="rounded-md bg-brand-400/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-300">
                        {item.badgeText}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
          </div>
        </div>

        {/* Bottom Live Exchange Telemetry Card (no backdrop-blur, pure CSS transition) */}
        <div
          style={{ height: compact ? 50 : 148 }}
          className="sidebar-card-shell relative overflow-hidden rounded-xl border border-slate-800/90 bg-slate-950/75"
        >
          {/* Expanded view */}
          <div
            className={`sidebar-label absolute inset-x-0 top-0 w-[218px] p-2 ${
              compact
                ? 'pointer-events-none translate-y-1.5 opacity-0'
                : 'pointer-events-auto translate-y-0 opacity-100'
            }`}
          >
            <div className="mb-1 flex items-center justify-between px-0.5">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
                <Sparkles className="h-3.5 w-3.5 text-brand-300" />
                Exchange Live
              </span>
              {snapshot.stats.lastCycleDurationMs > 0 && (
                <span className="font-mono text-[10px] text-slate-400">
                  {(snapshot.stats.lastCycleDurationMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>

            <div className="space-y-1">
              {exchangeSources.map((ex) => (
                <div
                  key={ex.id}
                  className="flex items-center justify-between rounded-lg bg-slate-900/80 px-2.5 py-1 text-[11px]"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        ex.state === 'ok'
                          ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]'
                          : ex.state === 'error'
                          ? 'bg-rose-400 shadow-[0_0_6px_#f43f5e]'
                          : ex.state === 'scraping'
                          ? 'animate-ping bg-brand-400'
                          : 'bg-slate-600'
                      }`}
                    />
                    <span className="font-medium text-slate-300">{ex.shortName}</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">
                    {ex.marketsCount} mkt
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-1.5 flex items-center justify-between border-t border-slate-800/80 px-0.5 pt-1.5 text-[10px] text-slate-400">
              <span>Eventi collegati</span>
              <span className="font-mono font-semibold text-brand-300">
                {snapshot.stats.linkedEventsCount}
              </span>
            </div>
          </div>

          {/* Compact icons-only summary button */}
          <button
            type="button"
            onClick={() => onSelectTab('scrapers')}
            title={`Fonti attive: ${okSources}/${enabledSources} • Clicca per aprire Motore Scraping`}
            className={`sidebar-label absolute inset-0 flex flex-col items-center justify-center gap-1 transition-colors hover:bg-brand-500/10 ${
              compact
                ? 'pointer-events-auto scale-100 opacity-100'
                : 'pointer-events-none scale-90 opacity-0'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-brand-300" />
            <span
              className={`font-mono text-[10px] font-bold ${
                failedSources > 0 && okSources === 0 ? 'text-rose-400' : 'text-emerald-300'
              }`}
            >
              {okSources}/{enabledSources}
            </span>
          </button>
        </div>
      </aside>
    );
  }
);

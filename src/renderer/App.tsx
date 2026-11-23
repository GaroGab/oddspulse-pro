import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Flame, Sparkles } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  SOURCE_CATALOG,
  type AppSettings,
  type BetMode,
  type OddsmatcherRow,
  type RatingWatch,
  type RatingWatchEngineStatus,
  type RatingWatchInput,
  type RatingWatchTriggerEvent,
  type SavedMultiplePlan,
  type SavedMultiplePlanInput,
  type ScrapeSnapshot,
  type TrackedBet,
} from '../shared/types';
import { CalculatorDrawer } from './components/CalculatorDrawer';
import { CalculatorView } from './components/CalculatorView';
import { ConnectionAlert } from './components/ConnectionAlert';
import { DutcherView } from './components/DutcherView';
import { MultioddsView } from './components/MultioddsView';
import { OddsmatcherView } from './components/OddsmatcherView';
import { RatingAlertBanner } from './components/RatingAlertBanner';
import { RatingWatchView } from './components/RatingWatchView';
import { ScrapersView } from './components/ScrapersView';
import { SettingsView } from './components/SettingsView';
import { Sidebar, type NavTab } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { TrackerView } from './components/TrackerView';
import { ViewErrorBoundary } from './components/ViewErrorBoundary';
import {
  playSurebetChime,
  startPersistentRatingAlarm,
  stopPersistentRatingAlarm,
} from './utils/sound';

const INITIAL_WATCH_STATUS: RatingWatchEngineStatus = {
  activeCount: 0,
  totalCount: 0,
  expiredCount: 0,
  isPolling: false,
  intervalSec: null,
  backoffMultiplier: 1,
  effectiveBookmakerIds: [],
  effectiveExchangeIds: [],
  nextCheckAt: null,
  lastCheckAt: null,
  lastCycleDurationMs: 0,
  rateLimitReasons: [],
};

const INITIAL_SNAPSHOT: ScrapeSnapshot = {
  rows: [],
  dutcherRows: [],
  sources: SOURCE_CATALOG.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.shortName,
    kind: c.kind,
    color: c.color,
    enabled: c.enabled,
    state: c.enabled ? 'idle' : 'disabled',
    latencyMs: 0,
    eventsCount: 0,
    marketsCount: 0,
    lastScrapedAt: null,
    lastError: null,
    successCount: 0,
    errorCount: 0,
  })),
  logs: [],
  connection: {
    health: 'idle',
    isSystemOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    failedSourcesCount: 0,
    activeSourcesCount: 0,
    enabledSourcesCount: SOURCE_CATALOG.filter((c) => c.enabled).length,
    exchangesOnlineCount: 0,
    bookmakersOnlineCount: 0,
    lastErrorSummary: null,
  },
  stats: {
    totalRawMarkets: 0,
    linkedEventsCount: 0,
    totalMatchesCount: 0,
    surebetsCount: 0,
    lastCycleDurationMs: 0,
    lastCompletedAt: null,
    isRunning: true,
  },
};

interface ToastMsg {
  id: string;
  title: string;
  body: string;
  kind: 'info' | 'surebet';
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('oddsmatcher');
  const [snapshot, setSnapshot] = useState<ScrapeSnapshot>(INITIAL_SNAPSHOT);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [trackedBets, setTrackedBets] = useState<TrackedBet[]>([]);
  const [savedMultiples, setSavedMultiples] = useState<SavedMultiplePlan[]>(() => {
    try {
      const raw = localStorage.getItem('oddspulse_saved_multiples_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as SavedMultiplePlan[];
      }
    } catch {
      // Ignore storage fallback error
    }
    return [];
  });

  const [mode, setMode] = useState<BetMode>('normal');
  const [stake, setStake] = useState<number>(50);
  const [selectedRow, setSelectedRow] = useState<OddsmatcherRow | null>(null);
  const [lockedRowIds, setLockedRowIds] = useState<string[]>([]);
  const [ratingWatches, setRatingWatches] = useState<RatingWatch[]>([]);
  const [watchStatus, setWatchStatus] = useState<RatingWatchEngineStatus>(INITIAL_WATCH_STATUS);
  const [activeWatchAlerts, setActiveWatchAlerts] = useState<RatingWatchTriggerEvent[]>([]);
  const [isAlarmRinging, setIsAlarmRinging] = useState<boolean>(false);
  const [pendingWatchDraft, setPendingWatchDraft] = useState<{
    key: number;
    row: OddsmatcherRow;
    mode?: BetMode;
  } | null>(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [dismissedDegradedAt, setDismissedDegradedAt] = useState<number | null>(null);
  const [showConnectionBanner, setShowConnectionBanner] = useState<boolean>(false);

  const lastSurebetAlertRef = useRef<number>(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Apply dominant color theme immediately to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme || 'gold');
  }, [settings.theme]);

  const pushToast = useCallback((title: string, body: string, kind: 'info' | 'surebet' = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-2), { id, title, body, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  // Monitor live OS/network online & offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsBrowserOnline(true);
      setDismissedDegradedAt(null);
      pushToast('Connessione Ripristinata', 'Avvio aggiornamento automatico delle quote live...');
      void window.oddspulse?.runScrapeNow();
    };
    const handleOffline = () => {
      setIsBrowserOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [pushToast]);

  useEffect(() => {
    const api = window.oddspulse;
    if (!api) return;

    api.getSettings().then((s) => {
      setSettings(s);
      setStake(s.defaultStake);
    }).catch(() => {});

    api.listTrackedBets().then(setTrackedBets).catch(() => {});
    api.listSavedMultiples?.().then(setSavedMultiples).catch(() => {});
    api.getSnapshot().then(setSnapshot).catch(() => {});
    api.listWatches?.().then(setRatingWatches).catch(() => {});
    api.getWatchStatus?.().then(setWatchStatus).catch(() => {});

    const unsubScrape = api.onScrapeUpdate((nextSnap) => {
      setSnapshot(nextSnap);
      if (
        !nextSnap.stats.isRunning &&
        nextSnap.stats.lastCompletedAt &&
        nextSnap.stats.lastCompletedAt !== lastSurebetAlertRef.current
      ) {
        lastSurebetAlertRef.current = nextSnap.stats.lastCompletedAt;
        const topSurebet = nextSnap.rows.find((r) => r.isSurebet);
        if (topSurebet) {
          if (settingsRef.current.soundEnabled) playSurebetChime();
          pushToast(
            `Surebet ${topSurebet.ratingNormal.toFixed(2)}% rilevata!`,
            `${topSurebet.eventName} (${topSurebet.selectionLabel}) — ${topSurebet.bookmakerName} @${topSurebet.backOdds}`,
            'surebet'
          );
        }
      }
    });

    const unsubWatches = api.onWatchesUpdated?.((payload) => {
      setRatingWatches(payload.watches);
      setWatchStatus(payload.status);
    });

    const unsubTriggered = api.onWatchesTriggered?.((events) => {
      if (!Array.isArray(events) || events.length === 0) return;
      setActiveWatchAlerts((prev) => {
        const next = [...prev];
        for (const ev of events) {
          const idx = next.findIndex((x) => x.watchId === ev.watchId);
          if (idx >= 0) next[idx] = ev;
          else next.push(ev);
        }
        return next.slice(-6);
      });
      if (settingsRef.current.soundEnabled) {
        setIsAlarmRinging(true);
        startPersistentRatingAlarm(() => setIsAlarmRinging(false));
      }
    });

    return () => {
      unsubScrape();
      unsubWatches?.();
      unsubTriggered?.();
      stopPersistentRatingAlarm();
    };
  }, [pushToast]);

  const handleRunScrape = useCallback(() => {
    void window.oddspulse?.runScrapeNow();
  }, []);

  const handleUpdateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((prev) => ({
      ...prev,
      ...patch,
      enabledSources: {
        ...prev.enabledSources,
        ...(patch.enabledSources ?? {}),
      },
    }));
    const updated = await window.oddspulse?.updateSettings(patch);
    if (updated) setSettings(updated);
  }, []);

  // Optimistic zero-jank sidebar toggle: single React update + background persist (no mid-animation re-render)
  const handleToggleSidebarCompact = useCallback(() => {
    setSettings((prev) => {
      const next = !prev.sidebarCompact;
      void window.oddspulse?.updateSettings({ sidebarCompact: next });
      return { ...prev, sidebarCompact: next };
    });
  }, []);

  const handleToggleOddsmatcherKpis = useCallback(() => {
    setSettings((prev) => {
      const next = !(prev.showOddsmatcherKpis ?? true);
      void window.oddspulse?.updateSettings({ showOddsmatcherKpis: next });
      return { ...prev, showOddsmatcherKpis: next };
    });
  }, []);

  const handleSelectTab = useCallback((t: NavTab) => {
    setSelectedRow(null);
    setActiveTab(t);
  }, []);

  const handleOpenScrapers = useCallback(() => {
    setActiveTab('scrapers');
  }, []);

  const handleToggleSound = useCallback(() => {
    setSettings((prev) => {
      const next = !prev.soundEnabled;
      if (!next) {
        stopPersistentRatingAlarm();
        setIsAlarmRinging(false);
      }
      void window.oddspulse?.updateSettings({ soundEnabled: next });
      return { ...prev, soundEnabled: next };
    });
  }, []);

  const handleSaveBet = useCallback(
    async (bet: Omit<TrackedBet, 'id' | 'createdAt'>) => {
      const updated = await window.oddspulse?.addTrackedBet(bet);
      if (updated) {
        setTrackedBets(updated);
      } else {
        setTrackedBets((prev) => [
          { ...bet, id: `local_${Date.now()}`, createdAt: Date.now() },
          ...prev,
        ]);
      }
      pushToast('Operazione Salvata', `${bet.eventName} aggiunta al Tracker Profitti.`);
    },
    [pushToast]
  );

  const handleUpdateBetStatus = useCallback(
    async (id: string, status: TrackedBet['status'], realizedProfit: number) => {
      const updated = await window.oddspulse?.updateTrackedBetStatus({
        id,
        status,
        realizedProfit,
      });
      if (updated) setTrackedBets(updated);
    },
    []
  );

  const handleDeleteBet = useCallback(async (id: string) => {
    const updated = await window.oddspulse?.deleteTrackedBet(id);
    if (updated) setTrackedBets(updated);
  }, []);

  const handleSaveMultiplePlan = useCallback(
    async (plan: SavedMultiplePlan | SavedMultiplePlanInput): Promise<SavedMultiplePlan | null> => {
      const isNew = !('id' in plan) || !plan.id;
      const updated = await window.oddspulse?.saveMultiplePlan?.(plan);
      if (updated) {
        setSavedMultiples(updated);
        if (isNew) {
          pushToast(
            'Piano Multipla Salvato',
            `${plan.name} aggiunto a Multiple Salvate (${plan.legs.length} eventi).`
          );
          return updated[0] ?? null;
        }
        const savedId = 'id' in plan ? plan.id : undefined;
        return updated.find((p) => p.id === savedId) ?? updated[0] ?? null;
      }

      // Browser/localStorage fallback when running without Electron IPC
      const now = Date.now();
      const isCompleted =
        plan.legs.some((l) => l.status === 'lost_bookie') ||
        (plan.legs.length > 0 && plan.legs.every((l) => l.status === 'won_bookie'));
      const status = isCompleted ? 'completed' : 'active';
      let resultPlan: SavedMultiplePlan | null = null;

      setSavedMultiples((prev) => {
        const existingId = 'id' in plan ? plan.id : undefined;
        let next: SavedMultiplePlan[];
        if (existingId && prev.some((p) => p.id === existingId)) {
          next = prev.map((p) => {
            if (p.id !== existingId) return p;
            resultPlan = { ...p, ...plan, id: existingId, createdAt: p.createdAt, updatedAt: now, status };
            return resultPlan;
          });
        } else {
          resultPlan = {
            ...plan,
            id: existingId || `multi_${now}_${Math.random().toString(36).slice(2, 6)}`,
            createdAt: now,
            updatedAt: now,
            status,
          };
          next = [resultPlan, ...prev];
        }
        try {
          localStorage.setItem('oddspulse_saved_multiples_v1', JSON.stringify(next));
        } catch {
          // Ignore storage error
        }
        return next;
      });

      if (isNew) {
        pushToast(
          'Piano Multipla Salvato',
          `${plan.name} aggiunto a Multiple Salvate (${plan.legs.length} eventi).`
        );
      }
      return resultPlan;
    },
    [pushToast]
  );

  const handleDeleteSavedMultiple = useCallback(
    async (id: string) => {
      const updated = await window.oddspulse?.deleteSavedMultiple?.(id);
      if (updated) {
        setSavedMultiples(updated);
      } else {
        setSavedMultiples((prev) => {
          const next = prev.filter((p) => p.id !== id);
          try {
            localStorage.setItem('oddspulse_saved_multiples_v1', JSON.stringify(next));
          } catch {
            // Ignore
          }
          return next;
        });
      }
      pushToast('Multipla Eliminata', 'Il piano salvato è stato rimosso.');
    },
    [pushToast]
  );

  const handleToggleLockMulti = useCallback(
    (row: OddsmatcherRow) => {
      setLockedRowIds((prev) => {
        if (prev.includes(row.id)) {
          return prev.filter((id) => id !== row.id);
        }
        // Keep only locks from the same bookmaker (a multipla must be on one bookmaker)
        const existingRows = snapshot.rows.filter((r) => prev.includes(r.id));
        const sameBook = existingRows
          .filter((r) => r.bookmakerId === row.bookmakerId && r.eventKey !== row.eventKey)
          .map((r) => r.id);
        pushToast(
          'Bloccato in Multiodds',
          `${row.eventName} (${row.bookmakerName} @${row.backOdds.toFixed(2)})`
        );
        return [...sameBook, row.id].slice(-4);
      });
    },
    [snapshot.rows, pushToast]
  );

  const handleLockAndGoMultiodds = useCallback(
    (row: OddsmatcherRow) => {
      setLockedRowIds((prev) => {
        const existingRows = snapshot.rows.filter((r) => prev.includes(r.id));
        const sameBook = existingRows
          .filter((r) => r.bookmakerId === row.bookmakerId && r.eventKey !== row.eventKey)
          .map((r) => r.id);
        return [...sameBook, row.id].slice(-4);
      });
      setActiveTab('multiodds');
      pushToast('Evento inviato a Multiodds', `${row.eventName} bloccato nel generatore multiple.`);
    },
    [snapshot.rows, pushToast]
  );

  const handleCreateWatch = useCallback(
    async (input: RatingWatchInput) => {
      const res = await window.oddspulse?.createWatch?.(input);
      if (res) {
        setRatingWatches(res.watches);
        setWatchStatus(res.status);
      }
      pushToast('Radar Rating Attivato', `${input.eventName} (${input.targetRating.toFixed(1)}%)`);
    },
    [pushToast]
  );

  const handleUpdateWatch = useCallback(async (id: string, patch: Partial<RatingWatch>) => {
    const res = await window.oddspulse?.updateWatch?.({ id, patch });
    if (res) {
      setRatingWatches(res.watches);
      setWatchStatus(res.status);
    }
  }, []);

  const handleDeleteWatch = useCallback(async (id: string) => {
    const res = await window.oddspulse?.deleteWatch?.(id);
    if (res) {
      setRatingWatches(res.watches);
      setWatchStatus(res.status);
    }
  }, []);

  const handleRunWatchNow = useCallback(async () => {
    const res = await window.oddspulse?.runWatchCheckNow?.();
    if (res) {
      setRatingWatches(res.watches);
      setWatchStatus(res.status);
    }
  }, []);

  const handleStartWatchFromRow = useCallback(
    (row: OddsmatcherRow) => {
      setPendingWatchDraft({ key: Date.now(), row, mode });
      setActiveTab('watches');
    },
    [mode]
  );

  const handleSilenceAlarm = useCallback(() => {
    stopPersistentRatingAlarm();
    setIsAlarmRinging(false);
    void window.oddspulse?.ackWatchAlert?.();
  }, []);

  const handleDismissAlert = useCallback((alertId: string) => {
    setActiveWatchAlerts((prev) => {
      const next = prev.filter((a) => a.id !== alertId);
      if (next.length === 0) {
        stopPersistentRatingAlarm();
        setIsAlarmRinging(false);
        void window.oddspulse?.ackWatchAlert?.();
      }
      return next;
    });
  }, []);

  const handleDismissAllAlerts = useCallback(() => {
    setActiveWatchAlerts([]);
    stopPersistentRatingAlarm();
    setIsAlarmRinging(false);
    void window.oddspulse?.ackWatchAlert?.();
  }, []);

  const handleOpenAlertInCalculator = useCallback(
    (ev: RatingWatchTriggerEvent) => {
      stopPersistentRatingAlarm();
      setIsAlarmRinging(false);
      void window.oddspulse?.ackWatchAlert?.();
      setActiveWatchAlerts((prev) => prev.filter((a) => a.id !== ev.id));

      const liveRow = snapshot.rows.find((r) => r.id === ev.match.rowId);
      const bkMeta = SOURCE_CATALOG.find((s) => s.id === ev.match.bookmakerId);
      const exMeta = SOURCE_CATALOG.find((s) => s.id === ev.match.exchangeId);
      const fallbackRow: OddsmatcherRow = {
        id: ev.match.rowId,
        eventKey: `${ev.match.eventName}_${ev.match.startTime}`,
        sport: 'football',
        league: ev.match.league,
        eventName: ev.match.eventName,
        homeTeam: ev.match.eventName.split(' - ')[0] ?? ev.match.eventName,
        awayTeam: ev.match.eventName.split(' - ')[1] ?? '',
        startTime: ev.match.startTime,
        marketType: ev.match.marketType,
        marketLabel: ev.match.marketLabel,
        selectionKey: ev.match.selectionKey,
        selectionLabel: ev.match.selectionLabel,
        bookmakerId: ev.match.bookmakerId,
        bookmakerName: ev.match.bookmakerName,
        bookmakerColor: bkMeta?.color ?? '#3b82f6',
        bookmakerUrl: bkMeta?.url,
        backOdds: ev.match.backOdds,
        backDelta: 'same',
        exchangeId: ev.match.exchangeId,
        exchangeName: ev.match.exchangeName,
        exchangeColor: exMeta?.color ?? '#ffb80c',
        exchangeUrl: exMeta?.url,
        layOdds: ev.match.layOdds,
        layDelta: 'same',
        liquidity: ev.match.liquidity,
        commission: ev.match.commission,
        ratingNormal: ev.match.rating,
        ratingSnr: ev.match.rating,
        rawRating: ev.match.rating,
        isSurebet: ev.match.rating >= 100,
        updatedAt: ev.match.matchedAt,
      };
      setMode(ev.mode);
      setSelectedRow(liveRow ?? fallbackRow);
    },
    [snapshot.rows]
  );

  const lockedRows = useMemo(() => {
    const set = new Set(lockedRowIds);
    return snapshot.rows.filter((r) => set.has(r.id));
  }, [snapshot.rows, lockedRowIds]);

  // Keep selectedRow synchronized with live odds ticks
  const liveSelectedRow = useMemo(() => {
    if (!selectedRow) return null;
    return snapshot.rows.find((r) => r.id === selectedRow.id) ?? selectedRow;
  }, [selectedRow, snapshot.rows]);

  // Delayed grace timer before surfacing ConnectionAlert banner so transient micro-drops or active scrapes never trigger false alarms
  const suppressedByViewEmptyState =
    (activeTab === 'oddsmatcher' || activeTab === 'multiodds' || activeTab === 'dutcher') &&
    snapshot.rows.length === 0 &&
    !snapshot.stats.isRunning &&
    (!isBrowserOnline || snapshot.connection.health === 'offline');

  const rawBannerKind: 'os_offline' | 'offline' | 'degraded' | null = !isBrowserOnline
    ? 'os_offline'
    : snapshot.stats.isRunning
    ? null
    : snapshot.connection.health === 'offline'
    ? 'offline'
    : snapshot.connection.health === 'degraded' &&
      snapshot.connection.failedSourcesCount >= 2 &&
      dismissedDegradedAt !== snapshot.stats.lastCompletedAt
    ? 'degraded'
    : null;

  useEffect(() => {
    if (!rawBannerKind || suppressedByViewEmptyState) {
      setShowConnectionBanner(false);
      return;
    }

    const graceMs =
      rawBannerKind === 'os_offline'
        ? 6000
        : rawBannerKind === 'offline'
        ? 10000
        : 15000;

    const timer = setTimeout(() => {
      setShowConnectionBanner(true);
    }, graceMs);

    return () => clearTimeout(timer);
  }, [rawBannerKind, suppressedByViewEmptyState, snapshot.stats.lastCompletedAt]);

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[var(--bg-base)] text-slate-100">
      {/* Ambient Background Layers (pure radial-gradient, zero GPU blur filter cost) */}
      <div className="bg-cyber-grid pointer-events-none fixed inset-0 z-0 opacity-90" />
      {settings.animationsEnabled && (
        <>
          <div className="ambient-orb-brand pointer-events-none fixed -left-40 -top-40 z-0 h-[640px] w-[640px] rounded-full" />
          <div className="ambient-orb-accent pointer-events-none fixed -bottom-44 -right-40 z-0 h-[680px] w-[680px] rounded-full" />
          <div className="ambient-orb-center pointer-events-none fixed left-1/2 top-1/4 z-0 h-[520px] w-[520px] -translate-x-1/2 rounded-full" />
        </>
      )}

      {/* Custom Frameless Titlebar */}
      <TitleBar
        snapshot={snapshot}
        theme={settings.theme}
        isBrowserOnline={isBrowserOnline}
        refreshIntervalSec={settings.refreshIntervalSec}
        soundEnabled={settings.soundEnabled}
        onToggleSound={handleToggleSound}
        onRunScrape={handleRunScrape}
      />

      {/* Main Layout */}
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          compact={settings.sidebarCompact}
          onToggleCompact={handleToggleSidebarCompact}
          onSelectTab={handleSelectTab}
          snapshot={snapshot}
          trackedBets={trackedBets}
          lockedMultiCount={lockedRows.length}
          activeWatchesCount={watchStatus.activeCount}
          activeAlertsCount={activeWatchAlerts.length}
        />

        <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          {/* Global Live Connection Alert Banner (debounced to avoid false transient alerts) */}
          <AnimatePresence>
            {showConnectionBanner && (
              <ConnectionAlert
                snapshot={snapshot}
                isBrowserOnline={isBrowserOnline}
                variant="banner"
                onRetry={handleRunScrape}
                onOpenScrapers={() => setActiveTab('scrapers')}
                onDismiss={() => {
                  setShowConnectionBanner(false);
                  setDismissedDegradedAt(snapshot.stats.lastCompletedAt);
                }}
              />
            )}
          </AnimatePresence>

          <div
            key={activeTab}
            className={`min-h-0 flex-1 w-full ${settings.animationsEnabled ? 'view-enter' : ''}`}
          >
            <ViewErrorBoundary
              resetKey={activeTab}
              onFallbackHome={() => setActiveTab('oddsmatcher')}
            >
              {activeTab === 'oddsmatcher' && (
                <OddsmatcherView
                  snapshot={snapshot}
                  isBrowserOnline={isBrowserOnline}
                  mode={mode}
                  stake={stake}
                  tableDensity={settings.tableDensity}
                  showKpis={settings.showOddsmatcherKpis ?? true}
                  lockedRowIds={lockedRowIds}
                  onChangeMode={setMode}
                  onChangeStake={setStake}
                  onSelectRow={setSelectedRow}
                  onToggleLockMulti={handleToggleLockMulti}
                  onCreateRatingWatch={handleStartWatchFromRow}
                  onToggleKpis={handleToggleOddsmatcherKpis}
                  onRetryScrape={handleRunScrape}
                  onOpenScrapers={handleOpenScrapers}
                />
              )}

              {activeTab === 'multiodds' && (
                <MultioddsView
                  snapshot={snapshot}
                  isBrowserOnline={isBrowserOnline}
                  lockedRows={lockedRows}
                  savedMultiples={savedMultiples}
                  soundEnabled={settings.soundEnabled}
                  onUnlockRow={(id) => setLockedRowIds((prev) => prev.filter((x) => x !== id))}
                  onClearLocks={() => setLockedRowIds([])}
                  onSaveTrackedBet={(bet) => void handleSaveBet(bet)}
                  onSaveMultiplePlan={handleSaveMultiplePlan}
                  onDeleteSavedMultiple={(id) => void handleDeleteSavedMultiple(id)}
                  onRetryScrape={handleRunScrape}
                  onOpenScrapers={() => setActiveTab('scrapers')}
                />
              )}

              {activeTab === 'dutcher' && (
                <DutcherView
                  snapshot={snapshot}
                  isBrowserOnline={isBrowserOnline}
                  soundEnabled={settings.soundEnabled}
                  defaultStake={settings.defaultStake}
                  tableDensity={settings.tableDensity}
                  defaultShowKpis={settings.showOddsmatcherKpis ?? true}
                  onSaveTrackedBet={(bet) => void handleSaveBet(bet)}
                  onRetryScrape={handleRunScrape}
                  onOpenScrapers={() => setActiveTab('scrapers')}
                />
              )}

              {activeTab === 'calculator' && (
                <CalculatorView
                  defaultStake={settings.defaultStake}
                  defaultCommission={settings.betfairCommission}
                  soundEnabled={settings.soundEnabled}
                  onSaveTrackedBet={(bet) => void handleSaveBet(bet)}
                />
              )}

              {activeTab === 'watches' && (
                <RatingWatchView
                  snapshot={snapshot}
                  watches={ratingWatches}
                  status={watchStatus}
                  settings={settings}
                  soundEnabled={settings.soundEnabled}
                  draftSeed={pendingWatchDraft}
                  onCreateWatch={handleCreateWatch}
                  onUpdateWatch={handleUpdateWatch}
                  onDeleteWatch={handleDeleteWatch}
                  onRunNow={handleRunWatchNow}
                  onEnableSound={() => void handleUpdateSettings({ soundEnabled: true })}
                  onOpenCalculator={(row, watchMode) => {
                    if (watchMode) setMode(watchMode);
                    setSelectedRow(row);
                  }}
                  onConsumeDraftSeed={() => setPendingWatchDraft(null)}
                />
              )}

              {activeTab === 'scrapers' && (
                <ScrapersView
                  snapshot={snapshot}
                  settings={settings}
                  onUpdateSettings={(p) => void handleUpdateSettings(p)}
                  onRunScrape={handleRunScrape}
                />
              )}

              {activeTab === 'tracker' && (
                <TrackerView
                  bets={trackedBets}
                  theme={settings.theme}
                  onUpdateStatus={(id, st, prof) => void handleUpdateBetStatus(id, st, prof)}
                  onDelete={(id) => void handleDeleteBet(id)}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  settings={settings}
                  onUpdateSettings={(p) => void handleUpdateSettings(p)}
                  onNotify={(title, body) => pushToast(title, body, 'info')}
                />
              )}
            </ViewErrorBoundary>
          </div>
        </main>
      </div>

      {/* Interactive Punta-Banca Calculator Slide-Over */}
      <CalculatorDrawer
        row={liveSelectedRow}
        initialMode={mode}
        initialStake={stake}
        drawerWidth={settings.drawerWidth}
        soundEnabled={settings.soundEnabled}
        onClose={() => setSelectedRow(null)}
        onSaveBet={(bet) => void handleSaveBet(bet)}
        onLockToMultiodds={handleLockAndGoMultiodds}
        onCreateRatingWatch={handleStartWatchFromRow}
      />

      {/* Persistent Bottom-Right Rating Watch Alert Stack */}
      <RatingAlertBanner
        alerts={activeWatchAlerts}
        isAlarmRinging={isAlarmRinging}
        onSilence={handleSilenceAlarm}
        onDismiss={handleDismissAlert}
        onDismissAll={handleDismissAllAlerts}
        onOpenCalculator={handleOpenAlertInCalculator}
      />

      {/* Animated Toast Notifications */}
      <div className="pointer-events-none fixed right-5 top-14 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40, scale: 0.94 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30, scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className={`pointer-events-auto flex w-80 items-start gap-2.5 rounded-xl border p-3 shadow-2xl backdrop-blur-xl ${
                t.kind === 'surebet'
                  ? 'border-brand-400/60 bg-slate-950/92 shadow-glow'
                  : 'border-slate-700/80 bg-slate-900/92'
              }`}
            >
              <div
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  t.kind === 'surebet'
                    ? 'bg-brand-400/20 text-brand-300'
                    : 'bg-accent-500/20 text-accent-300'
                }`}
              >
                {t.kind === 'surebet' ? (
                  <Flame className="h-4 w-4" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white">{t.title}</div>
                <div className="mt-0.5 truncate text-[11px] text-slate-400">{t.body}</div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default App;

import { app, BrowserWindow, ipcMain, net, Notification, screen, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { computeAdaptiveWatchPlan, evaluateRatingWatch } from '../src/shared/ratingWatch';
import {
  DEFAULT_SETTINGS,
  THEME_CATALOG,
  type AppSettings,
  type DisplayInfo,
  type OddsmatcherRow,
  type RatingWatch,
  type RatingWatchEngineStatus,
  type RatingWatchInput,
  type RatingWatchTriggerEvent,
  type SavedMultiplePlan,
  type SavedMultiplePlanInput,
  type ScrapeSnapshot,
  type TrackedBet,
} from '../src/shared/types';
import { ScraperEngine } from './scrapers/scraperEngine';

let mainWindow: BrowserWindow | null = null;
let scraperEngine: ScraperEngine;
let refreshTimer: NodeJS.Timeout | null = null;
let watchTimer: NodeJS.Timeout | null = null;
let currentSettings: AppSettings = { ...DEFAULT_SETTINGS };
let trackedBets: TrackedBet[] = [];
let savedMultiples: SavedMultiplePlan[] = [];
let ratingWatches: RatingWatch[] = [];
let watchBackoffMultiplier = 1;
let lastEvaluatedFullCycleAt: number | null = null;
let watchStatus: RatingWatchEngineStatus = {
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

function getStorePath(filename: string): string {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, filename);
}

function loadSettings(): AppSettings {
  try {
    const filePath = getStorePath('oddspulse-settings.json');
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<AppSettings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        enabledSources: {
          ...DEFAULT_SETTINGS.enabledSources,
          ...(parsed.enabledSources ?? {}),
        },
      };
    }
  } catch {
    // Fallback to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: AppSettings): void {
  try {
    const filePath = getStorePath('oddspulse-settings.json');
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch {
    // Ignore disk write error
  }
}

function loadTrackedBets(): TrackedBet[] {
  try {
    const filePath = getStorePath('oddspulse-tracker.json');
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(parsed)) return parsed as TrackedBet[];
    }
  } catch {
    // Fallback to empty
  }
  return [];
}

function saveTrackedBets(bets: TrackedBet[]): void {
  try {
    const filePath = getStorePath('oddspulse-tracker.json');
    fs.writeFileSync(filePath, JSON.stringify(bets, null, 2), 'utf-8');
  } catch {
    // Ignore
  }
}

function loadSavedMultiples(): SavedMultiplePlan[] {
  try {
    const filePath = getStorePath('oddspulse-saved-multiples.json');
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(parsed)) return parsed as SavedMultiplePlan[];
    }
  } catch {
    // Fallback to empty
  }
  return [];
}

function saveSavedMultiples(plans: SavedMultiplePlan[]): void {
  try {
    const filePath = getStorePath('oddspulse-saved-multiples.json');
    fs.writeFileSync(filePath, JSON.stringify(plans, null, 2), 'utf-8');
  } catch {
    // Ignore
  }
}

function loadRatingWatches(): RatingWatch[] {
  try {
    const filePath = getStorePath('oddspulse-watches.json');
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(parsed)) return parsed as RatingWatch[];
    }
  } catch {
    // Fallback to empty
  }
  return [];
}

function saveRatingWatches(watches: RatingWatch[]): void {
  try {
    const filePath = getStorePath('oddspulse-watches.json');
    fs.writeFileSync(filePath, JSON.stringify(watches, null, 2), 'utf-8');
  } catch {
    // Ignore
  }
}

function broadcastWatches() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('watches:updated', {
      watches: ratingWatches,
      status: watchStatus,
    });
  }
}

function fireOsWatchNotifications(events: RatingWatchTriggerEvent[]) {
  try {
    if (!Notification.isSupported()) return;
    for (const ev of events.slice(0, 3)) {
      const notif = new Notification({
        title: `Radar Rating ${ev.match.rating.toFixed(2)}% (target ${ev.targetRating}%)`,
        body: `${ev.match.eventName} · ${ev.match.selectionLabel}\n${ev.match.bookmakerName} @${ev.match.backOdds.toFixed(2)} vs ${ev.match.exchangeName} @${ev.match.layOdds.toFixed(2)} (Liq €${ev.match.liquidity.toFixed(0)})`,
        silent: true, // Renderer handles persistent alarm sound cleanly
      });
      notif.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
      notif.show();
    }
  } catch {
    // Ignore OS notification errors
  }
}

function evaluateWatchesAgainstRows(rows: OddsmatcherRow[], isFullCycle: boolean): void {
  if (ratingWatches.length === 0) {
    const plan = computeAdaptiveWatchPlan(ratingWatches, currentSettings);
    watchStatus = {
      ...watchStatus,
      activeCount: plan.activeWatches.length,
      totalCount: 0,
      expiredCount: plan.expiredWatchIds.length,
      intervalSec: null,
      effectiveBookmakerIds: [],
      effectiveExchangeIds: [],
      rateLimitReasons: [],
      nextCheckAt: null,
    };
    broadcastWatches();
    return;
  }

  const nowMs = Date.now();
  const triggered: RatingWatchTriggerEvent[] = [];
  let changed = false;
  let disabledByStateChange = false;

  ratingWatches = ratingWatches.map((w) => {
    if (!w.enabled && !isFullCycle) return w;

    const evalRes = evaluateRatingWatch(w, rows, {
      nowMs,
      includeLiveEvents: currentSettings.includeLiveEvents,
    });

    if (evalRes.isExpired && w.enabled) {
      changed = true;
      disabledByStateChange = true;
      return {
        ...w,
        enabled: false,
        updatedAt: nowMs,
        lastCheckedAt: nowMs,
        lastBestMatch: null,
      };
    }

    const nextWatch: RatingWatch = {
      ...w,
      lastCheckedAt: nowMs,
      lastBestMatch: evalRes.bestMatch,
    };
    changed = true;

    if (evalRes.shouldTrigger && evalRes.bestMatch) {
      nextWatch.lastTriggeredAt = nowMs;
      nextWatch.triggerCount = (w.triggerCount || 0) + 1;
      if (w.autoPauseOnTrigger) {
        nextWatch.enabled = false;
        nextWatch.updatedAt = nowMs;
        disabledByStateChange = true;
      }
      triggered.push({
        id: `trig_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
        watchId: w.id,
        watchEventName: w.eventName,
        targetRating: w.targetRating,
        mode: w.mode,
        match: evalRes.bestMatch,
        triggeredAt: nowMs,
      });
    }

    return nextWatch;
  });

  if (changed) {
    saveRatingWatches(ratingWatches);
  }

  if (triggered.length > 0) {
    fireOsWatchNotifications(triggered);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.flashFrame(true);
      } catch {
        // Ignore frame flash errors
      }
      mainWindow.webContents.send('watches:triggered', triggered);
    }
  }

  if (disabledByStateChange) {
    scheduleWatchPolling();
  } else {
    const plan = computeAdaptiveWatchPlan(ratingWatches, currentSettings, nowMs);
    watchStatus = {
      ...watchStatus,
      activeCount: plan.activeWatches.length,
      totalCount: ratingWatches.length,
      expiredCount: plan.expiredWatchIds.length,
      effectiveBookmakerIds: plan.bookmakerIds,
      effectiveExchangeIds: plan.exchangeIds,
      rateLimitReasons: plan.rateLimitReasons,
    };
    broadcastWatches();
  }
}

async function runTargetedWatchCycleAndEvaluate(): Promise<void> {
  if (!scraperEngine) return;
  const plan = computeAdaptiveWatchPlan(ratingWatches, currentSettings);
  if (plan.activeWatches.length === 0 || !plan.intervalSec) {
    watchStatus = {
      ...watchStatus,
      isPolling: false,
      activeCount: 0,
      totalCount: ratingWatches.length,
      expiredCount: plan.expiredWatchIds.length,
      intervalSec: null,
      nextCheckAt: null,
    };
    broadcastWatches();
    return;
  }

  watchStatus = { ...watchStatus, isPolling: true };
  broadcastWatches();

  try {
    const res = await scraperEngine.runTargetedWatchCycle(currentSettings, {
      bookmakerIds: plan.bookmakerIds,
      exchangeIds: plan.exchangeIds,
      sports: plan.sports,
      eventHints: plan.eventHints,
    });

    if (!res.skipped) {
      watchBackoffMultiplier = res.hadRateLimit
        ? Math.min(3, Math.round(watchBackoffMultiplier * 1.5 * 10) / 10)
        : 1;
      watchStatus = {
        ...watchStatus,
        lastCheckAt: Date.now(),
        lastCycleDurationMs: res.durationMs,
        backoffMultiplier: watchBackoffMultiplier,
      };
      evaluateWatchesAgainstRows(res.allRows, false);
    }
  } finally {
    watchStatus = { ...watchStatus, isPolling: false };
    scheduleWatchPolling();
  }
}

function scheduleWatchPolling(): void {
  if (watchTimer) {
    clearTimeout(watchTimer);
    watchTimer = null;
  }

  const nowMs = Date.now();
  const plan = computeAdaptiveWatchPlan(ratingWatches, currentSettings, nowMs);

  // Auto-disable expired enabled watches cleanly if any are still marked enabled
  if (plan.expiredWatchIds.length > 0) {
    const expSet = new Set(plan.expiredWatchIds);
    let updatedExpired = false;
    ratingWatches = ratingWatches.map((w) => {
      if (w.enabled && expSet.has(w.id)) {
        updatedExpired = true;
        return { ...w, enabled: false, updatedAt: nowMs, lastBestMatch: null };
      }
      return w;
    });
    if (updatedExpired) saveRatingWatches(ratingWatches);
  }

  if (plan.activeWatches.length === 0 || !plan.intervalSec) {
    watchBackoffMultiplier = 1;
    watchStatus = {
      ...watchStatus,
      activeCount: 0,
      totalCount: ratingWatches.length,
      expiredCount: plan.expiredWatchIds.length,
      intervalSec: null,
      backoffMultiplier: 1,
      effectiveBookmakerIds: [],
      effectiveExchangeIds: [],
      nextCheckAt: null,
      rateLimitReasons: [],
    };
    broadcastWatches();
    return;
  }

  const delaySec = Math.min(90, Math.max(8, Math.round(plan.intervalSec * watchBackoffMultiplier)));
  watchStatus = {
    ...watchStatus,
    activeCount: plan.activeWatches.length,
    totalCount: ratingWatches.length,
    expiredCount: plan.expiredWatchIds.length,
    intervalSec: delaySec,
    backoffMultiplier: watchBackoffMultiplier,
    effectiveBookmakerIds: plan.bookmakerIds,
    effectiveExchangeIds: plan.exchangeIds,
    rateLimitReasons: plan.rateLimitReasons,
    nextCheckAt: nowMs + delaySec * 1000,
  };
  broadcastWatches();

  watchTimer = setTimeout(() => {
    void runTargetedWatchCycleAndEvaluate();
  }, delaySec * 1000);
}

function setupRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  const sec = currentSettings.refreshIntervalSec;
  if (sec > 0) {
    refreshTimer = setInterval(() => {
      void scraperEngine.runCycle(currentSettings);
    }, sec * 1000);
  }
}

function broadcastSnapshot(snapshot: ScrapeSnapshot) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scraper:update', snapshot);
  }
}

function getDisplayInfo(): DisplayInfo {
  const display = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const bounds = mainWindow?.getBounds() ?? {
    width: currentSettings.windowWidth,
    height: currentSettings.windowHeight,
  };
  return {
    currentWidth: bounds.width,
    currentHeight: bounds.height,
    workAreaWidth: display.workAreaSize.width,
    workAreaHeight: display.workAreaSize.height,
    scaleFactor: display.scaleFactor,
    isMaximized: mainWindow?.isMaximized() ?? false,
    alwaysOnTop: mainWindow?.isAlwaysOnTop() ?? currentSettings.alwaysOnTop,
    zoomFactor: mainWindow?.webContents.getZoomFactor() ?? currentSettings.uiScale,
  };
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const initWidth = Math.max(960, Math.min(currentSettings.windowWidth || 1500, workArea.width));
  const initHeight = Math.max(620, Math.min(currentSettings.windowHeight || 940, workArea.height));

  const themeBg =
    THEME_CATALOG.find((t) => t.id === currentSettings.theme)?.bgHex ?? '#070609';

  mainWindow = new BrowserWindow({
    width: initWidth,
    height: initHeight,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    backgroundColor: themeBg,
    alwaysOnTop: Boolean(currentSettings.alwaysOnTop),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    const zoom = Math.max(0.75, Math.min(1.35, currentSettings.uiScale || 1));
    mainWindow.webContents.setZoomFactor(zoom);
    if (currentSettings.startMaximized) {
      mainWindow.maximize();
    }
    mainWindow.show();
  });

  let resizeDebounce: NodeJS.Timeout | null = null;
  const emitBounds = () => {
    if (resizeDebounce) clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window:bounds-change', getDisplayInfo());
      }
    }, 120);
  };

  mainWindow.on('resize', emitBounds);
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-change', true);
    emitBounds();
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-change', false);
    emitBounds();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    // dist/index.html relative to dist-electron/electron/main.js -> ../../dist/index.html
    const indexPath = path.join(__dirname, '..', '..', 'dist', 'index.html');
    void mainWindow.loadFile(indexPath);
  }
}

app.whenReady().then(() => {
  currentSettings = loadSettings();
  trackedBets = loadTrackedBets();
  savedMultiples = loadSavedMultiples();
  ratingWatches = loadRatingWatches();

  scraperEngine = new ScraperEngine(
    (snapshot) => {
      broadcastSnapshot(snapshot);
      if (
        !snapshot.stats.isRunning &&
        snapshot.stats.lastCompletedAt &&
        snapshot.stats.lastCompletedAt !== lastEvaluatedFullCycleAt
      ) {
        lastEvaluatedFullCycleAt = snapshot.stats.lastCompletedAt;
        evaluateWatchesAgainstRows(snapshot.rows, true);
      }
    },
    () => net.isOnline()
  );

  // Window IPC
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    } else {
      mainWindow.maximize();
      return true;
    }
  });
  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle('window:getDisplayInfo', () => getDisplayInfo());
  ipcMain.handle(
    'window:applyLayout',
    (
      _ev,
      opts: {
        width?: number;
        height?: number;
        maximize?: boolean;
        alwaysOnTop?: boolean;
        uiScale?: number;
        center?: boolean;
      }
    ) => {
      if (!mainWindow) return getDisplayInfo();
      const display = screen.getDisplayMatching(mainWindow.getBounds());
      const wa = display.workAreaSize;

      if (typeof opts.alwaysOnTop === 'boolean') {
        mainWindow.setAlwaysOnTop(opts.alwaysOnTop);
        currentSettings.alwaysOnTop = opts.alwaysOnTop;
      }

      if (typeof opts.uiScale === 'number' && Number.isFinite(opts.uiScale)) {
        const clampedZoom = Math.max(0.75, Math.min(1.35, opts.uiScale));
        mainWindow.webContents.setZoomFactor(clampedZoom);
        currentSettings.uiScale = Math.round(clampedZoom * 100) / 100;
      }

      if (opts.maximize === true) {
        mainWindow.maximize();
      } else if (typeof opts.width === 'number' && typeof opts.height === 'number') {
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        const w = Math.max(960, Math.min(Math.round(opts.width), wa.width));
        const h = Math.max(620, Math.min(Math.round(opts.height), wa.height));
        mainWindow.setSize(w, h, true);
        if (opts.center !== false) mainWindow.center();
        currentSettings.windowWidth = w;
        currentSettings.windowHeight = h;
      } else if (opts.maximize === false && mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      }

      saveSettings(currentSettings);
      const info = getDisplayInfo();
      mainWindow.webContents.send('window:bounds-change', info);
      return info;
    }
  );
  ipcMain.handle('window:snapHalfScreen', (_ev, side: 'left' | 'right') => {
    if (!mainWindow) return getDisplayInfo();
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    const wa = display.workArea;
    const halfW = Math.max(960, Math.floor(wa.width / 2));
    const x = side === 'left' ? wa.x : wa.x + wa.width - halfW;
    mainWindow.setBounds({ x, y: wa.y, width: halfW, height: wa.height }, true);
    currentSettings.windowWidth = halfW;
    currentSettings.windowHeight = wa.height;
    saveSettings(currentSettings);
    const info = getDisplayInfo();
    mainWindow.webContents.send('window:bounds-change', info);
    return info;
  });

  // Scraper IPC
  ipcMain.handle('scraper:getSnapshot', () => scraperEngine.getSnapshot());
  ipcMain.handle('scraper:runNow', async () => {
    return await scraperEngine.runCycle(currentSettings);
  });

  // Settings IPC
  ipcMain.handle('settings:get', () => currentSettings);
  ipcMain.handle('settings:update', (_ev, patch: Partial<AppSettings>) => {
    currentSettings = {
      ...currentSettings,
      ...patch,
      enabledSources: {
        ...currentSettings.enabledSources,
        ...(patch.enabledSources ?? {}),
      },
    };
    if (patch.theme && mainWindow && !mainWindow.isDestroyed()) {
      const bg = THEME_CATALOG.find((t) => t.id === patch.theme)?.bgHex;
      if (bg) mainWindow.setBackgroundColor(bg);
    }
    saveSettings(currentSettings);
    setupRefreshTimer();
    scheduleWatchPolling();
    return currentSettings;
  });

  // Tracker IPC
  ipcMain.handle('tracker:list', () => trackedBets);
  ipcMain.handle('tracker:add', (_ev, bet: Omit<TrackedBet, 'id' | 'createdAt'>) => {
    const created: TrackedBet = {
      ...bet,
      id: `bet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    trackedBets = [created, ...trackedBets];
    saveTrackedBets(trackedBets);
    return trackedBets;
  });
  ipcMain.handle(
    'tracker:updateStatus',
    (_ev, payload: { id: string; status: TrackedBet['status']; realizedProfit: number }) => {
      trackedBets = trackedBets.map((b) =>
        b.id === payload.id
          ? { ...b, status: payload.status, realizedProfit: payload.realizedProfit }
          : b
      );
      saveTrackedBets(trackedBets);
      return trackedBets;
    }
  );
  ipcMain.handle('tracker:delete', (_ev, id: string) => {
    trackedBets = trackedBets.filter((b) => b.id !== id);
    saveTrackedBets(trackedBets);
    return trackedBets;
  });

  // Saved Multiple Plans ("Multiple Salvate") IPC
  ipcMain.handle('multiples:list', () => savedMultiples);
  ipcMain.handle(
    'multiples:save',
    (_ev, payload: SavedMultiplePlan | SavedMultiplePlanInput) => {
      const now = Date.now();
      const legs = Array.isArray(payload.legs) ? payload.legs : [];
      const isCompleted =
        legs.some((l) => l.status === 'lost_bookie') ||
        (legs.length > 0 && legs.every((l) => l.status === 'won_bookie'));
      const derivedStatus = isCompleted ? 'completed' : 'active';

      const existingId = 'id' in payload ? payload.id : undefined;
      if (existingId && savedMultiples.some((p) => p.id === existingId)) {
        savedMultiples = savedMultiples.map((p) =>
          p.id === existingId
            ? {
                ...p,
                ...payload,
                id: existingId,
                createdAt: p.createdAt,
                updatedAt: now,
                status: derivedStatus,
              }
            : p
        );
      } else {
        const created: SavedMultiplePlan = {
          ...payload,
          id: existingId || `multi_${now}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: now,
          updatedAt: now,
          status: derivedStatus,
        };
        savedMultiples = [created, ...savedMultiples];
      }
      saveSavedMultiples(savedMultiples);
      return savedMultiples;
    }
  );
  ipcMain.handle('multiples:delete', (_ev, id: string) => {
    savedMultiples = savedMultiples.filter((p) => p.id !== id);
    saveSavedMultiples(savedMultiples);
    return savedMultiples;
  });

  // Rating Watch ("Radar Rating") IPC
  ipcMain.handle('watches:list', () => ratingWatches);
  ipcMain.handle('watches:getStatus', () => watchStatus);
  ipcMain.handle('watches:create', (_ev, input: RatingWatchInput) => {
    const now = Date.now();
    const minBack = Number.isFinite(input.minBackOdds) ? Math.max(1.01, input.minBackOdds) : 1.01;
    const maxBack = Number.isFinite(input.maxBackOdds)
      ? Math.max(minBack, input.maxBackOdds)
      : 50;

    const created: RatingWatch = {
      enabled: Boolean(input.enabled),
      eventKey: input.eventKey?.trim() || undefined,
      eventName: String(input.eventName || '').trim(),
      sport: input.sport,
      league: input.league?.trim() || undefined,
      startTime: input.startTime || undefined,
      marketType: input.marketType || 'ALL',
      selectionKey: input.selectionKey || 'ALL',
      bookmakerIds: Array.isArray(input.bookmakerIds) ? input.bookmakerIds : [],
      exchangeIds: Array.isArray(input.exchangeIds) ? input.exchangeIds : [],
      mode: input.mode || 'normal',
      targetRating: Number.isFinite(input.targetRating) ? input.targetRating : 97,
      refundRetention: Number.isFinite(input.refundRetention)
        ? Math.max(0, Math.min(100, input.refundRetention))
        : 70,
      minLiquidity: Number.isFinite(input.minLiquidity) ? Math.max(0, input.minLiquidity) : 0,
      minBackOdds: minBack,
      maxBackOdds: maxBack,
      autoPauseOnTrigger: input.autoPauseOnTrigger !== false,
      cooldownSec: Number.isFinite(input.cooldownSec)
        ? Math.max(10, Math.round(input.cooldownSec))
        : 60,
      id: `watch_${now}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now,
      updatedAt: now,
      lastCheckedAt: null,
      lastBestMatch: null,
      lastTriggeredAt: null,
      triggerCount: 0,
    };

    ratingWatches = [created, ...ratingWatches];
    saveRatingWatches(ratingWatches);
    scheduleWatchPolling();
    // Evaluate immediately against already loaded snapshot rows so live telemetry & hits appear right away
    evaluateWatchesAgainstRows(scraperEngine.getSnapshot().rows, false);
    return { watches: ratingWatches, status: watchStatus };
  });

  ipcMain.handle(
    'watches:update',
    (_ev, payload: { id: string; patch: Partial<RatingWatch> }) => {
      const now = Date.now();
      ratingWatches = ratingWatches.map((w) => {
        if (w.id !== payload.id) return w;
        const patch = payload.patch ?? {};
        const reEnabled = patch.enabled === true && !w.enabled;
        const filtersEdited =
          patch.targetRating !== undefined ||
          patch.eventName !== undefined ||
          patch.marketType !== undefined ||
          patch.selectionKey !== undefined ||
          patch.bookmakerIds !== undefined ||
          patch.exchangeIds !== undefined ||
          patch.mode !== undefined ||
          patch.minLiquidity !== undefined ||
          patch.minBackOdds !== undefined ||
          patch.maxBackOdds !== undefined;
        return {
          ...w,
          ...patch,
          updatedAt: now,
          // Clear cooldown lock when re-arming or changing thresholds
          ...(reEnabled || filtersEdited ? { lastTriggeredAt: null } : {}),
        };
      });
      saveRatingWatches(ratingWatches);
      scheduleWatchPolling();
      evaluateWatchesAgainstRows(scraperEngine.getSnapshot().rows, false);
      return { watches: ratingWatches, status: watchStatus };
    }
  );

  ipcMain.handle('watches:delete', (_ev, id: string) => {
    ratingWatches = ratingWatches.filter((w) => w.id !== id);
    saveRatingWatches(ratingWatches);
    scheduleWatchPolling();
    return { watches: ratingWatches, status: watchStatus };
  });

  ipcMain.handle('watches:runNow', async () => {
    await runTargetedWatchCycleAndEvaluate();
    return { watches: ratingWatches, status: watchStatus };
  });

  ipcMain.handle('watches:ackAlert', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.flashFrame(false);
      } catch {
        // Ignore frame flash errors
      }
    }
  });

  // External links
  ipcMain.handle('shell:openExternal', (_ev, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      void shell.openExternal(url);
    }
  });

  createWindow();
  setupRefreshTimer();
  scheduleWatchPolling();

  // Trigger initial live scrape shortly after window opens
  setTimeout(() => {
    void scraperEngine.runCycle(currentSettings);
  }, 500);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (watchTimer) clearTimeout(watchTimer);
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

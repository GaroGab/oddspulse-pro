import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  DisplayInfo,
  RatingWatch,
  RatingWatchEngineStatus,
  RatingWatchInput,
  RatingWatchTriggerEvent,
  SavedMultiplePlan,
  SavedMultiplePlanInput,
  ScrapeDateWindow,
  ScrapeSnapshot,
  TrackedBet,
  VerifyPuntaPuntaRequest,
  VerifyPuntaPuntaResult,
  VerifyRowQuotesRequest,
  VerifyRowQuotesResult,
} from '../src/shared/types';

export interface OddsPulseAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<boolean>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (cb: (isMax: boolean) => void) => () => void;

  getDisplayInfo: () => Promise<DisplayInfo>;
  applyWindowLayout: (opts: {
    width?: number;
    height?: number;
    maximize?: boolean;
    alwaysOnTop?: boolean;
    uiScale?: number;
    center?: boolean;
  }) => Promise<DisplayInfo>;
  snapHalfScreen: (side: 'left' | 'right') => Promise<DisplayInfo>;
  onBoundsChange: (cb: (info: DisplayInfo) => void) => () => void;

  getSnapshot: () => Promise<ScrapeSnapshot>;
  runScrapeNow: () => Promise<ScrapeSnapshot>;
  scrapeDateRange: (dateWindow: ScrapeDateWindow) => Promise<ScrapeSnapshot>;
  setActiveDateRange: (dateWindow: ScrapeDateWindow | null) => Promise<void>;
  verifyRowQuotes: (req: VerifyRowQuotesRequest) => Promise<VerifyRowQuotesResult>;
  verifyPuntaPunta: (req: VerifyPuntaPuntaRequest) => Promise<VerifyPuntaPuntaResult>;
  stopAutoScrape: () => Promise<{ settings: AppSettings; snapshot: ScrapeSnapshot }>;
  startAutoScrape: () => Promise<{ settings: AppSettings; snapshot: ScrapeSnapshot }>;
  onScrapeUpdate: (cb: (snapshot: ScrapeSnapshot) => void) => () => void;

  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;

  listTrackedBets: () => Promise<TrackedBet[]>;
  addTrackedBet: (bet: Omit<TrackedBet, 'id' | 'createdAt'>) => Promise<TrackedBet[]>;
  updateTrackedBetStatus: (payload: {
    id: string;
    status: TrackedBet['status'];
    realizedProfit: number;
  }) => Promise<TrackedBet[]>;
  deleteTrackedBet: (id: string) => Promise<TrackedBet[]>;

  listSavedMultiples: () => Promise<SavedMultiplePlan[]>;
  saveMultiplePlan: (
    plan: SavedMultiplePlan | SavedMultiplePlanInput
  ) => Promise<SavedMultiplePlan[]>;
  deleteSavedMultiple: (id: string) => Promise<SavedMultiplePlan[]>;

  listWatches: () => Promise<RatingWatch[]>;
  getWatchStatus: () => Promise<RatingWatchEngineStatus>;
  createWatch: (
    input: RatingWatchInput
  ) => Promise<{ watches: RatingWatch[]; status: RatingWatchEngineStatus }>;
  updateWatch: (payload: {
    id: string;
    patch: Partial<RatingWatch>;
  }) => Promise<{ watches: RatingWatch[]; status: RatingWatchEngineStatus }>;
  deleteWatch: (
    id: string
  ) => Promise<{ watches: RatingWatch[]; status: RatingWatchEngineStatus }>;
  runWatchCheckNow: () => Promise<{ watches: RatingWatch[]; status: RatingWatchEngineStatus }>;
  ackWatchAlert: () => Promise<void>;
  onWatchesUpdated: (
    cb: (payload: { watches: RatingWatch[]; status: RatingWatchEngineStatus }) => void
  ) => () => void;
  onWatchesTriggered: (cb: (events: RatingWatchTriggerEvent[]) => void) => () => void;

  openExternal: (url: string) => Promise<void>;
}

const api: OddsPulseAPI = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChange: (cb) => {
    const listener = (_ev: Electron.IpcRendererEvent, val: boolean) => cb(val);
    ipcRenderer.on('window:maximized-change', listener);
    return () => ipcRenderer.removeListener('window:maximized-change', listener);
  },

  getDisplayInfo: () => ipcRenderer.invoke('window:getDisplayInfo'),
  applyWindowLayout: (opts) => ipcRenderer.invoke('window:applyLayout', opts),
  snapHalfScreen: (side) => ipcRenderer.invoke('window:snapHalfScreen', side),
  onBoundsChange: (cb) => {
    const listener = (_ev: Electron.IpcRendererEvent, info: DisplayInfo) => cb(info);
    ipcRenderer.on('window:bounds-change', listener);
    return () => ipcRenderer.removeListener('window:bounds-change', listener);
  },

  getSnapshot: () => ipcRenderer.invoke('scraper:getSnapshot'),
  runScrapeNow: () => ipcRenderer.invoke('scraper:runNow'),
  scrapeDateRange: (dateWindow) => ipcRenderer.invoke('scraper:scrapeDateRange', dateWindow),
  setActiveDateRange: (dateWindow) => ipcRenderer.invoke('scraper:setActiveDateRange', dateWindow),
  verifyRowQuotes: (req) => ipcRenderer.invoke('scraper:verifyRow', req),
  verifyPuntaPunta: (req) => ipcRenderer.invoke('scraper:verifyPuntaPunta', req),
  stopAutoScrape: () => ipcRenderer.invoke('scraper:stopAuto'),
  startAutoScrape: () => ipcRenderer.invoke('scraper:startAuto'),
  onScrapeUpdate: (cb) => {
    const listener = (_ev: Electron.IpcRendererEvent, snapshot: ScrapeSnapshot) => cb(snapshot);
    ipcRenderer.on('scraper:update', listener);
    return () => ipcRenderer.removeListener('scraper:update', listener);
  },

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),

  listTrackedBets: () => ipcRenderer.invoke('tracker:list'),
  addTrackedBet: (bet) => ipcRenderer.invoke('tracker:add', bet),
  updateTrackedBetStatus: (payload) => ipcRenderer.invoke('tracker:updateStatus', payload),
  deleteTrackedBet: (id) => ipcRenderer.invoke('tracker:delete', id),

  listSavedMultiples: () => ipcRenderer.invoke('multiples:list'),
  saveMultiplePlan: (plan) => ipcRenderer.invoke('multiples:save', plan),
  deleteSavedMultiple: (id) => ipcRenderer.invoke('multiples:delete', id),

  listWatches: () => ipcRenderer.invoke('watches:list'),
  getWatchStatus: () => ipcRenderer.invoke('watches:getStatus'),
  createWatch: (input) => ipcRenderer.invoke('watches:create', input),
  updateWatch: (payload) => ipcRenderer.invoke('watches:update', payload),
  deleteWatch: (id) => ipcRenderer.invoke('watches:delete', id),
  runWatchCheckNow: () => ipcRenderer.invoke('watches:runNow'),
  ackWatchAlert: () => ipcRenderer.invoke('watches:ackAlert'),
  onWatchesUpdated: (cb) => {
    const listener = (
      _ev: Electron.IpcRendererEvent,
      payload: { watches: RatingWatch[]; status: RatingWatchEngineStatus }
    ) => cb(payload);
    ipcRenderer.on('watches:updated', listener);
    return () => ipcRenderer.removeListener('watches:updated', listener);
  },
  onWatchesTriggered: (cb) => {
    const listener = (_ev: Electron.IpcRendererEvent, events: RatingWatchTriggerEvent[]) =>
      cb(events);
    ipcRenderer.on('watches:triggered', listener);
    return () => ipcRenderer.removeListener('watches:triggered', listener);
  },

  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
};

contextBridge.exposeInMainWorld('oddspulse', api);

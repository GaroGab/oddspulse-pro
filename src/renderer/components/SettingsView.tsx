import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Columns2,
  LayoutGrid,
  LayoutPanelLeft,
  Maximize2,
  Monitor,
  Palette,
  Pin,
  RotateCcw,
  Settings,
  Sliders,
  Sparkles,
  ZoomIn,
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  THEME_CATALOG,
  type AppSettings,
  type DisplayInfo,
  type TableDensity,
  type ThemeId,
} from '../../shared/types';
import { SlidingPillTrack } from './SlidingPillTrack';

interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onNotify: (title: string, body: string) => void;
}

const WINDOW_PRESETS = [
  { id: 'compact', label: 'Compatta', w: 1120, h: 700, desc: 'Ideale per laptop 13"-14"' },
  { id: 'hd', label: 'HD Wide', w: 1280, h: 760, desc: 'Equilibrio compatto' },
  { id: 'pro', label: 'Standard Pro', w: 1500, h: 940, desc: 'Consigliata Full HD' },
  { id: 'fhd', label: 'Full HD Ampia', w: 1840, h: 1020, desc: 'Massima visibilità colonne' },
  { id: 'qhd', label: '2K / Ultrawide', w: 2200, h: 1200, desc: 'Monitor QHD / 4K' },
];

const ZOOM_PRESETS = [
  { label: '80%', val: 0.8 },
  { label: '90%', val: 0.9 },
  { label: '100%', val: 1.0 },
  { label: '110%', val: 1.1 },
  { label: '125%', val: 1.25 },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onNotify,
}) => {
  const [displayInfo, setDisplayInfo] = useState<DisplayInfo>({
    currentWidth: settings.windowWidth,
    currentHeight: settings.windowHeight,
    workAreaWidth: 1920,
    workAreaHeight: 1040,
    scaleFactor: 1,
    isMaximized: false,
    alwaysOnTop: settings.alwaysOnTop,
    zoomFactor: settings.uiScale,
  });

  const [draftWidth, setDraftWidth] = useState(settings.windowWidth);
  const [draftHeight, setDraftHeight] = useState(settings.windowHeight);

  useEffect(() => {
    setDraftWidth(settings.windowWidth);
    setDraftHeight(settings.windowHeight);
  }, [settings.windowWidth, settings.windowHeight]);

  useEffect(() => {
    window.oddspulse?.getDisplayInfo().then((info) => {
      setDisplayInfo(info);
    }).catch(() => {});

    const unsub = window.oddspulse?.onBoundsChange((info) => {
      setDisplayInfo(info);
    });
    return () => {
      unsub?.();
    };
  }, []);

  const applyDimensions = async (w: number, h: number, label?: string) => {
    const clampedW = Math.max(960, Math.min(Math.round(w), displayInfo.workAreaWidth));
    const clampedH = Math.max(620, Math.min(Math.round(h), displayInfo.workAreaHeight));
    setDraftWidth(clampedW);
    setDraftHeight(clampedH);
    const next = await window.oddspulse?.applyWindowLayout({
      width: clampedW,
      height: clampedH,
      maximize: false,
      center: true,
    });
    if (next) setDisplayInfo(next);
    onUpdateSettings({
      windowWidth: clampedW,
      windowHeight: clampedH,
      startMaximized: false,
    });
    onNotify(
      'Dimensioni Finestra Applicate',
      `${label ? `${label} — ` : ''}${clampedW} × ${clampedH} px`
    );
  };

  const applyMaximize = async () => {
    const next = await window.oddspulse?.applyWindowLayout({ maximize: true });
    if (next) setDisplayInfo(next);
    onNotify('Finestra Massimizzata', 'Schermata adattata all’intero monitor.');
  };

  const applySnap = async (side: 'left' | 'right') => {
    const next = await window.oddspulse?.snapHalfScreen(side);
    if (next) {
      setDisplayInfo(next);
      setDraftWidth(next.currentWidth);
      setDraftHeight(next.currentHeight);
      onUpdateSettings({
        windowWidth: next.currentWidth,
        windowHeight: next.currentHeight,
        startMaximized: false,
      });
    }
    onNotify(
      side === 'left' ? 'Affiancata a Sinistra' : 'Affiancata a Destra',
      'Perfetta per operare in split-screen accanto ai siti di scommesse.'
    );
  };

  const saveCurrentBounds = () => {
    setDraftWidth(displayInfo.currentWidth);
    setDraftHeight(displayInfo.currentHeight);
    onUpdateSettings({
      windowWidth: displayInfo.currentWidth,
      windowHeight: displayInfo.currentHeight,
    });
    onNotify(
      'Dimensioni Attuali Salvate',
      `Verrà riaperta a ${displayInfo.currentWidth} × ${displayInfo.currentHeight} px.`
    );
  };

  const applyZoom = async (scale: number) => {
    const clamped = Math.round(Math.max(0.75, Math.min(1.35, scale)) * 100) / 100;
    const next = await window.oddspulse?.applyWindowLayout({ uiScale: clamped });
    if (next) setDisplayInfo(next);
    onUpdateSettings({ uiScale: clamped });
  };

  const toggleAlwaysOnTop = async () => {
    const nextVal = !settings.alwaysOnTop;
    const next = await window.oddspulse?.applyWindowLayout({ alwaysOnTop: nextVal });
    if (next) setDisplayInfo(next);
    onUpdateSettings({ alwaysOnTop: nextVal });
  };

  const resetDefaults = async () => {
    onUpdateSettings({
      windowWidth: DEFAULT_SETTINGS.windowWidth,
      windowHeight: DEFAULT_SETTINGS.windowHeight,
      startMaximized: DEFAULT_SETTINGS.startMaximized,
      alwaysOnTop: DEFAULT_SETTINGS.alwaysOnTop,
      uiScale: DEFAULT_SETTINGS.uiScale,
      sidebarCompact: DEFAULT_SETTINGS.sidebarCompact,
      tableDensity: DEFAULT_SETTINGS.tableDensity,
      drawerWidth: DEFAULT_SETTINGS.drawerWidth,
      animationsEnabled: DEFAULT_SETTINGS.animationsEnabled,
      theme: DEFAULT_SETTINGS.theme,
    });
    const next = await window.oddspulse?.applyWindowLayout({
      width: DEFAULT_SETTINGS.windowWidth,
      height: DEFAULT_SETTINGS.windowHeight,
      maximize: false,
      alwaysOnTop: false,
      uiScale: 1,
      center: true,
    });
    if (next) setDisplayInfo(next);
    onNotify('Impostazioni Ripristinate', 'Dimensioni e layout riportati ai valori predefiniti.');
  };

  // Miniature preview proportions relative to real work area
  const previewWidthPct = Math.max(
    28,
    Math.min(100, (draftWidth / Math.max(1, displayInfo.workAreaWidth)) * 100)
  );
  const previewHeightPct = Math.max(
    32,
    Math.min(100, (draftHeight / Math.max(1, displayInfo.workAreaHeight)) * 100)
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
      {/* Header */}
      <div className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-accent-500 text-slate-950 shadow-glow">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-base font-bold text-white">
              Impostazioni Schermata, Layout & Terminale
            </h1>
            <p className="text-[11px] text-slate-400">
              Personalizza dimensioni finestra, split-screen, zoom interfaccia, larghezza pannelli e densità delle tabelle.
            </p>
          </div>
        </div>

        <button
          onClick={() => void resetDefaults()}
          className="flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900/80 px-3.5 py-2 text-xs font-semibold text-slate-300 transition hover:border-brand-400/40 hover:text-white"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Ripristina Predefiniti
        </button>
      </div>

      {/* Section 0: Live Dominant Color Theme Selector */}
      <div className="glass-panel rounded-2xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-brand-400" />
            <h2 className="font-display text-sm font-bold text-white">
              Tema & Colori Dominanti dell&apos;Applicazione
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">
            Cambia istantaneamente palette, sfondi, riflessi aurora e grafici
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {THEME_CATALOG.map((t) => {
            const isActive = (settings.theme || 'gold') === t.id;
            return (
              <motion.button
                key={t.id}
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  onUpdateSettings({ theme: t.id as ThemeId });
                  onNotify(`Tema ${t.name}`, 'Palette colori aggiornata in tempo reale.');
                }}
                className={`group relative overflow-hidden rounded-xl border p-2.5 text-left transition ${
                  isActive
                    ? 'border-brand-300/80 bg-brand-500/15 shadow-glow'
                    : 'border-slate-800 bg-slate-950/75 hover:border-slate-600'
                }`}
              >
                {/* Live dual-tone swatch bar */}
                <div
                  className="mb-2.5 h-7 w-full rounded-lg border border-white/15 shadow-inner flex items-center justify-end px-2"
                  style={{ background: t.previewGradient }}
                >
                  {isActive && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-950/85 text-white">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                </div>

                <div className="truncate text-xs font-bold text-white">{t.name}</div>
                <div className="mt-0.5 truncate text-[10px] text-slate-400">{t.subtitle}</div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Section 1: Window Dimensions + Live Monitor Preview */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="glass-panel space-y-4 rounded-2xl p-4 xl:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 text-brand-400" />
              <h2 className="font-display text-sm font-bold text-white">
                Dimensioni Finestra Principale
              </h2>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1 font-mono text-slate-300">
                Attuale:{' '}
                <strong className="text-brand-300">
                  {displayInfo.currentWidth} × {displayInfo.currentHeight}
                </strong>
              </span>
              <button
                onClick={saveCurrentBounds}
                className="rounded-lg border border-brand-400/35 bg-brand-500/10 px-2.5 py-1 font-semibold text-brand-200 transition hover:bg-brand-500/20"
              >
                Salva Attuali
              </button>
            </div>
          </div>

          {/* Resolution Presets */}
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Preset Risoluzione Finestra
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {WINDOW_PRESETS.map((p) => {
                const isSelected =
                  Math.abs(draftWidth - p.w) <= 20 && Math.abs(draftHeight - p.h) <= 20;
                const exceeds =
                  p.w > displayInfo.workAreaWidth || p.h > displayInfo.workAreaHeight;
                return (
                  <motion.button
                    key={p.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => void applyDimensions(p.w, p.h, p.label)}
                    className={`rounded-xl border p-2.5 text-left transition ${
                      isSelected
                        ? 'border-brand-400/60 bg-brand-500/15 shadow-glow'
                        : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{p.label}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-brand-300" />}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] font-semibold text-brand-300">
                      {p.w} × {p.h} px
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {exceeds ? 'Adattata al monitor' : p.desc}
                    </div>
                  </motion.button>
                );
              })}

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => void applyMaximize()}
                className={`rounded-xl border p-2.5 text-left transition ${
                  displayInfo.isMaximized
                    ? 'border-emerald-400/60 bg-emerald-500/15'
                    : 'border-slate-800 bg-slate-950/70 hover:border-emerald-400/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-300">Massimizzata</span>
                  <Maximize2 className="h-3.5 w-3.5 text-emerald-400" />
                </div>
                <div className="mt-0.5 font-mono text-[11px] font-semibold text-slate-200">
                  {displayInfo.workAreaWidth} × {displayInfo.workAreaHeight}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">Intera area schermo</div>
              </motion.button>
            </div>
          </div>

          {/* Split-Screen Matched Betting Quick Actions */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent-500/25 bg-accent-500/[0.06] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-accent-200">
              <Columns2 className="h-4 w-4 text-accent-400" />
              Split-Screen Rapido (affianca al browser):
            </div>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => void applySnap('left')}
                className="rounded-lg border border-accent-400/40 bg-accent-500/15 px-3 py-1.5 text-[11px] font-bold text-accent-100 transition hover:bg-accent-500/30"
              >
                Metà Sinistra (50%)
              </button>
              <button
                onClick={() => void applySnap('right')}
                className="rounded-lg border border-accent-400/40 bg-accent-500/15 px-3 py-1.5 text-[11px] font-bold text-accent-100 transition hover:bg-accent-500/30"
              >
                Metà Destra (50%)
              </button>
            </div>
          </div>

          {/* Custom Width / Height Sliders + Inputs */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="glass-card rounded-xl p-3">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-slate-300">Larghezza (px)</label>
                <input
                  type="number"
                  min={960}
                  max={displayInfo.workAreaWidth}
                  step={20}
                  value={draftWidth}
                  onChange={(e) => setDraftWidth(parseInt(e.target.value, 10) || 960)}
                  className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 text-right font-mono text-xs font-bold text-brand-200 focus:border-brand-400 focus:outline-none"
                />
              </div>
              <input
                type="range"
                min={960}
                max={Math.max(1280, displayInfo.workAreaWidth)}
                step={20}
                value={draftWidth}
                onChange={(e) => setDraftWidth(parseInt(e.target.value, 10))}
                className="pulse-slider mt-3 w-full"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
                <span>960px</span>
                <span>Max {displayInfo.workAreaWidth}px</span>
              </div>
            </div>

            <div className="glass-card rounded-xl p-3">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-slate-300">Altezza (px)</label>
                <input
                  type="number"
                  min={620}
                  max={displayInfo.workAreaHeight}
                  step={20}
                  value={draftHeight}
                  onChange={(e) => setDraftHeight(parseInt(e.target.value, 10) || 620)}
                  className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-0.5 text-right font-mono text-xs font-bold text-brand-200 focus:border-brand-400 focus:outline-none"
                />
              </div>
              <input
                type="range"
                min={620}
                max={Math.max(760, displayInfo.workAreaHeight)}
                step={20}
                value={draftHeight}
                onChange={(e) => setDraftHeight(parseInt(e.target.value, 10))}
                className="pulse-slider mt-3 w-full"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
                <span>620px</span>
                <span>Max {displayInfo.workAreaHeight}px</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => onUpdateSettings({ startMaximized: !settings.startMaximized })}
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  settings.startMaximized
                    ? 'border-brand-400/50 bg-brand-500/15 text-brand-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Avvia sempre massimizzata
              </button>

              <button
                onClick={() => void toggleAlwaysOnTop()}
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  settings.alwaysOnTop
                    ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                <Pin className="h-3.5 w-3.5" />
                Sempre in primo piano
              </button>
            </div>

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => void applyDimensions(draftWidth, draftHeight)}
              className="rounded-xl bg-gradient-to-r from-brand-300 to-accent-400 px-5 py-2 text-xs font-bold text-slate-950 shadow-glow hover:brightness-110"
            >
              Applica Dimensioni
            </motion.button>
          </div>
        </div>

        {/* Visual Proportional Monitor Preview */}
        <div className="glass-panel flex flex-col justify-between rounded-2xl p-4 xl:col-span-5">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-white">
                Anteprima Proporzioni Monitor
              </h2>
              <span className="font-mono text-[11px] text-slate-400">
                Schermo: {displayInfo.workAreaWidth} × {displayInfo.workAreaHeight}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Visualizzazione in tempo reale dell&apos;ingombro della finestra OddsPulse Pro sul tuo monitor principale.
            </p>
          </div>

          {/* Monitor Bezel Simulation */}
          <div className="my-4 flex flex-col items-center">
            <div className="relative flex aspect-video w-full max-w-[440px] items-center justify-center rounded-xl border-2 border-slate-700/90 bg-black/55 p-2 shadow-2xl">
              {/* Subtle screen grid */}
              <div className="bg-cyber-grid absolute inset-0 rounded-lg opacity-60" />

              {/* Animated Window Frame */}
              <motion.div
                animate={{
                  width: `${displayInfo.isMaximized ? 100 : previewWidthPct}%`,
                  height: `${displayInfo.isMaximized ? 100 : previewHeightPct}%`,
                }}
                transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                className="relative flex overflow-hidden rounded-lg border border-brand-400/70 bg-gradient-to-br from-brand-500/20 via-slate-900/90 to-accent-500/20 shadow-[0_0_24px_rgb(var(--brand-400)/0.35)]"
              >
                {/* Mini sidebar */}
                <div
                  className={`h-full border-r border-brand-400/25 bg-slate-950/75 transition-all ${
                    settings.sidebarCompact ? 'w-3' : 'w-10'
                  }`}
                />
                {/* Mini content + centered calculator modal indicator */}
                <div className="relative flex flex-1 flex-col items-center justify-center p-2 text-center">
                  <div
                    className="flex flex-col items-center justify-center rounded-md border border-accent-400/45 bg-accent-500/15 px-2.5 py-2 shadow-[0_0_16px_rgb(var(--accent-500)/0.25)]"
                    style={{
                      width: `${Math.max(38, Math.min(82, Math.round((settings.drawerWidth / Math.max(960, draftWidth)) * 100)))}%`,
                    }}
                    title="Finestra centrata Calcolatore Punta-Banca"
                  >
                    <div className="font-mono text-xs font-extrabold text-white">
                      {displayInfo.isMaximized
                        ? `${displayInfo.workAreaWidth} × ${displayInfo.workAreaHeight}`
                        : `${draftWidth} × ${draftHeight}`}
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-brand-300">
                      Zoom {Math.round(settings.uiScale * 100)}% • Calc {settings.drawerWidth}px
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
            {/* Monitor Stand */}
            <div className="h-3 w-16 rounded-b-md bg-slate-800" />
            <div className="h-1.5 w-28 rounded-full bg-slate-700/80" />
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-950/70 p-2.5 text-center text-[11px]">
            <div>
              <div className="text-[10px] text-slate-500">Copertura</div>
              <div className="font-mono font-bold text-brand-300">
                {Math.round((previewWidthPct * previewHeightPct) / 100)}%
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">DPI Sistema</div>
              <div className="font-mono font-bold text-white">
                {Math.round(displayInfo.scaleFactor * 100)}%
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Zoom App</div>
              <div className="font-mono font-bold text-emerald-300">
                {Math.round(settings.uiScale * 100)}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Interface Scaling, Panels & Visual Effects */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="glass-panel space-y-4 rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <ZoomIn className="h-4 w-4 text-emerald-400" />
            <h2 className="font-display text-sm font-bold text-white">
              Scala Interfaccia (Zoom) & Pannelli
            </h2>
          </div>

          {/* UI Zoom Slider + Pills */}
          <div className="glass-card rounded-xl p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Zoom Schermata Interfaccia
              </span>
              <span className="font-mono text-xs font-extrabold text-brand-300">
                {Math.round(settings.uiScale * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.75}
              max={1.35}
              step={0.05}
              value={settings.uiScale}
              onChange={(e) => void applyZoom(parseFloat(e.target.value))}
              className="pulse-slider mt-3 w-full"
            />
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {ZOOM_PRESETS.map((z) => (
                <button
                  key={z.label}
                  onClick={() => void applyZoom(z.val)}
                  className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold transition ${
                    Math.abs(settings.uiScale - z.val) < 0.02
                      ? 'border-brand-400/60 bg-brand-500/20 text-brand-200'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                  }`}
                >
                  {z.label}
                </button>
              ))}
            </div>
          </div>

          {/* Calculator Modal Width */}
          <div className="glass-card rounded-xl p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Larghezza Finestra Calcolatore Punta-Banca
              </span>
              <span className="font-mono text-xs font-bold text-accent-300">
                {settings.drawerWidth} px
              </span>
            </div>
            <input
              type="range"
              min={460}
              max={760}
              step={10}
              value={settings.drawerWidth}
              onChange={(e) =>
                onUpdateSettings({ drawerWidth: parseInt(e.target.value, 10) })
              }
              className="pulse-slider mt-3 w-full"
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
              <span>Compatta (460px)</span>
              <span>Standard (520px)</span>
              <span>Ampia (760px)</span>
            </div>
          </div>
        </div>

        <div className="glass-panel space-y-4 rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <LayoutPanelLeft className="h-4 w-4 text-accent-400" />
            <h2 className="font-display text-sm font-bold text-white">
              Spazi, Densità Tabelle & Effetti Visivi
            </h2>
          </div>

          {/* Sidebar Compact Toggle */}
          <div className="glass-card flex items-center justify-between rounded-xl p-3.5">
            <div>
              <div className="text-xs font-semibold text-white">Barra Laterale Compatta</div>
              <div className="text-[11px] text-slate-400">
                Riduci la sidebar a sole icone (76px) per allargare le tabelle Oddsmatcher.
              </div>
            </div>
            <button
              onClick={() => onUpdateSettings({ sidebarCompact: !settings.sidebarCompact })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                settings.sidebarCompact ? 'bg-brand-400' : 'bg-slate-700'
              }`}
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-slate-950 transition-transform ${
                  settings.sidebarCompact ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          {/* Table Density Selector */}
          <div className="glass-card rounded-xl p-3.5">
            <div className="mb-2 text-xs font-semibold text-white">
              Densità Righe Tabella Oddsmatcher
            </div>
            <SlidingPillTrack
              activeKey={settings.tableDensity}
              pillClassName="rounded-lg bg-gradient-to-r from-accent-400 to-brand-400 shadow-glow"
              className="grid grid-cols-3 gap-1.5 rounded-xl border border-slate-800 bg-slate-950/80 p-1"
            >
              {(
                [
                  { id: 'compact', label: 'Compatta' },
                  { id: 'comfortable', label: 'Bilanciata' },
                  { id: 'spacious', label: 'Ampia' },
                ] as Array<{ id: TableDensity; label: string }>
              ).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  data-pill-key={d.id}
                  onClick={() => onUpdateSettings({ tableDensity: d.id })}
                  className={`relative z-10 rounded-lg py-1.5 text-xs font-semibold transition ${
                    settings.tableDensity === d.id
                      ? 'text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </SlidingPillTrack>
          </div>

          {/* Ambient Glow / Animations Toggle */}
          <div className="glass-card flex items-center justify-between rounded-xl p-3.5">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-brand-300" />
              <div>
                <div className="text-xs font-semibold text-white">
                  Effetti Visivi Aurora & Animazioni
                </div>
                <div className="text-[11px] text-slate-400">
                  Sfondo luminoso animato, glow ambientale e transizioni fluide.
                </div>
              </div>
            </div>
            <button
              onClick={() => onUpdateSettings({ animationsEnabled: !settings.animationsEnabled })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                settings.animationsEnabled ? 'bg-brand-400' : 'bg-slate-700'
              }`}
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-slate-950 transition-transform ${
                  settings.animationsEnabled ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>
          {/* Oddsmatcher KPI Cards Toggle */}
          <div className="glass-card flex items-center justify-between rounded-xl p-3.5">
            <div className="flex items-center gap-2.5">
              <LayoutGrid className="h-4 w-4 text-accent-300" />
              <div>
                <div className="text-xs font-semibold text-white">
                  Schede Riepilogo Oddsmatcher (KPI)
                </div>
                <div className="text-[11px] text-slate-400">
                  Mostra o nascondi le 4 schede in alto (Miglior Rating, Match, Surebet, Liquidità) per dare più spazio alla tabella.
                </div>
              </div>
            </div>
            <button
              onClick={() =>
                onUpdateSettings({ showOddsmatcherKpis: !(settings.showOddsmatcherKpis ?? true) })
              }
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                (settings.showOddsmatcherKpis ?? true) ? 'bg-brand-400' : 'bg-slate-700'
              }`}
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-slate-950 transition-transform ${
                  (settings.showOddsmatcherKpis ?? true) ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Section 3: Default Matched Betting Parameters */}
      <div className="glass-panel rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sliders className="h-4 w-4 text-amber-400" />
          <h2 className="font-display text-sm font-bold text-white">
            Parametri Predefiniti Matched Betting
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500">
              Puntata Default (€)
            </label>
            <input
              type="number"
              min={1}
              step={5}
              value={settings.defaultStake}
              onChange={(e) =>
                onUpdateSettings({ defaultStake: Math.max(1, parseFloat(e.target.value) || 10) })
              }
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs font-bold text-brand-200 focus:border-brand-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500">
              Comm. Betfair EX (%)
            </label>
            <input
              type="number"
              min={0}
              max={15}
              step={0.5}
              value={Math.round(settings.betfairCommission * 1000) / 10}
              onChange={(e) =>
                onUpdateSettings({
                  betfairCommission: Math.max(0, (parseFloat(e.target.value) || 0) / 100),
                })
              }
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs font-bold text-amber-300 focus:border-brand-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500">
              Comm. Betflag EX (%)
            </label>
            <input
              type="number"
              min={0}
              max={15}
              step={0.5}
              value={Math.round((settings.betflagCommission ?? 0.05) * 1000) / 10}
              onChange={(e) =>
                onUpdateSettings({
                  betflagCommission: Math.max(0, (parseFloat(e.target.value) || 0) / 100),
                })
              }
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs font-bold text-sky-300 focus:border-brand-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500">
              Comm. Smarkets (%)
            </label>
            <input
              type="number"
              min={0}
              max={15}
              step={0.5}
              value={Math.round(settings.smarketsCommission * 1000) / 10}
              onChange={(e) =>
                onUpdateSettings({
                  smarketsCommission: Math.max(0, (parseFloat(e.target.value) || 0) / 100),
                })
              }
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs font-bold text-emerald-300 focus:border-brand-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500">
              Bankroll Exchange (€)
            </label>
            <input
              type="number"
              min={0}
              step={50}
              value={settings.bankrollExchange}
              onChange={(e) =>
                onUpdateSettings({
                  bankrollExchange: Math.max(0, parseFloat(e.target.value) || 0),
                })
              }
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs font-bold text-white focus:border-brand-400 focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

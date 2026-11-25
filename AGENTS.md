# AGENTS.md — OddsPulse Pro

Istruzioni di progetto per agenti di sviluppo su **OddsPulse Pro**. Questo file viene caricato automaticamente da Antigravity (e dagli agenti compatibili) per operare correttamente sulla codebase senza bisogno dello storico di conversazioni precedenti.

---

## 1. Panoramica e Stack Tecnologico

- **Progetto**: **OddsPulse Pro** — Terminale desktop di Matched Betting (Oddsmatcher Live, Multiodds Manuale/Automatico, Dutcher & Oddsmatcher Punta-Punta, Calcolatore Pro, Radar Rating, Telemetria Scraper e Tracker Profitti).
- **Repository GitHub**: `GaroGab/oddspulse-pro` (branch predefinito `main`).
- **Stack**: Electron `33.x`, React `18.x`, TypeScript `5.7.x`, Vite `5.x`, Tailwind CSS `3.x`, Framer Motion `11.15.0`, Recharts `2.x`, Vitest `2.x`.
- **Lingua**: Tutti i testi UI, tooltip, etichette e le risposte all'utente devono essere in **italiano**, salvo diversa richiesta.

---

## 2. Comandi di Sviluppo e Verifica

Su Windows PowerShell 5.1 usa `;` invece di `&&` e invoca `npm.cmd`. Se Node.js non è nel `PATH` predefinito della shell, anteponi `$env:LOCALAPPDATA\Programs\nodejs`.

- **Installazione dipendenze**: `npm install`
- **Sviluppo live**: `npm run dev`
- **Typecheck completo** (renderer + main process Electron):
  `npm run typecheck` (`tsc --noEmit && tsc -p tsconfig.electron.json --noEmit`)
- **Test unitari**:
  `npm test` (`vitest run` — suite in `src/shared/math.test.ts`)
- **Build di produzione** (necessaria prima di avviare Electron compilato / QA live):
  `npm run build` (`vite build && tsc -p tsconfig.electron.json`)
- **Avvio rapido Windows**: `start.bat` (o `npm start`)

Esegui **sempre** `typecheck`, `test` e `build` dopo le modifiche finali prima di considerare concluso un task.

---

## 3. Architettura e Mappa dei File Principali

```text
oddspulse-pro/
├── electron/
│   ├── main.ts                     # Finestra Electron, persistenza locale JSON, IPC, timer RatingWatch
│   ├── preload.ts                  # Espone l'API `window.oddspulse` (non `electronAPI`)
│   └── scrapers/
│       ├── scraperEngine.ts        # Motore scraping ciclico e mirato; popola rows, dutcherRows, backMarketGroups
│       ├── matchLinker.ts          # Linking cross-sito (`linkScrapedMarkets`, `matchesEventHints`)
│       └── *.ts                    # Connettori exchange (Betfair/Smarkets/Betflag) e bookmaker ADM/EU/Kambi/Pinnacle
├── src/
│   ├── shared/
│   │   ├── types.ts                # Tipi core, SOURCE_CATALOG, DEFAULT_SETTINGS, ScrapeSnapshot, RatingWatch, SavedMultiplePlan
│   │   ├── math.ts                 # Motore matematico: `calculateSingleMatch`, `calculateDutcher`, `calculatePuntaPunta`, `calculateSequentialMultiodds`, `findBestMultiodds`
│   │   ├── puntaPuntaMatcher.ts    # Matching Bookmaker-vs-Bookmaker (`extractBackMarketGroupsFromSnapshot`, `findPuntaPuntaMatches`)
│   │   ├── ratingWatch.ts          # Logica Radar Rating (`evaluateRatingWatch`, `computeAdaptiveWatchPlan`)
│   │   ├── savedMultiples.ts       # Salvataggio/ricalcolo progressivo multiple e sync quote live
│   │   ├── multioddsValidation.ts  # Validazione e ordinamento sequenziale gambe multipla
│   │   ├── networkHealth.ts        # Diagnostica rete/errori HTTP e formattazione messaggi amichevoli
│   │   ├── dateRange.ts            # Filtro calendario date condiviso tra UI e matcher
│   │   ├── welcomeBonusSimulator.ts # Motore simulazione profittabilità bonus benvenuto (Sport/Rollover/Casinò)
│   │   ├── welcomeBonuses.ts       # Catalogo guide step-by-step Bonus Benvenuto e siti esclusi
│   │   ├── welcomeBonuses.test.ts  # Verifica copertura SOURCE_CATALOG e profittabilità bonus
│   │   └── math.test.ts            # Suite Vitest principale
│   └── renderer/
│       ├── App.tsx                 # Shell principale, navigazione sezioni, banner alert Radar Rating
│       ├── assets/bookmakers/      # Loghi ufficiali PNG (128px) bundlati localmente via Vite per ogni `SourceId`
│       ├── utils/
│       │   ├── format.ts           # `formatEuro`, `formatOdds`, `formatPct`, `formatEventTime`, `ratingTone`, `sportLabel`
│       │   └── sound.ts            # `playCopyTick`, `playRatingAlertBurst`, `stopPersistentRatingAlarm`
│       └── components/
│           ├── OddsmatcherView.tsx         # Tabella live Punta/Banca, filtri, KPI e preset
│           ├── MultioddsView.tsx           # Tab predefinito `ManualMultioddsBuilder` + `SavedMultiplesView` + Ottimizzatore Auto
│           ├── DutcherView.tsx             # Sottosezioni `Scanner Automatico` + `Oddsmatcher Punta-Punta` (`PuntaPuntaMatcher` + `PuntaPuntaDrawer`)
│           ├── CalculatorView.tsx          # Calcolatore standalone Punta-Banca e Punta-Punta
│           ├── CalculatorDrawer.tsx        # Modale calcolo Punta-Banca da riga Oddsmatcher
│           ├── WelcomeBonusesView.tsx      # Sezione Bonus Benvenuto: guide step-by-step, checklist e simulatore live
│           ├── RatingWatchView.tsx         # Configurazione e gestione Radar Rating
│           ├── RatingAlertBanner.tsx       # Banner floating persistente per alert Rating raggiunti
│           ├── ScrapersView.tsx            # Stato fonti live, latenze, log e toggle fonti
│           ├── TrackerView.tsx             # Registro operazioni salvate e P&L
│           ├── SettingsView.tsx            # Temi, densità tabella, commissioni Exchange, stake predefinito
│           ├── SlidingPillTrack.tsx        # Controllo segmentato animato sicuro
│           ├── SourceSelect.tsx            # Dropdown singoli/multipli con tooltip errori fonti
│           ├── CustomSelect.tsx            # Dropdown portale generico (sostituisce `<select>` nativi)
│           ├── DateRangeCalendar.tsx       # Calendario intervallo date con densità eventi
│           ├── BookmakerIcon.tsx           # Render loghi ufficiali bookmaker/exchange
│           ├── NumericInput.tsx            # Input numerico decimale IT-friendly
│           ├── AnimatedNumber.tsx          # Numeri animati KPI/risultati
│           ├── ConnectionAlert.tsx         # Alert connettività/fonti con grace period
│           └── ViewErrorBoundary.tsx       # Error boundary per evitare schermate vuote
```

---

## 4. Vincoli Tecnici e Regole UI Critiche (Non Rompere)

### Framer Motion — Divieto di `layoutId` e `AnimatePresence mode="wait"`
- **MAI usare `layoutId`** né **`<AnimatePresence mode="wait">`** (in `framer-motion@11.15.0` hanno causato deadlock del cambio tab e schermate vuote).
- Per i selettori segmentati a pillola scorrevole usa sempre **`<SlidingPillTrack>`**:
  - Ogni `<button>` figlio diretto deve avere `data-pill-key="..."` **e obbligatoriamente `relative z-10`** nel `className`, altrimenti la pillola di sfondo (`z-0`) copre il testo dell'opzione attiva rendendolo illeggibile.
- Per le transizioni tra viste usa la classe CSS `.view-enter`; per i dialoghi/modali usa `<AnimatePresence>` standard con tween breve (`0.16s–0.18s`).

### API Esatte dei Componenti Condivisi
- **`NumericInput`**: accetta `{ value, onChange, min?, max?, allowDecimal?, placeholder?, className?, 'data-testid'? }`. **Non** accetta `step` né `decimals`.
- **`AnimatedNumber`**: usa la prop `formatter={(v) => ...}` (**non** `format`).
- **`SourceMultiSelect`**: usa `values={...}` (**non** `selected`). Costruisci sempre le opzioni con `buildBookmakerSourceOptions(snapshot)` e `buildExchangeSourceOptions(snapshot)` da `SourceSelect.tsx` per inibire automaticamente le fonti in errore (`state === 'error'`) mostrando il tooltip su hover.
- **`ConnectionAlert`**: accetta `{ snapshot, isBrowserOnline, variant, onRetry, onOpenScrapers }`.
- **Bridge Electron**: usa sempre `window.oddspulse?.openExternal(...)` e gli altri metodi tipizzati in `src/renderer/window.d.ts` (mai `window.electronAPI`).

### Tabelle Responsive e Densità
- Le tabelle dense (`OddsmatcherView.tsx`, `PuntaPuntaMatcher.tsx`) devono mantenere `min-w-[1040px]` dentro un contenitore scrollabile (`overflow-auto` / `overflow-x-auto`), `shrink-0` sui `BookmakerIcon` e `min-w-0` + `truncate` sui nomi di bookmaker ed exchange, così da prevenire sovrapposizioni testo/icone su finestre strette.

### Logica di Dominio e Invarianti Funzionali
- **Chiavi canoniche esiti scraper** (`electron/scrapers/scraperEngine.ts` e `src/shared/puntaPuntaMatcher.ts`):
  - `1X2`: `'HOME'`, `'DRAW'`, `'AWAY'`
  - `OVER_UNDER_25`: `'OVER_25'`, `'UNDER_25'`
  - `BTTS`: `'BTTS_YES'`, `'BTTS_NO'`
  - `H2H`: `'HOME'`, `'AWAY'`
- **Radar Rating (`src/shared/ratingWatch.ts`, `RatingWatchView.tsx`)**:
  - Il campo evento è **facoltativo** (`eventName: ''` supportato per monitorare qualsiasi match che soddisfi i filtri impostati).
  - Quando almeno un watch attivo è senza evento specifico, `computeAdaptiveWatchPlan` deve impostare `eventHints: []` per non filtrare via gli eventi nello scraping mirato.
  - Il pulsante di attivazione del tracking nel form resta **inibito** (`!hasAnyWatchFilter`) finché tutti i filtri di ricerca (`evento`, `sport`, `mercato`, `esito`, `bookmaker`, `exchange`) sono vuoti/predefiniti.
- **Multiodds (`MultioddsView.tsx`)**: il tab predefinito all'apertura è `Costruttore Manuale` (non l'ottimizzatore automatico), con supporto a salvataggio e modifica progressiva in `SavedMultiplesView`.
- **Dutcher (`DutcherView.tsx`)**: due sottosezioni (`Scanner Automatico` e `Oddsmatcher Punta-Punta`); per quest'ultima `ScraperEngine` emette `backMarketGroups` con le quote di tutti i bookmaker (non solo la migliore per esito) e `puntaPuntaMatcher.ts` include il fallback da `rows` + `dutcherRows`.

---

## 5. Sicurezza, QA e Igiene Repository

- **Segreti**: non committare mai API key (es. `theOddsApiKey` deve restare vuoto in `DEFAULT_SETTINGS`), file `.env`, file di stato Electron utente (`userData`) o credenziali.
- **File temporanei QA**: eventuali script di test Electron o screenshot vanno creati nella directory temporanea/scratch dell'agente o di sistema **fuori** dalla cartella del repository (non sporcare il working tree).
- **Verifica modifiche UI in Electron**: dopo `npm run build`, per modifiche grafiche o interattive rilevanti esegui una verifica reale caricando `dist/index.html` in Electron (`show: true`, intercettando `console-message` di livello `>= 2` = errore) e ispeziona visivamente gli screenshot risultanti.

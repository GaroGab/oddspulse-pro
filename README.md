# OddsPulse Pro — Terminale Matched Betting (Electron + React)

Terminale desktop **Electron + React + TypeScript + Tailwind CSS + Framer Motion** per il **Matched Betting**, con motore di scraping live integrato su Exchange e Bookmaker (ADM / EU), **Oddsmatcher**, **Multiodds**, **Dutcher & Oddsmatcher Punta-Punta**, **Calcolatore PRO**, **Radar Rating** e **Tracker Profitti**.

## Avvio Rapido

- **1-Click Windows**: fai doppio clic su `start.bat` nella root del progetto.
- **Installazione dipendenze**:
  ```bash
  npm install
  ```
- **Sviluppo (hot-reload Vite + Electron)**:
  ```bash
  npm run dev
  ```
- **Build & Avvio produzione**:
  ```bash
  npm run build
  npm start
  ```
- **Typecheck e Test unitari**:
  ```bash
  npm run typecheck
  npm test
  ```

## Funzionalità Principali

1. **Oddsmatcher Live (`OddsmatcherView`)**:
   - Confronto in tempo reale Punta vs Banca con Rating %, modalità *Normale*, *Freebet SNR*, *Bonus SR*, *Rimborso RF*, filtro calendario per intervallo date (`DateRangeCalendar`), preset rapidi, blocco/inibizione automatica dei bookmaker o exchange in errore con tooltip esplicativo, e **Calcolatore Punta-Banca Pro** con slider *Underlay / Bilanciato / Overlay*.
2. **Multiodds Pro (`MultioddsView`, `ManualMultioddsBuilder`, `SavedMultiplesView`)**:
   - **Costruttore Manuale** (predefinito): selezione progressiva degli eventi, validazione vincoli sequenziali/simultanee, **salvataggio dei piani multipla** per consultazione e ricalcolo progressivo al variare delle quote.
   - **Ottimizzatore Automatico**: generatore di multiple da 2 a 5 eventi con filtro di non-sovrapposizione oraria (*Gap Sequenziale*), supporto *Bonus Multipla %* e **Piano di Bancata Sequenziale**.
3. **Dutcher & Oddsmatcher Punta-Punta (`DutcherView`, `PuntaPuntaMatcher`, `PuntaPuntaDrawer`)**:
   - **Scanner Automatico**: rilevamento automatico 2-way e 3-way delle migliori quote cross-bookmaker senza Exchange.
   - **Oddsmatcher Punta-Punta**: vista tabellare manuale con tutti i filtri dell'Oddsmatcher (modalità Normale/SNR/SR/RF, Bookmaker Punta 1 e Bookmaker Copertura, esiti 2-way/3-way, lavagna, surebet, date) e calcolatore modale comparativo per scegliere/cambiare bookmaker su ogni esito.
4. **Calcolatore Standalone (`CalculatorView`)**:
   - Calcolatore dedicato Punta-Banca e Punta-Punta Pro (2–4 esiti) con tutte le modalità operative.
5. **Radar Rating (`RatingWatchView`)**:
   - Monitoraggio mirato di eventi specifici con scraping adattivo sugli operatori selezionati, soglia Rating >= target e avviso visivo + allarme sonoro persistente.
6. **Motore Scraping & Telemetria (`ScrapersView`, `electron/scrapers/`)**:
   - Monitoraggio in tempo reale di latenza, errori HTTP e stato di **Betfair Exchange IT**, **Smarkets**, **Betflag Exchange IT** e bookmaker ADM/EU (**Sisal.it**, **SNAI.it**, **Betflag.it**, **Eurobet.it**, **GoldBet.it**, **Betfair Sportsbook IT**, **888sport.it**, **LeoVegas.it**, **Unibet**, **Paf**, **Pinnacle**), oltre al connettore opzionale **The Odds API**.
7. **Tracker Profitti & Impostazioni (`TrackerView`, `SettingsView`)**:
   - Registro operazioni locale con salvataggio automatico, grafici P&L, temi personalizzabili, densità tabelle e commissioni Exchange configurabili.

## Struttura del Progetto

```text
oddspulse-pro/
├── electron/               # Main process Electron, preload IPC e scraper live
│   └── scrapers/           # Connettori Exchange/Bookmaker, matchLinker e ScraperEngine
├── src/
│   ├── shared/             # Tipi condivisi, matematica (math.ts), matcher Punta-Punta e test Vitest
│   └── renderer/           # Interfaccia React, componenti UI, asset loghi ufficiali
├── .github/workflows/      # Pipeline CI (typecheck, vitest, production build)
└── start.bat               # Launcher rapido Windows
```

---
name: update-welcome-bonuses
description: >-
  Procedura ricorrente completa per ricercare, analizzare i Termini e Condizioni,
  simulare la profittabilità (Matched Betting Sport/Exchange e Casinò +EV) e aggiornare
  le guide step-by-step della sezione Bonus Benvenuto di OddsPulse Pro per tutti i siti
  presenti in SOURCE_CATALOG. Attiva questa skill ogni volta che l'utente chiede di
  aggiornare, rivedere, verificare o rigenerare i bonus benvenuto o le relative guide.
---

# Aggiornamento Ricorrente — Sezione Bonus Benvenuto (OddsPulse Pro)

Usa questa procedura end-to-end ogni volta che devi aggiornare le offerte, i Termini e Condizioni, le simulazioni di profitto e le guide step-by-step nella sezione **Bonus Benvenuto**.

---

## Prerequisiti & Gestione Branch

1. Verifica lo stato git (`git status; git branch -a`).
2. Se richiesto o consigliato per aggiornamenti ampi, lavora su un branch dedicato (es. `chore/update-welcome-bonuses-YYYY-MM`).
3. Leggi sempre `SOURCE_CATALOG` in [src/shared/types.ts](../../../src/shared/types.ts) per ottenere l'elenco aggiornato al 100% di tutti i siti (`SourceId`) presenti nell'app:
   - Escludi aggregatori API non giocabili (es. `the_odds_api`).
   - Accorpa eventuali brand che condividono un unico conto gioco (es. `betfair_exchange` + `betfair_sportsbook`, `betflag_it` + `betflag_exchange`) indicando entrambi in `relatedSourceIds`.

---

## Fase 1 — Ricerca Profonda Offerte e T&C (Batch Paralleli)

Per **ogni sito** presente in `SOURCE_CATALOG`, esegui ricerche web aggiornate all'anno/mese corrente verificando **prima il bonus Sport/Exchange** e, se assente, chiuso o non profittevole, **il bonus Casinò/Slot**:

### Dati Obbligatori da Estrarre dai T&C Ufficiali
Consulta la checklist dettagliata in [references/tc-audit-checklist.md](./references/tc-audit-checklist.md). Per ciascun sito raccogli sempre:
1. **Stato operativo in Italia (ADM)**: concessione attiva? Chiusure recenti o migrazioni (es. Unibet IT)? Restrizioni geografiche (es. Smarkets UK/IE/MT)?
2. **Struttura offerta**: % su deposito, massimale €, eventuali bonus senza deposito (Standard vs SPID vs CIE), rimborsi/cashback, tranche settimanali.
3. **Codice promozionale e procedura di attivazione**: codice esatto, selezione obbligatoria in registrazione, consensi marketing, scadenza invio documenti.
4. **Deposito minimo / ottimale e metodi esclusi**: verificare sempre Skrill, Neteller, PayPal, Paysafecard, OnShop, Maestro, Revolut, Bonifico Bancario, carte prepagate.
5. **Requisiti di qualificazione (deposito)**: rollover deposito (1x, 3x, 6x, 7x, tabella scaglioni progressivi), singole vs multiple (numero minimo eventi), quota minima per evento e/o quota minima totale, esclusione sistemi / Cash Out / Asian Handicap / Bet Builder / eventi annullati a quota 1.00.
6. **Requisiti di utilizzo e conversione del Bonus**:
   - Tipo di bonus: `Real Bonus (SR 1x)`, `Freebet (SNR)`, `Bonus Gold / Rigioco / Fun Bonus (Mx rollover)`, `Rimborso / Cashback (RF)`.
   - Moltiplicatore rollover (`1x`, `3x`, `5x`, `6x`, `10x`, ecc.), numero minimo eventi, quota minima, **puntata massima per singolo ticket** (es. 10€ NetBet, 100€ SNAI/Eurobet/Gioco Digitale).
   - **CAP MASSIMO CONVERTIBILE (trappola critica!)**: se un Fun Bonus con rollover multiplo impone un cap ≤ 1x–1.5x del valore del bonus su multiple a quota alta, il bancaggio può diventare matematicamente in perdita (`-EV`)!
   - **Scadenza temporale**: giorni per depositare, giorni per completare il rollover, scadenza singole tranche (es. 2–3 giorni su Sisal/Betflag/DomusBet).
   - **Clausole collaterali**: eventuale blocco temporaneo sezione Exchange (es. Betflag 30gg), divieto saldo misto.

---

## Fase 2 — Simulazione Matematica e Selezione Profittabilità

Non fidarti MAI dei massimali pubblicitari. Verifica la profittabilità reale usando il motore [src/shared/welcomeBonusSimulator.ts](../../../src/shared/welcomeBonusSimulator.ts) (e/o uno script scratch temporaneo fuori dal repo):

### Parametri Standard dei 3 Scenari di Confronto
| Scenario | Rating Singola | Rating/Gamba Multipla | Commissione Exchange | Note |
| :--- | :---: | :---: | :---: | :--- |
| **Conservativo** | `94.5%` | `95.0%` | `5.0%` | Condizioni prudenti / liquidità media |
| **Realistico** | `96.5%` | `96.5%` | `4.5%` | Standard operativo con Oddsmatcher / Multiodds |
| **Ottimale** | `98.0%` | `97.8%` | `2.0%` | Quote top / commissione ridotta / promo multipla |

### Regole Decisionali di Selezione
1. **Bonus Sport / Exchange**:
   - **Seleziona** se il profitto netto atteso nello scenario **Realistico** è strettamente positivo (`netProfit >= +10€`, o `>= +5€` a rischio zero senza deposito) E operativamente eseguibile senza slippage estremo (es. escludi requisiti assurdi come multipla quota totale ≥ 15.00 su PokerStars Sport o scaglioni 24x–47x su Betflag Sport).
   - **Rollover Sport**: calcola SEMPRE sia il **Worst-Case lineare** (100% rollover completato) sia l'**EV con strategia Bust-Out** (svuotamento del saldo bonus sull'Exchange). Verifica sempre l'impatto di eventuali **Cap di conversione**.
   - **Multiple ≥ 3 eventi con rollover elevato (es. 6x–7x)**: calcola il **Break-Even Rating per gamba** e inserisci un avviso esplicito nella guida se nello scenario Conservativo il margine scende vicino a 0 o negativo.
2. **Fallback Casinò +EV** (solo se sul sito non esiste uno Sport profittevole o se lo Sport ha margine trascurabile rispetto a un Casinò senza deposito a rischio zero):
   - Valuta prima **Free Spins senza deposito** e **Fun Bonus senza deposito** (SPID/CIE/standard): con deposito `0€` il rischio monetario è `0€` → sempre `+EV` se convertibile.
   - Valuta **Bonus Deposito Casinò** solo con simulazione Monte Carlo / EV esatta:
     - Se il wagering richiede `M × Deposito` in **denaro reale** su slot (RTP ~96.5%), il break-even è `M < 1 / (1 - RTP)` (~28.5x per bonus 100%). Con `35x` reale (es. LeoVegas deposito) è **-EV** → scarta il deposito e guida solo i Free Spins senza deposito!
     - Se è un **Fun Bonus non-sticky** (saldo reale giocabile/prelevabile separatamente) o **senza deposito**, modella la strategia **2-Fasi** (Fase 1 alta volatilità per accumulare margine → Fase 2 bassa volatilità / alto RTP ≥ 97% per completare il rollover fino al cap).
3. **Esclusione ("Passa Avanti")**:
   - Se né Sport né Casinò risultano profittevoli o accessibili per residenti in Italia (es. siti chiusi, non ADM, no-bonus sharp), rimuovi il sito da `WELCOME_BONUS_GUIDES` e documenta in `EXCLUDED_WELCOME_SITES` data verifica, esito sport, esito casinò e motivazione esatta.

---

## Fase 3 — Aggiornamento Dati, Simulatore e Guide Step-by-Step

1. Aggiorna `WELCOME_BONUSES_LAST_UPDATED` (formato `YYYY-MM-DD`) in [src/shared/welcomeBonuses.ts](../../../src/shared/welcomeBonuses.ts).
2. Aggiorna `WELCOME_BONUS_GUIDES` per ogni sito selezionato:
   - Verifica `simulationModel` in modo che rifletta esattamente i T&C reali (deposito consigliato, scalabilità, gambe, quote medie, rollover, cap, tranche, parametri casinò).
   - Scrivi **5–8 step operativi chiari** in italiano (`setup` → `qualificante` → `sblocco` → `conversione` → `prelievo`), includendo per ogni step:
     - azione esatta (`exactAction`),
     - spiegazione operativa (`description`),
     - consiglio matematico (`mathTip`),
     - trappola T&C da evitare (`warning`),
     - eventuale pulsante rapido verso gli strumenti OddsPulse (`toolAction`: `oddsmatcher`, `multiodds`, `calculator`, `external`).
   - Per ogni guida `casino_fallback`, compila sempre `categoryReason` spiegando con numeri esatti perché lo sport è stato scartato.
3. Aggiorna `EXCLUDED_WELCOME_SITES` con tutti i siti esclusi e controlla che **ogni `SourceId` giocabile di `SOURCE_CATALOG`** sia presente o in `WELCOME_BONUS_GUIDES` (`sourceId` / `relatedSourceIds`) o in `EXCLUDED_WELCOME_SITES`.

---

## Fase 4 — Validazione Automatica, Build e QA Visivo

1. Esegui la suite completa di verifica (su Windows PowerShell 5.1 usa `;` e `npm.cmd`):
   ```powershell
   npm.cmd run typecheck; npm.cmd test; npm.cmd run build
   ```
2. Controlla che i test unitari in `src/shared/welcomeBonuses.test.ts` (eseguiti automaticamente da `npm test`) confermino:
   - Copertura del **100%** di `SOURCE_CATALOG` (nessun sito dimenticato).
   - Ogni guida selezionata ha **profitto atteso realistico > 0 €**.
   - Ogni sito in `casino_fallback` ha `categoryReason` valorizzato.
   - Coerenza matematica tra breakdown delle voci e profitto netto totale.
3. Se hai modificato anche la UI di `WelcomeBonusesView.tsx`, esegui la verifica in Electron compilato (`dist/index.html`) intercettando errori console e controllando visivamente gli screenshot (salvando file temporanei solo nella scratch directory fuori dal repository).

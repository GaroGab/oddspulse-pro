# Piano Riutilizzabile — Analisi e Aggiornamento Bonus Benvenuto (OddsPulse Pro)

> **Skill Antigravity collegata**: [`.agents/skills/update-welcome-bonuses/SKILL.md`](../.agents/skills/update-welcome-bonuses/SKILL.md)
>
> Questo documento conserva l'intero piano operativo eseguito per creare e mantenere nel tempo la sezione **Bonus Benvenuto** di OddsPulse Pro. Alla prossima richiesta di aggiornamento dei bonus, basta richiamare questo piano (o lasciare che Antigravity carichi automaticamente la skill `update-welcome-bonuses`).

---

## 1. Obiettivo e Ambito

Mantenere sempre aggiornate, accurate e matematicamente verificate le guide step-by-step di **Matched Betting (Sport/Exchange)** e, in fallback, di **Casinò +EV** per tutti i siti presenti in `SOURCE_CATALOG` ([`src/shared/types.ts`](../src/shared/types.ts)).

- **Copertura richiesta**: 100% dei siti giocabili in `SOURCE_CATALOG` (esclusi connettori API puri come `the_odds_api`).
- **Gerarchia di selezione per ogni sito**:
  1. Analisi profonda del **Bonus Benvenuto Sport / Exchange** e dei suoi T&C.
  2. Simulazione matematica su 3 scenari (**Conservativo**, **Realistico**, **Ottimale**).
  3. Se lo Sport è assente, chiuso, non profittevole (`EV <= 0`) o drasticamente inferiore a un bonus Casinò a rischio zero, analisi profonda del **Bonus Benvenuto Casinò / Slot** con simulazione Monte Carlo / EV.
  4. Se nessuno dei due è profittevole o accessibile in Italia (ADM), **esclusione** dalle guide attive e registrazione trasparente nella tabella `EXCLUDED_WELCOME_SITES`.

---

## 2. Procedura Operativa Step-by-Step

### Step A — Inventario Siti da `SOURCE_CATALOG`
1. Estrarre tutti i `SourceId` da `src/shared/types.ts`.
2. Raggruppare i brand multi-prodotto con conto unico (es. `betfair_exchange` + `betfair_sportsbook`; `betflag_it` + `betflag_exchange`).
3. Creare un branch separato per l'aggiornamento (es. `chore/update-welcome-bonuses-YYYY-MM`).

### Step B — Ricerca Web e Audit T&C Approfondito
Per ogni brand, eseguire ricerche mirate sulle pagine ufficiali dell'operatore ADM e sui principali tracker italiani, verificando ogni voce della [Checklist Audit T&C](../.agents/skills/update-welcome-bonuses/references/tc-audit-checklist.md):
- Licenza ADM attiva / eventuali chiusure o migrazioni.
- Offerta esatta (deposito, %, massimale, tranche, SPID/CIE vs registrazione standard).
- Codice promo e consensi obbligatori.
- Metodi di deposito esclusi (Skrill, Neteller, PayPal, Paysafecard, Maestro, Bonifico, Revolut, OnShop).
- Requisiti di sblocco/rollover (moltiplicatore, singole vs multiple, numero minimo eventi, quota minima per evento e totale, puntata massima per ticket, scadenze).
- **Cap massimo convertibile** e regole di wallet (`mixed` vs `bonus_first` vs non-sticky).

### Step C — Motore di Simulazione e Calcolo Profitto Atteso
Utilizzare `src/shared/welcomeBonusSimulator.ts` per valutare ogni offerta su:
- **Conservativo**: singola `94.5%`, gamba multipla `95.0%`, commissione `5.0%`, casinò prudente.
- **Realistico**: singola `96.5%`, gamba multipla `96.5%`, commissione `4.5%`, casinò standard.
- **Ottimale**: singola `98.0%`, gamba multipla `97.8%`, commissione `2.0%`, casinò ottimizzato.

Modelli supportati dal motore:
1. **Qualificante Normale** (singola o multipla sequenziale `r^N` con eventuale boost multipla).
2. **Real Bonus SR (1x)** (singola o multipla sequenziale).
3. **Freebet SNR** (`((Q - 1) / Q) * r^N`).
4. **Rollover con Strategia Bust-Out** (calcolo sia del **Worst-Case lineare** sia dell'**EV con svuotamento sull'Exchange**, includendo la penalità esplicita da eventuale **Cap di conversione**).
5. **Rimborso Exchange settimanale** (es. Betfair `ZBETEX`).
6. **Casinò Free Spins** (RTP × giri × valore, con eventuale rollover sulle vincite).
7. **Casinò Fun Bonus 2-Fasi** (simulazione Monte Carlo deterministica: Fase 1 alta volatilità → Fase 2 bassa volatilità / alto RTP fino al cap).
8. **Casinò Deposito in Denaro Reale** (verifica rigorosa `-EV` quando `M * (1 - RTP) > 100%`).

### Step D — Redazione Guide Step-by-Step in `src/shared/welcomeBonuses.ts`
Per ogni sito profittevole selezionato:
- Aggiornare `WELCOME_BONUSES_LAST_UPDATED`.
- Inserire `simulationModel` fedele ai T&C.
- Scrivere step numerati chiari (`setup`, `qualificante`, `sblocco`, `conversione`, `prelievo`) con azione esatta, nota matematica, avviso T&C e link rapido a Oddsmatcher / Multiodds / Calcolatore.
- Per i siti in `casino_fallback`, documentare chiaramente in `categoryReason` perché lo sport è stato scartato.
- Aggiornare `EXCLUDED_WELCOME_SITES` con i siti non profittevoli o non idonei.

### Step E — Verifica Automatica e QA
Eseguire sempre prima di chiudere il task:
```powershell
npm.cmd run typecheck; npm.cmd test; npm.cmd run build
```
Verificare che `src/shared/welcomeBonuses.test.ts` passi al 100% (copertura integrale di `SOURCE_CATALOG`, profittabilità positiva di ogni guida selezionata, coerenza calcoli). Se la UI è stata toccata, eseguire QA visivo in Electron su `dist/index.html`.

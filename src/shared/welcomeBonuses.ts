import type { BetMode, SourceId } from './types';
import type { WelcomeBonusSimulationModel } from './welcomeBonusSimulator';

export const WELCOME_BONUSES_LAST_UPDATED = '2026-11-25';

export type WelcomeBonusCategory = 'sport' | 'exchange' | 'casino_fallback';

export type WelcomeBonusTier = 'S' | 'A' | 'B' | 'C';

export type WelcomeBonusDifficulty = 'principiante' | 'intermedio' | 'avanzato';

export type WelcomeBonusStepPhase =
  | 'setup'
  | 'qualificante'
  | 'sblocco'
  | 'conversione'
  | 'prelievo';

export type RegistrationMethodTag = 'standard' | 'spid_recommended' | 'cie_recommended';

export interface WelcomeBonusToolAction {
  target: 'oddsmatcher' | 'multiodds' | 'calculator' | 'external';
  label: string;
  presetMode?: BetMode;
  url?: string;
}

export interface WelcomeBonusStep {
  id: string;
  stepNumber: number;
  phase: WelcomeBonusStepPhase;
  title: string;
  exactAction: string;
  description: string;
  mathTip?: string;
  warning?: string;
  toolAction?: WelcomeBonusToolAction;
}

export interface WelcomeBonusTermsSummary {
  bonusStructure: string;
  rolloverRule: string;
  minOddsRule: string;
  minLegs: number | null;
  excludedPayments: string[];
  validityRule: string;
  conversionCap: string;
  criticalWarnings: string[];
}

export interface WelcomeBonusGuide {
  id: string;
  sourceId: SourceId;
  /** Altri SourceId dello stesso operatore che condividono un unico conto gioco (es. Sportsbook + Exchange) */
  relatedSourceIds?: SourceId[];
  bookmakerName: string;
  url: string;
  category: WelcomeBonusCategory;
  /** Obbligatorio per category === 'casino_fallback': spiega con i numeri perché lo sport è stato scartato */
  categoryReason?: string;
  tier: WelcomeBonusTier;
  difficulty: WelcomeBonusDifficulty;
  headline: string;
  summary: string;
  promoCode: string | null;
  registrationMethod: RegistrationMethodTag;
  registrationNote: string;
  estimatedTimeLabel: string;
  expiryDays: number;
  strategyTags: string[];
  termsSummary: WelcomeBonusTermsSummary;
  simulationModel: WelcomeBonusSimulationModel;
  steps: WelcomeBonusStep[];
}

export interface ExcludedWelcomeSite {
  sourceId: SourceId;
  siteName: string;
  region: string;
  reasonShort: string;
  sportAudit: string;
  casinoAudit: string;
  note?: string;
  url: string;
}

export const WELCOME_BONUS_GUIDES: WelcomeBonusGuide[] = [
  // =========================================================================
  // 1. BET365.IT — SPORT (TIER S)
  // =========================================================================
  {
    id: 'bet365_sport_welcome',
    sourceId: 'bet365_it',
    bookmakerName: 'bet365.it',
    url: 'https://www.bet365.it/',
    category: 'sport',
    tier: 'S',
    difficulty: 'avanzato',
    headline: '100% fino a 500€ sul primo deposito (Singole ≥ 3.00)',
    summary:
      'Il bonus sportivo ADM dal valore assoluto più alto sul mercato: singole ammesse a quota ≥ 3.00 e 30 giorni di tempo. Con la strategia Bust-Out in modalità Rollover il profitto atteso supera i 400€ su deposito 500€ (ma è scalabile anche a 100€–200€ per bankroll ridotti).',
    promoCode: null,
    registrationMethod: 'standard',
    registrationNote: 'Registrazione standard + richiesta manuale offerta in "Il mio conto -> Offerte" entro 7 giorni.',
    estimatedTimeLabel: '2–5 giorni (scalabile)',
    expiryDays: 30,
    strategyTags: ['Singole Ammesse', 'Bust-Out Rollover', 'Scalabile', 'Top Profitto'],
    termsSummary: {
      bonusStructure: '100% sul primo versamento qualificante da 5€ fino a 500€ di saldo bonus.',
      rolloverRule: 'Sblocco con 1x deposito refertato; prelievo dopo 10x l’importo del bonus (es. 5.000€ su bonus 500€).',
      minOddsRule: 'Quota minima 3.00 su singole (o almeno una selezione ≥ 3.00 nelle multiple).',
      minLegs: 1,
      excludedPayments: ['PayPal', 'Paysafecard'],
      validityRule: '7 giorni per richiedere l’offerta; 30 giorni per completare il rollover.',
      conversionCap: 'Nessun cap penalizzante sul profitto bancabile.',
      criticalWarnings: [
        'NON depositare con PayPal o Paysafecard: usa Carta di debito/credito o Bonifico.',
        'Esclusi dal rollover: Cash Out, scommesse nulle (push), Asian Handicap e Somma Gol Asiatica.',
        'La quota minima 3.00 richiede liquidità Exchange adeguata (responsabilità ~2.2x–3x la puntata): se hai bankroll ridotto scala il deposito a 100€–200€ nel simulatore.',
      ],
    },
    simulationModel: {
      defaultDeposit: 500,
      minDeposit: 50,
      maxDeposit: 500,
      scalableDeposit: true,
      baseRecommendedBankroll: 1650,
      components: [
        {
          kind: 'qualifying_bet',
          label: 'Qualificante 1x deposito (singole ≥ 3.00)',
          depositMultiplier: 1,
          scalesWithDeposit: true,
          legs: 1,
          avgLegOdds: 3.3,
        },
        {
          kind: 'rollover_bustout',
          label: 'Rollover 10x Bonus (strategia Bust-Out)',
          pctOfDeposit: 100,
          maxAmount: 500,
          rolloverMultiplier: 10,
          legs: 1,
          avgLegOdds: 3.5,
          maxStakePerBet: 500,
        },
      ],
    },
    steps: [
      {
        id: 'bet365_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrazione, convalida e deposito con metodo idoneo',
        exactAction: 'Apri conto su bet365.it, valida il documento e deposita 500€ (o l’importo scelto nel simulatore) con Carta Visa/Mastercard.',
        description:
          'Completa l’iscrizione ed effettua il primo deposito qualificante (minimo 5€, ottimale 500€ se disponi di ~1.650€ sull’Exchange, oppure 100€–200€ se preferisci iniziare con responsabilità ridotta).',
        warning: 'Evita tassativamente PayPal e Paysafecard per il primo deposito: non qualificano per l’offerta.',
        toolAction: { target: 'external', label: 'Apri bet365.it', url: 'https://www.bet365.it/' },
      },
      {
        id: 'bet365_s2',
        stepNumber: 2,
        phase: 'setup',
        title: 'Richiedi manualmente l’offerta entro 7 giorni',
        exactAction: 'Vai in "Il mio conto" → "Offerte" → "Offerte disponibili" e clicca "Richiedi" prima di scommettere.',
        description:
          'Su bet365 il bonus non si attiva in automatico al deposito: va reclamato esplicitamente entro 7 giorni dalla registrazione/versamento.',
      },
      {
        id: 'bet365_s3',
        stepNumber: 3,
        phase: 'qualificante',
        title: 'Piazza la scommessa qualificante 1x a quota ≥ 3.00',
        exactAction: 'Scommetti il valore del deposito (es. 500€, anche diviso in 2×250€) su singole a quota ≥ 3.00 in modalità Normale.',
        description:
          'Usa l’Oddsmatcher filtrando su bet365 con quota minima 3.00 e rating ≥ 96.5% (mercati liquidi 1X2 o Over/Under 2.5 di calcio). Banca l’esito opposto su Betfair/Betflag Exchange.',
        mathTip: 'Se dividi 500€ in 2 singole da 250€ su eventi non sovrapposti dimezzi la responsabilità istantanea richiesta sull’Exchange.',
        warning: 'Mai usare Cash Out e mai puntare su Asian Handicap o mercati rimborsabili in caso di pareggio (DNB/push).',
        toolAction: { target: 'oddsmatcher', label: 'Cerca quote ≥ 3.00 in Oddsmatcher', presetMode: 'normal' },
      },
      {
        id: 'bet365_s4',
        stepNumber: 4,
        phase: 'sblocco',
        title: 'Attiva la strategia Bust-Out sul saldo Bonus (1° tentativo)',
        exactAction: 'Una volta accreditato il bonus (500€), punta l’intero bonus su una singola liquida a quota 3.20–4.00 usando il Calcolatore in modalità Rollover.',
        description:
          'Inserisci nel Calcolatore Pro: modalità Rollover, Saldo Reale attuale su bet365, Saldo Bonus 500€, Rollover rimanente 5.000€, Rating stimato 96.5%. Punta su bet365 e banca esattamente la cifra calcolata.',
        mathTip: 'A quota 3.50 c’è il 71% di probabilità che la puntata perda su bet365: in quel caso il saldo si azzera, il rollover 10x si chiude all’istante e incassi subito ~+440€ sull’Exchange!',
        toolAction: { target: 'calculator', label: 'Apri Calcolatore Rollover', presetMode: 'rollover' },
      },
      {
        id: 'bet365_s5',
        stepNumber: 5,
        phase: 'conversione',
        title: 'Se la prima giocata vince su bet365: completa il rollover residuo',
        exactAction: 'Se la scommessa vince su bet365 (prob. ~29%), prosegui con singole da 250€–500€ a quota ≥ 3.00 (rating ≥ 96.5%) fino al completamento dei 5.000€ entro 30 giorni.',
        description:
          'Anche completando integralmente tutti i 5.000€ di rollover lineare (worst-case), mantieni un profitto netto solido intorno a +300€ (con rating 96.5%). Monitora la barra avanzamento nella sezione Offerte.',
        toolAction: { target: 'oddsmatcher', label: 'Apri Oddsmatcher', presetMode: 'rollover' },
      },
      {
        id: 'bet365_s6',
        stepNumber: 6,
        phase: 'prelievo',
        title: 'Verifica completamento rollover e prelievo',
        exactAction: 'Attendi che il saldo bonus passi a saldo prelevabile e registra il profitto netto nel Tracker.',
        description:
          'Non richiedere alcun prelievo prima che la barra del rollover sia al 100% o il saldo bonus sia azzerato sull’Exchange, pena la decadenza immediata dei fondi bonus.',
      },
    ],
  },

  // =========================================================================
  // 2. SNAI.IT — SPORT (TIER S)
  // =========================================================================
  {
    id: 'snai_sport_welcome',
    sourceId: 'snai_it',
    bookmakerName: 'SNAI.it',
    url: 'https://www.snai.it/sport',
    category: 'sport',
    tier: 'S',
    difficulty: 'avanzato',
    headline: 'Bonus Gold 50% fino a 500€ (cod. BB_SPORT, Rollover 3x–6x)',
    summary:
      'Una delle offerte storiche più ricche in Italia: fino a 500€ di Bonus Gold (deposito 1.000€, oppure scalabile a 200€–400€). Sfruttando il tetto di 100€ per schedina in 5 multiple sequenziali da 3 eventi (modalità Rollover), oltre il 70% delle tranche si svuota subito sull’Exchange!',
    promoCode: 'BB_SPORT',
    registrationMethod: 'standard',
    registrationNote: 'Inserisci il codice BB_SPORT (o la variante sport attiva nel form) in registrazione e convalida il documento.',
    estimatedTimeLabel: '3–7 giorni',
    expiryDays: 15,
    strategyTags: ['Bonus Gold', 'Multiple 3 Eventi', 'Bust-Out', 'Scalabile'],
    termsSummary: {
      bonusStructure: '50% del primo deposito in Bonus Gold Sport fino a 500€ (deposito ottimale 1.000€; scalabile da 10€).',
      rolloverRule: 'Rollover 3x sull’importo del Bonus Gold (alcune varianti promo arrivano a 6x: regolabile nel simulatore).',
      minOddsRule: 'Solo multiple ≥ 3 eventi, quota minima 1.50 per ogni singolo evento; max 100€ di Bonus Gold per singolo ticket.',
      minLegs: 3,
      excludedPayments: ['Bonifico Bancario'],
      validityRule: 'Primo deposito entro 14 giorni dalla registrazione; 15 giorni per completare il rollover del Bonus Gold.',
      conversionCap: 'Nessun cap penalizzante: l’intero saldo convertito diventa Real Bonus/prelevabile.',
      criticalWarnings: [
        'NON usare Bonifico Bancario per il primo deposito e NON dimenticare il codice promozionale BB_SPORT in registrazione.',
        'Il Bonus Gold ha un tetto massimo di 100€ per singola schedina e NON può essere mischiato con saldo reale nella stessa scommessa.',
        'Controlla nei T&C del tuo account se la campagna attiva prevede 3x oppure 6x (entrambi restano altamente profittevoli col Bust-Out!).',
      ],
    },
    simulationModel: {
      defaultDeposit: 1000,
      minDeposit: 100,
      maxDeposit: 1000,
      scalableDeposit: true,
      baseRecommendedBankroll: 1100,
      variableRollover: {
        label: 'Moltiplicatore Rollover Bonus Gold (3x standard / 6x varianti)',
        defaultValue: 3,
        min: 3,
        max: 6,
      },
      components: [
        {
          kind: 'qualifying_bet',
          label: 'Movimentazione 1x deposito reale (singole)',
          depositMultiplier: 1,
          scalesWithDeposit: true,
          legs: 1,
          avgLegOdds: 2.0,
        },
        {
          kind: 'rollover_bustout',
          label: 'Bonus Gold 50% (ticket da max 100€, 3 eventi ≥ 1.50)',
          pctOfDeposit: 50,
          maxAmount: 500,
          rolloverMultiplier: 3,
          rolloverRange: [3, 6],
          legs: 3,
          avgLegOdds: 1.56,
          maxStakePerBet: 100,
        },
      ],
    },
    steps: [
      {
        id: 'snai_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrazione con codice BB_SPORT e convalida documento',
        exactAction: 'Registrati su SNAI.it inserendo il codice promo BB_SPORT e invia subito il documento d’identità.',
        description:
          'Verifica nella schermata di registrazione che il Bonus Benvenuto Sport sia selezionato e controlla nei T&C attivi il moltiplicatore di rollover (3x o 6x).',
        warning: 'Senza convalida del documento il Bonus Gold non viene erogato.',
        toolAction: { target: 'external', label: 'Apri SNAI.it', url: 'https://www.snai.it/sport' },
      },
      {
        id: 'snai_s2',
        stepNumber: 2,
        phase: 'setup',
        title: 'Deposito qualificante (evita Bonifico)',
        exactAction: 'Deposita fino a 1.000€ (per il max 500€ Bonus Gold, o 200€–400€ per bankroll più piccolo) tramite Carta o PayPal.',
        description:
          'Effettua il versamento entro 14 giorni dalla registrazione. Se preferisci operare con meno liquidità, imposta il tuo deposito nel Simulatore Profitto per ricalcolare tutte le cifre.',
        warning: 'Il Bonifico Bancario è escluso dalla promozione di benvenuto.',
      },
      {
        id: 'snai_s3',
        stepNumber: 3,
        phase: 'qualificante',
        title: 'Movimenta il deposito reale 1x su singole ad alto rating',
        exactAction: 'Gioca il deposito reale su 1–3 scommesse singole liquide a quota bassa (1.50–2.10) con rating ≥ 97% per renderlo prelevabile.',
        description:
          'Conviene ripulire prima il saldo reale su singole (molto più efficienti delle multiple!) prima di iniziare le multiple con Bonus Gold, così da non confondere mai i due wallet.',
        toolAction: { target: 'oddsmatcher', label: 'Trova singole SNAI ≥ 97%', presetMode: 'normal' },
      },
      {
        id: 'snai_s4',
        stepNumber: 4,
        phase: 'sblocco',
        title: 'Gioca il Bonus Gold in tranche da 100€ con Multiodds Sequenziale',
        exactAction: 'Costruisci 5 multiple sequenziali non sovrapposte (3 eventi ciascuna, ogni quota ≥ 1.50) da 100€ di Bonus Gold l’una.',
        description:
          'Usa il Multiodds di OddsPulse Pro selezionando SNAI, 3 gambe distanziate di almeno 2 ore (per bancare sequenzialmente una partita alla volta!) con quota per evento 1.50–1.75 e rating per gamba ≥ 96.5%.',
        mathTip: 'Con quota combinata ~3.75 ogni tranche da 100€ ha ~73% di probabilità di perdersi su SNAI già al 1° colpo, azzerando il proprio rollover e trasferendo subito il profitto sull’Exchange!',
        warning: 'Non selezionare mai giocate miste (Bonus + Saldo Reale) e non usare Cash Out o sistemi.',
        toolAction: { target: 'multiodds', label: 'Apri Multiodds su SNAI', presetMode: 'rollover' },
      },
      {
        id: 'snai_s5',
        stepNumber: 5,
        phase: 'conversione',
        title: 'Gestisci eventuali tranche vincenti fino a fine rollover',
        exactAction: 'Se una delle 5 multiple da 100€ vince tutte e 3 le partite (~375€ sul conto), continua con multiple da 100€ (3 eventi ≥ 1.50) finché il rollover residuo raggiunge 0€.',
        description:
          'Aggiorna passo dopo passo il Saldo Bonus e il Rollover Rimanente nel modulo Multiodds in modalità Rollover (con regola wallet Bonus First) per mantenere il profitto perfettamente bilanciato in ogni esito.',
        toolAction: { target: 'multiodds', label: 'Continua Rollover in Multiodds', presetMode: 'rollover' },
      },
      {
        id: 'snai_s6',
        stepNumber: 6,
        phase: 'prelievo',
        title: 'Conversione completata e prelievo',
        exactAction: 'Una volta esaurito il saldo Bonus Gold o completato il 100% del rollover entro 15 giorni, preleva eventuali vincite residue.',
        description: 'Registra il risultato finale nel Tracker Profitti per confrontarlo con la simulazione.',
      },
    ],
  },

  // =========================================================================
  // 3. GIOCO DIGITALE — SPORT (TIER S)
  // =========================================================================
  {
    id: 'giocodigitale_sport_welcome',
    sourceId: 'giocodigitale_it',
    bookmakerName: 'Gioco Digitale',
    url: 'https://www.giocodigitale.it/it/sports',
    category: 'sport',
    tier: 'S',
    difficulty: 'intermedio',
    headline: '100% fino a 200€ Real Bonus Sport (3x deposito @ 3.50)',
    summary:
      'Uno dei migliori rapporti tempo/profitto in Italia: singole ammesse per qualificazione 3x a quota ≥ 3.50 (600€ volume) che sbloccano 200€ di Real Bonus 1x. Profitto netto pulito di circa +170€ in meno di una settimana.',
    promoCode: null,
    registrationMethod: 'standard',
    registrationNote: 'Registrazione standard + primo deposito entro 7 giorni (giorno di apertura incluso).',
    estimatedTimeLabel: '2–4 giorni',
    expiryDays: 7,
    strategyTags: ['Singole Ammesse', 'Real Bonus 1x', 'Alto ROI', 'Veloce'],
    termsSummary: {
      bonusStructure: '100% sul primo deposito fino a 200€ in Real Bonus Sport (+ 5€ Bingo).',
      rolloverRule: 'Sblocco: movimentare 3x il deposito (600€ su dep. 200€) entro 7 giorni. Real Bonus: rigioco 1x (max 100€ per singola giocata bonus).',
      minOddsRule: 'Quota minima 3.50 per le scommesse qualificanti (singole ammesse!).',
      minLegs: 1,
      excludedPayments: ['Maestro', 'Skrill', 'Neteller', 'Paysafecard'],
      validityRule: '7 giorni dalla registrazione per deposito e qualificante 3x.',
      conversionCap: 'Max 100€ di bonus per singola schedina (quindi 2 giocate da 100€).',
      criticalWarnings: [
        'Deposita ESCLUSIVAMENTE con Visa, Mastercard o Postepay (il circuito Maestro e gli e-wallet sono esclusi!).',
        'I 7 giorni decorrono dal giorno stesso della registrazione: registrati solo quando hai eventi liquidi pronti per completare i 600€ di qualificante.',
        'Il tetto normativo per giocata bonus è 100€: spezza i 200€ di Real Bonus in 2 scommesse da 100€.',
      ],
    },
    simulationModel: {
      defaultDeposit: 200,
      minDeposit: 20,
      maxDeposit: 200,
      scalableDeposit: true,
      baseRecommendedBankroll: 750,
      components: [
        {
          kind: 'qualifying_bet',
          label: 'Qualificante 3x deposito (singole ≥ 3.50)',
          depositMultiplier: 3,
          scalesWithDeposit: true,
          legs: 1,
          avgLegOdds: 3.6,
        },
        {
          kind: 'real_bonus_sr',
          label: 'Real Bonus 100% (2×100€ singole SR 1x)',
          pctOfDeposit: 100,
          maxAmount: 200,
          legs: 1,
          avgLegOdds: 2.2,
        },
      ],
    },
    steps: [
      {
        id: 'gd_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrazione e deposito 200€ con Visa/Mastercard/Postepay',
        exactAction: 'Apri conto su Gioco Digitale, invia il documento e deposita 200€ con Visa, Mastercard o Postepay.',
        description:
          'Seleziona l’offerta di benvenuto Sport (NON quella Casinò). Controlla di avere almeno 650€–750€ disponibili sull’Exchange per coprire le quote ≥ 3.50.',
        warning: 'Esclusi circuito Maestro, Skrill, Neteller e Paysafecard.',
        toolAction: { target: 'external', label: 'Apri Gioco Digitale', url: 'https://www.giocodigitale.it/it/sports' },
      },
      {
        id: 'gd_s2',
        stepNumber: 2,
        phase: 'qualificante',
        title: 'Completa i 600€ di volume qualificante a quota ≥ 3.50 (entro 7gg)',
        exactAction: 'Piazza 3 scommesse singole (es. 3×200€, oppure 6×100€) a quota ≥ 3.50 in modalità Normale con rating ≥ 96.5%.',
        description:
          'Se la prima scommessa da 200€ perde su Gioco Digitale, puoi ridepositare (senza impattare la promo) o spezzare in 6×100€ per ruotare più facilmente il capitale senza bloccare troppa responsabilità.',
        mathTip: 'A rating 96.5% i 600€ di volume qualificante ti costano solo ~21€ a fronte di 200€ di Real Bonus!',
        warning: 'Tutti i 600€ devono essere giocati e preferibilmente refertati entro il 7° giorno dalla registrazione.',
        toolAction: { target: 'oddsmatcher', label: 'Cerca quote ≥ 3.50 su Gioco Digitale', presetMode: 'normal' },
      },
      {
        id: 'gd_s3',
        stepNumber: 3,
        phase: 'conversione',
        title: 'Converti i 200€ di Real Bonus in 2 singole da 100€',
        exactAction: 'Appena accreditato il Real Bonus (200€), piazza 2 singole da 100€ (quota bassa 1.60–2.30, rating ≥ 97%) in modalità SR (Bonus Reale).',
        description:
          'Trattandosi di Real Bonus (Stake Returned), la puntata viene restituita nella vincita: usa il Calcolatore in modalità SR su quote basse/medie per estrarre ~96.5%–98% del valore nominale (~193€).',
        toolAction: { target: 'calculator', label: 'Apri Calcolatore SR', presetMode: 'sr' },
      },
      {
        id: 'gd_s4',
        stepNumber: 4,
        phase: 'prelievo',
        title: 'Preleva il saldo residuo e sfrutta i 5€ Bingo extra',
        exactAction: 'Preleva l’eventuale saldo vinto su Gioco Digitale e chiudi l’operazione registrando il profitto (~+172€).',
        description:
          'I 5€ extra Bingo inclusi nel pacchetto sono giocabili a rischio zero per un piccolo EV aggiuntivo (~+3€).',
      },
    ],
  },

  // =========================================================================
  // 4. BETSSON.IT — SPORT (TIER A — AVANZATO, SOGLIA RATING CRITICA)
  // =========================================================================
  {
    id: 'betsson_sport_welcome',
    sourceId: 'betsson_it',
    bookmakerName: 'Betsson.it',
    url: 'https://www.betsson.it/scommesse',
    category: 'sport',
    tier: 'A',
    difficulty: 'avanzato',
    headline: '100% fino a 2.000€ (6x–7x multiple ≥3 eventi) + Senza Deposito CIE/SPID',
    summary:
      'Massimale enorme fino a 2.000€, ma con rollover deposito 6x–7x su multiple da 3 eventi (≥ 1.50). ATTENZIONE: è profittevole SOLO usando Multiodds con rating ≥ 96.0% per singola gamba (break-even ~95.3% su 6x)! Guida calibrata su deposito gestibile 500€ (scalabile) + extra Senza Deposito Casinò.',
    promoCode: null,
    registrationMethod: 'cie_recommended',
    registrationNote: 'Registrandoti con CIE sblocchi fino a 2.000€ senza deposito (1.000€ Casinò + 1.000€ Sport), con SPID 1.000€, manuale 200€.',
    estimatedTimeLabel: '7–20 giorni',
    expiryDays: 30,
    strategyTags: ['Multiodds Obbligatorio', 'Rating ≥ 96%/gamba', 'Scalabile', 'Bonus CIE Extra'],
    termsSummary: {
      bonusStructure: '100% sul primo deposito fino a 2.000€ + Bonus Senza Deposito CIE (2.000€) / SPID (1.000€) / Standard (200€).',
      rolloverRule: 'Deposito da rigiocare 6x (in alcune campagne 7x: seleziona nel simulatore!) entro 30 giorni; Real Bonus finale da rigiocare 1x su 3 eventi.',
      minOddsRule: 'Multiple ≥ 3 eventi con quota minima 1.50 per ogni evento. (Il Fun Bonus Sport senza deposito richiede 8 eventi ≥ 1.50: non bancabile, usalo come freeroll).',
      minLegs: 3,
      excludedPayments: ['Skrill', 'Neteller'],
      validityRule: '30 giorni dalla registrazione per il bonus deposito; 3–5 giorni per le tranche senza deposito.',
      conversionCap: 'Nessun cap penalizzante sul bonus deposito fino a 2.000€.',
      criticalWarnings: [
        'SOGLIA CRITICA: con 6x su multiple da 3 eventi, se il rating medio per gamba scende sotto 95.3% vai in PERDITA! Punta SOLO eventi con rating ≥ 96.5%/gamba (rating multipla ≥ 90%).',
        'Controlla nei T&C al momento dell’iscrizione se il rollover deposito è 6x o 7x e imposta il valore esatto nel Simulatore qui a fianco.',
        'Escluse singole, sistemi e depositi con Skrill/Neteller.',
      ],
    },
    simulationModel: {
      defaultDeposit: 500,
      minDeposit: 50,
      maxDeposit: 2000,
      scalableDeposit: true,
      baseRecommendedBankroll: 1200,
      variableRollover: {
        label: 'Rollover Deposito Betsson (6x standard / 7x variante)',
        defaultValue: 6,
        min: 6,
        max: 7,
      },
      components: [
        {
          kind: 'qualifying_bet',
          label: 'Rollover deposito (multiple 3 eventi ≥ 1.50)',
          depositMultiplier: 6,
          scalesWithDeposit: true,
          legs: 3,
          avgLegOdds: 1.58,
        },
        {
          kind: 'real_bonus_sr',
          label: 'Real Bonus 100% (1x su multiple 3 eventi ≥ 1.50)',
          pctOfDeposit: 100,
          maxAmount: 2000,
          legs: 3,
          avgLegOdds: 1.58,
        },
      ],
    },
    steps: [
      {
        id: 'betsson_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrati con CIE o SPID e verifica il moltiplicatore attivo (6x o 7x)',
        exactAction: 'Apri il conto su Betsson.it con CIE (o SPID) e verifica nei T&C se il rollover sul deposito è 6x oppure 7x.',
        description:
          'Con CIE ottieni in aggiunta il pacchetto senza deposito (metà Sport 8 eventi, metà Casinò). Gioca la parte Casinò senza deposito a rischio zero; la parte Sport da 8 eventi non va bancata (giocala solo come tentativo gratuito a 0€ di rischio).',
        toolAction: { target: 'external', label: 'Apri Betsson.it', url: 'https://www.betsson.it/scommesse' },
      },
      {
        id: 'betsson_s2',
        stepNumber: 2,
        phase: 'setup',
        title: 'Calibra il deposito nel Simulatore e versa con Carta',
        exactAction: 'Deposita l’importo scelto (consigliato 200€–500€ per iniziare; max 2.000€ solo per esperti) con Carta Visa/Mastercard o Bonifico.',
        description:
          'Non farti tentare subito dai 2.000€ se non hai tempo per generare 12.000€ di volume in 30 giorni su multiple da 3 eventi ad altissimo rating. Un deposito da 500€ richiede 3.000€ di volume (es. 15–20 multiple ben selezionate).',
        warning: 'Skrill e Neteller sono esclusi dalla promozione.',
      },
      {
        id: 'betsson_s3',
        stepNumber: 3,
        phase: 'qualificante',
        title: 'Sviluppa il 6x/7x SOLO con multiple 3 eventi ad altissimo rating',
        exactAction: 'Usa Multiodds su Betsson impostando 3 eventi non sovrapposti (gap ≥ 2h), quota minima 1.50 e filtro rating multipla ≥ 90% (≥ 96.5%/gamba).',
        description:
          'Questa è la fase decisiva: ogni punto percentuale di rating per gamba su 6x sposta il profitto di oltre 18 punti percentuali! Usa campionati top (Serie A, Premier, Champions) poco prima del calcio d’inizio per trovare rating 97%–98.5% per gamba.',
        mathTip: 'Esempio su deposito 500€ (6x = 3.000€): a 96.5%/gamba perdi ~304€ e incassi ~449€ dal bonus (+145€ netti); a 97.8%/gamba perdi solo ~193€ e incassi ~467€ (+274€ netti)!',
        warning: 'Fermati subito se trovi solo rating < 95.5%/gamba: aspetta il weekend o usa Smarkets/commissione ridotta.',
        toolAction: { target: 'multiodds', label: 'Apri Multiodds su Betsson', presetMode: 'normal' },
      },
      {
        id: 'betsson_s4',
        stepNumber: 4,
        phase: 'conversione',
        title: 'Converti il Real Bonus sbloccato (1x su 3 eventi ≥ 1.50)',
        exactAction: 'Al raggiungimento del volume 6x/7x, gioca il Real Bonus ricevuto su multiple sequenziali da 3 eventi (q ≥ 1.50) in modalità SR.',
        description:
          'Costruisci le multiple in Multiodds (modalità SR) preferendo quote 1.50–1.70 per tenere bassa la responsabilità cumulativa sull’Exchange.',
        toolAction: { target: 'multiodds', label: 'Converti Bonus in Multiodds (SR)', presetMode: 'sr' },
      },
      {
        id: 'betsson_s5',
        stepNumber: 5,
        phase: 'prelievo',
        title: 'Incassa il profitto e registra l’operazione',
        exactAction: 'Preleva l’eventuale saldo reale residuo su Betsson dopo la refertazione delle multiple bonus.',
        description: 'Annota il guadagno effettivo nella scheda Bonus Benvenuto e nel Tracker.',
      },
    ],
  },

  // =========================================================================
  // 5. PLANETWIN365.IT — SPORT (TIER A)
  // =========================================================================
  {
    id: 'planetwin365_sport_welcome',
    sourceId: 'planetwin365_it',
    bookmakerName: 'Planetwin365.it',
    url: 'https://www.planetwin365.it/it/scommesse',
    category: 'sport',
    tier: 'A',
    difficulty: 'intermedio',
    headline: '25% fino a 100€ + Rimborso Settimanale 10€/sett × 10 settimane',
    summary:
      'Doppia leva di profitto del gruppo GBO: 100€ di Bonus Rigioco Sport sulla prima ricarica (5x su 5 eventi @1.70: oltre il 93% di bust-out immediato!) PIÙ 10€ a settimana per 10 settimane (100€ extra). Profitto combinato stimato ~+130€.',
    promoCode: null,
    registrationMethod: 'standard',
    registrationNote: 'SPID attualmente disattivato su GBO: usa registrazione standard con CIE, Patente o Passaporto (NO carta d’identità cartacea).',
    estimatedTimeLabel: '10 settimane (15 min/sett)',
    expiryDays: 7,
    strategyTags: ['Bust-Out 93%', 'Rimborso 10 Settimane', 'Multiodds'],
    termsSummary: {
      bonusStructure: '25% primo deposito fino a 100€ Bonus Rigioco Sport (dep. 400€) + 50% rimborso settimanale fino a 10€/sett per 10 settimane (tot. 100€).',
      rolloverRule: 'Bonus prima ricarica: 5x (= 500€) su multiple ≥ 5 eventi q ≥ 1.70 entro 7gg (saldo residuo → Real Bonus 1x). Bonus settimanali: rigioco entro 7gg.',
      minOddsRule: 'Multipla ≥ 5 eventi con quota minima 1.70 per singolo evento (max 100€ bonus per ticket).',
      minLegs: 5,
      excludedPayments: ['Skrill', 'Neteller', 'OnShop', 'Titolo di Ricarica'],
      validityRule: 'Primo deposito entro 7 giorni; ogni bonus ha scadenza 7 giorni dall’accredito.',
      conversionCap: 'Saldo residuo del Bonus Rigioco convertito in Real Bonus 1x (nessun cap distruttivo 1x sulla singola giocata; verificare box Area Bonus).',
      criticalWarnings: [
        'NON utilizzare Carta d’Identità cartacea per la convalida: su Planetwin365/GBO sono accettati solo CIE, Passaporto o Patente.',
        'La quota combinata di 5 eventi a 1.72 è ~15.0: dividi i 100€ di bonus in 2 tranche da 50€ (o 4×25€) per mantenere gestibile la responsabilità sull’Exchange se dovessero entrare tutte e 5 le gambe.',
        'Esclusi Skrill, Neteller, OnShop, Titolo di Ricarica, sistemi e Cash Out.',
      ],
    },
    simulationModel: {
      defaultDeposit: 400,
      minDeposit: 20,
      maxDeposit: 400,
      scalableDeposit: true,
      baseRecommendedBankroll: 900,
      components: [
        {
          kind: 'qualifying_bet',
          label: 'Movimentazione 1x deposito reale (singole)',
          depositMultiplier: 1,
          scalesWithDeposit: true,
          legs: 1,
          avgLegOdds: 2.0,
        },
        {
          kind: 'rollover_bustout',
          label: 'Bonus Rigioco 25% (5x su 5 eventi ≥ 1.70, 2×50€)',
          pctOfDeposit: 25,
          maxAmount: 100,
          rolloverMultiplier: 5,
          legs: 5,
          avgLegOdds: 1.72,
          maxStakePerBet: 50,
          finalRealBonusWagering: 1,
          finalRealLegs: 1,
        },
        {
          kind: 'qualifying_bet',
          label: 'Qualificanti settimanali (10 sett × 20€, 3 eventi)',
          stake: 20,
          count: 10,
          legs: 3,
          avgLegOdds: 1.55,
        },
        {
          kind: 'real_bonus_sr',
          label: 'Rimborsi settimanali (10 sett × 10€ Bonus Sport)',
          fixedAmount: 10,
          count: 10,
          legs: 3,
          avgLegOdds: 1.55,
        },
      ],
    },
    steps: [
      {
        id: 'pw_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrati selezionando Bonus Benvenuto Sport e valida il conto',
        exactAction: 'Apri conto su Planetwin365.it, seleziona "Bonus Benvenuto Sport" nel form e carica CIE, Patente o Passaporto.',
        description: 'Non serve alcun codice promo testuale, ma è obbligatorio selezionare il bonus sport durante l’iscrizione.',
        warning: 'La carta d’identità cartacea non è più accettata per nuove aperture.',
        toolAction: { target: 'external', label: 'Apri Planetwin365.it', url: 'https://www.planetwin365.it/it/scommesse' },
      },
      {
        id: 'pw_s2',
        stepNumber: 2,
        phase: 'setup',
        title: 'Deposita 400€ entro 7 giorni con Carta o PayPal',
        exactAction: 'Effettua una prima ricarica di 400€ (per ottenere il massimo di 100€) entro 7 giorni usando Carta o PayPal.',
        description: 'Se vuoi dedicare meno capitale, puoi scalare il deposito (es. 200€ → 50€ bonus) nel simulatore.',
        warning: 'Esclusi Skrill, Neteller, OnShop e Titolo di Ricarica.',
      },
      {
        id: 'pw_s3',
        stepNumber: 3,
        phase: 'qualificante',
        title: 'Movimenta il deposito 400€ su singole liquide (1x)',
        exactAction: 'Piazza 1 o 2 singole per un totale di 400€ su quote 1.60–2.20 con rating ≥ 96.5% in modalità Normale.',
        description: 'Libera il saldo reale senza vincoli di multipla così da poterlo prelevare subito a fine operazione.',
        toolAction: { target: 'oddsmatcher', label: 'Trova singole Planetwin365', presetMode: 'normal' },
      },
      {
        id: 'pw_s4',
        stepNumber: 4,
        phase: 'sblocco',
        title: 'Converti i 100€ di Bonus Rigioco in 2 multiple da 50€ (5 eventi ≥ 1.70)',
        exactAction: 'Seleziona il wallet Bonus in schedina (voce in rosso) e piazza 2 multiple sequenziali da 50€ (5 eventi non sovrapposti, q ≥ 1.70) con Multiodds in modalità Rollover.',
        description:
          'Con 5 eventi a quota ~1.72 la quota totale è ~15.0: nel 93% dei casi ciascuna multipla si interrompe su una delle 5 gambe, azzerando il rollover 5x e pagando subito sull’Exchange!',
        mathTip: 'Spezzare 100€ in 2×50€ dimezza la responsabilità massima nel raro 6.6% di casi in cui tutte e 5 le partite vincono (~750€ anziché 1.500€).',
        warning: 'Controlla sempre nell’Area Bonus che non siano presenti cap temporanei di conversione prima di piazzare la multipla.',
        toolAction: { target: 'multiodds', label: 'Costruisci Multiple in Multiodds', presetMode: 'rollover' },
      },
      {
        id: 'pw_s5',
        stepNumber: 5,
        phase: 'conversione',
        title: 'Sfrutta i 10€ di rimborso settimanale per 10 settimane',
        exactAction: 'Ogni settimana (lun–dom) per 10 settimane, piazza una multipla qualificante da 20€ (requisiti della promo settimanale) e converti il bonus da 10€ accreditato il lunedì.',
        description:
          'Con 20€ di qualificante a settimana (costo ~2€) ottieni 10€ di bonus sport (~+8.90€ di estrazione) → circa +7€ netti a settimana × 10 settimane = ~+70€ extra!',
        toolAction: { target: 'multiodds', label: 'Prepara Multipla Settimanale', presetMode: 'normal' },
      },
      {
        id: 'pw_s6',
        stepNumber: 6,
        phase: 'prelievo',
        title: 'Rigioco finale Real Bonus (1x) e prelievo',
        exactAction: 'Se una tranche completa il 5x e si trasforma in Real Bonus, rigiocala 1x in modalità SR e preleva il saldo reale.',
        description: 'Tieni traccia delle 10 settimane spuntando lo step solo a ciclo completato.',
      },
    ],
  },

  // =========================================================================
  // 6. EUROBET.IT — SPORT (TIER A)
  // =========================================================================
  {
    id: 'eurobet_sport_welcome',
    sourceId: 'eurobet_it',
    bookmakerName: 'Eurobet.it',
    url: 'https://www.eurobet.it/it/scommesse/',
    category: 'sport',
    tier: 'A',
    difficulty: 'intermedio',
    headline: '50% fino a 100€ Real Bonus Sport (1x su multipla 5 eventi ≥ 1.50)',
    summary:
      'Semplice e pulito: depositi 200€, ottieni subito 100€ di Real Bonus da rigiocare una sola volta (1x) su multipla da 5 eventi a quota ≥ 1.50, mentre i 200€ reali li sblocchi in singola. Profitto netto ~+78€ in 2–3 giorni.',
    promoCode: null,
    registrationMethod: 'spid_recommended',
    registrationNote: 'Con SPID o CIE la convalida documento è immediata e velocizza l’accredito del Real Bonus.',
    estimatedTimeLabel: '2–4 giorni',
    expiryDays: 7,
    strategyTags: ['Real Bonus 1x', 'Multipla 5 Eventi', 'Multiodds', 'Bonus Multipla +3%'],
    termsSummary: {
      bonusStructure: '50% del primo deposito fino a 100€ in Real Bonus Sport (deposito ottimale 200€, min 20€).',
      rolloverRule: 'Real Bonus da rigiocare 1 sola volta (1x) entro 7 giorni. Deposito reale libero (1x in singola).',
      minOddsRule: 'Multipla ≥ 5 eventi con quota minima 1.50 per ogni evento; max 100€ per ticket bonus.',
      minLegs: 5,
      excludedPayments: ['Skrill', 'Neteller', 'Paysafecard', 'OnShop', 'Admiral Pay'],
      validityRule: '7 giorni dalla registrazione per depositare; 7 giorni dall’accredito per giocare il Real Bonus.',
      conversionCap: 'Nessun cap penalizzante (max 100€ puntata bonus per singola schedina).',
      criticalWarnings: [
        'Esclusi Skrill, Neteller, Paysafecard, OnShop e Admiral Pay: deposita con Carta, Postepay o PayPal.',
        'Sulla multipla da 5 eventi con Real Bonus sono vietati sistemi, Virtual e Cash Out.',
        'Distanzia sempre le 5 partite di almeno 2 ore l’una dall’altra (Multiodds Sequenziale) per non dover bancare eventi simultanei.',
      ],
    },
    simulationModel: {
      defaultDeposit: 200,
      minDeposit: 20,
      maxDeposit: 200,
      scalableDeposit: true,
      baseRecommendedBankroll: 750,
      components: [
        {
          kind: 'qualifying_bet',
          label: 'Movimentazione 1x deposito reale (singola)',
          depositMultiplier: 1,
          scalesWithDeposit: true,
          legs: 1,
          avgLegOdds: 2.0,
        },
        {
          kind: 'real_bonus_sr',
          label: 'Real Bonus 50% (1x su multipla 5 eventi ≥ 1.50, +3% boost)',
          pctOfDeposit: 50,
          maxAmount: 100,
          legs: 5,
          avgLegOdds: 1.55,
          multiBoostPct: 3,
        },
      ],
    },
    steps: [
      {
        id: 'eurobet_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrazione (meglio SPID/CIE) e deposito 200€',
        exactAction: 'Apri il conto su Eurobet.it (preferibilmente con SPID/CIE) e deposita 200€ entro 7 giorni con Carta o PayPal.',
        description: 'La convalida del documento è obbligatoria per l’erogazione del Real Bonus Sport da 100€.',
        warning: 'Non usare Skrill, Neteller, Paysafecard, OnShop o Admiral Pay.',
        toolAction: { target: 'external', label: 'Apri Eurobet.it', url: 'https://www.eurobet.it/it/scommesse/' },
      },
      {
        id: 'eurobet_s2',
        stepNumber: 2,
        phase: 'qualificante',
        title: 'Movimenta i 200€ reali in singola ad alto rating',
        exactAction: 'Piazza 1 singola da 200€ (o 2×100€) su Eurobet in modalità Normale con rating ≥ 96.5%.',
        description: 'Ripulisci subito i 200€ reali con una spesa minima (~7€) in modo da poterli prelevare senza vincoli.',
        toolAction: { target: 'oddsmatcher', label: 'Trova singola Eurobet ≥ 96.5%', presetMode: 'normal' },
      },
      {
        id: 'eurobet_s3',
        stepNumber: 3,
        phase: 'conversione',
        title: 'Gioca i 100€ di Real Bonus con Multiodds Sequenziale (5 eventi ≥ 1.50)',
        exactAction: 'Apri Multiodds, imposta Eurobet, modalità SR, puntata 100€ (oppure 2 multiple da 50€), 5 eventi non sovrapposti con quota ≥ 1.50.',
        description:
          'Salva il piano in "Multiple Salvate" e banca una partita alla volta solo se quella precedente è risultata vincente su Eurobet. Se anche Eurobet applica il bonus multipla sul 5° evento (+3–4%), inserisci il boost nel calcolatore!',
        mathTip: 'Dividere in 2 multiple da 50€ (invece di 1 da 100€) dimezza la responsabilità massima nel caso vincano tutte e 5 le gambe (~380€ anziché ~760€).',
        warning: 'Completa entro 7 giorni dall’accredito; niente Cash Out né sistemi.',
        toolAction: { target: 'multiodds', label: 'Costruisci Multipla 5 Eventi (SR)', presetMode: 'sr' },
      },
      {
        id: 'eurobet_s4',
        stepNumber: 4,
        phase: 'prelievo',
        title: 'Preleva le vincite e archivia la guida',
        exactAction: 'A schedine refertate preleva l’eventuale saldo vinto su Eurobet e segna completato.',
        description: 'Le vincite generate dal Real Bonus 1x sono immediatamente prelevabili.',
      },
    ],
  },

  // =========================================================================
  // 7. WILLIAMHILL.IT — SPORT (TIER A)
  // =========================================================================
  {
    id: 'williamhill_sport_welcome',
    sourceId: 'williamhill_it',
    bookmakerName: 'WilliamHill.it',
    url: 'https://sports.williamhill.it/',
    category: 'sport',
    tier: 'A',
    difficulty: 'intermedio',
    headline: '10€ Senza Deposito SPID + 100% fino a 100€ + Extra Bet Club',
    summary:
      'Pacchetto completo fino a 210€: 10€ immediati con SPID (5€ manuale) + fino a 100€ di bonus deposito in tranche da 10€ su multiple da 5 eventi con quota totale ≥ 5.00 (basta ~1.38 per evento, molto più comodo di 1.70/1.90!). Profitto core ~+76€ (+ extra club settimanale).',
    promoCode: null,
    registrationMethod: 'spid_recommended',
    registrationNote: 'Con SPID ottieni 10€ senza deposito subito (contro 5€ con documento manuale entro 96h). Nessun codice promo richiesto.',
    estimatedTimeLabel: '5–10 giorni',
    expiryDays: 7,
    strategyTags: ['Bonus SPID 10€', 'Quota Totale ≥ 5.00', 'Tranche 10€', 'Multiodds'],
    termsSummary: {
      bonusStructure: '10€ senza deposito (SPID) / 5€ (manuale) + 100% deposito fino a 100€ (2 fasi da 50€ in tranche da 10€) + Extra Bet Club 5€/sett.',
      rolloverRule: 'Tranche sbloccate piazzando multiple qualificanti entro 7 giorni; rigioco tranche 1x (Freebet Extra Bet Club in modalità SNR).',
      minOddsRule: 'Multiple ≥ 5 eventi con quota totale ≥ 5.00 (media ~1.38 per selezione — altissima liquidità!).',
      minLegs: 5,
      excludedPayments: ['Skrill', 'Neteller', 'Paysafecard', 'Bonifico Bancario', 'Revolut', 'Moneybookers'],
      validityRule: '96 ore per invio documento (se manuale); 7 giorni per sbloccare e usare le tranche.',
      conversionCap: 'Nessun cap penalizzante sulle vincite delle tranche cash/bonus.',
      criticalWarnings: [
        'Lista metodi esclusi molto severa: usa ESCLUSIVAMENTE Carta di credito/debito tradizionale (NO Revolut!) o PayPal.',
        'Ricorda di selezionare/attivare manualmente il token bonus in schedina prima di confermare la giocata.',
        'Verifica che la quota totale della multipla da 5 eventi sia almeno 5.05–5.20 (margine di sicurezza contro cali quota).',
      ],
    },
    simulationModel: {
      defaultDeposit: 100,
      minDeposit: 20,
      maxDeposit: 100,
      scalableDeposit: true,
      baseRecommendedBankroll: 500,
      components: [
        {
          kind: 'real_bonus_sr',
          label: 'Bonus Senza Deposito SPID (10€)',
          fixedAmount: 10,
          legs: 3,
          avgLegOdds: 1.5,
        },
        {
          kind: 'qualifying_bet',
          label: 'Qualificante deposito (1x su 5 eventi q tot ≥ 5.00)',
          depositMultiplier: 1,
          scalesWithDeposit: true,
          legs: 5,
          avgLegOdds: 1.4,
        },
        {
          kind: 'real_bonus_sr',
          label: 'Bonus Deposito 100% (tranche da 10€ su 5 eventi)',
          pctOfDeposit: 100,
          maxAmount: 100,
          legs: 5,
          avgLegOdds: 1.4,
        },
      ],
    },
    steps: [
      {
        id: 'wh_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrati con SPID per i 10€ subito (senza codice)',
        exactAction: 'Apri il conto su WilliamHill.it tramite SPID selezionando il Bonus Benvenuto Sport.',
        description: 'Con SPID ottieni 10€ senza deposito e validazione immediata; se usi registrazione manuale invia il documento entro 96 ore (riceverai 5€).',
        toolAction: { target: 'external', label: 'Apri WilliamHill.it', url: 'https://sports.williamhill.it/' },
      },
      {
        id: 'wh_s2',
        stepNumber: 2,
        phase: 'setup',
        title: 'Deposita 100€ con Carta tradizionale o PayPal',
        exactAction: 'Effettua il primo deposito di 100€ (o diviso nelle due fasi da 50€ secondo i T&C della promo attiva) con Carta Visa/Mastercard o PayPal.',
        description: 'Controlla la scheda "Promozioni" nel conto per verificare se la fase 2 da 50€ richiede un secondo deposito separato.',
        warning: 'NO Skrill, Neteller, Paysafecard, Bonifico Bancario o Revolut!',
      },
      {
        id: 'wh_s3',
        stepNumber: 3,
        phase: 'qualificante',
        title: 'Piazza le qualificanti su 5 eventi a quota media ~1.40 (q tot ≥ 5.00)',
        exactAction: 'In Multiodds costruisci multiple da 5 eventi non sovrapposti (es. quote 1.38–1.45 ciascuna → quota totale ~5.30) con rating per gamba ≥ 96.5%.',
        description:
          'Il vantaggio di William Hill è che chiede solo quota totale ≥ 5.00 senza quota minima per singola gamba: usare 5 favorite a ~1.40 garantisce spread bassissimi e responsabilità ridotta sull’Exchange!',
        toolAction: { target: 'multiodds', label: 'Apri Multiodds (5 eventi q tot ≥ 5)', presetMode: 'normal' },
      },
      {
        id: 'wh_s4',
        stepNumber: 4,
        phase: 'conversione',
        title: 'Converti i 10€ SPID e le tranche da 10€ man mano che arrivano',
        exactAction: 'Spunta il bonus nel carrello schedina e converti ogni tranche da 10€ in modalità SR (oppure SNR se token Freebet Extra Bet Club).',
        description:
          'Completa ciascuna tranche entro 7 giorni dall’accredito. Una volta concluso il benvenuto principale puoi continuare con l’Extra Bet Club settimanale (5€ freebet SNR).',
        toolAction: { target: 'multiodds', label: 'Converti Tranche in Multiodds', presetMode: 'sr' },
      },
      {
        id: 'wh_s5',
        stepNumber: 5,
        phase: 'prelievo',
        title: 'Preleva il saldo e registra il risultato',
        exactAction: 'Preleva le vincite accumulate dopo aver completato tutte le tranche.',
        description: 'Archivia il profitto netto nel Tracker.',
      },
    ],
  },

  // =========================================================================
  // 8. SISAL.IT — SPORT (TIER A)
  // =========================================================================
  {
    id: 'sisal_sport_welcome',
    sourceId: 'sisal_it',
    bookmakerName: 'Sisal.it',
    url: 'https://www.sisal.it/scommesse-matchpoint',
    category: 'sport',
    tier: 'A',
    difficulty: 'intermedio',
    headline: '30% fino a 100€ Real Bonus Sport (1x 4 eventi ≥ 1.90) + Salva il Bottino',
    summary:
      'Depositi 334€, liberi il deposito in singola e ottieni 100€ di Real Bonus da giocare 1x su multipla da 4 eventi a quota ≥ 1.90. Profitto netto ~+75€, ma ATTENZIONE: il Real Bonus scade in soli 3 giorni!',
    promoCode: null,
    registrationMethod: 'standard',
    registrationNote: 'Convalida documento obbligatoria prima dell’accredito del Real Bonus.',
    estimatedTimeLabel: '2–3 giorni (scadenza stretta!)',
    expiryDays: 3,
    strategyTags: ['Real Bonus 1x', '4 Eventi ≥ 1.90', 'Scadenza 3 Giorni', 'Salva il Bottino'],
    termsSummary: {
      bonusStructure: '30% della prima ricarica fino a 100€ Real Bonus Sport (deposito ottimale 334€, min 20€) + Salva il Bottino (5.000€ virtuali).',
      rolloverRule: 'Real Bonus 100€ da rigiocare 1x entro 3 giorni dall’accredito; deposito 334€ movimentabile 1x in singola.',
      minOddsRule: 'Multipla ≥ 4 eventi, quota minima 1.90 per ogni singolo evento (quota combinata ~13–15).',
      minLegs: 4,
      excludedPayments: ['Bonifico Bancario', 'Skrill', 'Neteller'],
      validityRule: 'SOLO 3 GIORNI dall’accredito per utilizzare il Real Bonus Sport (2 giorni per il Fun Bonus slot).',
      conversionCap: 'Nessun cap sulle vincite del Real Bonus (solo vincite prelevabili dopo rigioco 1x).',
      criticalWarnings: [
        'SCADENZA CRITICA DI 3 GIORNI: attiva e deposita preferibilmente di giovedì/venerdì quando il palinsesto calcistico del weekend offre tantissimi eventi liquidi non sovrapposti!',
        'Con 4 eventi a quota ≥ 1.90 la quota totale è ~13–15: dividi i 100€ in 2 multiple da 50€ (o 4×25€) per dimezzare la responsabilità massima sull’Exchange.',
        'Verifica sempre nei T&C della landing page che non sia richiesta quota totale minima extra (es. 6.00 — comunque superata da 1.90^4 = 13.03).',
      ],
    },
    simulationModel: {
      defaultDeposit: 334,
      minDeposit: 20,
      maxDeposit: 334,
      scalableDeposit: true,
      baseRecommendedBankroll: 850,
      components: [
        {
          kind: 'qualifying_bet',
          label: 'Movimentazione 1x deposito reale (singole)',
          depositMultiplier: 1,
          scalesWithDeposit: true,
          legs: 1,
          avgLegOdds: 2.0,
        },
        {
          kind: 'real_bonus_sr',
          label: 'Real Bonus 30% (1x su 4 eventi ≥ 1.90, 2×50€)',
          pctOfDeposit: 30,
          maxAmount: 100,
          legs: 4,
          avgLegOdds: 1.95,
        },
      ],
    },
    steps: [
      {
        id: 'sisal_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Pianifica il timing (giovedì/venerdì), registrati e valida il conto',
        exactAction: 'Registrati su Sisal.it scegliendo il Bonus Sport, carica il documento e attendi la convalida prima di depositare.',
        description:
          'Poiché il Real Bonus dura solo 3 giorni, sincronizza l’accredito con il weekend di campionati europei per trovare facilmente 4 partite sfalsate ad alto rating.',
        warning: 'Non far scadere il Real Bonus: dopo 72 ore viene stornato automaticamente.',
        toolAction: { target: 'external', label: 'Apri Sisal.it', url: 'https://www.sisal.it/scommesse-matchpoint' },
      },
      {
        id: 'sisal_s2',
        stepNumber: 2,
        phase: 'setup',
        title: 'Deposita 334€ con Carta o PayPal',
        exactAction: 'Effettua una prima ricarica di 334€ (30% = 100€ di Real Bonus) tramite Carta di debito/credito o PayPal.',
        description: 'Puoi scalare il deposito (es. 100€ → 30€ bonus) se disponi di un bankroll Exchange ridotto.',
        warning: 'Evita Bonifico Bancario ed e-wallet non idonei (Skrill/Neteller).',
      },
      {
        id: 'sisal_s3',
        stepNumber: 3,
        phase: 'qualificante',
        title: 'Sblocca il deposito 334€ con 1–2 singole ad alto rating',
        exactAction: 'Gioca i 334€ reali su singole liquide (rating ≥ 96.5%) in modalità Normale per renderli prelevabili.',
        description: 'Costo medio ~11.70€ su 334€; l’intero saldo reale torna subito liquido.',
        toolAction: { target: 'oddsmatcher', label: 'Trova singole Sisal', presetMode: 'normal' },
      },
      {
        id: 'sisal_s4',
        stepNumber: 4,
        phase: 'conversione',
        title: 'Converti i 100€ di Real Bonus in 2 multiple da 50€ (4 eventi ≥ 1.90)',
        exactAction: 'Apri Multiodds su Sisal, modalità SR, imposta 4 eventi sfalsati di almeno 2h con quota minima 1.90 (ideale 1.92–2.15) e salva in Multiple Salvate.',
        description:
          'Banca la gamba 1 prima del fischio d’inizio; solo se vince su Sisal banchi la gamba 2, poi la 3 e la 4. Con 2 multiple da 50€ mantieni la responsabilità massima entro ~650€.',
        mathTip: 'Cerca quote vicine a 1.95–2.10 (es. Over/Under 2.5 o GG/NG sui big match) dove spread e liquidità sono eccellenti.',
        toolAction: { target: 'multiodds', label: 'Costruisci 4-Eventi Sisal (SR)', presetMode: 'sr' },
      },
      {
        id: 'sisal_s5',
        stepNumber: 5,
        phase: 'prelievo',
        title: 'Preleva le vincite e gioca gratis "Salva il Bottino"',
        exactAction: 'Preleva il saldo reale e utilizza gratuitamente i 5.000€ virtuali di "Salva il Bottino" per ulteriore EV a rischio zero.',
        description: 'Salva il Bottino non costa nulla e può aggiungere ulteriori vincite bonus gratuite.',
      },
    ],
  },

  // =========================================================================
  // 9. LOTTOMATICA.IT (BETTER) — SPORT (TIER B)
  // =========================================================================
  {
    id: 'lottomatica_sport_welcome',
    sourceId: 'lottomatica_it',
    bookmakerName: 'Lottomatica.it',
    url: 'https://www.lottomatica.it/scommesse',
    category: 'sport',
    tier: 'B',
    difficulty: 'avanzato',
    headline: '5€ Senza Deposito + 25% fino a 100€ Bonus Rigioco Sport',
    summary:
      'Offerta sportiva Better (Gruppo GBO): 5€ alla convalida documento + 100€ di Bonus Rigioco Sport su deposito 400€ (5x su 5 eventi @1.70). Sfruttando il Bust-Out in 2 multiple da 50€ (93% di chiusura al 1° colpo!), il profitto atteso è ~+67€.',
    promoCode: null,
    registrationMethod: 'standard',
    registrationNote: 'SPID disattivato su Lottomatica: usa registrazione standard con CIE, Patente o Passaporto.',
    estimatedTimeLabel: '3–5 giorni',
    expiryDays: 7,
    strategyTags: ['5€ No-Deposito', 'Bust-Out 93%', '5 Eventi ≥ 1.70', 'Multiodds'],
    termsSummary: {
      bonusStructure: '5€ Bonus Rigioco Sport alla convalida + 25% primo deposito fino a 100€ (deposito 400€, min 20€).',
      rolloverRule: 'Bonus Rigioco 5x (= 500€) entro 7 giorni → saldo residuo convertito in Real Bonus 1x.',
      minOddsRule: 'Multiple ≥ 5 eventi con quota minima 1.70 per ogni singolo evento (anche per i 5€ senza deposito).',
      minLegs: 5,
      excludedPayments: ['Skrill', 'Neteller', 'OnShop', 'Titolo di Ricarica'],
      validityRule: '7 giorni dalla registrazione per il deposito; 7 giorni dall’accredito per il bonus.',
      conversionCap: 'Verifica sempre il box Area Bonus per eventuali cap mensili; saldo bonus non mischiabile con saldo reale.',
      criticalWarnings: [
        'Non mischiare mai saldo bonus e saldo reale nella stessa schedina.',
        'Dividi i 100€ di bonus in 2×50€ (o 4×25€): su 5 eventi a 1.72 la quota totale è ~15, quindi la responsabilità in caso di 5/5 su 100€ arriverebbe a ~1.400€.',
        'Esclusi Skrill, Neteller, OnShop e sistemi.',
      ],
    },
    simulationModel: {
      defaultDeposit: 400,
      minDeposit: 20,
      maxDeposit: 400,
      scalableDeposit: true,
      baseRecommendedBankroll: 850,
      components: [
        {
          kind: 'real_bonus_sr',
          label: '5€ Senza Deposito (5 eventi ≥ 1.70)',
          fixedAmount: 5,
          legs: 5,
          avgLegOdds: 1.72,
        },
        {
          kind: 'qualifying_bet',
          label: 'Movimentazione 1x deposito reale (singole)',
          depositMultiplier: 1,
          scalesWithDeposit: true,
          legs: 1,
          avgLegOdds: 2.0,
        },
        {
          kind: 'rollover_bustout',
          label: 'Bonus Rigioco 25% (5x su 5 eventi ≥ 1.70, 2×50€)',
          pctOfDeposit: 25,
          maxAmount: 100,
          rolloverMultiplier: 5,
          legs: 5,
          avgLegOdds: 1.72,
          maxStakePerBet: 50,
          finalRealBonusWagering: 1,
          finalRealLegs: 1,
        },
      ],
    },
    steps: [
      {
        id: 'lotto_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrazione Bonus Sport + convalida documento',
        exactAction: 'Apri conto su Lottomatica.it selezionando "Bonus Benvenuto Scommesse" e invia CIE, Patente o Passaporto.',
        description: 'Alla convalida ricevi i primi 5€ di Bonus Rigioco Sport senza deposito.',
        toolAction: { target: 'external', label: 'Apri Lottomatica.it', url: 'https://www.lottomatica.it/scommesse' },
      },
      {
        id: 'lotto_s2',
        stepNumber: 2,
        phase: 'setup',
        title: 'Deposito 400€ entro 7 giorni',
        exactAction: 'Effettua la prima ricarica di 400€ (o importo scalato) con Carta o PayPal.',
        description: 'Ricevi il 25% fino a 100€ nel portafoglio Bonus Rigioco Sport.',
        warning: 'NO Skrill, Neteller o OnShop.',
      },
      {
        id: 'lotto_s3',
        stepNumber: 3,
        phase: 'qualificante',
        title: 'Movimenta i 400€ reali in singola',
        exactAction: 'Gioca i 400€ reali su 1–2 singole a rating ≥ 96.5% (modalità Normale) per renderli prelevabili.',
        description: 'Mantiene il costo sul saldo reale intorno ai ~14€.',
        toolAction: { target: 'oddsmatcher', label: 'Trova singole Lottomatica', presetMode: 'normal' },
      },
      {
        id: 'lotto_s4',
        stepNumber: 4,
        phase: 'sblocco',
        title: 'Converti i 5€ + 100€ Bonus Rigioco in 2×50€ (5 eventi ≥ 1.70)',
        exactAction: 'Costruisci 2 multiple sequenziali da 50€ (e 1 da 5€) con 5 eventi ≥ 1.70 non sovrapposti in Multiodds (modalità Rollover).',
        description:
          'Con quota totale ~15, nel 93.4% dei casi la multipla perde su Lottomatica entro i 5 eventi, azzerando subito il rollover 5x e trasferendo il valore pulito sull’Exchange.',
        mathTip: 'Se una tranche da 50€ vince tutte e 5 le partite (prob. 6.6%, saldo ~750€), completi i restanti 200€ di rollover e rigiochi 1x il Real Bonus.',
        toolAction: { target: 'multiodds', label: 'Apri Multiodds su Lottomatica', presetMode: 'rollover' },
      },
      {
        id: 'lotto_s5',
        stepNumber: 5,
        phase: 'prelievo',
        title: 'Prelievo e registrazione profitto',
        exactAction: 'Preleva il saldo reale residuo al termine del rigioco.',
        description: 'Segna completata la guida per aggiornare il totale guadagnato.',
      },
    ],
  },

  // =========================================================================
  // 10. GOLDBET.IT — SPORT (TIER B)
  // =========================================================================
  {
    id: 'goldbet_sport_welcome',
    sourceId: 'goldbet_it',
    bookmakerName: 'GoldBet.it',
    url: 'https://www.goldbet.it/scommesse/sport',
    category: 'sport',
    tier: 'B',
    difficulty: 'intermedio',
    headline: '25% fino a 100€ Bonus Rigioco Sport (5x su 3 eventi ≥ 1.50)',
    summary:
      'Cugino di Lottomatica nello stesso gruppo GBO, ma spesso con vincolo più morbido sulle multiple (3 eventi a quota ≥ 1.50 anziché 5 eventi @1.70). Con strategia Bust-Out genera ~+63€ netti con responsabilità molto più contenuta.',
    promoCode: null,
    registrationMethod: 'standard',
    registrationNote: 'Seleziona obbligatoriamente il Bonus Sport al 4° step di registrazione; convalida con CIE/Patente/Passaporto.',
    estimatedTimeLabel: '3–5 giorni',
    expiryDays: 7,
    strategyTags: ['Bust-Out 73%', '3 Eventi ≥ 1.50', 'Multiodds'],
    termsSummary: {
      bonusStructure: '25% del primo deposito fino a 100€ in Bonus Rigioco Sport (deposito 400€, min 20€).',
      rolloverRule: 'Bonus Rigioco 5x (= 500€) entro 7 giorni → saldo residuo convertito in Real Bonus 1x.',
      minOddsRule: 'Multiple ≥ 3 eventi con quota minima 1.50 per evento (verifica in Area Bonus eventuali varianti a 5 eventi @1.70).',
      minLegs: 3,
      excludedPayments: ['Skrill', 'Neteller', 'OnShop', 'MyBank', 'Titolo di Ricarica'],
      validityRule: '7 giorni dalla registrazione per il deposito; 7 giorni per completare il rigioco.',
      conversionCap: 'Verifica sempre il box Area Bonus prima di scommettere; vietato saldo misto.',
      criticalWarnings: [
        'Ricorda di selezionare il Bonus Benvenuto Sport al 4° step della registrazione (non è attivabile a posteriori!).',
        'Controlla nell’Area Bonus se nella campagna del mese corrente servono 3 eventi @1.50 o 5 eventi @1.70.',
        'Esclusi Skrill, Neteller, OnShop, MyBank e sistemi.',
      ],
    },
    simulationModel: {
      defaultDeposit: 400,
      minDeposit: 20,
      maxDeposit: 400,
      scalableDeposit: true,
      baseRecommendedBankroll: 700,
      components: [
        {
          kind: 'qualifying_bet',
          label: 'Movimentazione 1x deposito reale (singole)',
          depositMultiplier: 1,
          scalesWithDeposit: true,
          legs: 1,
          avgLegOdds: 2.0,
        },
        {
          kind: 'rollover_bustout',
          label: 'Bonus Rigioco 25% (5x su 3 eventi ≥ 1.50)',
          pctOfDeposit: 25,
          maxAmount: 100,
          rolloverMultiplier: 5,
          legs: 3,
          avgLegOdds: 1.56,
          maxStakePerBet: 100,
          finalRealBonusWagering: 1,
          finalRealLegs: 1,
        },
      ],
    },
    steps: [
      {
        id: 'gb_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrazione (step 4: Bonus Sport) e convalida documento',
        exactAction: 'Apri conto su GoldBet.it, seleziona Bonus Benvenuto Sport al 4° step e convalida con CIE, Patente o Passaporto.',
        description: 'La selezione durante lo step 4 è indispensabile per agganciare la promozione.',
        toolAction: { target: 'external', label: 'Apri GoldBet.it', url: 'https://www.goldbet.it/scommesse/sport' },
      },
      {
        id: 'gb_s2',
        stepNumber: 2,
        phase: 'setup',
        title: 'Deposita 400€ con Carta o PayPal entro 7 giorni',
        exactAction: 'Effettua una ricarica da 400€ (o importo scalato) per ricevere 100€ di Bonus Rigioco Sport.',
        description: 'Appena accreditato, apri l’Area Bonus per confermare il requisito eventi (3 eventi @1.50).',
        warning: 'Esclusi Skrill, Neteller, OnShop, MyBank.',
      },
      {
        id: 'gb_s3',
        stepNumber: 3,
        phase: 'qualificante',
        title: 'Ripulisci i 400€ reali su singole ad alto rating',
        exactAction: 'Piazza 1–2 singole per 400€ totali su GoldBet (rating ≥ 96.5%, modalità Normale).',
        description: 'Costo medio ~14€; libera subito il saldo reale.',
        toolAction: { target: 'oddsmatcher', label: 'Trova singole GoldBet', presetMode: 'normal' },
      },
      {
        id: 'gb_s4',
        stepNumber: 4,
        phase: 'sblocco',
        title: 'Piazza i 100€ di Bonus Rigioco in Multiodds (Rollover Bust-Out)',
        exactAction: 'Punta i 100€ di bonus su 1 multipla sequenziale da 3 eventi (q ≥ 1.50, rating ≥ 96.5%/gamba) in modalità Rollover.',
        description:
          'Con quota totale ~3.80, nel 73% dei casi la multipla si ferma su una delle 3 partite, chiude il rollover 5x all’istante e incassi direttamente sull’Exchange.',
        mathTip: 'Se vince (27% dei casi, saldo ~380€), completa i 400€ residui di rollover su multiple da 3 eventi e poi rigioca 1x il Real Bonus in singola.',
        toolAction: { target: 'multiodds', label: 'Apri Multiodds su GoldBet', presetMode: 'rollover' },
      },
      {
        id: 'gb_s5',
        stepNumber: 5,
        phase: 'prelievo',
        title: 'Preleva le vincite e registra il profitto',
        exactAction: 'Preleva l’eventuale saldo reale residuo su GoldBet.',
        description: 'Aggiorna lo stato della guida a Completato.',
      },
    ],
  },

  // =========================================================================
  // 11. 888SPORT.IT — SPORT (TIER B)
  // =========================================================================
  {
    id: '888sport_welcome',
    sourceId: '888sport_it',
    bookmakerName: '888sport.it',
    url: 'https://www.888sport.it/',
    category: 'sport',
    tier: 'B',
    difficulty: 'principiante',
    headline: '100% fino a 100€ (cod. ITALIA — Singole ≥ 2.00 a blocchi da 10€)',
    summary:
      'Ottima offerta per chi preferisce SOLO scommesse singole senza impazzire con le multiple: 10€ subito alla ricarica + 9 blocchi da 10€ sbloccati ogni 100€ giocati a quota ≥ 2.00 entro 30 giorni. Profitto netto ~+61€.',
    promoCode: 'ITALIA',
    registrationMethod: 'standard',
    registrationNote: 'Inserisci il codice promozionale ITALIA al momento del primo deposito (minimo 10€, ottimale 100€).',
    estimatedTimeLabel: '5–15 giorni (singole comode)',
    expiryDays: 30,
    strategyTags: ['Singole Ammesse', 'Codice ITALIA', 'Bassa Responsabilità', 'Tranche 10€'],
    termsSummary: {
      bonusStructure: '100% sul primo deposito fino a 100€ (10€ subito + 9 tranche da 10€) + 5€ bonus casinò.',
      rolloverRule: 'Ogni blocco da 10€ si sblocca dopo 100€ di scommesse refertate (900€ totali per gli ultimi 9 blocchi); rigioco bonus sbloccato 2x.',
      minOddsRule: 'Quota minima 2.00 su scommesse singole o multiple.',
      minLegs: 1,
      excludedPayments: ['PayPal', 'Skrill', 'Neteller', 'Paysafecard', 'Moneybookers'],
      validityRule: '30 giorni dall’accredito per completare gli sblocchi.',
      conversionCap: 'Nessun cap penalizzante sul profitto sportivo.',
      criticalWarnings: [
        'NON usare PayPal, Skrill, Neteller o Paysafecard al primo deposito: usa Carta di debito/credito o Bonifico!',
        'Devi inserire manualmente il codice ITALIA in fase di ricarica.',
        'Poiché il volume totale è ~1.100€ (900€ sblocco + 200€ rigioco 2x), mantieni sempre un rating ≥ 96% sulle singole per preservare tutto il margine.',
      ],
    },
    simulationModel: {
      defaultDeposit: 100,
      minDeposit: 10,
      maxDeposit: 100,
      scalableDeposit: true,
      baseRecommendedBankroll: 350,
      components: [
        {
          kind: 'qualifying_bet',
          label: 'Volume sblocco 9 blocchi (9×100€ singole ≥ 2.00)',
          depositMultiplier: 9,
          scalesWithDeposit: true,
          legs: 1,
          avgLegOdds: 2.15,
        },
        {
          kind: 'real_bonus_sr',
          label: '100€ Bonus totale (10€ subito + 9×10€, rigioco 2x @ 2.00)',
          pctOfDeposit: 100,
          maxAmount: 100,
          legs: 1,
          avgLegOdds: 2.15,
          rolloverMultiplier: 2,
        },
      ],
    },
    steps: [
      {
        id: '888_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrazione e deposito 100€ con codice ITALIA',
        exactAction: 'Apri conto su 888sport.it, valida il documento e deposita 100€ inserendo il codice promozionale ITALIA con Carta o Bonifico.',
        description: 'Ricevi immediatamente il primo blocco da 10€ di bonus; gli altri 90€ restano in stato Pending (9 blocchi da 10€).',
        warning: 'PayPal, Skrill, Neteller e Paysafecard NON attivano il bonus!',
        toolAction: { target: 'external', label: 'Apri 888sport.it', url: 'https://www.888sport.it/' },
      },
      {
        id: '888_s2',
        stepNumber: 2,
        phase: 'qualificante',
        title: 'Sblocca i 9 blocchi da 10€ con singole a quota 2.00–2.40',
        exactAction: 'Piazza 9 scommesse singole da 100€ (o 18 da 50€) su 888sport a quota ≥ 2.00 con rating ≥ 96.5% in modalità Normale.',
        description:
          'Piattaforma Kambi con ottime quote su Calcio e Tennis: cerca quote vicine a 2.05–2.30 così da mantenere la responsabilità sull’Exchange intorno a soli 110€–140€ a puntata.',
        mathTip: 'Ogni 100€ giocati a 96.5% ti costano solo 3.50€ e sbloccano 10€ di bonus (~+9.30€) → guadagno netto +5.80€ per blocco!',
        toolAction: { target: 'oddsmatcher', label: 'Trova singole 888sport ≥ 2.00', presetMode: 'normal' },
      },
      {
        id: '888_s3',
        stepNumber: 3,
        phase: 'conversione',
        title: 'Converti i blocchi da 10€ sbloccati (rigioco 2x @ 2.00)',
        exactAction: 'Gioca i blocchi bonus da 10€ su singole a quota ≥ 2.00 (rating ≥ 96.5%) in modalità SR fino a esaurimento del requisito 2x.',
        description: 'Puoi accumulare 2–3 blocchi insieme o giocarli uno per volta entro i 30 giorni di validità.',
        toolAction: { target: 'calculator', label: 'Apri Calcolatore SR', presetMode: 'sr' },
      },
      {
        id: '888_s4',
        stepNumber: 4,
        phase: 'prelievo',
        title: 'Preleva il saldo reale e gioca i 5€ Casinò extra',
        exactAction: 'Completati tutti i 9 blocchi entro 30 giorni, preleva il saldo residuo e sfrutta i 5€ casinò extra.',
        description: 'Registra il guadagno effettivo nel Tracker.',
      },
    ],
  },

  // =========================================================================
  // 12. DAZN BET.IT — SPORT (TIER B)
  // =========================================================================
  {
    id: 'daznbet_sport_welcome',
    sourceId: 'daznbet_it',
    bookmakerName: 'DAZN Bet.it',
    url: 'https://www.daznbet.it/scommesse',
    category: 'sport',
    tier: 'B',
    difficulty: 'intermedio',
    headline: '5€ Freebet No-Deposito + 50% fino a 100€ Real Bonus Sport',
    summary:
      'Doppia offerta: 5€ Freebet gratuita alla convalida documento + 100€ Real Bonus su deposito 200€ (qualificante 1x + bonus 1x su multiple da 5 eventi con quota totale ≥ 5.00). Profitto atteso ~+54€ (disponibile anche opzione compatta 100% fino a 25€).',
    promoCode: null,
    registrationMethod: 'standard',
    registrationNote: 'Seleziona l’offerta Benvenuto Sport in fase di registrazione e convalida il documento per la Freebet da 5€.',
    estimatedTimeLabel: '3–5 giorni',
    expiryDays: 7,
    strategyTags: ['5€ Freebet Gratis', 'Quota Totale ≥ 5.00', 'Real Bonus 1x', 'Multiodds'],
    termsSummary: {
      bonusStructure: '5€ Freebet (Fun Point) senza deposito + 50% primo deposito fino a 100€ Real Bonus (dep. 200€; alternativa compatta 100% fino 25€).',
      rolloverRule: 'Deposito 1x su multipla 5 eventi (q tot ≥ 5.00) entro 7gg → Real Bonus 100€ da rigiocare 1x su 5 eventi (q tot ≥ 5.00).',
      minOddsRule: 'Multiple ≥ 5 eventi con quota totale ≥ 5.00 (basta ~1.40 per evento). Esclusi Antepost, Marcatori, Sistemi, Cash Out.',
      minLegs: 5,
      excludedPayments: ['Skrill', 'Neteller', 'OnShop', 'Bonifico Bancario'],
      validityRule: 'TUTTI gli eventi del ticket qualificante devono concludersi entro la mezzanotte del 7° giorno!',
      conversionCap: 'Nessun cap penalizzante sul Real Bonus; vincite della Freebet 5€ accreditate come Real Bonus.',
      criticalWarnings: [
        'REGOLA EVENTI ANNULLATI: se una delle 5 partite viene rinviata (quota 1.00) il ticket scende a 4 eventi e VIENE INVALIDATO! Per sicurezza inserisci sempre 5 partite ad altissima affidabilità (o 6 eventi se in dubbio su meteo/tennis).',
        'Tutti gli eventi devono concludersi entro la mezzanotte del 7° giorno dall’attivazione.',
        'Esclusi Skrill, Neteller, OnShop, Bonifico Bancario, mercati Giocatori/Marcatori e Cash Out.',
      ],
    },
    simulationModel: {
      defaultDeposit: 200,
      minDeposit: 25,
      maxDeposit: 200,
      scalableDeposit: true,
      baseRecommendedBankroll: 750,
      components: [
        {
          kind: 'freebet_snr',
          label: '5€ Freebet Senza Deposito (5 eventi q tot ≥ 5.00)',
          fixedAmount: 5,
          legs: 5,
          avgLegOdds: 1.42,
        },
        {
          kind: 'qualifying_bet',
          label: 'Qualificante 1x deposito (5 eventi q tot ≥ 5.00)',
          depositMultiplier: 1,
          scalesWithDeposit: true,
          legs: 5,
          avgLegOdds: 1.4,
        },
        {
          kind: 'real_bonus_sr',
          label: 'Real Bonus 50% (1x su 5 eventi q tot ≥ 5.00)',
          pctOfDeposit: 50,
          maxAmount: 100,
          legs: 5,
          avgLegOdds: 1.4,
        },
      ],
    },
    steps: [
      {
        id: 'dazn_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrazione, convalida documento e Freebet 5€ gratis',
        exactAction: 'Registrati su DAZN Bet selezionando il Bonus Sport 50% fino 100€ + 5€ e carica il documento.',
        description: 'Appena convalidato ricevi la Freebet da 5€ da giocare in un’unica soluzione su 5 eventi (q tot ≥ 5.00) in modalità SNR.',
        toolAction: { target: 'external', label: 'Apri DAZN Bet.it', url: 'https://www.daznbet.it/scommesse' },
      },
      {
        id: 'dazn_s2',
        stepNumber: 2,
        phase: 'setup',
        title: 'Deposita 200€ con Carta o PayPal',
        exactAction: 'Effettua un primo deposito di 200€ tramite Carta Visa/Mastercard o PayPal.',
        description: 'Se vuoi un’operazione lampo a basso bankroll, verifica l’opzione alternativa 100% fino a 25€ (deposito 25€ → ~+17€ netti).',
        warning: 'Esclusi Skrill, Neteller, OnShop e Bonifico Bancario.',
      },
      {
        id: 'dazn_s3',
        stepNumber: 3,
        phase: 'qualificante',
        title: 'Piazza la qualificante 200€ (2×100€ su 5 eventi q tot ≥ 5.00)',
        exactAction: 'Costruisci in Multiodds 2 multiple sequenziali da 100€ (5 partite di calcio top a ~1.40–1.45, q tot ~5.40) che terminino tutte entro il 7° giorno.',
        description:
          'Evita partite di tennis all’aperto a rischio ritiro/pioggia: un singolo evento annullato a quota 1.00 farebbe scendere la schedina sotto i 5 eventi invalidando la promo!',
        mathTip: 'Mantieni rating per gamba ≥ 96.5% per contenere la spesa qualificante entro ~32€.',
        toolAction: { target: 'multiodds', label: 'Costruisci Qualificanti DAZN Bet', presetMode: 'normal' },
      },
      {
        id: 'dazn_s4',
        stepNumber: 4,
        phase: 'conversione',
        title: 'Converti i 100€ di Real Bonus (1x su 5 eventi q tot ≥ 5.00)',
        exactAction: 'Una volta accreditato il Real Bonus da 100€, giocalo in 1 o 2 multiple sequenziali da 5 eventi (modalità SR) entro 7 giorni.',
        description: 'Scegli sempre 5 quote basse/medie (~1.40) per minimizzare la responsabilità totale sull’Exchange.',
        toolAction: { target: 'multiodds', label: 'Converti Real Bonus (SR)', presetMode: 'sr' },
      },
      {
        id: 'dazn_s5',
        stepNumber: 5,
        phase: 'prelievo',
        title: 'Preleva le vincite e chiudi',
        exactAction: 'A refertazione conclusa preleva il saldo residuo e registra il profitto.',
        description: 'Conferma il saldo finale nel Tracker.',
      },
    ],
  },

  // =========================================================================
  // 13. BETFAIR.IT (EXCHANGE + SPORTSBOOK) — EXCHANGE / SPORT (TIER A — PRINCIPIANTI!)
  // =========================================================================
  {
    id: 'betfair_exchange_welcome',
    sourceId: 'betfair_exchange',
    relatedSourceIds: ['betfair_sportsbook'],
    bookmakerName: 'Betfair.it',
    url: 'https://www.betfair.it/exchange/plus/it/calcio-scommesse-1',
    category: 'exchange',
    tier: 'A',
    difficulty: 'principiante',
    headline: 'Rimborso 100% perdite Exchange fino a 50€ (10€/sett × 5 sett — cod. ZBETEX)',
    summary:
      'Il bonus benvenuto più facile e rilassato in assoluto, perfetto come PRIMA operazione: usi Betfair Exchange normalmente come tua banca durante gli altri bonus e ogni settimana in cui l’Exchange registra una perdita netta ≥ 10€ ricevi 10€ di Bonus Sport (1x in singola @1.50). Profitto quasi garantito ~+45€!',
    promoCode: 'ZBETEX',
    registrationMethod: 'standard',
    registrationNote: 'Inserisci OBBLIGATORIAMENTE il codice ZBETEX in registrazione e convalida il documento PRIMA di scommettere.',
    estimatedTimeLabel: '5 settimane (5 min/sett)',
    expiryDays: 35,
    strategyTags: ['Principiante', 'Singole 1x @ 1.50', 'Account Unico Sport+EX', 'Codice ZBETEX'],
    termsSummary: {
      bonusStructure: 'Rimborso 100% sulle perdite nette settimanali dell’Exchange fino a 10€/settimana per 5 settimane (max 50€ totali).',
      rolloverRule: 'Ogni rimborso da 10€ arriva il lunedì come Bonus Sport da rigiocare 1 sola volta (1x) su Betfair Sportsbook entro 7 giorni.',
      minOddsRule: 'Quota minima 1.50 sul Bonus Sport (singole ammesse!).',
      minLegs: 1,
      excludedPayments: ['Carte Prepagate', 'Skrill', 'Neteller', 'Paysafecard'],
      validityRule: '5 cicli settimanali (lun–dom); ogni bonus da 10€ scade dopo 7 giorni dall’accredito.',
      conversionCap: 'Nessun cap: le vincite dal Bonus Sport 1x sono interamente prelevabili.',
      criticalWarnings: [
        'Account unico per Betfair Exchange e Betfair Sportsbook: scegli subito il codice ZBETEX in registrazione.',
        'Valgono SOLO le scommesse piazzate DOPO la convalida del documento d’identità!',
        'Deposita SOLO con Carta di credito/debito tradizionale (NO prepagate!), Apple Pay o PayPal.',
      ],
    },
    simulationModel: {
      defaultDeposit: 100,
      minDeposit: 50,
      maxDeposit: 500,
      scalableDeposit: false,
      baseRecommendedBankroll: 150,
      components: [
        {
          kind: 'exchange_cashback',
          label: 'Rimborso Exchange ZBETEX (5 settimane × 10€)',
          maxRefundPerPeriod: 10,
          periods: 5,
          qualifyingVolumePerPeriod: 20,
          bonusLegs: 1,
          bonusAvgLegOdds: 1.65,
        },
      ],
    },
    steps: [
      {
        id: 'bf_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrati con codice ZBETEX e attendi convalida documento',
        exactAction: 'Apri il conto su Betfair.it inserendo il codice promozionale ZBETEX e invia subito il documento d’identità.',
        description:
          'Betfair Exchange e Sportsbook condividono lo stesso conto: è fondamentale completare la verifica documento PRIMA di piazzare qualsiasi bancata valida ai fini del rimborso.',
        warning: 'Le giocate fatte prima della convalida del documento NON generano rimborso!',
        toolAction: { target: 'external', label: 'Apri Betfair.it', url: 'https://www.betfair.it/exchange/plus/it/calcio-scommesse-1' },
      },
      {
        id: 'bf_s2',
        stepNumber: 2,
        phase: 'setup',
        title: 'Effettua il primo deposito con Carta (no prepagata), PayPal o Apple Pay',
        exactAction: 'Deposita almeno 50€–100€ tramite Carta di debito/credito non prepagata, PayPal o Apple Pay.',
        description: 'Questo saldo ti servirà comunque come bankroll di bancata per tutte le altre guide di OddsPulse Pro.',
        warning: 'Le carte prepagate, Skrill e Neteller escludono dal bonus benvenuto.',
      },
      {
        id: 'bf_s3',
        stepNumber: 3,
        phase: 'qualificante',
        title: 'Registra almeno 10€ di perdita netta sull’Exchange (per 5 settimane)',
        exactAction: 'Ogni settimana (lun–dom), durante le tue normali bancate sugli altri bookmaker, verifica entro domenica sera di avere saldo settimanale Exchange ≤ -10€ (altrimenti piazza una copertura da ~15€–20€ su quota bassa).',
        description:
          'Attenzione: perdi sull’Exchange quando vince il bookmaker dall’altro lato (quindi il tuo capitale totale non perde quasi nulla, solo ~0.50€ di spread!). Se in una settimana l’Exchange ha vinto tutte le bancate, non riceverai il rimborso per quella specifica settimana.',
        mathTip: 'Se venerdì sei ancora in attivo sull’Exchange, usa un altro bookmaker su quota bassa (es. 1.50–1.70, rating ≥ 97%) così da avere ~60% di probabilità di spostare 10€ dall’Exchange al bookmaker.',
        toolAction: { target: 'oddsmatcher', label: 'Trova match con Betfair Exchange', presetMode: 'normal' },
      },
      {
        id: 'bf_s4',
        stepNumber: 4,
        phase: 'conversione',
        title: 'Converti i 10€ di Bonus Sport ogni lunedì (1x singola ≥ 1.50)',
        exactAction: 'Ogni lunedì mattina, gioca i 10€ di Bonus Sport accreditati su Betfair Sportsbook su una singola a quota ≥ 1.50 in modalità SR, bancandola su Betflag Exchange (o Smarkets).',
        description:
          'Ricorda di bancare il Bonus Sport di Betfair su un ALTRO Exchange (es. Betflag Exchange) per non fare puntate opposte sullo stesso operatore e non sporcare il calcolo delle perdite nette Exchange della settimana successiva!',
        mathTip: 'Ogni 10€ di Bonus Sport rigiocati 1x a rating 96.5% si trasformano in +9.65€ puliti!',
        warning: 'Non bancare su Betfair Exchange una scommessa fatta su Betfair Sportsbook: usa Betflag Exchange o Dutcher Punta-Punta.',
        toolAction: { target: 'oddsmatcher', label: 'Converti su Betfair SB vs Betflag EX', presetMode: 'sr' },
      },
      {
        id: 'bf_s5',
        stepNumber: 5,
        phase: 'prelievo',
        title: 'Ripeti per 5 settimane e consolida ~+45€ netti',
        exactAction: 'Ripeti i passi 3 e 4 per tutte e 5 le settimane della promozione.',
        description: 'Alla fine della 5ª settimana avrai incassato fino a 50€ di Bonus Sport con sforzo praticamente nullo.',
      },
    ],
  },

  // =========================================================================
  // 14. STANLEYBET.IT — SPORT (TIER A — MIGLIOR ROI SU 20€!)
  // =========================================================================
  {
    id: 'stanleybet_sport_welcome',
    sourceId: 'stanleybet_it',
    bookmakerName: 'Stanleybet.it',
    url: 'https://www.stanleybet.it/sport',
    category: 'sport',
    tier: 'A',
    difficulty: 'principiante',
    headline: 'Deposita 20€ → 40€ Real Bonus Sport + 5€ App + 50 Free Spins (cod. WB_2026)',
    summary:
      'Miglior ROI percentuale dell’intera app (~+200% sul deposito!): con soli 20€ di ricarica ottieni 40€ di Real Bonus Sport (4×10€ settimanali su 3 eventi ≥ 1.50), 5€ Real Bonus App e 50 Free Spins. Ideale per iniziare con piccolo bankroll (~+40€ netti).',
    promoCode: 'WB_2026',
    registrationMethod: 'standard',
    registrationNote: 'Inserisci il codice promo WB_2026 in registrazione e invia il documento d’identità.',
    estimatedTimeLabel: '4 settimane (10 min/sett)',
    expiryDays: 7,
    strategyTags: ['Deposito Solo 20€', 'ROI ~200%', 'Principiante', 'Codice WB_2026'],
    termsSummary: {
      bonusStructure: '40€ Real Bonus Sport (4 tranche da 10€/settimana) + 5€ Real Bonus App + 5€ Virtual + 50 Free Spins.',
      rolloverRule: 'Qualificante 20€ (1x) su 3 eventi q ≥ 1.80; ogni tranche da 10€ Real Bonus rigioco 1x su 3 eventi q ≥ 1.50.',
      minOddsRule: 'Qualificante: ≥ 3 eventi, quota ≥ 1.80 per evento. Real Bonus: ≥ 3 eventi, quota ≥ 1.50 per evento.',
      minLegs: 3,
      excludedPayments: ['Verifica esclusioni e-wallet nei T&C (preferisci Carta o PayPal)'],
      validityRule: 'Deposito entro 7 giorni; tranche da 10€ valide 3–7 giorni dall’accredito.',
      conversionCap: 'Nessun cap penalizzante sul Real Bonus Sport.',
      criticalWarnings: [
        'Inserisci tassativamente il codice WB_2026 in fase di apertura conto.',
        'Esclusi sistemi, Antepost, Cash Out, Bet Builder e mercati Pari/Dispari.',
        'Scarica e fai login sull’App mobile Stanleybet per sbloccare i 5€ Real Bonus App extra.',
      ],
    },
    simulationModel: {
      defaultDeposit: 20,
      minDeposit: 20,
      maxDeposit: 20,
      scalableDeposit: false,
      baseRecommendedBankroll: 160,
      components: [
        {
          kind: 'qualifying_bet',
          label: 'Qualificante 20€ (1x su 3 eventi ≥ 1.80)',
          stake: 20,
          legs: 3,
          avgLegOdds: 1.85,
        },
        {
          kind: 'real_bonus_sr',
          label: '40€ Real Bonus Sport (4×10€, 1x su 3 eventi ≥ 1.50)',
          fixedAmount: 10,
          count: 4,
          legs: 3,
          avgLegOdds: 1.55,
        },
        {
          kind: 'real_bonus_sr',
          label: '5€ Real Bonus App mobile (1x)',
          fixedAmount: 5,
          legs: 1,
          avgLegOdds: 1.8,
        },
        {
          kind: 'casino_free_spins',
          label: '50 Free Spins inclusi (25x su vincite — rischio 0€)',
          spinsCount: 50,
          spinValue: 0.1,
          rtp: 0.962,
          wageringMultiplier: 25,
          conversionCapPerTranche: 20,
          tranches: 1,
          seed: 514,
        },
      ],
    },
    steps: [
      {
        id: 'stan_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrati con codice WB_2026, valida documento e deposita 20€',
        exactAction: 'Apri conto su Stanleybet.it inserendo il codice WB_2026, convalida il documento e ricarica 20€ con Carta o PayPal.',
        description: 'Bastano esattamente 20€ di deposito per attivare l’intero pacchetto da 40€ + 5€ App + 50 Free Spins.',
        toolAction: { target: 'external', label: 'Apri Stanleybet.it', url: 'https://www.stanleybet.it/sport' },
      },
      {
        id: 'stan_s2',
        stepNumber: 2,
        phase: 'qualificante',
        title: 'Piazza la qualificante da 20€ (3 eventi ≥ 1.80)',
        exactAction: 'Costruisci in Multiodds una multipla sequenziale da 20€ su Stanleybet con 3 eventi sfalsati, ciascuno a quota ≥ 1.80 (modalità Normale).',
        description:
          'Con soli 20€ la perdita qualificante è minuscola (~2€) e la responsabilità massima resta sotto i ~120€.',
        warning: 'Esclusi sistemi, Cash Out, Bet Builder e mercati Pari/Dispari.',
        toolAction: { target: 'multiodds', label: 'Costruisci 3-Eventi Stanleybet', presetMode: 'normal' },
      },
      {
        id: 'stan_s3',
        stepNumber: 3,
        phase: 'conversione',
        title: 'Converti le 4 tranche da 10€ Real Bonus (1 a settimana)',
        exactAction: 'Dopo la refertazione ricevi i primi 10€ (poi 10€/sett per 3 settimane): gioca ogni tranche in Multiodds modalità SR su 3 eventi ≥ 1.50.',
        description: 'Ogni tranche da 10€ genera circa +8.95€ netti, con pochissima responsabilità richiesta sull’Exchange (~28€–35€).',
        toolAction: { target: 'multiodds', label: 'Converti Tranche 10€ (SR)', presetMode: 'sr' },
      },
      {
        id: 'stan_s4',
        stepNumber: 4,
        phase: 'conversione',
        title: 'Sblocca i 5€ App Real Bonus e gira i 50 Free Spins gratuiti',
        exactAction: 'Accedi dall’App mobile Stanleybet per ricevere i 5€ Real Bonus (converti 1x in SR) e gioca i 50 Free Spins + 5€ Virtual a rischio zero.',
        description: 'Tutto valore aggiunto puro senza ulteriore deposito.',
      },
      {
        id: 'stan_s5',
        stepNumber: 5,
        phase: 'prelievo',
        title: 'Preleva il saldo e registra ~+40€ netti',
        exactAction: 'Al termine della 4ª settimana preleva eventuali vincite residue e archivia la guida.',
        description: 'Ottimo rapporto profitto/capitale impegnato.',
      },
    ],
  },

  // =========================================================================
  // 15. NETBET.IT — SPORT + 200 FS SPID (TIER B — AVANZATO)
  // =========================================================================
  {
    id: 'netbet_sport_welcome',
    sourceId: 'netbet_it',
    bookmakerName: 'NetBet.it',
    url: 'https://www.netbet.it/scommesse/',
    category: 'sport',
    tier: 'B',
    difficulty: 'avanzato',
    headline: '100% fino a 1.000€ (calibra 100€–200€) + 200 Free Spin SPID',
    summary:
      'Offerta a due componenti: 200 Free Spin SPID senza deposito (4×50 FS su Legacy of Dead, rischio zero) + 100% Fun Bonus Sport (6x deposito su 3 eventi ≥ 1.50). ATTENZIONE: il Fun Bonus ha limite di puntata 10€ a ticket in 5 giorni! Consigliato deposito calibrato di 100€ (10 schedine) e rating ≥ 96.5%/gamba.',
    promoCode: null,
    registrationMethod: 'spid_recommended',
    registrationNote: 'Con SPID ottieni anche i 200 Free Spin senza deposito su Legacy of Dead (50 FS/sett × 4 sett).',
    estimatedTimeLabel: '7–14 giorni',
    expiryDays: 30,
    strategyTags: ['Rating ≥ 96.5%/gamba', 'Limite 10€/ticket', '200 FS SPID', 'Multiodds'],
    termsSummary: {
      bonusStructure: '100% sul primo deposito fino a 1.000€ Fun Bonus Sport (consigliato 100€–200€) + 200 Free Spin SPID senza deposito.',
      rolloverRule: 'Deposito 6x su multiple ≥ 3 eventi q ≥ 1.50 entro 30gg → Fun Bonus 1x (in 5gg, max 10€ per schedina!) → Real Bonus 1x.',
      minOddsRule: 'Multiple ≥ 3 eventi con quota minima 1.50 per evento (Fun Bonus solo Pre-Match, puntata 1€–10€ per ticket).',
      minLegs: 3,
      excludedPayments: ['Skrill', 'Neteller', 'PayPal', 'OnShop'],
      validityRule: '30 giorni per il 6x qualificante; SOLO 5 giorni per rigiocare il Fun Bonus Sport (3 giorni per ogni set di Free Spin).',
      conversionCap: 'Cap 1.000€ sul Fun Bonus Sport; cap 10€/settimana (40€ tot.) sui 200 Free Spin SPID.',
      criticalWarnings: [
        'LIMITE 10€ PER TICKET FUN BONUS IN 5 GIORNI: se depositassi 1.000€ dovresti piazzare 100 multiple da 10€ (300 partite!) in 5 giorni! Calibra il deposito su 100€ (solo 10 multiple da 10€) o massimo 200€.',
        'Come Betsson, con 6x su 3 eventi serve tassativamente rating ≥ 96.5% per gamba (sotto 95.3%/gamba la parte sportiva va in perdita!).',
        'NON usare PayPal, Skrill, Neteller o OnShop: deposita solo con Carta di credito/debito.',
      ],
    },
    simulationModel: {
      defaultDeposit: 100,
      minDeposit: 50,
      maxDeposit: 300,
      scalableDeposit: true,
      baseRecommendedBankroll: 450,
      components: [
        {
          kind: 'qualifying_bet',
          label: 'Qualificante 6x deposito (3 eventi ≥ 1.50)',
          depositMultiplier: 6,
          scalesWithDeposit: true,
          legs: 3,
          avgLegOdds: 1.56,
        },
        {
          kind: 'real_bonus_sr',
          label: 'Fun Bonus 100% (1x in ticket da 10€, 3 eventi) → Real 1x',
          pctOfDeposit: 100,
          maxAmount: 1000,
          legs: 3,
          avgLegOdds: 1.56,
          rolloverMultiplier: 1.35, // include frizione del rigioco finale 1x del Real Bonus
        },
        {
          kind: 'casino_free_spins',
          label: '200 Free Spin SPID (4×50 FS @ 0.20€, 35x, cap 10€/sett)',
          spinsCount: 200,
          spinValue: 0.2,
          rtp: 0.9658,
          wageringMultiplier: 35,
          conversionCapPerTranche: 10,
          tranches: 4,
          seed: 404,
        },
      ],
    },
    steps: [
      {
        id: 'nb_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrati con SPID selezionando Welcome Offer Sport',
        exactAction: 'Apri il conto su NetBet.it tramite SPID per attivare sia la promo Sport sia i 200 Free Spin senza deposito su Legacy of Dead.',
        description: 'I primi 50 Free Spin (da 0.20€) vengono accreditati entro 24 ore dalla convalida SPID, seguiti da altri 3 blocchi settimanali.',
        toolAction: { target: 'external', label: 'Apri NetBet.it', url: 'https://www.netbet.it/scommesse/' },
      },
      {
        id: 'nb_s2',
        stepNumber: 2,
        phase: 'setup',
        title: 'Deposita 100€ (max 200€) SOLO con Carta',
        exactAction: 'Ricarica 100€ con Carta Visa/Mastercard (evita cifre più alte per via del limite di 10€ a ticket sul Fun Bonus).',
        description: 'Con 100€ dovrai generare 600€ di qualificanti in 30 giorni e poi rigiocare solo 10 schedine da 10€ in 5 giorni.',
        warning: 'PayPal, Skrill, Neteller e OnShop sono esclusi!',
      },
      {
        id: 'nb_s3',
        stepNumber: 3,
        phase: 'qualificante',
        title: 'Completa 600€ su multiple 3 eventi SOLO con rating ≥ 96.5%/gamba',
        exactAction: 'Usa Multiodds su NetBet filtrando 3 eventi ≥ 1.50 con rating multipla ≥ 90% (es. 6 multiple da 100€ o 12 da 50€).',
        description: 'Seleziona solo match liquidi del weekend per tenere la perdita qualificante sotto i ~60€.',
        warning: 'Non piazzare multiple con rating < 88%: eroderebbero l’intero margine della parte sportiva.',
        toolAction: { target: 'multiodds', label: 'Apri Multiodds su NetBet', presetMode: 'normal' },
      },
      {
        id: 'nb_s4',
        stepNumber: 4,
        phase: 'conversione',
        title: 'Rigioca i 100€ di Fun Bonus in 10 schedine da 10€ entro 5 giorni',
        exactAction: 'Spunta il Fun Bonus nel carrello e piazza 10 multiple pre-match da 10€ (3 eventi ≥ 1.50) in modalità SR, poi rigioca 1x in singola il Real Bonus ottenuto.',
        description: 'Le schedine da 10€ hanno responsabilità minuscola (~28€–35€ ciascuna): puoi gestirle rapidamente in 2–3 giorni del weekend.',
        toolAction: { target: 'multiodds', label: 'Converti Fun Bonus (10€×10)', presetMode: 'sr' },
      },
      {
        id: 'nb_s5',
        stepNumber: 5,
        phase: 'conversione',
        title: 'Sfrutta i 4 blocchi da 50 Free Spin su Legacy of Dead',
        exactAction: 'Ogni settimana apri Legacy of Dead, imposta spin 0.20€, gioca i 50 FS gratuiti e completa il 35x entro 3 giorni (cap 10€ Real Bonus 1x).',
        description: 'Rischio monetario 0,00 €: aggiunge mediamente ~+8€–+12€ extra al profitto netto.',
      },
    ],
  },

  // =========================================================================
  // 16. BETFLAG.IT / BETFLAG EXCHANGE — CASINÒ +EV FALLBACK (TIER S RISCHIO ZERO!)
  // =========================================================================
  {
    id: 'betflag_casino_cie_welcome',
    sourceId: 'betflag_it',
    relatedSourceIds: ['betflag_exchange'],
    bookmakerName: 'Betflag.it',
    url: 'https://www.betflag.it/',
    category: 'casino_fallback',
    categoryReason:
      'Lo Sport Deposito fino a 5.000€ ha scaglioni di turnover crescenti punitivi: a 50€ chiede 800€ (16x → solo ~+20€), a 100€ sale a 2.400€ (24x → margine quasi nullo) e a 5.000€ chiede 235.000€ (47x → perdita matematica di -3.400€!). Inoltre il no-dep Sport da 10€ può inibire l’Exchange per 30 giorni. Al contrario, il Bonus Senza Deposito Casinò CIE da 5.000€ (10×500€ slot) ha rischio 0,00€ ed EV simulato ~+270€–+350€ su tutte le 10 tranche!',
    tier: 'S',
    difficulty: 'intermedio',
    headline: 'Casinò +EV: 5.000€ Senza Deposito con CIE (10×500€, cap 150€/tranche)',
    summary:
      'Miglior bonus senza deposito a rischio ZERO in Italia (account unico Betflag Sport/Exchange/Casinò): registrandoti con CIE ricevi 10 tranche da 500€ di Fun Bonus Slot su 10 provider diversi (turnover 50x, cap 150€ Real Bonus ciascuna, max 1.500€). Con strategia Casinò 2-Fasi l’EV simulato è ~+270€–+350€ con 0€ depositati! (Con SPID: 500€ → EV ~+27€–+35€).',
    promoCode: null,
    registrationMethod: 'cie_recommended',
    registrationNote: 'Usa OBBLIGATORIAMENTE la CIE (Carta d’Identità Elettronica) per avere tutte le 10 tranche da 500€ (5.000€). Con SPID ne ottieni 500€, con registrazione classica 250€.',
    estimatedTimeLabel: '10–20 giorni (1 tranche ogni 1–2gg)',
    expiryDays: 2,
    strategyTags: ['Rischio 0,00 €', 'Casinò 2-Fasi', 'CIE 5.000€', 'Non Tocca Exchange'],
    termsSummary: {
      bonusStructure: '5.000€ senza deposito CIE (10 tranche × 500€ su 10 provider slot + 25€ Virtual); 500€ con SPID; 250€ classico.',
      rolloverRule: 'Turnover 50x per singola tranche (25.000€ per tranche da 500€) → Real Bonus convertito da rigiocare 1x.',
      minOddsRule: 'Slot del singolo provider assegnato alla tranche (Playtech, Pragmatic, Hacksaw, Games Global, Playson, ecc.).',
      minLegs: null,
      excludedPayments: ['Nessun deposito richiesto! (Verifica solo mail e numero cellulare entro 30gg)'],
      validityRule: 'OGNI tranche dura SOLO 2 GIORNI (48 ore) dall’attivazione.',
      conversionCap: 'Cap massimo convertibile 150€ per ciascuna delle 10 tranche (totale massimo 1.500€ Real Bonus).',
      criticalWarnings: [
        'NON scegliere il Welcome Bonus Sport sopra i 50€ (24x–47x è matematicamente in perdita!) e ricorda che i bonus di benvenuto Sport e Casinò sono MUTUAMENTE ESCLUSIVI in registrazione.',
        'Valida subito sia l’email sia il numero di cellulare entro 30 giorni: è condizione obbligatoria per l’accredito e il prelievo.',
        'Se non hai CIE ma vuoi comunque fare Sport, ferma il deposito Sport al massimo a 50€ (scaglione 800€ = 16x @3.50 → ~+20€) e NON oltre.',
      ],
    },
    simulationModel: {
      defaultDeposit: 0,
      minDeposit: 0,
      maxDeposit: 0,
      scalableDeposit: false,
      baseRecommendedBankroll: 0,
      isPureCasino: true,
      components: [
        {
          kind: 'casino_fun_bonus',
          label: '10 Tranche CIE × 500€ Slot (50x, cap 150€/tranche)',
          bonusPerTranche: 500,
          tranches: 10,
          wageringMultiplier: 50,
          conversionCapPerTranche: 150,
          rtpPhase1: 0.958,
          rtpPhase2: 0.962,
          maxBetPerSpin: 2,
          contributionPct: 100,
          seed: 1011,
        },
      ],
    },
    steps: [
      {
        id: 'bfl_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrati con CIE selezionando Bonus Senza Deposito Slot',
        exactAction: 'Apri conto su Betflag.it usando la Carta d’Identità Elettronica (CIE), seleziona il Bonus Senza Deposito Slot (5.000€) e convalida subito SMS ed Email.',
        description:
          'Non serve alcun deposito iniziale. Betflag è anche un ottimo Exchange italiano (commissione standard 5%, promo 2%): questa scelta Casinò ti lascia libero l’Exchange senza i rischi di blocco del no-dep Sport.',
        warning: 'Senza CIE (usando solo SPID) riceverai un pacchetto ridotto (~500€). Assicurati di selezionare il comparto Slot/Casinò nel form.',
        toolAction: { target: 'external', label: 'Apri Betflag.it', url: 'https://www.betflag.it/' },
      },
      {
        id: 'bfl_s2',
        stepNumber: 2,
        phase: 'sblocco',
        title: 'Fase 1 (Alta Volatilità) su ciascuna delle 10 tranche da 500€',
        exactAction: 'Appena si attiva una tranche da 500€ (dura 48 ore!), apri una slot ad ALTA volatilità del provider indicato con puntata medio-alta (2€–4€ a spin, rispettando sempre il max bet dei T&C).',
        description:
          'Perché alta volatilità all’inizio? Perché con 25.000€ di turnover (50x) la perdita attesa a puntate piccole sarebbe ~875€, superiore ai 500€ di partenza. Puntare alto all’inizio mira a beccare un bonus/feature da 150x–300x che porti il saldo oltre 1.300€–1.600€ (oppure andare a 0€ perdendo zero euro tuoi!).',
        mathTip: 'Se la tranche scende a 0€, passa serenamente alla tranche successiva: hai perso 0,00€ reali e la varianza lavora a tuo favore su 10 tentativi indipendenti.',
        warning: 'Controlla sempre nei dettagli della tranche il limite massimo di puntata per spin consentito.',
      },
      {
        id: 'bfl_s3',
        stepNumber: 3,
        phase: 'conversione',
        title: 'Fase 2 (Grind Alto RTP / Bassa Volatilità) una volta superati ~1.200€',
        exactAction: 'Se in Fase 1 il saldo supera ~1.200€–1.400€, cambia subito strategia: abbassa lo spin a 0.20€–0.50€ su una slot a BASSA volatilità e RTP ≥ 96.5% dello stesso provider fino al 100% dei 25.000€.',
        description:
          'Con 1.200€+ di saldo e puntata piccola, la curva si stabilizza: smaltisci il rollover residuo atterrando comodamente sopra il cap di 150€, che si converte automaticamente in 150€ di Real Bonus!',
        mathTip: 'Basta convertire anche solo 2 tranche su 10 al cap di 150€ per incassare +290€ puliti a rischio zero!',
      },
      {
        id: 'bfl_s4',
        stepNumber: 4,
        phase: 'conversione',
        title: 'Rigioca 1x il Real Bonus convertito (max 150€/tranche)',
        exactAction: 'Appena una tranche converte in Real Bonus (fino a 150€), rigiocalo 1 volta (1x) su una slot ad altissimo RTP / bassissima volatilità (o su Sport se consentito dai T&C della tranche).',
        description: 'Un rigioco 1x a puntata minima (0.10€–0.20€) su slot ~97% RTP converte mediamente il 96.5%–97% del Real Bonus in saldo prelevabile.',
      },
      {
        id: 'bfl_s5',
        stepNumber: 5,
        phase: 'prelievo',
        title: 'Ripeti per tutte le 10 tranche e preleva il profitto',
        exactAction: 'Segna i giorni di attivazione (ogni 1–2 giorni) per non far scadere nessuna tranche da 48h, quindi preleva il totale convertito.',
        description: 'Nessun rischio di perdita reale sull’intera operazione.',
      },
    ],
  },

  // =========================================================================
  // 17. DOMUSBET.IT — CASINÒ +EV FALLBACK (TIER B RISCHIO ZERO)
  // =========================================================================
  {
    id: 'domusbet_casino_spid_welcome',
    sourceId: 'domusbet_it',
    bookmakerName: 'DomusBet.it',
    url: 'https://www.domusbet.it/scommesse',
    category: 'casino_fallback',
    categoryReason:
      'Il Bonus Benvenuto Sport (50% fino a 100€) è matematicamente NON profittevole: richiede una qualificante da 200€ su multipla ≥ 4 eventi a quota ≥ 1.50 (perdita ~-26.60€) e poi applica un CAP massimo convertibile pari a 1x (100€) sul Fun Bonus Sport 3x 4 eventi, impedendo il bancaggio in profitto (EV simulato da -15€ a -27€). Al contrario, il Bonus Senza Deposito Casinò SPID (250€ Fun Bonus 45x) ha rischio 0,00€ ed EV positivo!',
    tier: 'B',
    difficulty: 'intermedio',
    headline: 'Casinò +EV: 250€ Senza Deposito SPID (45x, rischio 0,00€)',
    summary:
      'Scartato lo Sport perché cappato a 1x dopo una qualificante costosa, si sfrutta il Bonus Senza Deposito SPID di DomusBet (fino a 500€ totali, di cui 250€ Casinò 45x in tranche da 3 giorni) con strategia Casinò 2-Fasi a rischio zero (~+26€ EV).',
    promoCode: null,
    registrationMethod: 'spid_recommended',
    registrationNote: 'Con SPID il pacchetto senza deposito raddoppia (fino a 500€ totali vs 250€ con documento classico).',
    estimatedTimeLabel: '3 giorni',
    expiryDays: 3,
    strategyTags: ['Rischio 0,00 €', 'Casinò 2-Fasi', 'SPID Consigliato', 'Sport Cappato Scartato'],
    termsSummary: {
      bonusStructure: 'Senza deposito SPID fino a 500€ (250€ Casinò + 250€ Sport); registrazione classica fino a 250€.',
      rolloverRule: 'Fun Bonus Casinò 45x (= 11.250€ su 250€) entro 3 giorni → Real Bonus convertito da rigiocare 1x.',
      minOddsRule: 'Video slot della sezione promozionale indicata nei T&C.',
      minLegs: null,
      excludedPayments: ['Nessun deposito richiesto'],
      validityRule: '3 giorni dall’accredito di ciascuna tranche.',
      conversionCap: 'Verifica il cap esatto per tranche nell’Area Bonus (modellato prudentemente a max 250€).',
      criticalWarnings: [
        'NON effettuare il deposito da 200€ per il Bonus Sport 50%: il cap 1x sul Fun Bonus 3x 4 eventi lo rende -EV!',
        'La validità delle tranche senza deposito è di soli 3 giorni: inizia la sessione 2-Fasi subito dopo l’accredito.',
        'Valida sempre il documento/SPID per rendere prelevabile l’eventuale Real Bonus convertito.',
      ],
    },
    simulationModel: {
      defaultDeposit: 0,
      minDeposit: 0,
      maxDeposit: 0,
      scalableDeposit: false,
      baseRecommendedBankroll: 0,
      isPureCasino: true,
      components: [
        {
          kind: 'casino_fun_bonus',
          label: '250€ Fun Bonus Casinò SPID (45x, rischio 0€)',
          bonusPerTranche: 250,
          tranches: 1,
          wageringMultiplier: 45,
          conversionCapPerTranche: 250,
          rtpPhase1: 0.96,
          rtpPhase2: 0.965,
          maxBetPerSpin: 3,
          contributionPct: 100,
          seed: 2022,
        },
      ],
    },
    steps: [
      {
        id: 'dom_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrati tramite SPID senza depositare',
        exactAction: 'Apri il conto su DomusBet.it con SPID (evita di depositare per il bonus sport cappato) e attendi l’accredito del Fun Bonus senza deposito.',
        description: 'Con SPID ottieni il massimale senza deposito (250€ Casinò + quota Sport gratuita utilizzabile solo come freeroll a 0€ di rischio).',
        warning: 'Non depositare 200€ per il bonus sport: l’analisi T&C dimostra un EV negativo per via del cap 1x.',
        toolAction: { target: 'external', label: 'Apri DomusBet.it', url: 'https://www.domusbet.it/scommesse' },
      },
      {
        id: 'dom_s2',
        stepNumber: 2,
        phase: 'sblocco',
        title: 'Fase 1: Alta Volatilità sul Fun Bonus Casinò 250€',
        exactAction: 'Apri una slot ad alta volatilità tra quelle idonee e gioca a 2€–3€ per spin puntando a superare i ~700€–850€ di saldo.',
        description:
          'Con 45x di rollover (= 11.250€) il costo medio in Fase 2 è ~400€: serve prima uno spike di varianza che crei il cuscinetto necessario a superare il wagering con saldo positivo.',
      },
      {
        id: 'dom_s3',
        stepNumber: 3,
        phase: 'conversione',
        title: 'Fase 2: Completa il 45x a puntata bassa entro 3 giorni',
        exactAction: 'Superata la soglia di ~750€, passa a una slot a bassa volatilità/alto RTP (spin 0.20€–0.40€) e completa il 100% del rollover.',
        description: 'Una volta riempita la barra, il saldo (fino al cap) diventa Real Bonus.',
      },
      {
        id: 'dom_s4',
        stepNumber: 4,
        phase: 'prelievo',
        title: 'Rigioca 1x il Real Bonus e preleva',
        exactAction: 'Rigioca 1x il Real Bonus convertito a spin minimo (0.10€–0.20€) e richiedi il prelievo delle vincite.',
        description: 'Operazione al 100% priva di rischio sul capitale personale.',
      },
    ],
  },

  // =========================================================================
  // 18. POKERSTARS.IT — CASINÒ +EV FALLBACK (TIER B RISCHIO ZERO)
  // =========================================================================
  {
    id: 'pokerstars_casino_welcome',
    sourceId: 'pokerstars_it',
    bookmakerName: 'PokerStars.it',
    url: 'https://www.pokerstars.it/scommesse',
    category: 'casino_fallback',
    categoryReason:
      'Il Bonus Benvenuto Sport di PokerStars (100% fino a 100€ in 5 tranche da 20€) impone multiple ≥ 3 eventi con quota totale minima pari a 15.00, rendendo la bancata sequenziale estremamente inefficiente (responsabilità altissima, slippage e rischio clausole anti-copertura). Il Casinò offre invece 200€ Fun Bonus + 10 Free Spin completamente SENZA DEPOSITO (rischio 0,00€, EV positivo).',
    tier: 'B',
    difficulty: 'intermedio',
    headline: 'Casinò +EV: 200€ Fun Bonus + 10 Free Spin Senza Deposito (rischio 0€)',
    summary:
      'Escluso lo Sport (quota minima totale 15.00), si sfrutta il pacchetto Casinò Senza Deposito: 200€ Fun Bonus alla registrazione (65x, cap 200€, 2 giorni) + 10 Free Spin alla convalida documento. Rischio 0,00 €, EV stimato ~+17€ (con nota prudente sul 300% deposito).',
    promoCode: null,
    registrationMethod: 'standard',
    registrationNote: 'Registrazione standard + invio documento per sbloccare sia i 200€ Fun Bonus sia i 10 Free Spin.',
    estimatedTimeLabel: '2 giorni',
    expiryDays: 2,
    strategyTags: ['Rischio 0,00 €', 'Casinò 2-Fasi', '10 Free Spin', 'Sport q≥15 Scartato'],
    termsSummary: {
      bonusStructure: '200€ Fun Bonus Senza Deposito alla registrazione + 10 Free Spin (0.20€) alla convalida documento. (Opzionale: 300% fino 300€ 40x sul deposito).',
      rolloverRule: 'Fun Bonus 200€ senza deposito: wagering 65x (= 13.000€) entro 2 giorni → Real Bonus 1x.',
      minOddsRule: 'Slot machine selezionate nei T&C Casinò (esclusi giochi da tavolo e live).',
      minLegs: null,
      excludedPayments: ['Nessun deposito richiesto (per l’eventuale 300% deposito è escluso il Bonifico Bancario)'],
      validityRule: 'SOLO 2 GIORNI (48 ore) per completare il 65x sui 200€ senza deposito.',
      conversionCap: 'Cap massimo convertibile 200€ in Real Bonus sui 200€ senza deposito.',
      criticalWarnings: [
        'NON scegliere il Bonus Sport: la quota minima totale di 15.00 rende lo sport sconsigliato per il Matched Betting.',
        'Valuta il bonus deposito 300% (fino 300€, 40x) SOLO se verifichi nei T&C che il tuo deposito cash resta separato (non-sticky): se è sticky con il Fun Bonus, l’EV diventa negativo (-35€)!',
        'I 200€ senza deposito scadono in 48 ore: registrati solo quando hai 1–2 ore libere per completarli.',
      ],
    },
    simulationModel: {
      defaultDeposit: 0,
      minDeposit: 0,
      maxDeposit: 0,
      scalableDeposit: false,
      baseRecommendedBankroll: 0,
      isPureCasino: true,
      components: [
        {
          kind: 'casino_fun_bonus',
          label: '200€ Fun Bonus Senza Deposito (65x, cap 200€)',
          bonusPerTranche: 200,
          tranches: 1,
          wageringMultiplier: 65,
          conversionCapPerTranche: 200,
          rtpPhase1: 0.96,
          rtpPhase2: 0.965,
          maxBetPerSpin: 2.5,
          contributionPct: 100,
          seed: 3033,
        },
        {
          kind: 'casino_free_spins',
          label: '10 Free Spin alla convalida documento (0.20€)',
          spinsCount: 10,
          spinValue: 0.2,
          rtp: 0.965,
          wageringMultiplier: 1,
          tranches: 1,
          seed: 3034,
        },
      ],
    },
    steps: [
      {
        id: 'ps_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrati sul Casinò PokerStars e convalida subito il documento',
        exactAction: 'Apri conto su PokerStars.it scegliendo l’offerta Casinò Senza Deposito (200€ Fun Bonus + 10 Free Spin) e carica il documento.',
        description: 'Non effettuare alcun deposito iniziale: l’intera strategia principale ha rischio monetario zero.',
        warning: 'I 200€ Fun Bonus durano solo 48 ore: agisci subito dopo l’accredito.',
        toolAction: { target: 'external', label: 'Apri PokerStars.it', url: 'https://www.pokerstars.it/scommesse' },
      },
      {
        id: 'ps_s2',
        stepNumber: 2,
        phase: 'sblocco',
        title: 'Fase 1: Alta Volatilità sui 200€ Fun Bonus',
        exactAction: 'Apri una delle slot idonee ad alta volatilità (puntata 2€–2.50€ a spin) puntando a superare ~750€–900€ di saldo prima di abbassare la puntata.',
        description:
          'Con 65x di wagering (= 13.000€), solo un hit consistente in Fase 1 permette di superare indenni la perdita attesa della Fase 2 (~450€).',
      },
      {
        id: 'ps_s3',
        stepNumber: 3,
        phase: 'conversione',
        title: 'Fase 2: Completa il 65x a spin basso + gioca i 10 Free Spin',
        exactAction: 'Se raggiungi ~800€+, abbassa lo spin a 0.20€ su slot idonea a bassa varianza fino al 100% del rollover (cap 200€ Real Bonus); gioca inoltre i 10 Free Spin gratuiti.',
        description: 'Rigioca 1x l’eventuale Real Bonus convertito.',
      },
      {
        id: 'ps_s4',
        stepNumber: 4,
        phase: 'prelievo',
        title: 'Preleva le vincite (senza cadere nella trappola sticky)',
        exactAction: 'Preleva il saldo reale generato. Ignora il 300% deposito se i T&C vincolano il saldo reale al 40x.',
        description: 'Registra il profitto effettivo a costo 0€.',
      },
    ],
  },

  // =========================================================================
  // 19. LEOVEGAS.IT — CASINÒ FREE SPINS SPID FALLBACK (TIER C RISCHIO ZERO)
  // =========================================================================
  {
    id: 'leovegas_casino_spid_welcome',
    sourceId: 'leovegas_it',
    bookmakerName: 'LeoVegas.it',
    url: 'https://www.leovegas.it/scommesse',
    category: 'casino_fallback',
    categoryReason:
      'LeoVegas Italia non propone un Welcome Bonus Sport fisso profittevole (solo promozioni temporanee di vincite potenziate con puntate basse 10€–25€). Inoltre il Bonus Deposito Casinò fino a 1.500€ richiede 35x in DENARO REALE sulle slot: a 96.5% RTP la perdita attesa è 122.5% del deposito contro 100% di bonus (-22.5% = -EV!). È invece al 100% profittevole e senza rischio il Bonus SPID da 50 Free Spin con vincite direttamente in Real Bonus 1x!',
    tier: 'C',
    difficulty: 'principiante',
    headline: 'Casinò +EV: 50 Free Spin SPID Senza Deposito (Real Bonus 1x — rischio 0€)',
    summary:
      'Operazione lampo da 5 minuti a rischio 0,00€: registrandoti con SPID ricevi 50 Free Spin su Big Bass Bonanza le cui vincite sono accreditate direttamente come Real Bonus 1x (niente rollover 35x!). EV pulito ~+5€–+9€, evitando la trappola -EV del bonus deposito 35x.',
    promoCode: null,
    registrationMethod: 'spid_recommended',
    registrationNote: 'SPID obbligatorio per i 50 Free Spin senza deposito. Presta il consenso alle comunicazioni promo/bonus in registrazione!',
    estimatedTimeLabel: '5–10 minuti',
    expiryDays: 3,
    strategyTags: ['Rischio 0,00 €', 'Real Bonus 1x', 'SPID Obbligatorio', '5 Minuti'],
    termsSummary: {
      bonusStructure: '50 Free Spin senza deposito con SPID su Big Bass Bonanza (vincite in Real Bonus 1x!).',
      rolloverRule: 'Vincite dei 50 Free Spin accreditate in Real Bonus con rigioco 1x (EVITA invece il bonus deposito 35x in denaro reale: -EV!).',
      minOddsRule: 'Slot Big Bass Bonanza per i 50 FS; rigioco 1x su slot ad alto RTP.',
      minLegs: null,
      excludedPayments: ['Nessun deposito richiesto (Skrill/Neteller esclusi per eventuali promo future)'],
      validityRule: 'Attiva la scheda bonus in "Le Mie Offerte" entro 24 ore dall’accredito; usa i giri entro 72 ore.',
      conversionCap: 'Nessun cap punitivo sulle vincite dei 50 Free Spin (Real Bonus 1x).',
      criticalWarnings: [
        'NON fare il Bonus Deposito Casinò 1.500€ (35x in denaro reale): la simulazione matematica dimostra un valore atteso negativo di circa -26€ ogni 100€ depositati a 96.5% RTP!',
        'Attiva la scheda dei 50 Free Spin entro 24 ore dall’accredito in "Promozioni Attive" o scadono.',
        'Spunta il consenso a ricevere offerte/bonus durante la registrazione (altrimenti LeoVegas non assegna promozioni).',
      ],
    },
    simulationModel: {
      defaultDeposit: 0,
      minDeposit: 0,
      maxDeposit: 0,
      scalableDeposit: false,
      baseRecommendedBankroll: 0,
      isPureCasino: true,
      components: [
        {
          kind: 'casino_free_spins',
          label: '50 Free Spin SPID su Big Bass Bonanza (Real Bonus 1x)',
          spinsCount: 50,
          spinValue: 0.15,
          rtp: 0.9671,
          wageringMultiplier: 1,
          tranches: 1,
          seed: 901,
        },
      ],
    },
    steps: [
      {
        id: 'leo_s1',
        stepNumber: 1,
        phase: 'setup',
        title: 'Registrati tramite SPID spuntando il consenso bonus',
        exactAction: 'Apri conto su LeoVegas.it con SPID selezionando il benvenuto Casinò e attiva i consensi alle promozioni.',
        description: 'I 50 Free Spin gratuiti vengono accreditati entro 72 ore dalla registrazione SPID.',
        warning: 'Non depositare per il bonus 35x (matematicamente -EV su slot standard).',
        toolAction: { target: 'external', label: 'Apri LeoVegas.it', url: 'https://www.leovegas.it/scommesse' },
      },
      {
        id: 'leo_s2',
        stepNumber: 2,
        phase: 'sblocco',
        title: 'Attiva la scheda bonus entro 24 ore e gira i 50 Free Spin',
        exactAction: 'Vai in "Le Mie Offerte / Promozioni attive", attiva la scheda dei 50 Free Spin entro 24 ore e giocali su Big Bass Bonanza entro 72 ore.',
        description: 'A differenza di quasi tutti gli altri siti, qui le vincite dei giri gratis arrivano direttamente come Real Bonus 1x!',
      },
      {
        id: 'leo_s3',
        stepNumber: 3,
        phase: 'conversione',
        title: 'Rigioca 1x le vincite e preleva (o tienile per future quote potenziate)',
        exactAction: 'Rigioca 1 volta (1x) il Real Bonus vinto su una slot ad alto RTP a puntata minima (0.10€) per renderlo prelevabile.',
        description: 'Incasso immediato a costo zero; in futuro tieni d’occhio eventuali promo sport "Vincite Potenziate" con boost ≥ 20%.',
      },
    ],
  },
];

/**
 * Siti presenti in SOURCE_CATALOG esaminati ed ESCLUSI dalle guide operative
 * (chiusi in Italia, non ADM, assenza di bonus profittevole o restrizioni geografiche).
 */
export const EXCLUDED_WELCOME_SITES: ExcludedWelcomeSite[] = [
  {
    sourceId: 'unibet',
    siteName: 'Unibet',
    region: 'EU (Chiuso in Italia)',
    reasonShort: 'Attività cessata in Italia dal 10/11/2025',
    sportAudit: 'Concessione ADM non rinnovata da Kindred Group: sito unibet.it chiuso per nuove registrazioni.',
    casinoAudit: 'Non disponibile in Italia (i vecchi conti esistenti sono stati migrati su Codere.it).',
    note: 'Impossibile aprire un nuovo conto o riscattare bonus benvenuto dall’Italia.',
    url: 'https://www.unibet.it/',
  },
  {
    sourceId: 'pinnacle',
    siteName: 'Pinnacle',
    region: 'INTL (Non ADM)',
    reasonShort: 'Nessun bonus benvenuto sport + non ADM',
    sportAudit: 'Pinnacle è un bookmaker sharp a margine ridotto che per policy NON offre bonus benvenuto sulle scommesse sportive.',
    casinoAudit: 'Eventuali promozioni Free Spins casinò sono limitate a mercati extra-UE specifici; operatore privo di concessione ADM Italia.',
    note: 'Utilissimo nell’app come riferimento quote sharp per surebet/value, non per bonus benvenuto.',
    url: 'https://www.pinnacle.com/',
  },
  {
    sourceId: 'paf',
    siteName: 'Paf Sports',
    region: 'EU (Non ADM)',
    reasonShort: 'Operatore nordico/ES privo di licenza ADM Italia',
    sportAudit: 'Offre piccole freebet (es. 5€–20€ wager-free) esclusivamente nei mercati regolamentati in cui opera (Finlandia, Svezia, Spagna, Baltici).',
    casinoAudit: 'Non registrabile legalmente da residenti in Italia.',
    note: 'Presente nell’Oddsmatcher/Dutcher come fonte quote EU, ma non idoneo a nuove iscrizioni dall’Italia.',
    url: 'https://www.paf.com/',
  },
  {
    sourceId: 'smarkets_exchange',
    siteName: 'Smarkets Exchange',
    region: 'EU (UK / IE / MT)',
    reasonShort: 'Promo 0% commissione riservata a UK, Irlanda e Malta',
    sportAudit: 'L’offerta benvenuto (codice COMMFREE: 0% commissione per 60 giorni su primo deposito ≥ 10£/€ con Carta di Debito o Instant Banking) è limitata dai T&C ai residenti in UK, Irlanda e Malta.',
    casinoAudit: 'Smarkets è un Betting Exchange puro (nessun casinò).',
    note: 'Se risiedi legalmente in UK, Irlanda o Malta, inserisci il codice COMMFREE in registrazione (esclusi PayPal, Skrill, Neteller, Revolut e carte prepagate): risparmi il 2% di commissione per 60 giorni!',
    url: 'https://smarkets.com/',
  },
];

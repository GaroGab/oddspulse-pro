import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Repeat, Sparkles } from 'lucide-react';
import type { AutoRolloverRatingResult } from '../../shared/math';
import type { RolloverCalcDetails, RolloverWalletRule } from '../../shared/types';
import { formatEuro, formatPct } from '../utils/format';
import { NumericInput } from './NumericInput';

interface RolloverParamsPanelProps {
  stake: number;
  realBalance: number;
  bonusBalance: number;
  rolloverRemaining: number;
  estimatedRating: number;
  autoEstimatedRating: boolean;
  autoRatingInfo: AutoRolloverRatingResult;
  walletRule: RolloverWalletRule;
  rolloverDetails?: RolloverCalcDetails;
  onChangeStake: (v: number) => void;
  onChangeRealBalance: (v: number) => void;
  onChangeBonusBalance: (v: number) => void;
  onChangeRolloverRemaining: (v: number) => void;
  onChangeEstimatedRating: (v: number) => void;
  onToggleAutoRating: (auto: boolean) => void;
  onChangeWalletRule: (rule: RolloverWalletRule) => void;
  compact?: boolean;
  testIdPrefix?: string;
}

const RATING_PRESETS = [93, 95, 96, 97, 98];
const ROLLOVER_MULTIPLIERS = [3, 5, 6, 10];

export const RolloverParamsPanel: React.FC<RolloverParamsPanelProps> = ({
  stake,
  realBalance,
  bonusBalance,
  rolloverRemaining,
  estimatedRating,
  autoEstimatedRating,
  autoRatingInfo,
  walletRule,
  rolloverDetails,
  onChangeStake,
  onChangeRealBalance,
  onChangeBonusBalance,
  onChangeRolloverRemaining,
  onChangeEstimatedRating,
  onToggleAutoRating,
  onChangeWalletRule,
  compact = false,
  testIdPrefix = 'rollover',
}) => {
  const totalWallet = Math.max(0, realBalance + bonusBalance);
  const rolloverAfter = rolloverDetails?.rolloverAfter ?? Math.max(0, rolloverRemaining - stake);
  const baselineEv =
    rolloverDetails?.baselineExpectedValue ??
    bonusBalance - rolloverRemaining * (1 - estimatedRating / 100);

  const autoSourceHint =
    autoRatingInfo.source === 'oddsmatcher'
      ? `Calcolato live da ${autoRatingInfo.sampleCount} match Oddsmatcher`
      : autoRatingInfo.source === 'current_quote'
      ? 'Calcolato automaticamente dalla quota attuale'
      : 'Stima di riferimento (nessuna quota live attiva)';

  return (
    <div
      data-testid={`${testIdPrefix}-panel`}
      className="rounded-xl border border-amber-400/35 bg-amber-500/[0.08] p-3.5 space-y-3"
    >
      {/* Panel Header + Live Post-Bet & EV Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-amber-200">
          <Repeat className="h-4 w-4 text-amber-300" />
          Parametri Bonus Rollover
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          <span
            data-testid={`${testIdPrefix}-after-badge`}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold ${
              rolloverAfter <= 0.005
                ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-200'
                : 'border-slate-700/90 bg-slate-950/75 text-slate-300'
            }`}
          >
            {rolloverAfter <= 0.005 ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-emerald-300" />
                Sblocco completato!
              </>
            ) : (
              <>Residuo post-giocata: {formatEuro(rolloverAfter)}</>
            )}
          </span>

          <span
            data-testid={`${testIdPrefix}-ev-badge`}
            className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold ${
              baselineEv >= -0.005
                ? 'border-emerald-400/35 bg-slate-950/75 text-emerald-300'
                : 'border-rose-400/40 bg-rose-500/15 text-rose-200'
            }`}
          >
            EV Bonus: {formatEuro(baselineEv, true)}
          </span>
        </div>
      </div>

      {/* Quick Stake Alignment Bar */}
      {(totalWallet > 0 || rolloverRemaining > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="font-semibold text-slate-400">Imposta puntata rapida:</span>
          {totalWallet > 0 && (
            <button
              type="button"
              data-testid={`${testIdPrefix}-stake-allin`}
              onClick={() => onChangeStake(Math.round(totalWallet * 100) / 100)}
              className={`rounded-md border px-2 py-0.5 font-mono font-bold transition ${
                Math.abs(stake - totalWallet) < 0.01
                  ? 'border-brand-400/60 bg-brand-400/25 text-brand-100'
                  : 'border-slate-700/80 bg-slate-950/75 text-amber-200 hover:border-amber-400/50 hover:text-white'
              }`}
              title="Punta l'intero saldo (Reale + Bonus) per tentare lo sblocco diretto su Exchange"
            >
              = Tutto Saldo ({formatEuro(totalWallet)})
            </button>
          )}
          {bonusBalance > 0 && realBalance > 0 && (
            <button
              type="button"
              data-testid={`${testIdPrefix}-stake-bonus`}
              onClick={() => onChangeStake(Math.round(bonusBalance * 100) / 100)}
              className={`rounded-md border px-2 py-0.5 font-mono font-bold transition ${
                Math.abs(stake - bonusBalance) < 0.01
                  ? 'border-brand-400/60 bg-brand-400/25 text-brand-100'
                  : 'border-slate-700/80 bg-slate-950/75 text-slate-300 hover:border-slate-500 hover:text-white'
              }`}
            >
              = Solo Bonus ({formatEuro(bonusBalance)})
            </button>
          )}
          {rolloverRemaining > 0 && rolloverRemaining !== totalWallet && (
            <button
              type="button"
              data-testid={`${testIdPrefix}-stake-finish`}
              onClick={() => onChangeStake(Math.round(rolloverRemaining * 100) / 100)}
              className={`rounded-md border px-2 py-0.5 font-mono font-bold transition ${
                Math.abs(stake - rolloverRemaining) < 0.01
                  ? 'border-emerald-400/60 bg-emerald-400/20 text-emerald-100'
                  : 'border-slate-700/80 bg-slate-950/75 text-emerald-300 hover:border-emerald-400/50 hover:text-white'
              }`}
            >
              = Chiudi Rollover ({formatEuro(rolloverRemaining)})
            </button>
          )}
        </div>
      )}

      {/* 4 Core Rollover Inputs */}
      <div className={`grid gap-2.5 ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
        <div>
          <label
            htmlFor={`${testIdPrefix}-real-input`}
            className="block text-[11px] font-medium text-amber-100/90"
          >
            Saldo Reale (€)
          </label>
          <NumericInput
            id={`${testIdPrefix}-real-input`}
            data-testid={`${testIdPrefix}-real-input`}
            min={0}
            value={realBalance}
            onChange={onChangeRealBalance}
            placeholder="50"
            className="mt-1 w-full rounded-lg border border-amber-400/30 bg-slate-950/90 px-3 py-1.5 font-mono text-sm font-bold text-white focus:border-amber-400 focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor={`${testIdPrefix}-bonus-input`}
            className="block text-[11px] font-medium text-amber-100/90"
          >
            Saldo Bonus (€)
          </label>
          <NumericInput
            id={`${testIdPrefix}-bonus-input`}
            data-testid={`${testIdPrefix}-bonus-input`}
            min={0}
            value={bonusBalance}
            onChange={onChangeBonusBalance}
            placeholder="50"
            className="mt-1 w-full rounded-lg border border-amber-400/30 bg-slate-950/90 px-3 py-1.5 font-mono text-sm font-bold text-emerald-200 focus:border-amber-400 focus:outline-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-1">
            <label
              htmlFor={`${testIdPrefix}-remaining-input`}
              className="truncate text-[11px] font-medium text-amber-100/90"
            >
              Rollover Rimanente (€)
            </label>
            {bonusBalance > 0 && (
              <div className="flex shrink-0 gap-1">
                {ROLLOVER_MULTIPLIERS.map((mult) => (
                  <button
                    key={mult}
                    type="button"
                    onClick={() =>
                      onChangeRolloverRemaining(Math.round(bonusBalance * mult * 100) / 100)
                    }
                    title={`Imposta ${mult}× Saldo Bonus (${formatEuro(bonusBalance * mult)})`}
                    className={`rounded px-1 py-0.5 font-mono text-[9px] font-bold transition ${
                      Math.abs(rolloverRemaining - bonusBalance * mult) < 0.05
                        ? 'border border-amber-400/50 bg-amber-400/20 text-amber-200'
                        : 'bg-slate-950/80 text-slate-400 hover:text-white'
                    }`}
                  >
                    {mult}×B
                  </button>
                ))}
              </div>
            )}
          </div>
          <NumericInput
            id={`${testIdPrefix}-remaining-input`}
            data-testid={`${testIdPrefix}-remaining-input`}
            min={0}
            value={rolloverRemaining}
            onChange={onChangeRolloverRemaining}
            placeholder="300"
            className="mt-1 w-full rounded-lg border border-amber-400/30 bg-slate-950/90 px-3 py-1.5 font-mono text-sm font-bold text-white focus:border-amber-400 focus:outline-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-1">
            <label
              htmlFor={`${testIdPrefix}-rating-input`}
              className="truncate text-[11px] font-medium text-amber-100/90"
            >
              Rating Stimato (%)
            </label>
            <button
              type="button"
              data-testid={`${testIdPrefix}-auto-rating-btn`}
              onClick={() => onToggleAutoRating(!autoEstimatedRating)}
              title={autoSourceHint}
              className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold transition ${
                autoEstimatedRating
                  ? 'border-brand-400/60 bg-brand-400/25 text-brand-100'
                  : 'border-slate-700 bg-slate-950/80 text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {autoEstimatedRating ? 'Auto ON' : 'Manuale'}
            </button>
          </div>
          <NumericInput
            id={`${testIdPrefix}-rating-input`}
            data-testid={`${testIdPrefix}-rating-input`}
            min={50}
            max={105}
            value={estimatedRating}
            onChange={(val) => {
              if (autoEstimatedRating) onToggleAutoRating(false);
              onChangeEstimatedRating(val);
            }}
            placeholder="96"
            className="mt-1 w-full rounded-lg border border-amber-400/30 bg-slate-950/90 px-3 py-1.5 font-mono text-sm font-bold text-brand-200 focus:border-amber-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Rating Presets + Auto Explanation + Wallet Order */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <div className="flex flex-wrap items-center gap-1">
          {RATING_PRESETS.map((rp) => (
            <button
              key={rp}
              type="button"
              onClick={() => {
                onToggleAutoRating(false);
                onChangeEstimatedRating(rp);
              }}
              className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold transition ${
                !autoEstimatedRating && Math.abs(estimatedRating - rp) < 0.05
                  ? 'border-amber-400/60 bg-amber-400/25 text-white'
                  : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:text-white'
              }`}
            >
              {rp}%
            </button>
          ))}
          <span className="ml-1 text-[10px] text-slate-400">{autoSourceHint}</span>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/80 p-0.5 text-[10px]">
          <button
            type="button"
            data-testid={`${testIdPrefix}-wallet-mixed`}
            onClick={() => onChangeWalletRule('mixed')}
            title="Il bonus resta vincolato finché il saldo totale non si azzera o completi il rollover (Bet365, Eurobet, standard)"
            className={`rounded-md px-2 py-0.5 font-semibold transition ${
              walletRule === 'mixed'
                ? 'bg-amber-400/25 text-amber-100'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Reale/Misto
          </button>
          <button
            type="button"
            data-testid={`${testIdPrefix}-wallet-bonus-first`}
            onClick={() => onChangeWalletRule('bonus_first')}
            title="Il bookmaker scala prima il Saldo Bonus: se perdi almeno l'importo del bonus, il rollover termina subito"
            className={`rounded-md px-2 py-0.5 font-semibold transition ${
              walletRule === 'bonus_first'
                ? 'bg-amber-400/25 text-amber-100'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Bonus Prima
          </button>
        </div>
      </div>

      {/* Contextual Warnings / Insights */}
      {rolloverDetails && rolloverDetails.extraRealUsed > 0.005 && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-500/35 bg-sky-500/10 px-2.5 py-1.5 text-[11px] text-sky-200">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
          <span>
            La puntata ({formatEuro(stake)}) supera Saldo Reale + Bonus ({formatEuro(totalWallet)}): la differenza di{' '}
            <strong className="font-mono">{formatEuro(rolloverDetails.extraRealUsed)}</strong> è considerata capitale reale aggiuntivo.
          </span>
        </div>
      )}

      {baselineEv < -0.005 && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-[11px] text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" />
          <span>
            Attenzione: al rating stimato ({formatPct(estimatedRating)}), il costo del rollover residuo (
            <strong className="font-mono">
              {formatEuro(rolloverRemaining * (1 - estimatedRating / 100))}
            </strong>
            ) supera il Saldo Bonus ({formatEuro(bonusBalance)}). Valuta quote a quota alta/rating maggiore.
          </span>
        </div>
      )}
    </div>
  );
};

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) audioCtx = new Ctor();
  }
  return audioCtx;
}

export function playSurebetChime() {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    const notes = [587.33, 880.0, 1174.66]; // D5 -> A5 -> D6 crystalline triad
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      gain.gain.setValueAtTime(0.0001, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.05, now + i * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.36);
    });
  } catch {
    // Ignore audio errors
  }
}

export function playCopyTick() {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(740, now);
    osc.frequency.exponentialRampToValueAtTime(1040, now + 0.07);
    gain.gain.setValueAtTime(0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } catch {
    // Ignore
  }
}

let alarmIntervalId: ReturnType<typeof setInterval> | null = null;
let alarmBurstsRemaining = 0;

/**
 * Distinct 2x ascending radar ping for Rating Watch threshold alerts.
 */
export function playRatingAlertBurst() {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    const pattern = [
      { freq: 880.0, delay: 0, dur: 0.13 },
      { freq: 1174.66, delay: 0.11, dur: 0.14 },
      { freq: 1318.51, delay: 0.22, dur: 0.15 },
      { freq: 1760.0, delay: 0.34, dur: 0.24 },
      { freq: 1174.66, delay: 0.62, dur: 0.12 },
      { freq: 1760.0, delay: 0.74, dur: 0.28 },
    ];

    for (const p of pattern) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t0 = now + p.delay;
      osc.frequency.setValueAtTime(p.freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.13, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + p.dur + 0.02);
    }
  } catch {
    // Ignore audio errors
  }
}

export function isRatingAlarmActive(): boolean {
  return alarmIntervalId !== null;
}

export function stopPersistentRatingAlarm() {
  if (alarmIntervalId !== null) {
    clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
  alarmBurstsRemaining = 0;
}

/**
 * Starts a persistent audible alarm repeating every 2.4s until dismissed
 * or until the 35-burst (~84s) safety ceiling is reached.
 */
export function startPersistentRatingAlarm(onAutoStop?: () => void) {
  if (alarmIntervalId !== null) {
    // Reset countdown ceiling when a fresh trigger arrives while ringing
    alarmBurstsRemaining = 35;
    return;
  }

  alarmBurstsRemaining = 35;
  playRatingAlertBurst();
  alarmBurstsRemaining--;

  alarmIntervalId = setInterval(() => {
    if (alarmBurstsRemaining <= 0) {
      stopPersistentRatingAlarm();
      onAutoStop?.();
      return;
    }
    alarmBurstsRemaining--;
    playRatingAlertBurst();
  }, 2400);
}

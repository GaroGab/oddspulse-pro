import type { OddsPulseAPI } from '../../electron/preload';

declare global {
  interface Window {
    oddspulse?: OddsPulseAPI;
  }
}

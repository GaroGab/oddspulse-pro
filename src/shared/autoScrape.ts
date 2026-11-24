import { DEFAULT_SETTINGS, type AppSettings } from './types';

/**
 * Returns true when automatic periodic scraping is active (both enabled and interval > 0).
 */
export function isAutoScrapeActive(
  settings: Pick<AppSettings, 'autoScrapeEnabled' | 'refreshIntervalSec'>
): boolean {
  return settings.autoScrapeEnabled !== false && settings.refreshIntervalSec > 0;
}

/**
 * Resolves the effective automatic refresh interval in seconds when (re)starting auto-scraping.
 * Preserves the user's configured interval if > 0, otherwise falls back to the default (60s).
 */
export function getEffectiveAutoRefreshSec(
  settings: Pick<AppSettings, 'refreshIntervalSec'>
): number {
  return settings.refreshIntervalSec > 0
    ? settings.refreshIntervalSec
    : DEFAULT_SETTINGS.refreshIntervalSec;
}

/**
 * Computes the next settings snapshot when stopping or restarting automatic scraping.
 */
export function buildAutoScrapeSettingsPatch(
  current: AppSettings,
  enable: boolean
): Partial<AppSettings> {
  if (!enable) {
    return { autoScrapeEnabled: false };
  }
  return {
    autoScrapeEnabled: true,
    refreshIntervalSec: getEffectiveAutoRefreshSec(current),
  };
}

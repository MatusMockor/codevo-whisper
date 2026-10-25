import { useLiveValue, type Live } from '../home/live-value';
import type { Settings } from '../../shared/settings';

const loadSettings = () => window.codevo.getSettings();

export const SAVE_FAILED_EVENT = 'codevo:settings-save-failed';

export function useSettings(): Live<Settings> {
  return useLiveValue('settings-changed', loadSettings);
}

export function saveSettings(patch: Partial<Settings>): void {
  window.codevo.updateSettings(patch).catch((error: unknown) => {
    console.error('Saving the settings failed', error);
    window.dispatchEvent(new Event(SAVE_FAILED_EVENT));
  });
}

import type { LastTranscript } from '../insertion/last-transcript';
import type { SettingsStore } from '../settings/settings-store';
import type { StatsStore } from '../stats/stats-store';
import type { AppStatusService } from '../status/app-status-service';
import type { HandlerGroup } from './invoke-handlers';
import { validateSettingsPatch } from './validate';

export type CoreHandlerDeps = {
  settings: Pick<SettingsStore, 'get' | 'update'>;
  stats: Pick<StatsStore, 'days' | 'reset'>;
  status: Pick<AppStatusService, 'status'>;
  lastTranscript: Pick<LastTranscript, 'get'>;
};

export function coreHandlers({ settings, stats, status, lastTranscript }: CoreHandlerDeps): HandlerGroup<'getSettings' | 'updateSettings' | 'getStats' | 'resetStats' | 'getStatus' | 'getLastTranscript'> {
  return {
    getSettings: () => Promise.resolve(settings.get()),
    updateSettings: (patch) => settings.update(validateSettingsPatch(patch)),
    getStats: () => stats.days(),
    resetStats: () => stats.reset(),
    getStatus: () => status.status(),
    getLastTranscript: () => Promise.resolve(lastTranscript.get()),
  };
}

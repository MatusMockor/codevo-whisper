import type { LastTranscript } from '../insertion/last-transcript';
import type { InputHelper } from '../helper/input-helper';
import type { SettingsStore } from '../settings/settings-store';
import type { StatsStore } from '../stats/stats-store';
import type { AppStatusService } from '../status/app-status-service';
import type { HandlerGroup } from './invoke-handlers';
import { validateSettingsPatch } from './validate';

export type CoreHandlerDeps = {
  helper: Pick<InputHelper, 'getOutputAudio'>;
  settings: Pick<SettingsStore, 'get' | 'update'>;
  stats: Pick<StatsStore, 'days' | 'reset'>;
  status: Pick<AppStatusService, 'status'>;
  lastTranscript: Pick<LastTranscript, 'get'>;
};

export function coreHandlers({ settings, stats, status, lastTranscript, helper }: CoreHandlerDeps): HandlerGroup<'getSettings' | 'updateSettings' | 'getStats' | 'resetStats' | 'getStatus' | 'getLastTranscript' | 'getOutputAudio'> {
  return {
    getOutputAudio: () => helper.getOutputAudio(),
    getSettings: () => Promise.resolve(settings.get()),
    updateSettings: (patch) => settings.update(validateSettingsPatch(patch)),
    getStats: () => stats.days(),
    resetStats: () => stats.reset(),
    getStatus: () => status.status(),
    getLastTranscript: () => Promise.resolve(lastTranscript.get()),
  };
}

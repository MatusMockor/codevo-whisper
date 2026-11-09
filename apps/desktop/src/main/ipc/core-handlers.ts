import type { Settings } from '../../shared/settings';
import type { EngineOrderQueue } from '../engines/engine-order-queue';
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
  order: Pick<EngineOrderQueue, 'exclusive'>;
  stats: Pick<StatsStore, 'days' | 'reset'>;
  status: Pick<AppStatusService, 'status'>;
  lastTranscript: Pick<LastTranscript, 'get'>;
};

export type SettingsWriter = Pick<CoreHandlerDeps, 'settings' | 'order'>;

export function writeSettings({ settings, order }: SettingsWriter, patch: Partial<Settings>): Promise<Settings> {
  return order.exclusive(() => settings.update(patch));
}

export function coreHandlers({ settings, order, stats, status, lastTranscript, helper }: CoreHandlerDeps): HandlerGroup<'getSettings' | 'updateSettings' | 'getStats' | 'resetStats' | 'getStatus' | 'getLastTranscript' | 'getOutputAudio'> {
  return {
    getOutputAudio: () => helper.getOutputAudio(),
    getSettings: () => Promise.resolve(settings.get()),
    updateSettings: (patch) => writeSettings({ settings, order }, validateSettingsPatch(patch)),
    getStats: () => stats.days(),
    resetStats: () => stats.reset(),
    getStatus: () => status.status(),
    getLastTranscript: () => Promise.resolve(lastTranscript.get()),
  };
}

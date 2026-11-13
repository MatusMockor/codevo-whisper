import type { Settings } from '../../shared/settings';
import type { EngineOrderQueue } from '../engines/engine-order-queue';
import type { LastTranscript } from '../insertion/last-transcript';
import type { InputHelper } from '../helper/input-helper';
import type { SettingsStore } from '../settings/settings-store';
import type { StatsStore } from '../stats/stats-store';
import type { AppStatusService } from '../status/app-status-service';
import type { HandlerGroup } from './invoke-handlers';
import { shortcutsConflict, type ShortcutSlot } from '../session/session-shortcuts';
import { sameHotkey } from '../../shared/hotkey';
import { REBINDABLE_ACTIONS } from '../../shared/session-shortcuts';
import { IpcValidationError, validateSettingsPatch } from './validate';

export type CoreHandlerDeps = {
  helper: Pick<InputHelper, 'getOutputAudio'>;
  settings: Pick<SettingsStore, 'get' | 'update'>;
  order: Pick<EngineOrderQueue, 'exclusive'>;
  stats: Pick<StatsStore, 'days' | 'reset'>;
  status: Pick<AppStatusService, 'status'>;
  lastTranscript: Pick<LastTranscript, 'get'>;
};

export type SettingsWriter = Pick<CoreHandlerDeps, 'settings' | 'order'>;

function changedShortcuts(patch: Partial<Settings>, current: Settings): Set<ShortcutSlot> {
  const changed = new Set<ShortcutSlot>(patch.hotkey !== undefined && !sameHotkey(patch.hotkey, current.hotkey) ? ['hotkey'] : []);
  for (const action of REBINDABLE_ACTIONS) {
    const binding = patch.sessionShortcuts?.[action];
    if (binding !== undefined && JSON.stringify(binding) !== JSON.stringify(current.sessionShortcuts[action])) changed.add(action);
  }
  return changed;
}

function allowedPatch(patch: Partial<Settings>, current: Settings): Partial<Settings> {
  if (shortcutsConflict({ ...current, ...patch }, changedShortcuts(patch, current))) {
    throw new IpcValidationError('The shortcut collides with another shortcut');
  }
  if (current.serverEnabled || !(patch.engineOrder?.includes('server') ?? false)) {
    return patch;
  }
  throw new IpcValidationError('The server is switched off');
}

export function writeSettings({ settings, order }: SettingsWriter, patch: Partial<Settings>): Promise<Settings> {
  return order.exclusive(() => settings.update(allowedPatch(patch, settings.get())));
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

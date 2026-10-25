import { app } from 'electron';
import { join } from 'node:path';
import type { InputHelper } from '../helper/input-helper';
import type { Logger } from '../logging/logger';
import type { ModelManager } from '../models/model-manager';
import { electronMicrophoneAccess } from '../permissions/electron-microphone-access';
import { PermissionsService } from '../permissions/permissions-service';
import type { PauseState } from '../session/pause-state';
import type { SettingsStore } from '../settings/settings-store';
import { StatsStore } from '../stats/stats-store';
import { AppStatusService } from '../status/app-status-service';
import type { MainWindowEvents } from '../windows/main-window-controller';

const STATS_FILE = 'stats.json';

export type HomeWiringDeps = {
  settings: SettingsStore;
  models: ModelManager;
  helper: Pick<InputHelper, 'permissions'>;
  pause: PauseState;
  inputReady: Promise<void>;
  window: MainWindowEvents;
  logger: Logger;
};

export type HomeServices = { stats: StatsStore; status: AppStatusService; dispose(): void };

export function createHomeServices({ settings, models, helper, pause, inputReady, window, logger }: HomeWiringDeps): HomeServices {
  const stats = new StatsStore(join(app.getPath('userData'), STATS_FILE), undefined, logger);
  const permissions = new PermissionsService(helper, electronMicrophoneAccess, logger, inputReady);
  const status = new AppStatusService({ settings, models, permissions, pause, logger });
  status.start();
  const unsubscribers = [
    stats.onChange((days) => window.send('stats-changed', days)),
    status.onChange((next) => window.send('status-changed', next)),
    window.onFocus(() => status.refresh()),
  ];
  return {
    stats,
    status,
    dispose: () => {
      for (const unsubscribe of unsubscribers.splice(0)) {
        unsubscribe();
      }
      status.dispose();
    },
  };
}

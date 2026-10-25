import { app } from 'electron';
import { join } from 'node:path';
import type { LastTranscript } from '../insertion/last-transcript';
import type { Logger } from '../logging/logger';
import type { ModelManager } from '../models/model-manager';
import type { PermissionsService } from '../permissions/permissions-service';
import type { PauseState } from '../session/pause-state';
import type { SettingsStore } from '../settings/settings-store';
import { StatsStore } from '../stats/stats-store';
import { AppStatusService } from '../status/app-status-service';
import type { MainWindowEvents } from '../windows/main-window-controller';

const STATS_FILE = 'stats.json';

export type HomeWiringDeps = {
  settings: SettingsStore;
  models: ModelManager;
  permissions: Pick<PermissionsService, 'status'>;
  pause: PauseState;
  lastTranscript: Pick<LastTranscript, 'onChange'>;
  window: MainWindowEvents;
  logger: Logger;
};

export type HomeServices = { stats: StatsStore; status: AppStatusService; dispose(): void };

export function createHomeServices({ settings, models, permissions, pause, lastTranscript, window, logger }: HomeWiringDeps): HomeServices {
  const stats = new StatsStore(join(app.getPath('userData'), STATS_FILE), undefined, logger);
  const status = new AppStatusService({ settings, models, permissions, pause, logger });
  status.start();
  const unsubscribers = [
    stats.onChange((days) => window.send('stats-changed', days)),
    status.onChange((next) => window.send('status-changed', next)),
    lastTranscript.onChange((text) => window.send('last-transcript-changed', text)),
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

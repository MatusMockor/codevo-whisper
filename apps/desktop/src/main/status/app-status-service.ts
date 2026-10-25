import type { AppStatus } from '../../shared/app-status';
import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';
import type { ModelManager } from '../models/model-manager';
import { allGranted, type PermissionsService } from '../permissions/permissions-service';
import type { PauseState } from '../session/pause-state';
import type { SettingsStore } from '../settings/settings-store';

export type AppStatusDeps = {
  settings: Pick<SettingsStore, 'get' | 'onChange'>;
  models: Pick<ModelManager, 'states' | 'onChange'>;
  permissions: Pick<PermissionsService, 'status'>;
  pause: Pick<PauseState, 'isPaused' | 'onChange'>;
  logger: Logger;
};

function sameStatus(a: AppStatus | null, b: AppStatus): boolean {
  return a !== null && a.hotkeyLabel === b.hotkeyLabel && a.modelReady === b.modelReady && a.permissionsOk === b.permissionsOk && a.paused === b.paused;
}

export class AppStatusService {
  private readonly listeners: Listeners<AppStatus>;
  private unsubscribers: Array<() => void> = [];
  private lastEmitted: AppStatus | null = null;
  private generation = 0;

  constructor(private readonly deps: AppStatusDeps) {
    this.listeners = new Listeners(deps.logger, 'An app status listener failed');
  }

  start(): void {
    const refresh = (): void => this.refresh();
    this.unsubscribers = [this.deps.settings.onChange(refresh), this.deps.models.onChange(refresh), this.deps.pause.onChange(refresh)];
  }

  async status(): Promise<AppStatus> {
    const { hotkey, localModelId } = this.deps.settings.get();
    const permissions = await this.deps.permissions.status();
    return {
      hotkeyLabel: hotkey?.label ?? null,
      modelReady: localModelId !== null && this.deps.models.states().some((state) => state.id === localModelId && state.status === 'ready'),
      permissionsOk: allGranted(permissions),
      paused: this.deps.pause.isPaused(),
    };
  }

  refresh(): void {
    this.generation += 1;
    const generation = this.generation;
    this.status()
      .then((status) => {
        if (generation !== this.generation || sameStatus(this.lastEmitted, status)) {
          return;
        }
        this.lastEmitted = status;
        this.listeners.emit(status);
      })
      .catch((error: unknown) => {
        this.deps.logger.error('The app status could not be refreshed', error);
      });
  }

  onChange(listener: (status: AppStatus) => void): () => void {
    return this.listeners.add(listener);
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }
}

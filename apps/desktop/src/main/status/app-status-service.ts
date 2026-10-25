import type { AppStatus } from '../../shared/app-status';
import type { ModelState } from '../../shared/models';
import { allPermissionsGranted } from '../../shared/permissions';
import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';
import type { ModelManager } from '../models/model-manager';
import type { PermissionsService } from '../permissions/permissions-service';
import type { PauseState } from '../session/pause-state';
import type { SettingsStore } from '../settings/settings-store';

export type AppStatusDeps = {
  settings: Pick<SettingsStore, 'get' | 'onChange'>;
  models: Pick<ModelManager, 'states' | 'onChange'>;
  permissions: Pick<PermissionsService, 'status'>;
  pause: Pick<PauseState, 'isPaused' | 'onChange'>;
  logger: Logger;
};

const STATUS_KEYS = ['hotkeyLabel', 'mode', 'modelReady', 'permissionsOk', 'paused'] as const satisfies ReadonlyArray<keyof AppStatus>;

function sameStatus(a: AppStatus | null, b: AppStatus): boolean {
  return a !== null && STATUS_KEYS.every((key) => a[key] === b[key]);
}

function isReady(states: readonly ModelState[], id: string | null): boolean {
  return id !== null && states.some((state) => state.id === id && state.status === 'ready');
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
    this.unsubscribers = [this.deps.settings.onChange(refresh), this.deps.models.onChange((states) => this.refreshOnReadiness(states)), this.deps.pause.onChange(refresh)];
  }

  async status(): Promise<AppStatus> {
    const { hotkey, mode, localModelId } = this.deps.settings.get();
    const permissions = await this.deps.permissions.status();
    return {
      hotkeyLabel: hotkey?.label ?? null,
      mode,
      modelReady: isReady(this.deps.models.states(), localModelId),
      permissionsOk: allPermissionsGranted(permissions),
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

  private refreshOnReadiness(states: readonly ModelState[]): void {
    const ready = isReady(states, this.deps.settings.get().localModelId);
    if (this.lastEmitted !== null && this.lastEmitted.modelReady === ready) {
      return;
    }
    this.refresh();
  }
}

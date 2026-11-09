import { isModelReady } from '../../shared/models';
import type { SettingsStore } from '../settings/settings-store';
import type { ModelManager } from './model-manager';

export interface LocalModelReadiness {
  isReady(): boolean;
}

export class ActiveModelReadiness implements LocalModelReadiness {
  constructor(
    private readonly models: Pick<ModelManager, 'states'>,
    private readonly settings: Pick<SettingsStore, 'get'>,
  ) {}

  isReady(): boolean {
    return isModelReady(this.models.states(), this.settings.get().localModelId);
  }
}

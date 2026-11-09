import { changeAfterPairing, type PairingEngineChange } from '../../shared/engine-routing';
import type { LocalModelReadiness } from '../models/local-model-readiness';
import type { SettingsStore } from '../settings/settings-store';

export type PairingEngineSwitchDeps = { settings: Pick<SettingsStore, 'get' | 'update'>; local: LocalModelReadiness };

export class PairingEngineSwitch {
  constructor(private readonly deps: PairingEngineSwitchDeps) {}

  async afterPairing(): Promise<PairingEngineChange> {
    const change = changeAfterPairing(this.deps.settings.get().engineOrder, this.deps.local.isReady());
    if (change.kind !== 'switched') {
      return change;
    }
    await this.deps.settings.update({ engineOrder: change.current });
    return change;
  }
}

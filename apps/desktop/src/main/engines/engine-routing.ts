import { isEngineUsable, preferredOrder, type EngineCapabilities } from '../../shared/engine-routing';
import type { EngineId } from '../../shared/settings';
import type { LocalModelReadiness } from '../models/local-model-readiness';
import type { SettingsStore } from '../settings/settings-store';

export type ServerReadiness = { isPaired(): Promise<boolean>; needsRepair(): boolean };

export type EngineRoutingDeps = { settings: Pick<SettingsStore, 'get' | 'update'>; local: LocalModelReadiness; server: ServerReadiness };

export class EngineRouting {
  constructor(private readonly deps: EngineRoutingDeps) {}

  async capabilities(): Promise<EngineCapabilities> {
    const paired = await this.deps.server.isPaired();
    return { localReady: this.deps.local.isReady(), serverReady: paired && !this.deps.server.needsRepair() };
  }

  async prefer(engine: EngineId): Promise<EngineId[]> {
    const capabilities = await this.capabilities();
    if (!isEngineUsable(engine, capabilities)) {
      return [...this.deps.settings.get().engineOrder];
    }
    const order = preferredOrder(engine, capabilities);
    await this.deps.settings.update({ engineOrder: order });
    return order;
  }
}

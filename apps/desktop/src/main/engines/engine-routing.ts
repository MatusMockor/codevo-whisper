import { isEngineUsable, preferredOrder, refusalReason, type EngineCapabilities, type EngineConditions, type EngineSwitch } from '../../shared/engine-routing';
import type { EngineId } from '../../shared/settings';
import type { LocalModelReadiness } from '../models/local-model-readiness';
import type { EngineOrderQueue, OrderDecision } from './engine-order-queue';

export type ServerReadiness = { isPaired(): Promise<boolean>; isEnabled(): boolean; needsRepair(): boolean; isOffline(): boolean };

export type EngineRoutingDeps = { order: Pick<EngineOrderQueue, 'change'>; local: LocalModelReadiness; server: ServerReadiness };

export class EngineRouting {
  constructor(private readonly deps: EngineRoutingDeps) {}

  async capabilities(): Promise<EngineConditions> {
    const paired = await this.deps.server.isPaired();
    const enabled = paired && this.deps.server.isEnabled();
    return {
      localReady: this.deps.local.isReady(),
      serverReady: enabled && !this.deps.server.needsRepair(),
      serverOffline: enabled && this.deps.server.isOffline(),
      serverOff: paired && !enabled,
      serverRepair: enabled && this.deps.server.needsRepair(),
    };
  }

  prefer(engine: EngineId): Promise<EngineSwitch> {
    return this.deps.order.change(async () => this.decide(engine, await this.capabilities()));
  }

  private decide(engine: EngineId, capabilities: EngineCapabilities): OrderDecision<EngineSwitch> {
    if (!isEngineUsable(engine, capabilities)) {
      return { order: null, result: { kind: 'refused', reason: refusalReason(engine) } };
    }
    const order = preferredOrder(engine, capabilities);
    return { order, result: { kind: 'switched', order } };
  }
}

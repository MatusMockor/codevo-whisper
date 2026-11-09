import { changeAfterPairing, type PairingEngineChange } from '../../shared/engine-routing';
import type { EngineId } from '../../shared/settings';
import type { EngineOrderQueue, OrderDecision } from '../engines/engine-order-queue';
import type { LocalModelReadiness } from '../models/local-model-readiness';

export type PairingEngineSwitchDeps = { order: Pick<EngineOrderQueue, 'change'>; local: LocalModelReadiness };

const ABANDONED: OrderDecision<PairingEngineChange | null> = Object.freeze({ order: null, result: null });

export class PairingEngineSwitch {
  constructor(private readonly deps: PairingEngineSwitchDeps) {}

  afterPairing(claim: () => boolean): Promise<PairingEngineChange | null> {
    return this.deps.order.change((current) => this.decide(current, claim));
  }

  private decide(current: readonly EngineId[], claim: () => boolean): OrderDecision<PairingEngineChange | null> {
    if (!claim()) {
      return ABANDONED;
    }
    const change = changeAfterPairing(current, this.deps.local.isReady());
    return { order: change.kind === 'switched' ? change.current : null, result: change };
  }
}

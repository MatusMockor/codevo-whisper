import { changeAfterPairing, type PairingEngineChange } from '../../shared/engine-routing';
import type { Settings } from '../../shared/settings';
import type { EngineOrderQueue, SettingsDecision } from '../engines/engine-order-queue';
import type { LocalModelReadiness } from '../models/local-model-readiness';
import { SERVER_ON } from './server-switch';

export type PairingEngineSwitchDeps = { order: Pick<EngineOrderQueue, 'update'>; local: LocalModelReadiness };

const ABANDONED: SettingsDecision<PairingEngineChange | null> = Object.freeze({ patch: null, result: null });

export class PairingEngineSwitch {
  constructor(private readonly deps: PairingEngineSwitchDeps) {}

  afterPairing(claim: () => boolean): Promise<PairingEngineChange | null> {
    return this.deps.order.update((current) => this.decide(current, claim));
  }

  private decide(current: Settings, claim: () => boolean): SettingsDecision<PairingEngineChange | null> {
    if (!claim()) {
      return ABANDONED;
    }
    const change = changeAfterPairing(current.engineOrder, this.deps.local.isReady());
    if (change.kind === 'switched') {
      return { patch: { ...SERVER_ON, engineOrder: change.current }, result: change };
    }
    return { patch: { ...SERVER_ON }, result: change };
  }
}

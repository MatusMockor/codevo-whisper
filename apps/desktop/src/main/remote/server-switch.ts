import { restoredOrder, type EngineConditions } from '../../shared/engine-routing';
import type { EngineId, Settings } from '../../shared/settings';
import type { EngineOrderQueue, SettingsDecision } from '../engines/engine-order-queue';
import type { LocalModelReadiness } from '../models/local-model-readiness';
import type { SettingsStore } from '../settings/settings-store';

export type ServerSwitchDeps = { settings: Pick<SettingsStore, 'get'>; queue: Pick<EngineOrderQueue, 'update'>; local: LocalModelReadiness };

export const SERVER_ON: Readonly<Pick<Settings, 'serverEnabled' | 'serverRestoreOrder'>> = Object.freeze({ serverEnabled: true, serverRestoreOrder: null });

const UNCHANGED: SettingsDecision<void> = Object.freeze({ patch: null, result: undefined });

export function withoutServer(order: readonly EngineId[]): EngineId[] {
  const rest = order.filter((engine) => engine !== 'server');
  return rest.length > 0 ? rest : ['local'];
}

function switchedOff(current: Settings): SettingsDecision<void> {
  if (!current.serverEnabled) {
    return UNCHANGED;
  }
  return { patch: { serverEnabled: false, serverRestoreOrder: [...current.engineOrder], engineOrder: withoutServer(current.engineOrder) }, result: undefined };
}

function enabledConditions(localReady: boolean): EngineConditions {
  return { localReady, serverReady: true, serverOffline: false, serverOff: false, serverRepair: false };
}

function switchedOn(current: Settings, localReady: boolean): SettingsDecision<void> {
  if (current.serverEnabled) {
    return UNCHANGED;
  }
  const saved = current.serverRestoreOrder ?? current.engineOrder;
  return { patch: { ...SERVER_ON, engineOrder: restoredOrder(saved, enabledConditions(localReady)) }, result: undefined };
}

function forgotten(current: Settings): SettingsDecision<void> {
  return { patch: { ...SERVER_ON, engineOrder: withoutServer(current.engineOrder) }, result: undefined };
}

export class ServerSwitch {
  constructor(private readonly deps: ServerSwitchDeps) {}

  isEnabled(): boolean {
    return this.deps.settings.get().serverEnabled;
  }

  switchOff(): Promise<void> {
    return this.deps.queue.update(switchedOff);
  }

  switchOn(): Promise<void> {
    return this.deps.queue.update((current) => switchedOn(current, this.deps.local.isReady()));
  }

  forget(): Promise<void> {
    return this.deps.queue.update(forgotten);
  }
}

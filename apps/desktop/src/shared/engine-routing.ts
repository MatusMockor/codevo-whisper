import type { EngineId } from './settings';

export type EngineCapabilities = { localReady: boolean; serverReady: boolean };

export type EngineFix = 'use-server' | 'use-local' | 'download-model';

export type PairingEngineChange = { kind: 'unchanged' } | { kind: 'available' } | { kind: 'switched'; previous: EngineId[]; current: EngineId[] };

export const ENGINE_IDS: readonly EngineId[] = Object.freeze(['local', 'server']);

export function isEngineId(value: unknown): value is EngineId {
  return ENGINE_IDS.some((engine) => engine === value);
}

export function preferredOrder(engine: EngineId, capabilities: EngineCapabilities): EngineId[] {
  if (engine === 'server') {
    return capabilities.localReady ? ['server', 'local'] : ['server'];
  }
  return capabilities.serverReady ? ['local', 'server'] : ['local'];
}

export function isEngineUsable(engine: EngineId, capabilities: EngineCapabilities): boolean {
  return engine === 'local' ? capabilities.localReady : capabilities.serverReady;
}

export function orderFix(order: readonly EngineId[], capabilities: EngineCapabilities): EngineFix | null {
  if (order.some((engine) => isEngineUsable(engine, capabilities))) {
    return null;
  }
  if (capabilities.serverReady) {
    return 'use-server';
  }
  if (capabilities.localReady) {
    return 'use-local';
  }
  return 'download-model';
}

export function changeAfterPairing(order: readonly EngineId[], localReady: boolean): PairingEngineChange {
  if (order[0] === 'server') {
    return { kind: 'unchanged' };
  }
  if (localReady) {
    return { kind: 'available' };
  }
  return { kind: 'switched', previous: [...order], current: preferredOrder('server', { localReady, serverReady: true }) };
}

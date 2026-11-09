import type { EngineId } from './settings';

export type EngineCapabilities = { localReady: boolean; serverReady: boolean };

export type EngineFix = 'use-server' | 'use-local' | 'download-model';

export type EngineProblem = 'no-model' | 'server-not-paired' | 'server-offline';

export type EngineRemedyAction = EngineFix | 'pair-server';

export type EngineRemedy = { action: EngineRemedyAction; alternative?: EngineRemedyAction };

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

const REMEDIES: Readonly<Record<EngineProblem, (capabilities: EngineCapabilities) => EngineRemedy | null>> = Object.freeze({
  'no-model': (capabilities) => (capabilities.serverReady ? { action: 'use-server', alternative: 'download-model' } : { action: 'download-model', alternative: 'pair-server' }),
  'server-not-paired': (capabilities) => (capabilities.localReady ? { action: 'use-local', alternative: 'pair-server' } : { action: 'pair-server', alternative: 'download-model' }),
  'server-offline': (capabilities) => (capabilities.localReady ? { action: 'use-local' } : null),
});

export function engineRemedy(problem: EngineProblem, capabilities: EngineCapabilities): EngineRemedy | null {
  return REMEDIES[problem](capabilities);
}

function isEngineWorking(engine: EngineId, capabilities: EngineCapabilities, serverOffline: boolean): boolean {
  if (engine === 'server' && serverOffline) {
    return false;
  }
  return isEngineUsable(engine, capabilities);
}

function engineProblem(engine: EngineId, capabilities: EngineCapabilities): EngineProblem {
  if (engine === 'local') {
    return 'no-model';
  }
  return capabilities.serverReady ? 'server-offline' : 'server-not-paired';
}

export function orderProblem(order: readonly EngineId[], capabilities: EngineCapabilities, serverOffline: boolean): EngineProblem | null {
  if (order.some((engine) => isEngineWorking(engine, capabilities, serverOffline))) {
    return null;
  }
  return engineProblem(order[0] ?? 'local', capabilities);
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

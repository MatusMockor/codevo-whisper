import type { EngineId } from './settings';

export type EngineCapabilities = { localReady: boolean; serverReady: boolean };

export type EngineConditions = EngineCapabilities & { serverOffline: boolean; serverOff: boolean; serverRepair: boolean };

export type EngineAvailability = 'ready' | 'unavailable' | 'blocked';

export type RouteOutcome = { engine: EngineId | null; blockedBy: EngineId | null };

export type EngineFix = 'use-server' | 'use-local' | 'download-model';

export type EngineProblem = 'no-model' | 'server-not-paired' | 'server-offline';

export type EngineRemedyAction = EngineFix | 'pair-server' | 'open-server' | 'enable-server';

export type EngineRemedy = { action: EngineRemedyAction; alternative?: EngineRemedyAction };

export type EngineRefusal = Extract<EngineProblem, 'no-model' | 'server-not-paired'>;

export type EngineSwitch = { kind: 'switched'; order: EngineId[] } | { kind: 'refused'; reason: EngineRefusal };

export type PairingEngineChange = { kind: 'unchanged' } | { kind: 'available' } | { kind: 'switched'; previous: EngineId[]; current: EngineId[] };

export const ENGINE_IDS: readonly EngineId[] = Object.freeze(['local', 'server']);

export function isEngineId(value: unknown): value is EngineId {
  return ENGINE_IDS.some((engine) => engine === value);
}

const ENGINE_REFUSALS: readonly EngineRefusal[] = Object.freeze(['no-model', 'server-not-paired']);

function isEngineRefusal(value: unknown): value is EngineRefusal {
  return ENGINE_REFUSALS.some((refusal) => refusal === value);
}

function isEngineOrder(value: unknown): value is EngineId[] {
  return Array.isArray(value) && value.length > 0 && value.every(isEngineId);
}

export function isEngineSwitch(value: unknown): value is EngineSwitch {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate: { kind?: unknown; order?: unknown; reason?: unknown } = value;
  if (candidate.kind === 'switched') {
    return isEngineOrder(candidate.order);
  }
  return candidate.kind === 'refused' && isEngineRefusal(candidate.reason);
}

export function refusalReason(engine: EngineId): EngineRefusal {
  return engine === 'local' ? 'no-model' : 'server-not-paired';
}

export function preferredOrder(engine: EngineId, capabilities: EngineCapabilities): EngineId[] {
  if (engine === 'local') {
    return ['local'];
  }
  return capabilities.localReady ? ['server', 'local'] : ['server'];
}

export function isEngineUsable(engine: EngineId, capabilities: EngineCapabilities): boolean {
  return engine === 'local' ? capabilities.localReady : capabilities.serverReady;
}

function isServerUsableNow(conditions: EngineConditions): boolean {
  return conditions.serverReady && !conditions.serverOffline;
}

function missingModelRemedy(conditions: EngineConditions): EngineRemedy {
  if (isServerUsableNow(conditions)) {
    return { action: 'use-server', alternative: 'download-model' };
  }
  if (conditions.serverReady) {
    return { action: 'download-model', alternative: 'open-server' };
  }
  if (conditions.serverOff) {
    return { action: 'download-model', alternative: 'enable-server' };
  }
  return { action: 'download-model', alternative: 'pair-server' };
}

const REMEDIES: Readonly<Record<EngineProblem, (conditions: EngineConditions) => EngineRemedy | null>> = Object.freeze({
  'no-model': missingModelRemedy,
  'server-not-paired': (conditions) => (conditions.localReady ? { action: 'use-local', alternative: 'pair-server' } : { action: 'pair-server', alternative: 'download-model' }),
  'server-offline': (conditions) => (conditions.localReady ? { action: 'use-local' } : null),
});

export function engineRemedy(problem: EngineProblem, conditions: EngineConditions): EngineRemedy | null {
  return REMEDIES[problem](conditions);
}

export function stopsRoute(availability: EngineAvailability): boolean {
  return availability !== 'unavailable';
}

function serverAvailability(conditions: EngineConditions): EngineAvailability {
  if (conditions.serverRepair) {
    return 'blocked';
  }
  return isServerUsableNow(conditions) ? 'ready' : 'unavailable';
}

export function engineAvailability(engine: EngineId, conditions: EngineConditions): EngineAvailability {
  if (engine === 'server') {
    return serverAvailability(conditions);
  }
  return conditions.localReady ? 'ready' : 'unavailable';
}

export function routeOutcome(order: readonly EngineId[], conditions: EngineConditions): RouteOutcome {
  const stop = order.find((engine) => stopsRoute(engineAvailability(engine, conditions)));
  if (stop === undefined) {
    return { engine: null, blockedBy: null };
  }
  if (engineAvailability(stop, conditions) === 'blocked') {
    return { engine: null, blockedBy: stop };
  }
  return { engine: stop, blockedBy: null };
}

function engineProblem(engine: EngineId, conditions: EngineConditions): EngineProblem {
  if (engine === 'local') {
    return 'no-model';
  }
  return conditions.serverReady ? 'server-offline' : 'server-not-paired';
}

export function orderProblem(order: readonly EngineId[], conditions: EngineConditions): EngineProblem | null {
  const outcome = routeOutcome(order, conditions);
  if (outcome.engine !== null) {
    return null;
  }
  return engineProblem(outcome.blockedBy ?? order[0] ?? 'local', conditions);
}

export function restoredOrder(saved: readonly EngineId[], conditions: EngineConditions): EngineId[] {
  if (routeOutcome(saved, conditions).engine !== null) {
    return [...saved];
  }
  return preferredOrder('server', conditions);
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

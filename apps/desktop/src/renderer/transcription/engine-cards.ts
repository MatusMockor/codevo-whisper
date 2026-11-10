import { engineAvailability, type EngineConditions } from '../../shared/engine-routing';
import type { ModelState } from '../../shared/models';
import type { PairedServerView, ServerStatus } from '../../shared/server';
import type { EngineId } from '../../shared/settings';

export type LocalFacts = { modelName: string | null; download: ModelState | null };

export type EngineFacts = { server: PairedServerView | null; local: LocalFacts; conditions: EngineConditions };

export type EngineCard = { id: EngineId; title: string; noun: string; meta: string; ready: boolean };

const STATUS_META: Readonly<Record<ServerStatus['kind'], (status: ServerStatus) => string>> = Object.freeze({
  online: (status) => (status.kind === 'online' ? `${status.connectMs} ms · šifrované E2E` : ''),
  offline: () => 'neodpovedá',
  unavailable: (status) => (status.kind === 'unavailable' && status.reason === 'busy' ? 'zaneprázdnený' : 'odpovedá chybou'),
  'repair-needed': () => 'treba znova spárovať',
  checking: () => 'overujem spojenie',
  unknown: () => 'overujem spojenie',
});

function serverMeta(server: PairedServerView): string {
  if (!server.enabled) {
    return 'odpojený';
  }
  return STATUS_META[server.status.kind](server.status);
}

function serverCard(server: PairedServerView | null, ready: boolean): EngineCard {
  if (server === null) {
    return { id: 'server', title: 'Server', noun: 'server', meta: 'nie je spárovaný', ready };
  }
  return { id: 'server', title: `Server ${server.host}`, noun: `server ${server.host}`, meta: serverMeta(server), ready };
}

function downloadPercent(download: ModelState): number {
  if (download.totalBytes <= 0) {
    return 0;
  }
  return Math.floor((download.receivedBytes / download.totalBytes) * 100);
}

function localMeta({ modelName, download }: LocalFacts, ready: boolean): string {
  if (ready) {
    return modelName ?? 'model je pripravený';
  }
  if (download !== null) {
    return `model sa sťahuje · ${downloadPercent(download)} %`;
  }
  return 'model chýba';
}

export function engineCard(engine: EngineId, facts: EngineFacts): EngineCard {
  const ready = engineAvailability(engine, facts.conditions) === 'ready';
  if (engine === 'server') {
    return serverCard(facts.server, ready);
  }
  return { id: 'local', title: 'Lokálne', noun: 'lokálny prepis', meta: localMeta(facts.local, ready), ready };
}

export function activeDownload(states: readonly ModelState[]): ModelState | null {
  return states.find((state) => state.status === 'downloading') ?? null;
}

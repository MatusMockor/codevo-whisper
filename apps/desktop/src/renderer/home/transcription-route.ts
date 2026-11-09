import type { AppStatus } from '../../shared/app-status';
import type { PairedServerView } from '../../shared/server';
import type { EngineId } from '../../shared/settings';
import type { NavTarget } from '../navigation';

export type SignalState = 'ok' | 'warn' | 'err' | 'off';

export type TranscriptionRoute = { state: Exclude<SignalState, 'off'>; label: string; detail: string; latencyMs: number | null; target: NavTarget };

export type RouteInput = { status: AppStatus; engineOrder: readonly EngineId[]; server: PairedServerView | null; localReady: boolean; modelName: string | null };

const SERVER_PAGE: NavTarget = { page: 'server' };

const ENGINE_SECTION: NavTarget = { page: 'settings', section: 'Kde beží prepis' };

const MODEL_SECTION: NavTarget = { page: 'settings', section: 'Lokálny model' };

const FIX = 'kliknite a opravte';

function problem(label: string, target: NavTarget): TranscriptionRoute {
  return { state: 'err', label, detail: FIX, latencyMs: null, target };
}

function serverLabel(server: PairedServerView): string {
  return `Server ${server.host}`;
}

function localLabel(modelName: string | null): string {
  if (modelName === null) {
    return 'Lokálne';
  }
  return `Lokálne · ${modelName}`;
}

function latency(server: PairedServerView): number | null {
  return server.status.kind === 'online' ? server.status.connectMs : null;
}

function serverDetail(server: PairedServerView): string {
  const ms = latency(server);
  if (ms === null) {
    return 'šifrované E2E';
  }
  return `${ms} ms · E2E`;
}

function serverFirst({ server, localReady, modelName }: RouteInput): TranscriptionRoute {
  if (server === null) {
    return { state: 'warn', label: localLabel(modelName), detail: 'server nie je spárovaný', latencyMs: null, target: SERVER_PAGE };
  }
  if (server.status.kind === 'offline') {
    return { state: 'warn', label: serverLabel(server), detail: localReady ? 'offline · záloha lokálne' : 'server je offline', latencyMs: null, target: SERVER_PAGE };
  }
  return { state: 'ok', label: serverLabel(server), detail: serverDetail(server), latencyMs: latency(server), target: ENGINE_SECTION };
}

function localFirst({ engineOrder, server, localReady, modelName }: RouteInput): TranscriptionRoute {
  if (!localReady && server !== null) {
    return { state: 'warn', label: serverLabel(server), detail: 'lokálny model chýba · záloha', latencyMs: latency(server), target: MODEL_SECTION };
  }
  return { state: 'ok', label: localLabel(modelName), detail: engineOrder.includes('server') ? 'záloha: server' : 'na tomto zariadení', latencyMs: null, target: ENGINE_SECTION };
}

export function transcriptionRoute(input: RouteInput): TranscriptionRoute {
  const { status, engineOrder } = input;
  if (status.serverRepairNeeded) {
    return problem('Server treba znova spárovať', SERVER_PAGE);
  }
  if (status.pairingNeeded) {
    return problem('Server nie je spárovaný', SERVER_PAGE);
  }
  if (!status.modelReady) {
    return problem('Lokálne · model chýba', MODEL_SECTION);
  }
  if (engineOrder[0] === 'server') {
    return serverFirst(input);
  }
  return localFirst(input);
}

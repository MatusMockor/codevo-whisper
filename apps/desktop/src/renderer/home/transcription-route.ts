import type { AppStatus } from '../../shared/app-status';
import { isServerDown, type PairedServerView } from '../../shared/server';
import type { EngineId } from '../../shared/settings';
import type { EngineProblem } from '../../shared/engine-routing';
import { ENGINE_SECTION, SERVER_SECTION, type NavTarget } from '../navigation';
import { ISSUE_TARGETS, type EngineIssue } from './engine-issue';

export type SignalState = 'ok' | 'warn' | 'err' | 'off';

export type TranscriptionRoute = { state: Exclude<SignalState, 'off'>; label: string; detail: string; latencyMs: number | null; target: NavTarget };

export type RouteInput = { status: AppStatus; engineOrder: readonly EngineId[]; server: PairedServerView | null; localReady: boolean; modelName: string | null; issue: EngineIssue | null };

const FIX = 'kliknite a opravte';

const ISSUE_LABELS: Readonly<Record<EngineProblem, string>> = Object.freeze({
  'no-model': 'Lokálne · model chýba',
  'server-not-paired': 'Server nie je spárovaný',
  'server-offline': 'Server je offline',
});

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
    return { state: 'warn', label: localLabel(modelName), detail: 'server nie je spárovaný', latencyMs: null, target: SERVER_SECTION };
  }
  if (isServerDown(server.status)) {
    return { state: 'warn', label: serverLabel(server), detail: localReady ? 'offline · záloha lokálne' : 'server je offline', latencyMs: null, target: SERVER_SECTION };
  }
  return { state: 'ok', label: serverLabel(server), detail: serverDetail(server), latencyMs: latency(server), target: ENGINE_SECTION };
}

function localFirst({ engineOrder, server, localReady, modelName }: RouteInput): TranscriptionRoute {
  if (!localReady && server !== null) {
    return { state: 'warn', label: serverLabel(server), detail: 'lokálny model chýba · záloha', latencyMs: latency(server), target: ISSUE_TARGETS['no-model'] };
  }
  return { state: 'ok', label: localLabel(modelName), detail: engineOrder.includes('server') ? 'záloha: server' : 'na tomto zariadení', latencyMs: null, target: ENGINE_SECTION };
}

export function transcriptionRoute(input: RouteInput): TranscriptionRoute {
  const { status, engineOrder, issue } = input;
  if (status.serverRepairNeeded) {
    return problem('Server treba znova spárovať', SERVER_SECTION);
  }
  if (issue !== null) {
    return problem(ISSUE_LABELS[issue.problem], ISSUE_TARGETS[issue.problem]);
  }
  if (engineOrder[0] === 'server') {
    return serverFirst(input);
  }
  return localFirst(input);
}

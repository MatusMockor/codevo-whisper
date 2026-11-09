import type { AppStatus } from '../../shared/app-status';
import { engineRemedy, orderProblem, type EngineConditions, type EngineProblem, type EngineRemedy } from '../../shared/engine-routing';
import type { PairedServerView } from '../../shared/server';
import type { EngineId } from '../../shared/settings';
import type { NavTarget } from '../navigation';

export type EngineIssue = { problem: EngineProblem; remedy: EngineRemedy | null; serverHost: string | null };

const SERVER_PAGE: NavTarget = { page: 'server' };

export const ISSUE_TARGETS: Readonly<Record<EngineProblem, NavTarget>> = Object.freeze({
  'no-model': { page: 'settings', section: 'local-model' },
  'server-not-paired': SERVER_PAGE,
  'server-offline': SERVER_PAGE,
});

export type EngineIssueInput = { status: AppStatus; engineOrder: readonly EngineId[]; conditions: EngineConditions | null; server: PairedServerView | null };

function issue(problem: EngineProblem, remedy: EngineRemedy | null, server: PairedServerView | null): EngineIssue {
  return { problem, remedy, serverHost: server?.host ?? null };
}

function knownIssue({ engineOrder, conditions, server }: EngineIssueInput): EngineIssue | null {
  if (conditions === null) {
    return null;
  }
  const problem = orderProblem(engineOrder, conditions);
  if (problem === null) {
    return null;
  }
  return issue(problem, engineRemedy(problem, conditions), server);
}

function reportedIssue({ status, server }: EngineIssueInput): EngineIssue | null {
  if (status.modelReady) {
    return null;
  }
  return issue(status.pairingNeeded ? 'server-not-paired' : 'no-model', null, server);
}

function confirmedIssue(input: EngineIssueInput): EngineIssue | null {
  const known = knownIssue(input);
  if (known === null || !input.status.modelReady) {
    return known;
  }
  return known.problem === 'server-offline' ? known : null;
}

export function engineIssue(input: EngineIssueInput): EngineIssue | null {
  if (input.status.serverRepairNeeded) {
    return null;
  }
  return confirmedIssue(input) ?? reportedIssue(input);
}

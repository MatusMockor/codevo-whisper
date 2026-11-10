import type { EngineConditions } from '../../shared/engine-routing';
import { isModelReady, type ModelState } from '../../shared/models';
import { isServerDown, type ServerView } from '../../shared/server';

export type ModelReadinessView = { states: readonly ModelState[]; statesLoaded: boolean };

export function engineConditions(localModelId: string | null, models: ModelReadinessView, server: ServerView | null): EngineConditions | null {
  if (!models.statesLoaded || server === null) {
    return null;
  }
  const paired = server.server;
  const enabled = paired !== null && paired.enabled;
  return {
    localReady: isModelReady(models.states, localModelId),
    serverReady: enabled && paired.status.kind !== 'repair-needed',
    serverOffline: enabled && isServerDown(paired.status),
    serverOff: paired !== null && !paired.enabled,
    serverRepair: enabled && paired.status.kind === 'repair-needed',
  };
}

import type { EngineConditions } from '../../shared/engine-routing';
import { isModelReady, type ModelState } from '../../shared/models';
import type { ServerView } from '../../shared/server';

export type ModelReadinessView = { states: readonly ModelState[]; statesLoaded: boolean };

export function engineConditions(localModelId: string | null, models: ModelReadinessView, server: ServerView | null): EngineConditions | null {
  if (!models.statesLoaded || server === null) {
    return null;
  }
  const paired = server.server;
  return {
    localReady: isModelReady(models.states, localModelId),
    serverReady: paired !== null && paired.status.kind !== 'repair-needed',
    serverOffline: paired?.status.kind === 'offline',
  };
}

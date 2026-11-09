import type { AppStatus } from '../../shared/app-status';
import { isModelReady } from '../../shared/models';
import type { PairedServerView, ServerView } from '../../shared/server';
import type { Settings } from '../../shared/settings';
import { engineConditions } from '../settings/engine-conditions';
import { useModels, type Models } from '../settings/use-models';
import { useSettings } from '../settings/use-settings';
import { useServer } from '../server/use-server';
import { engineIssue, type EngineIssue } from './engine-issue';
import { useLiveValue, type Live } from './live-value';
import { transcriptionRoute, type TranscriptionRoute } from './transcription-route';

export type Dictation = { status: Live<AppStatus>; settings: Live<Settings>; route: TranscriptionRoute | null; issue: EngineIssue | null };

const loadStatus = () => window.codevo.getStatus();

function modelName(models: Models, id: string | null): string | null {
  if (models.catalog.kind !== 'ready') {
    return null;
  }
  return models.catalog.value.models.find((model) => model.id === id)?.name ?? null;
}

function serverView(server: Live<ServerView>): ServerView | null {
  return server.kind === 'ready' ? server.value : null;
}

function dictationIssue(status: AppStatus, settings: Settings, view: ServerView | null, models: Models): EngineIssue | null {
  return engineIssue({ status, engineOrder: settings.engineOrder, conditions: engineConditions(settings.localModelId, models, view), server: view?.server ?? null });
}

function route(status: AppStatus, settings: Settings, server: PairedServerView | null, models: Models, issue: EngineIssue | null): TranscriptionRoute {
  return transcriptionRoute({
    status,
    engineOrder: settings.engineOrder,
    server,
    localReady: isModelReady(models.states, settings.localModelId),
    modelName: modelName(models, settings.localModelId),
    issue,
  });
}

export function useDictation(): Dictation {
  const status = useLiveValue('status-changed', loadStatus);
  const settings = useSettings();
  const server = useServer();
  const models = useModels();
  if (status.kind !== 'ready' || settings.kind !== 'ready') {
    return { status, settings, route: null, issue: null };
  }
  const view = serverView(server);
  const issue = dictationIssue(status.value, settings.value, view, models);
  return { status, settings, route: route(status.value, settings.value, view?.server ?? null, models, issue), issue };
}

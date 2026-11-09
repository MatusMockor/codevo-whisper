import type { AppStatus } from '../../shared/app-status';
import type { ServerView } from '../../shared/server';
import type { Settings } from '../../shared/settings';
import { useModels, type Models } from '../settings/use-models';
import { useSettings } from '../settings/use-settings';
import { useServer } from '../server/use-server';
import { useLiveValue, type Live } from './live-value';
import { transcriptionRoute, type TranscriptionRoute } from './transcription-route';

export type Dictation = { status: Live<AppStatus>; settings: Live<Settings>; route: TranscriptionRoute | null };

const loadStatus = () => window.codevo.getStatus();

function modelName(models: Models, id: string | null): string | null {
  if (models.catalog.kind !== 'ready') {
    return null;
  }
  return models.catalog.value.models.find((model) => model.id === id)?.name ?? null;
}

function localReady(models: Models, id: string | null): boolean {
  return id !== null && models.states.some((state) => state.id === id && state.status === 'ready');
}

function route(status: AppStatus, settings: Settings, server: Live<ServerView>, models: Models): TranscriptionRoute {
  return transcriptionRoute({
    status,
    engineOrder: settings.engineOrder,
    server: server.kind === 'ready' ? server.value.server : null,
    localReady: localReady(models, settings.localModelId),
    modelName: modelName(models, settings.localModelId),
  });
}

export function useDictation(): Dictation {
  const status = useLiveValue('status-changed', loadStatus);
  const settings = useSettings();
  const server = useServer();
  const models = useModels();
  if (status.kind !== 'ready' || settings.kind !== 'ready') {
    return { status, settings, route: null };
  }
  return { status, settings, route: route(status.value, settings.value, server, models) };
}

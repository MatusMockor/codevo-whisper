import type { EngineCapabilities, EngineFix } from '../../shared/engine-routing';
import { isModelReady, type ModelState } from '../../shared/models';
import type { ServerView } from '../../shared/server';

export type ModelReadinessView = { states: readonly ModelState[]; statesLoaded: boolean };

export type EngineFixCopy = { message: string; button: string };

export const ENGINE_FIX_COPY: Readonly<Record<EngineFix, EngineFixCopy>> = Object.freeze({
  'use-server': { message: 'Lokálny model nemáte stiahnutý, takže s touto voľbou diktovanie nebude fungovať.', button: 'Prepisovať na serveri' },
  'use-local': { message: 'Server teraz nie je pripravený, takže s touto voľbou diktovanie nebude fungovať.', button: 'Prepisovať lokálne' },
  'download-model': { message: 'Lokálny model nemáte stiahnutý a server nie je spárovaný, takže diktovanie zatiaľ nebude fungovať.', button: 'Stiahnuť model' },
});

export function engineCapabilities(localModelId: string | null, models: ModelReadinessView, server: ServerView | null): EngineCapabilities | null {
  if (!models.statesLoaded || server === null) {
    return null;
  }
  const paired = server.server;
  return { localReady: isModelReady(models.states, localModelId), serverReady: paired !== null && paired.status.kind !== 'repair-needed' };
}

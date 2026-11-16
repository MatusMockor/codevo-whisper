import { routesDictationLanguages } from '@codevo-whisper/protocol';
import { requestedTranscriptionModel } from '../../shared/transcription-models';
import type { ReadyConnection } from './server-connector';
import { ServerFeatures } from './server-features';

export type ModelTarget = Pick<ReadyConnection, 'serverVersion' | 'transcriptionModels' | 'pairing'>;

export function requestedModel(ready: ModelTarget): string | undefined {
  if (!ServerFeatures.of(ready.serverVersion).transcriptionModels) {
    return undefined;
  }
  return requestedTranscriptionModel(ready.transcriptionModels, ready.pairing.transcriptionModel ?? null);
}

export function routesLanguages(ready: ModelTarget): boolean {
  return routesDictationLanguages(ready.transcriptionModels, requestedModel(ready) ?? null);
}

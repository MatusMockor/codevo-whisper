import { RoutedTranscriber } from '@codevo-whisper/language-routing';
import type { SttConfig } from './config';
import { Engine } from './engine';
import { ModelLanguageRouter, UnavailableLanguageRouter } from './language-router';
import { modelName } from './model-names';
import { runnerFactoryFor } from './runner-factory';
import type { RetryBackoff } from './warm-up-retry';

export type EngineOptions = { routing: boolean; warmUpBackoff?: RetryBackoff };

export function createEngine(config: SttConfig, options: EngineOptions): Engine {
  const factory = runnerFactoryFor(config);
  const verbatim = factory.transcriber({ model: config.model, backend: config.backend });
  const transcription = modelName(config.model);
  if (!options.routing) {
    return new Engine(verbatim, new UnavailableLanguageRouter(), { transcription, conditioned: null, languageId: null }, []);
  }
  const conditioned = factory.transcriber({ model: config.conditionedModel, backend: config.backend });
  const identifier = factory.identifier({ model: config.lidModel, backend: config.lidBackend });
  const routed = new RoutedTranscriber({ identifier, conditioned, verbatim });
  const models = { transcription, conditioned: modelName(config.conditionedModel), languageId: modelName(config.lidModel) };
  return new Engine(verbatim, new ModelLanguageRouter(routed, [verbatim, conditioned, identifier]), models, [conditioned, identifier], options.warmUpBackoff);
}

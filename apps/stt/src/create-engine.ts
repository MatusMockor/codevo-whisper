import type { SttConfig } from './config';
import { DirectTranscriptionModel } from './direct-transcription-model';
import type { EngineComponent } from './engine-component';
import { Engine } from './engine';
import { ModelLanguageRouter, UnavailableLanguageRouter, type LanguageRouter } from './language-router';
import { modelName, type ServerModels } from './model-names';
import { RoutingTranscriptionModel } from './routing-transcription-model';
import { runnerFactoryFor, type RunnerFactory } from './runner-factory';
import { PARAKEET_ULTRA, WHISPER_LARGE_V3 } from './transcription-model';
import { TranscriptionModelCatalog } from './transcription-model-catalog';
import type { Transcriber } from './transcriber';
import type { RetryBackoff } from './warm-up-retry';

export type EngineOptions = { routing: boolean; whisper?: boolean; warmUpBackoff?: RetryBackoff };

type LanguageModels = { router: LanguageRouter; models: ServerModels; components: readonly EngineComponent[] };

function languageModels(config: SttConfig, factory: RunnerFactory, verbatim: Transcriber, routing: boolean): LanguageModels {
  const transcription = modelName(config.model);
  if (!routing) {
    return { router: new UnavailableLanguageRouter(), models: { transcription, conditioned: null, languageId: null }, components: [] };
  }
  const conditioned = factory.transcriber({ model: config.conditionedModel, backend: config.backend });
  const identifier = factory.identifier({ model: config.lidModel, backend: config.lidBackend });
  return {
    router: new ModelLanguageRouter({ identifier, conditioned, verbatim }),
    models: { transcription, conditioned: modelName(config.conditionedModel), languageId: modelName(config.lidModel) },
    components: [conditioned, identifier],
  };
}

export function createEngine(config: SttConfig, options: EngineOptions): Engine {
  const factory = runnerFactoryFor(config);
  const verbatim = factory.transcriber({ model: config.model, backend: config.backend });
  const whisper = factory.transcriber({ model: config.whisperModel, backend: config.backend });
  const language = languageModels(config, factory, verbatim, options.routing);
  const catalog = new TranscriptionModelCatalog(new RoutingTranscriptionModel(PARAKEET_ULTRA, language.models.transcription, verbatim, language.router), [
    new DirectTranscriptionModel(WHISPER_LARGE_V3, modelName(config.whisperModel), whisper, options.whisper === true),
  ]);
  return new Engine(
    { transcriber: verbatim, router: language.router, models: language.models, catalog, languageModels: language.components, selectableModels: [whisper] },
    options.warmUpBackoff,
  );
}

import { pinnedCatalog, type CatalogModel, type ModelFamily, type PinnedCatalog } from './catalog-models';
import type { SttConfig } from './config';
import { StatfsDiskSpace, type DiskSpace } from './disk-space';
import type { EngineComponent } from './engine-component';
import { Engine } from './engine';
import { ModelLanguageRouter, UnavailableLanguageRouter, type LanguageRouter } from './language-router';
import { LoadableTranscriber } from './loadable-transcriber';
import { ModelDownloads, type DownloadEvent } from './model-downloads';
import { LocalModelFileStore, type ModelFileStore } from './model-file-store';
import { ModelInventory } from './model-inventory';
import { DirectJobs, RoutedJobs, type ModelJobs } from './model-jobs';
import { ModelManagement } from './model-management';
import { modelName, type ServerModels } from './model-names';
import { OnDemandTranscriptionModel } from './on-demand-transcription-model';
import { ResidencyLimit } from './residency-limit';
import { ResidentTranscriptionModel } from './resident-transcription-model';
import { runnerFactoryFor, type RunnerFactory } from './runner-factory';
import { TranscriptionModelCatalog } from './transcription-model-catalog';
import type { Transcriber } from './transcriber';
import type { RetryBackoff } from './warm-up-retry';

export type DownloadDeps = { space?: DiskSpace; fetchImpl?: typeof fetch; onEvent?: DownloadEvent };

export type EngineOptions = {
  routing: boolean;
  installed?: readonly string[];
  catalog?: PinnedCatalog;
  downloads?: DownloadDeps;
  files?: ModelFileStore;
  warmUpBackoff?: RetryBackoff;
};

type RouterSource = (verbatim: Transcriber) => LanguageRouter;

type LanguageModels = { routerFor: RouterSource; models: ServerModels; components: readonly EngineComponent[] };

type JobsSource = (transcriber: Transcriber, routerFor: RouterSource) => ModelJobs;

const JOBS_BY_FAMILY: Readonly<Record<ModelFamily, JobsSource>> = {
  parakeet: (transcriber, routerFor) => new RoutedJobs(transcriber, routerFor(transcriber)),
  whisper: (transcriber) => new DirectJobs(transcriber),
};

function languageModels(config: SttConfig, factory: RunnerFactory, transcription: string, routing: boolean): LanguageModels {
  if (!routing) {
    return { routerFor: () => new UnavailableLanguageRouter(), models: { transcription, conditioned: null, languageId: null }, components: [] };
  }
  const conditioned = factory.transcriber({ model: config.conditionedModel, backend: config.backend });
  const identifier = factory.identifier({ model: config.lidModel, backend: config.lidBackend });
  return {
    routerFor: (verbatim) => new ModelLanguageRouter({ identifier, conditioned, verbatim }),
    models: { transcription, conditioned: modelName(config.conditionedModel), languageId: modelName(config.lidModel) },
    components: [conditioned, identifier],
  };
}

function downloadsOf(inventory: ModelInventory, deps: DownloadDeps): ModelDownloads {
  return new ModelDownloads({
    inventory,
    space: deps.space ?? new StatfsDiskSpace(),
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    ...(deps.onEvent === undefined ? {} : { onEvent: deps.onEvent }),
  });
}

export function createEngine(config: SttConfig, options: EngineOptions): Engine {
  const factory = runnerFactoryFor(config);
  const catalog = options.catalog ?? pinnedCatalog(config);
  const verbatim = factory.transcriber({ model: catalog.primary.target, backend: config.backend });
  const language = languageModels(config, factory, catalog.primary.name, options.routing);
  const inventory = new ModelInventory(options.installed ?? []);
  const residency = new ResidencyLimit(config.maxResidentModels);
  const loadables: LoadableTranscriber[] = [];
  const alternative = (model: CatalogModel): OnDemandTranscriptionModel => {
    const transcriber = new LoadableTranscriber(() => factory.transcriber({ model: model.target, backend: config.backend }));
    loadables.push(transcriber);
    return new OnDemandTranscriptionModel(model.id, model.name, { transcriber, jobs: JOBS_BY_FAMILY[model.family](transcriber, language.routerFor), inventory, residency });
  };
  const router = language.routerFor(verbatim);
  const models = new TranscriptionModelCatalog(new ResidentTranscriptionModel(catalog.primary.id, catalog.primary.name, new RoutedJobs(verbatim, router)), catalog.alternatives.map(alternative));
  const management = new ModelManagement({
    catalog,
    models,
    inventory,
    downloads: downloadsOf(inventory, options.downloads ?? {}),
    files: options.files ?? new LocalModelFileStore(),
    downloadsEnabled: config.modelDownloads === 'enabled',
  });
  return new Engine(
    { transcriber: verbatim, router, models: language.models, catalog: models, management, languageModels: language.components, selectableModels: loadables },
    options.warmUpBackoff,
  );
}

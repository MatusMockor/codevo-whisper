import type { EngineComponent } from './engine-component';
import type { LanguageRouter } from './language-router';
import type { ServerModels } from './model-names';
import type { TranscriptionModelCatalog } from './transcription-model-catalog';
import type { Transcriber } from './transcriber';
import { WarmUpRetry, type RetryBackoff, type RetryListener } from './warm-up-retry';

export type EngineParts = {
  transcriber: Transcriber;
  router: LanguageRouter;
  models: ServerModels;
  catalog: TranscriptionModelCatalog;
  languageModels: readonly EngineComponent[];
  selectableModels: readonly EngineComponent[];
};

export class Engine {
  readonly transcriber: Transcriber;
  readonly router: LanguageRouter;
  readonly models: ServerModels;
  readonly catalog: TranscriptionModelCatalog;
  private readonly components: readonly EngineComponent[];
  private readonly languageWarmUp: WarmUpRetry;

  constructor(parts: EngineParts, warmUpBackoff?: RetryBackoff) {
    this.transcriber = parts.transcriber;
    this.router = parts.router;
    this.models = parts.models;
    this.catalog = parts.catalog;
    this.components = [parts.transcriber, ...parts.languageModels, ...parts.selectableModels];
    this.languageWarmUp = new WarmUpRetry(parts.languageModels, warmUpBackoff);
  }

  warmUpLanguageModels(onRetry?: RetryListener): Promise<boolean> {
    return this.languageWarmUp.run(onRetry);
  }

  async close(): Promise<void> {
    this.languageWarmUp.stop();
    await Promise.all(this.components.map((component) => component.close()));
  }
}

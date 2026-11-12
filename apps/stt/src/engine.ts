import type { EngineComponent } from './engine-component';
import type { LanguageRouter } from './language-router';
import type { ServerModels } from './model-names';
import type { Transcriber } from './transcriber';
import { WarmUpRetry, type RetryBackoff, type RetryListener } from './warm-up-retry';

export class Engine {
  private readonly languageWarmUp: WarmUpRetry;

  constructor(
    readonly transcriber: Transcriber,
    readonly router: LanguageRouter,
    readonly models: ServerModels,
    private readonly languageModels: readonly EngineComponent[],
    warmUpBackoff?: RetryBackoff,
  ) {
    this.languageWarmUp = new WarmUpRetry(languageModels, warmUpBackoff);
  }

  warmUpLanguageModels(onRetry?: RetryListener): Promise<boolean> {
    return this.languageWarmUp.run(onRetry);
  }

  async close(): Promise<void> {
    this.languageWarmUp.stop();
    await Promise.all([this.transcriber, ...this.languageModels].map((component) => component.close()));
  }
}

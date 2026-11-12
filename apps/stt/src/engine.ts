import type { EngineComponent } from './engine-component';
import type { LanguageRouter } from './language-router';
import type { ServerModels } from './model-names';
import type { Transcriber } from './transcriber';

export class Engine {
  constructor(
    readonly transcriber: Transcriber,
    readonly router: LanguageRouter,
    readonly models: ServerModels,
    private readonly languageModels: readonly EngineComponent[],
  ) {}

  async warmUpLanguageModels(): Promise<void> {
    await Promise.all(this.languageModels.map((model) => model.warmUp()));
  }

  async close(): Promise<void> {
    await Promise.all([this.transcriber, ...this.languageModels].map((component) => component.close()));
  }
}

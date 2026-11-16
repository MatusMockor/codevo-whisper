import type { EngineComponent } from './engine-component';

export class SingleFlightWarmUp {
  private pending: Promise<void> | null = null;

  constructor(private readonly component: EngineComponent) {}

  run(): Promise<void> {
    if (this.component.ready()) {
      return Promise.resolve();
    }
    this.pending ??= this.component.warmUp().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}

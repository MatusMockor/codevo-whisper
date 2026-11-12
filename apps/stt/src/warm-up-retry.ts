import { setTimeout as sleep } from 'node:timers/promises';
import type { EngineComponent } from './engine-component';

export type RetryBackoff = { initialMs: number; maxMs: number };

export type RetryListener = (delayMs: number) => void;

export const WARM_UP_BACKOFF: RetryBackoff = { initialMs: 1_000, maxMs: 60_000 };

export class WarmUpRetry {
  private readonly stopping = new AbortController();

  constructor(
    private readonly components: readonly EngineComponent[],
    private readonly backoff: RetryBackoff = WARM_UP_BACKOFF,
  ) {}

  async run(onRetry: RetryListener = () => undefined): Promise<boolean> {
    for (let failures = 0; !this.stopping.signal.aborted; failures += 1) {
      if (await this.attempt()) {
        return true;
      }
      if (this.stopping.signal.aborted) {
        return false;
      }
      const delayMs = this.delayMs(failures);
      onRetry(delayMs);
      await sleep(delayMs, undefined, { signal: this.stopping.signal }).catch(() => undefined);
    }
    return false;
  }

  stop(): void {
    this.stopping.abort();
  }

  private async attempt(): Promise<boolean> {
    return Promise.all(this.components.map((component) => component.warmUp())).then(
      () => true,
      () => false,
    );
  }

  private delayMs(failures: number): number {
    return Math.min(this.backoff.maxMs, this.backoff.initialMs * 2 ** failures);
  }
}

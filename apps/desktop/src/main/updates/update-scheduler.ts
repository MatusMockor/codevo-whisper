import type { Logger } from '../logging/logger';

export type UpdateTiming = { initialDelayMs: number; intervalMs: number };

export const UPDATE_TIMING: UpdateTiming = Object.freeze({ initialDelayMs: 15_000, intervalMs: 4 * 60 * 1000 });

export class UpdateScheduler {
  private first: NodeJS.Timeout | null = null;
  private repeat: NodeJS.Timeout | null = null;
  private started = false;

  constructor(
    private readonly check: () => Promise<void>,
    private readonly logger: Logger,
    private readonly timing: UpdateTiming = UPDATE_TIMING,
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.first = setTimeout(() => {
      this.first = null;
      this.run();
      this.repeat = setInterval(() => this.run(), this.timing.intervalMs);
    }, this.timing.initialDelayMs);
  }

  dispose(): void {
    clearTimeout(this.first ?? undefined);
    clearInterval(this.repeat ?? undefined);
    this.first = null;
    this.repeat = null;
  }

  private run(): void {
    this.check().catch((error: unknown) => {
      this.logger.error('The scheduled update check failed', error);
    });
  }
}

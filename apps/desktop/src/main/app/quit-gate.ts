import type { Logger } from '../logging/logger';

export type QuitEvent = { preventDefault(): void };

export type SettlingWork = { isBusy(): boolean; settled(): Promise<void> };

const DEFAULT_TIMEOUT_MS = 2000;

export function settleWithin(work: SettlingWork, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const settled = work.settled().then(() => true);
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}

export class QuitGate {
  private draining = false;
  private drained = false;

  constructor(
    private readonly work: SettlingWork,
    private readonly quit: () => void,
    private readonly logger: Logger,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  systemShuttingDown(): void {
    this.drained = true;
  }

  handle(event: QuitEvent): void {
    if (this.drained || !this.work.isBusy()) {
      return;
    }
    event.preventDefault();
    if (this.draining) {
      return;
    }
    this.draining = true;
    void settleWithin(this.work, this.timeoutMs).then((settled) => {
      if (!settled) {
        this.logger.info('Quitting while the microphone is still busy', { timeoutMs: this.timeoutMs });
      }
      this.drained = true;
      this.quit();
    });
  }
}

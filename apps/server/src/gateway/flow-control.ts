import type { IngestionLimits } from './ingestion-limiter';
import type { SecureChannel } from './secure-channel';

export const FLOW_CHECK_MS = 250;

export class FlowControl {
  private paused = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly channel: SecureChannel,
    private readonly availableSeconds: () => number,
    private readonly limits: IngestionLimits,
  ) {}

  update(): void {
    if (this.paused || this.availableSeconds() >= this.limits.pauseBelowSeconds) {
      return;
    }
    this.paused = true;
    this.channel.send({ type: 'flow', paused: true });
    this.schedule();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    this.timer = setTimeout(() => this.check(), FLOW_CHECK_MS);
    this.timer.unref();
  }

  private check(): void {
    if (this.availableSeconds() < this.limits.resumeAboveSeconds) {
      this.schedule();
      return;
    }
    this.paused = false;
    this.timer = undefined;
    this.channel.send({ type: 'flow', paused: false });
  }
}

import type { InputHelper } from '../helper/input-helper';
import type { PowerEvents } from './power-events';

export type ResetReason = 'max-duration' | 'lock' | 'suspend' | 'input-lost';

export const MAX_SESSION_MS = 600_000;

type InputLossSource = Pick<InputHelper, 'onInputLost'>;

export class ResetGuard {
  private startedAt: number | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly input: InputLossSource,
    private readonly power: PowerEvents,
    private readonly clock: () => number,
  ) {}

  arm(onReset: (reason: ResetReason) => void): void {
    this.disarm();
    this.startedAt = this.clock();
    const reset = (reason: ResetReason): void => {
      this.disarm();
      onReset(reason);
    };
    const timer = setTimeout(() => reset('max-duration'), MAX_SESSION_MS);
    this.unsubscribers = [
      () => clearTimeout(timer),
      this.power.on('lock-screen', () => reset('lock')),
      this.power.on('suspend', () => reset('suspend')),
      this.input.onInputLost(() => reset('input-lost')),
    ];
  }

  expired(): boolean {
    return this.startedAt !== null && this.clock() - this.startedAt >= MAX_SESSION_MS;
  }

  disarm(): void {
    this.startedAt = null;
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }
}

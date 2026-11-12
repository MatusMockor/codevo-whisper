import type { ServerStatus } from '../../shared/server';
import type { PowerEvents } from '../hotkey/power-events';
import type { ServerStatusBoard } from './server-status';

export const RECONNECT_DELAYS_MS: readonly number[] = Object.freeze([5_000, 15_000, 30_000, 60_000]);

export type ServerReconnectDeps = {
  status: Pick<ServerStatusBoard, 'onChange' | 'onStaleLanguages'>;
  check: () => Promise<void>;
  power: PowerEvents;
  delaysMs?: readonly number[];
};

export class ServerReconnect {
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: ServerReconnectDeps) {}

  start(): void {
    const wake = (): void => this.checkNow();
    this.unsubscribers = [
      this.deps.status.onChange((status) => this.follow(status)),
      this.deps.status.onStaleLanguages(wake),
      this.deps.power.on('resume', wake),
      this.deps.power.on('unlock-screen', wake),
    ];
  }

  dispose(): void {
    this.cancel();
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  private follow(status: ServerStatus): void {
    if (status.kind === 'checking') {
      return;
    }
    if (status.kind !== 'offline' && status.kind !== 'unavailable') {
      this.attempt = 0;
      this.cancel();
      return;
    }
    this.schedule();
  }

  private schedule(): void {
    const delays = this.deps.delaysMs ?? RECONNECT_DELAYS_MS;
    const delay = delays[Math.min(this.attempt, delays.length - 1)] ?? 0;
    this.attempt += 1;
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.deps.check();
    }, delay);
  }

  private checkNow(): void {
    this.attempt = 0;
    this.cancel();
    void this.deps.check();
  }

  private cancel(): void {
    if (this.timer === null) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
  }
}

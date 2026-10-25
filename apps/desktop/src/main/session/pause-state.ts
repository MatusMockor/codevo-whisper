import { Listeners } from '../helper/listeners';
import type { Logger } from '../logging/logger';

export class PauseState {
  private paused = false;
  private readonly listeners: Listeners<boolean>;

  constructor(logger: Logger) {
    this.listeners = new Listeners(logger, 'A pause listener failed');
  }

  isPaused(): boolean {
    return this.paused;
  }

  set(paused: boolean): void {
    if (this.paused === paused) {
      return;
    }
    this.paused = paused;
    this.listeners.emit(paused);
  }

  onChange(listener: (paused: boolean) => void): () => void {
    return this.listeners.add(listener);
  }
}

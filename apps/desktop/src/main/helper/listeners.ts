import type { Logger } from '../logging/logger';

export class Listeners<T> {
  private readonly listeners = new Set<(value: T) => void>();

  constructor(
    private readonly logger: Logger,
    private readonly failureMessage: string,
  ) {}

  add(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (error) {
        this.logger.error(this.failureMessage, error);
      }
    }
  }
}

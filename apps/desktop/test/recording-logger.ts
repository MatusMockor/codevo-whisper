import type { Logger } from '../src/main/logging/logger';

export class RecordingLogger implements Logger {
  readonly errors: Array<{ message: string; error: unknown }> = [];

  error(message: string, error: unknown): void {
    this.errors.push({ message, error });
  }
}

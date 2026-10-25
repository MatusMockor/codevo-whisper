import type { Logger } from '../src/main/logging/logger';

export class RecordingLogger implements Logger {
  readonly infos: Array<{ message: string; detail: unknown }> = [];
  readonly warns: Array<{ message: string; detail: unknown }> = [];
  readonly errors: Array<{ message: string; error: unknown }> = [];

  info(message: string, detail: unknown): void {
    this.infos.push({ message, detail });
  }

  warn(message: string, detail: unknown): void {
    this.warns.push({ message, detail });
  }

  error(message: string, error: unknown): void {
    this.errors.push({ message, error });
  }
}

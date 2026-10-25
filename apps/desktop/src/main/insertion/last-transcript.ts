import { Listeners } from '../helper/listeners';
import { consoleLogger, type Logger } from '../logging/logger';

export class LastTranscript {
  private text: string | null = null;
  private readonly listeners: Listeners<string>;

  constructor(logger: Logger = consoleLogger) {
    this.listeners = new Listeners(logger, 'A last transcript listener failed');
  }

  set(text: string): void {
    this.text = text;
    this.listeners.emit(text);
  }

  get(): string | null {
    return this.text;
  }

  onChange(listener: (text: string) => void): () => void {
    return this.listeners.add(listener);
  }
}

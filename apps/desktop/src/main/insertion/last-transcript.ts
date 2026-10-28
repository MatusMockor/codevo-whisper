import { Listeners } from '../helper/listeners';
import { consoleLogger, type Logger } from '../logging/logger';
import { sanitizeInsertionText, type TextSpacing } from './sanitize-insertion-text';

export class LastTranscript {
  private text: string | null = null;
  private readonly listeners: Listeners<string>;

  constructor(logger: Logger = consoleLogger) {
    this.listeners = new Listeners(logger, 'A last transcript listener failed');
  }

  set(text: string, options?: TextSpacing): void {
    const sanitized = sanitizeInsertionText(text, options);
    if (sanitized === '') {
      return;
    }
    this.text = sanitized;
    this.listeners.emit(sanitized);
  }

  get(): string | null {
    return this.text;
  }

  onChange(listener: (text: string) => void): () => void {
    return this.listeners.add(listener);
  }
}

import { writeFileAtomic } from '../fs/atomic-write';
import { readOptionalFile } from '../fs/read-optional-file';
import { consoleLogger, type Logger } from '../logging/logger';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { sanitizeSettings } from './sanitize-settings';

export type SettingsListener = (next: Settings, previous: Settings) => void;

function parseJson(text: string | null): unknown {
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function freezeSettings(settings: Settings): Settings {
  const copy = structuredClone(settings);
  Object.freeze(copy.hotkey);
  Object.freeze(copy.microphone);
  Object.freeze(copy.engineOrder);
  return Object.freeze(copy);
}

export class SettingsStore {
  private current: Settings = DEFAULT_SETTINGS;
  private readonly listeners = new Set<SettingsListener>();
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly logger: Logger = consoleLogger,
  ) {}

  async load(): Promise<Settings> {
    const raw = parseJson(await this.readStoredText());
    this.current = freezeSettings(sanitizeSettings(raw));
    return this.current;
  }

  get(): Settings {
    return this.current;
  }

  update(patch: Partial<Settings>): Promise<Settings> {
    const run = this.pending.then(() => this.apply(patch));
    this.pending = run.catch(() => undefined);
    return run;
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async readStoredText(): Promise<string | null> {
    try {
      return await readOptionalFile(this.file);
    } catch (error) {
      this.logger.error('Settings file could not be read, using defaults', error);
      return null;
    }
  }

  private async apply(patch: Partial<Settings>): Promise<Settings> {
    const previous = this.current;
    const next = freezeSettings({ ...previous, ...patch });
    await writeFileAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`);
    this.current = next;
    this.notify(next, previous);
    return next;
  }

  private notify(next: Settings, previous: Settings): void {
    for (const listener of this.listeners) {
      try {
        listener(next, previous);
      } catch (error) {
        this.logger.error('Settings listener failed', error);
      }
    }
  }
}

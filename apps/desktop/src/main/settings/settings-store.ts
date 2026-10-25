import { writeFileAtomic } from '../fs/atomic-write';
import { readOptionalFile } from '../fs/read-optional-file';
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

  constructor(private readonly file: string) {}

  async load(): Promise<Settings> {
    const raw = parseJson(await readOptionalFile(this.file));
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

  private async apply(patch: Partial<Settings>): Promise<Settings> {
    const previous = this.current;
    const next = freezeSettings({ ...previous, ...patch });
    await writeFileAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`);
    this.current = next;
    for (const listener of this.listeners) {
      listener(next, previous);
    }
    return next;
  }
}

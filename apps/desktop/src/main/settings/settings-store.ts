import { writeFileAtomic } from '../fs/atomic-write';
import { readOptionalFile } from '../fs/read-optional-file';
import { consoleLogger, type Logger } from '../logging/logger';
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings';
import { readLegacyLanguage, type LegacyLanguage, type LegacySettingsReader } from './legacy-settings';
import { sanitizeSettings } from './sanitize-settings';

export type SettingsListener = (next: Settings, previous: Settings) => void;

export type SettingsPatch = Partial<Settings> | ((current: Settings) => Partial<Settings>);

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
  if (copy.hotkey?.kind === 'modifiers') Object.freeze(copy.hotkey.keycodes);
  if (copy.hotkey?.kind === 'key') Object.freeze(copy.hotkey.modifiers);
  Object.freeze(copy.hotkey);
  for (const binding of Object.values(copy.sessionShortcuts)) {
    Object.freeze(binding.modifiers);
    Object.freeze(binding);
  }
  Object.freeze(copy.sessionShortcuts);
  copy.microphones.forEach((entry) => Object.freeze(entry));
  Object.freeze(copy.microphones);
  Object.freeze(copy.engineOrder);
  Object.freeze(copy.serverRestoreOrder);
  for (const entry of copy.customWords) {
    Object.freeze(entry.aliases);
    Object.freeze(entry);
  }
  Object.freeze(copy.customWords);
  Object.freeze(copy.languages.selected);
  Object.freeze(copy.languages);
  return Object.freeze(copy);
}

export class SettingsStore implements LegacySettingsReader {
  private current: Settings = DEFAULT_SETTINGS;
  private legacy: LegacyLanguage | null = null;
  private readonly listeners = new Set<SettingsListener>();
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly logger: Logger = consoleLogger,
  ) {}

  async load(): Promise<Settings> {
    const raw = parseJson(await this.readStoredText());
    this.legacy = readLegacyLanguage(raw);
    this.current = freezeSettings(sanitizeSettings(raw));
    return this.current;
  }

  legacyLanguage(): LegacyLanguage | null {
    return this.legacy;
  }

  get(): Settings {
    return this.current;
  }

  update(patch: SettingsPatch): Promise<Settings> {
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

  private async apply(patch: SettingsPatch): Promise<Settings> {
    const previous = this.current;
    const changes = typeof patch === 'function' ? patch(previous) : patch;
    const next = freezeSettings({ ...previous, ...changes });
    const legacy = Object.hasOwn(changes, 'languages') ? null : this.legacy;
    const stored = legacy === null ? next : { ...next, language: legacy };
    await writeFileAtomic(this.file, `${JSON.stringify(stored, null, 2)}\n`);
    this.legacy = legacy;
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

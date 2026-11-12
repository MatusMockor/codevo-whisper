import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelManager } from '../src/main/models/model-manager';
import { migrateLegacyLanguage } from '../src/main/settings/language-migration';
import { SettingsStore } from '../src/main/settings/settings-store';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';
import { testEntry } from './model-fixtures';

const CATALOG = [
  testEntry('parakeet', 'PARAKEET', { languageHint: 'ignored' }),
  testEntry('canary', 'CANARY', { languageHint: 'required' }),
  testEntry('whisper', 'WHISPER', { languageHint: 'optional' }),
];

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-language-migration-'));
  file = join(dir, 'settings.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function migrate(stored: Record<string, unknown>): Promise<{ migrated: boolean; settings: Settings; onDisk: Record<string, unknown> }> {
  await writeFile(file, JSON.stringify(stored));
  const settings = new SettingsStore(file);
  await settings.load();
  const models = new ModelManager({ dir: join(dir, 'models'), catalog: CATALOG, settings, warmUp: () => Promise.resolve() });
  const migrated = await migrateLegacyLanguage({ legacy: settings, settings, activeLanguageHint: () => models.activeLanguageHint() });
  const onDisk = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  return { migrated, settings: settings.get(), onDisk };
}

describe('legacy language migration', () => {
  it.each([
    ['sk', 'canary', { mode: 'selected', selected: ['sk'] }],
    ['cs', 'canary', { mode: 'selected', selected: ['cs'] }],
    ['en', 'canary', { mode: 'selected', selected: ['en'] }],
    ['sk', 'parakeet', { mode: 'auto', selected: ['sk'] }],
    ['cs', 'whisper', { mode: 'auto', selected: ['cs'] }],
    ['en', null, { mode: 'auto', selected: ['en'] }],
    ['auto', 'parakeet', DEFAULT_SETTINGS.languages],
    ['auto', null, DEFAULT_SETTINGS.languages],
  ] as const)('turns language %s with the active model %s into %j and writes it once', async (language, localModelId, expected) => {
    const { migrated, settings, onDisk } = await migrate({ language, localModelId, engineOrder: ['server'] });

    expect(migrated).toBe(true);
    expect(settings.languages).toEqual(expected);
    expect(onDisk['languages']).toEqual(expected);
    expect(onDisk).not.toHaveProperty('language');
    expect(onDisk['engineOrder']).toEqual(['server']);
  });

  it('migrates the owner file to automatic recognition with Slovak kept for one click', async () => {
    const { settings } = await migrate({ engineOrder: ['server'], localModelId: null, language: 'sk' });

    expect(settings.languages).toEqual({ mode: 'auto', selected: ['sk'] });
  });

  it('keeps valid stored languages and ignores a leftover legacy key', async () => {
    const languages = { mode: 'selected', selected: ['cs', 'sk', 'en'] };
    const { migrated, settings, onDisk } = await migrate({ language: 'en', languages, localModelId: 'canary' });

    expect(migrated).toBe(false);
    expect(settings.languages).toEqual(languages);
    expect(onDisk['language']).toBe('en');
  });

  it('does nothing without a legacy language', async () => {
    const { migrated, settings, onDisk } = await migrate({ mode: 'hold' });

    expect(migrated).toBe(false);
    expect(settings.languages).toEqual(DEFAULT_SETTINGS.languages);
    expect(onDisk).toEqual({ mode: 'hold' });
  });

  it('ignores an unknown legacy value', async () => {
    const { migrated, settings } = await migrate({ language: 'de' });

    expect(migrated).toBe(false);
    expect(settings.languages).toEqual(DEFAULT_SETTINGS.languages);
  });

  it('migrates a legacy value next to invalid languages', async () => {
    const { migrated, settings } = await migrate({ language: 'cs', languages: { mode: 'selected', selected: [] }, localModelId: 'canary' });

    expect(migrated).toBe(true);
    expect(settings.languages).toEqual({ mode: 'selected', selected: ['cs'] });
  });

  it('does not migrate again after the first write', async () => {
    await migrate({ language: 'sk', localModelId: 'canary' });
    const settings = new SettingsStore(file);
    await settings.load();
    await settings.update({ languages: { mode: 'auto', selected: ['en'] } });

    const migrated = await migrateLegacyLanguage({ legacy: settings, settings, activeLanguageHint: () => 'required' });

    expect(migrated).toBe(false);
    expect((await new SettingsStore(file).load()).languages).toEqual({ mode: 'auto', selected: ['en'] });
  });

  it('forgets the legacy value once any update was written in the same run', async () => {
    await writeFile(file, JSON.stringify({ language: 'cs' }));
    const settings = new SettingsStore(file);
    await settings.load();
    await settings.update({ mode: 'toggle' });

    expect(settings.legacyLanguage()).toBeNull();
    expect(JSON.parse(await readFile(file, 'utf8'))).not.toHaveProperty('language');
  });
});

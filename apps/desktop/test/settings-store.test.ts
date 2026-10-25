import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/main/settings/settings-store';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-settings-'));
  file = join(dir, 'settings.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('returns defaults for a missing file', async () => {
    const store = new SettingsStore(file);

    const loaded = await store.load();

    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for a corrupt file', async () => {
    await writeFile(file, '{ not json');
    const store = new SettingsStore(file);

    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists an update', async () => {
    const store = new SettingsStore(file);
    await store.load();

    const updated = await store.update({ mode: 'toggle', hotkey: { keycode: 62, label: 'Pravý ⌃ Control' } });

    expect(updated).toEqual({ ...DEFAULT_SETTINGS, mode: 'toggle', hotkey: { keycode: 62, label: 'Pravý ⌃ Control' } });
    const reloaded = await new SettingsStore(file).load();
    expect(reloaded).toEqual(updated);
  });

  it('replaces invalid fields with defaults on load', async () => {
    await writeFile(
      file,
      JSON.stringify({
        mode: 'toggle',
        language: 'de',
        hotkey: { keycode: 12, label: 'Q' },
        microphone: { deviceId: 'usb-mic', label: 'USB Mic' },
        engineOrder: ['server', 'local'],
        localModelId: 42,
        insertion: 'clipboard',
        overlay: 'fullscreen',
        launchAtLogin: 'yes',
        onboardingDone: true,
        history: ['secret transcript'],
      }),
    );

    const loaded = await new SettingsStore(file).load();

    expect(loaded).toEqual({
      ...DEFAULT_SETTINGS,
      mode: 'toggle',
      microphone: { deviceId: 'usb-mic', label: 'USB Mic' },
      insertion: 'clipboard',
      onboardingDone: true,
    });
    expect(loaded).not.toHaveProperty('history');
  });

  it('notifies listeners with next and previous', async () => {
    const store = new SettingsStore(file);
    await store.load();
    const calls: Array<{ next: Settings; previous: Settings }> = [];
    const unsubscribe = store.onChange((next, previous) => {
      calls.push({ next, previous });
    });

    await store.update({ language: 'en' });
    unsubscribe();
    await store.update({ language: 'cs' });

    expect(calls).toEqual([{ next: { ...DEFAULT_SETTINGS, language: 'en' }, previous: DEFAULT_SETTINGS }]);
  });

  it('applies concurrent updates in order', async () => {
    const store = new SettingsStore(file);
    await store.load();

    await Promise.all([store.update({ language: 'en' }), store.update({ mode: 'toggle' }), store.update({ language: 'auto' })]);

    const expected = { ...DEFAULT_SETTINGS, language: 'auto', mode: 'toggle' };
    expect(store.get()).toEqual(expected);
    expect(await new SettingsStore(file).load()).toEqual(expected);
  });

  it('survives a stray temp file', async () => {
    await writeFile(file, JSON.stringify({ ...DEFAULT_SETTINGS, language: 'en' }));
    await writeFile(`${file}.tmp`, '{ half written');
    const store = new SettingsStore(file);

    expect(await store.load()).toEqual({ ...DEFAULT_SETTINGS, language: 'en' });
    await store.update({ overlay: 'live' });

    const onDisk = JSON.parse(await readFile(file, 'utf8')) as unknown;
    expect(onDisk).toEqual({ ...DEFAULT_SETTINGS, language: 'en', overlay: 'live' });
  });

  it('does not let callers mutate the stored settings', async () => {
    const store = new SettingsStore(file);
    await store.load();

    expect(() => {
      store.get().engineOrder.push('server');
    }).toThrow(TypeError);
    expect(store.get().engineOrder).toEqual(['local']);
  });
});

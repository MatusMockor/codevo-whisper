import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/main/settings/settings-store';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/settings';
import { RecordingLogger } from './recording-logger';

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
  it('defaults recording audio for old files and persists independent preferences', async () => {
    await writeFile(file, JSON.stringify({ language: 'cs' }));
    const store = new SettingsStore(file);
    expect(await store.load()).toMatchObject({ muteWhileRecording: false, audioFeedback: false, feedbackOutputId: null, feedbackVolume: 50 });
    await store.update({ muteWhileRecording: true, audioFeedback: true, feedbackOutputId: 'usb-output', feedbackVolume: 73 });
    expect(await new SettingsStore(file).load()).toMatchObject({ language: 'cs', muteWhileRecording: true, audioFeedback: true, feedbackOutputId: 'usb-output', feedbackVolume: 73 });
  });
  it('migrates output defaults and persists direct typing preferences across reload', async () => {
    await writeFile(file, JSON.stringify({ insertion: 'paste' }));
    const store = new SettingsStore(file);
    expect(await store.load()).toMatchObject({ insertion: 'paste', clipboardPolicy: 'restore', autoSubmit: 'off' });
    await store.update({ insertion: 'type', clipboardPolicy: 'leave', autoSubmit: 'primary-enter' });
    expect(await new SettingsStore(file).load()).toMatchObject({ insertion: 'type', clipboardPolicy: 'leave', autoSubmit: 'primary-enter' });
  });
  it('defaults, freezes and persists transcript preferences independently', async () => {
    const store = new SettingsStore(file);
    expect(await store.load()).toMatchObject({ customWords: [], removeFillerWords: false, appendTrailingSpace: false });
    const words = ['Kumiba', 'Žilina'];
    await store.update({ customWords: words, removeFillerWords: true, appendTrailingSpace: true });
    words.push('changed');
    expect(await new SettingsStore(file).load()).toMatchObject({ customWords: ['Kumiba', 'Žilina'], removeFillerWords: true, appendTrailingSpace: true });
    expect(Object.isFrozen(store.get().customWords)).toBe(true);
    await writeFile(file, JSON.stringify({ customWords: ['two words'], removeFillerWords: true, appendTrailingSpace: 'yes' }));
    expect(await new SettingsStore(file).load()).toMatchObject({ customWords: [], removeFillerWords: true, appendTrailingSpace: false });
  });
  it('returns defaults for a missing file', async () => {
    const store = new SettingsStore(file);

    const loaded = await store.load();

    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(loaded.mode).toBe('smart');
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults resident settings and persists every retention and acceleration option', async () => {
    const store = new SettingsStore(file);
    expect(await store.load()).toMatchObject({ localAcceleration: 'auto', localModelUnload: 5, mode: 'smart' });
    for (const localModelUnload of ['never', 'immediately', 2, 5, 10, 15, 60] as const) {
      for (const localAcceleration of ['auto', 'gpu', 'cpu'] as const) {
        await store.update({ localModelUnload, localAcceleration });
        expect(await new SettingsStore(file).load()).toMatchObject({ localModelUnload, localAcceleration, mode: 'smart' });
      }
    }
    await writeFile(file, JSON.stringify({ localAcceleration: 'vulkan', localModelUnload: '5' }));
    expect(await new SettingsStore(file).load()).toMatchObject({ localAcceleration: 'auto', localModelUnload: 5 });
  });

  it('returns defaults for a corrupt file', async () => {
    await writeFile(file, '{ not json');
    const store = new SettingsStore(file);

    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults and logs when the file cannot be read', async () => {
    await mkdir(file);
    const logger = new RecordingLogger();
    const store = new SettingsStore(file, logger);

    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]?.error).toMatchObject({ code: 'EISDIR' });
  });

  it.each(['hold', 'toggle', 'smart'] as const)('preserves saved %s mode across reloads', async (mode) => {
    const store = new SettingsStore(file);
    await store.load();
    await store.update({ mode });

    expect((await new SettingsStore(file).load()).mode).toBe(mode);
  });

  it.each([{}, { mode: 'invalid' }])('uses smart when mode is absent or invalid: %j', async (stored) => {
    await writeFile(file, JSON.stringify(stored));

    expect((await new SettingsStore(file).load()).mode).toBe('smart');
  });

  it.each([54, 58, 61, 62, 63])('migrates legacy key %i only on load and saves canonical settings on the next update', async (keycode) => {
    const legacy = { hotkey: { keycode, label: 'Legacy side' }, mode: 'hold', language: 'cs' };
    await writeFile(file, JSON.stringify(legacy));
    const store = new SettingsStore(file);
    expect(await store.load()).toMatchObject({ hotkey: { kind: 'modifiers', keycodes: [keycode], label: 'Legacy side' }, mode: 'hold', language: 'cs' });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(legacy);
    await store.update({ language: 'en' });
    expect(await new SettingsStore(file).load()).toMatchObject({ hotkey: { kind: 'modifiers', keycodes: [keycode], label: 'Legacy side' }, mode: 'hold', language: 'en' });
  });

  it('persists an update', async () => {
    const store = new SettingsStore(file);
    await store.load();

    const updated = await store.update({ mode: 'toggle', hotkey: { kind: 'modifiers', keycodes: [62], label: 'Pravý ⌃ Control' } });

    expect(updated).toEqual({ ...DEFAULT_SETTINGS, mode: 'toggle', hotkey: { kind: 'modifiers', keycodes: [62], label: 'Pravý ⌃ Control' } });
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
        engineOrder: ['server', 'server'],
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

  it('round trips combinations and protects nested members from mutation', async () => {
    const store = new SettingsStore(file);
    await store.load();
    const binding = { kind: 'key', keycode: 49, modifiers: ['control'], label: '⌃Space' } as const;
    await store.update({ hotkey: binding });
    expect(await new SettingsStore(file).load()).toMatchObject({ hotkey: binding });
    const hotkey = store.get().hotkey;
    if (hotkey?.kind !== 'key') throw new Error('missing combo');
    expect(Reflect.set(hotkey.modifiers, 0, 'alt')).toBe(false);
    expect(hotkey.modifiers).toEqual(['control']);
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

  it('keeps a saved update and the other listeners when a listener throws', async () => {
    const logger = new RecordingLogger();
    const store = new SettingsStore(file, logger);
    await store.load();
    const failure = new Error('listener failed');
    const seen: string[] = [];
    store.onChange(() => {
      throw failure;
    });
    store.onChange((next) => {
      seen.push(next.language);
    });

    const updated = await store.update({ language: 'en' });

    expect(updated.language).toBe('en');
    expect(seen).toEqual(['en']);
    expect(logger.errors.map((entry) => entry.error)).toEqual([failure]);
    expect((await new SettingsStore(file).load()).language).toBe('en');
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
    await store.update({ mode: 'toggle' });

    const onDisk = JSON.parse(await readFile(file, 'utf8')) as unknown;
    expect(onDisk).toEqual({ ...DEFAULT_SETTINGS, language: 'en', mode: 'toggle' });
  });

  it('keeps a stored Živý text overlay and replaces an unknown one with the indicator', async () => {
    await writeFile(file, JSON.stringify({ ...DEFAULT_SETTINGS, overlay: 'live', mode: 'toggle' }));
    expect(await new SettingsStore(file).load()).toEqual({ ...DEFAULT_SETTINGS, overlay: 'live', mode: 'toggle' });

    await writeFile(file, JSON.stringify({ ...DEFAULT_SETTINGS, overlay: 'text' }));
    expect((await new SettingsStore(file).load()).overlay).toBe('indicator');
  });

  it('keeps a stored server engine order', async () => {
    await writeFile(file, JSON.stringify({ ...DEFAULT_SETTINGS, engineOrder: ['server', 'local'] }));

    expect((await new SettingsStore(file).load()).engineOrder).toEqual(['server', 'local']);
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

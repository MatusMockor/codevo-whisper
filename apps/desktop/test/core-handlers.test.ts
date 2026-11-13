import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeSettings } from '../src/main/ipc/core-handlers';
import { IpcValidationError, validateSettingsPatch } from '../src/main/ipc/validate';
import { SettingsStore } from '../src/main/settings/settings-store';
import { RecordingLogger } from './recording-logger';
import { startTestGateway, type TestGateway } from './support/gateway';
import { createServerService, tinyModels, type ServerServiceHarness } from './support/server-service';

let dir: string;
let gateway: TestGateway;
let settings: SettingsStore;
let harness: ServerServiceHarness;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-core-handlers-'));
  gateway = await startTestGateway();
  const logger = new RecordingLogger();
  settings = new SettingsStore(join(dir, 'settings.json'), logger);
  await settings.load();
  const models = await tinyModels(dir, settings, logger, false);
  harness = createServerService({ dir, settings, models, logger });
  await harness.pairings.save(await gateway.addDevice());
});

afterEach(async () => {
  harness.service.dispose();
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
});

function write(patch: unknown): ReturnType<typeof writeSettings> {
  return writeSettings({ settings, order: harness.order }, validateSettingsPatch(patch));
}

describe('writeSettings', () => {
  it('a disconnect never leaves the server as the only engine while the renderer saves an order with it', async () => {
    const saving = write({ engineOrder: ['server'] });
    await harness.service.disconnect();
    await saving;

    expect(settings.get().engineOrder).toEqual(['local']);
  });

  it('refuses a dictation hotkey or an in-dictation shortcut that one key press fires together', async () => {
    const ctrlAltJ = { kind: 'key', keycode: 0x10000 + 36 + 8, modifiers: ['control', 'alt'], label: 'Ctrl+Alt+J' };
    await expect(write({ hotkey: ctrlAltJ })).rejects.toThrow(IpcValidationError);
    await write({ hotkey: { kind: 'key', keycode: 0x10000 + 25 + 8, modifiers: ['control', 'alt', 'shift'], label: 'Ctrl+Alt+Shift+P' } });
    const polish = { key: 'p', modifiers: ['control', 'alt'] };
    await expect(write({ sessionShortcuts: { ...settings.get().sessionShortcuts, 'toggle-polish': polish } })).rejects.toThrow(IpcValidationError);
    expect(settings.get().sessionShortcuts['toggle-polish']).toEqual({ key: 'a', modifiers: ['control', 'alt'] });
  });

  it('saves a repaired in-dictation shortcut while the unchanged one still collides with a modifier-only dictation hotkey', async () => {
    await settings.update({ hotkey: { kind: 'modifiers', keycodes: [0x10000 + 37], label: 'Ctrl' } });
    const polish = { key: 'p', modifiers: ['alt'] };

    await write({ sessionShortcuts: { ...settings.get().sessionShortcuts, 'toggle-polish': polish } });
    await write({ sessionShortcuts: { ...settings.get().sessionShortcuts, 'cycle-language': { key: 'k', modifiers: ['alt'] } } });
    expect(settings.get().sessionShortcuts).toEqual({ 'toggle-polish': polish, 'cycle-language': { key: 'k', modifiers: ['alt'] } });
    await write({ languages: { mode: 'selected', selected: ['en'] }, hotkey: settings.get().hotkey });
    await expect(write({ sessionShortcuts: { ...settings.get().sessionShortcuts, 'toggle-polish': { key: 'p', modifiers: ['control', 'alt'] } } })).rejects.toThrow(IpcValidationError);
  });

  it('saves the engine order and the other settings of one patch', async () => {
    const languages = { mode: 'selected', selected: ['en'] };
    const saved = await write({ engineOrder: ['server', 'local'], languages });

    expect(saved).toMatchObject({ engineOrder: ['server', 'local'], languages });
    expect(settings.get()).toMatchObject({ engineOrder: ['server', 'local'], languages });
    expect(await write({ engineOrder: ['local'] })).toMatchObject({ engineOrder: ['local'], languages });
  });

  it('keeps the newest value when a later patch is sent before an earlier one with an engine order finishes', async () => {
    const first = write({ engineOrder: ['server'], languages: { mode: 'selected', selected: ['en'] } });
    const second = write({ languages: { mode: 'selected', selected: ['cs', 'en'] } });
    await Promise.all([first, second]);

    expect(settings.get()).toMatchObject({ engineOrder: ['server'], languages: { mode: 'selected', selected: ['cs', 'en'] } });
  });
});

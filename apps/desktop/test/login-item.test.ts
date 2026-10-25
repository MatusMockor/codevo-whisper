import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncLoginItem, type LoginItem } from '../src/main/system/login-item';
import { SettingsStore } from '../src/main/settings/settings-store';
import { RecordingLogger } from './recording-logger';

class SystemLoginItems implements LoginItem {
  readonly applied: boolean[] = [];

  apply(openAtLogin: boolean): void {
    this.applied.push(openAtLogin);
  }
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-login-item-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('syncLoginItem', () => {
  it('applies the stored choice at startup and every change after it', async () => {
    const settings = new SettingsStore(join(dir, 'settings.json'), new RecordingLogger());
    await settings.load();
    const items = new SystemLoginItems();

    const stop = syncLoginItem(settings, items, new RecordingLogger());
    await settings.update({ launchAtLogin: true });
    await settings.update({ mode: 'toggle' });
    await settings.update({ launchAtLogin: false });
    stop();
    await settings.update({ launchAtLogin: true });

    expect(items.applied).toEqual([false, true, false]);
  });

  it('logs when the system refuses the change', async () => {
    const settings = new SettingsStore(join(dir, 'settings.json'), new RecordingLogger());
    await settings.load();
    const logger = new RecordingLogger();

    syncLoginItem(settings, { apply: () => { throw new Error('denied'); } }, logger);

    expect(logger.errors).toHaveLength(1);
  });
});

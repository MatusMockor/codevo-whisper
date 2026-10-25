import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncLoginItem, type LoginItem } from '../src/main/system/login-item';
import { SettingsStore } from '../src/main/settings/settings-store';
import { RecordingLogger } from './recording-logger';

class SystemLoginItems implements LoginItem {
  readonly applied: boolean[] = [];

  constructor(private enabled: boolean) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  apply(openAtLogin: boolean): void {
    this.applied.push(openAtLogin);
    this.enabled = openAtLogin;
  }
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-login-item-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function settings(launchAtLogin: boolean): Promise<SettingsStore> {
  const store = new SettingsStore(join(dir, 'settings.json'), new RecordingLogger());
  await store.load();
  await store.update({ launchAtLogin });
  return store;
}

describe('syncLoginItem', () => {
  it('never removes an existing login item at startup', async () => {
    const items = new SystemLoginItems(true);

    syncLoginItem(await settings(false), items, new RecordingLogger());

    expect(items.applied).toEqual([]);
  });

  it('adds the login item at startup when the setting asks for it and the system has none', async () => {
    const items = new SystemLoginItems(false);

    syncLoginItem(await settings(true), items, new RecordingLogger());

    expect(items.applied).toEqual([true]);
  });

  it('writes only when the setting changes and differs from the system', async () => {
    const store = await settings(false);
    const items = new SystemLoginItems(false);
    const stop = syncLoginItem(store, items, new RecordingLogger());

    await store.update({ launchAtLogin: true });
    await store.update({ mode: 'toggle' });
    await store.update({ launchAtLogin: false });
    await store.update({ launchAtLogin: true });
    expect(items.applied.splice(0)).toEqual([true, false, true]);
    items.apply(false);
    items.applied.splice(0);
    await store.update({ launchAtLogin: false });
    stop();
    await store.update({ launchAtLogin: true });

    expect(items.applied).toEqual([]);
  });

  it('logs when the system refuses the change', async () => {
    const store = await settings(false);
    const logger = new RecordingLogger();
    const refusing: LoginItem = {
      isEnabled: () => false,
      apply: () => {
        throw new Error('denied');
      },
    };

    syncLoginItem(store, refusing, logger);
    await store.update({ launchAtLogin: true });

    expect(logger.errors).toHaveLength(1);
  });
});

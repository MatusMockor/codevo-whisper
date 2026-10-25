import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { HotkeyService } from '../src/main/hotkey/hotkey-service';
import { rearmHotkeyOnGrant } from '../src/main/hotkey/rearm-on-grant';
import { MACOS_PERMISSION_LINKS } from '../src/main/permissions/macos-permission-links';
import { PermissionsService } from '../src/main/permissions/permissions-service';
import { SettingsStore } from '../src/main/settings/settings-store';
import { FakePowerEvents } from './fake-power-events';
import { RecordingLogger } from './recording-logger';

const RIGHT_CONTROL = { keycode: 62, label: 'Pravý ⌃ Control' } as const;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-rearm-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function harness() {
  const logger = new RecordingLogger();
  const settings = new SettingsStore(join(dir, 'settings.json'), logger);
  await settings.load();
  await settings.update({ hotkey: RIGHT_CONTROL });
  const helper = new FakeInputHelper({ permissions: { listen: false, post: true, accessibility: true } });
  const hotkey = new HotkeyService(helper, settings, new FakePowerEvents(), undefined, logger);
  const permissions = new PermissionsService({
    helper,
    microphone: { status: () => 'granted', ask: () => Promise.resolve(true) },
    links: MACOS_PERMISSION_LINKS,
    openUrl: () => Promise.resolve(),
    logger,
  });
  const starts: string[] = [];
  hotkey.onStart(() => starts.push('start'));
  return { helper, hotkey, permissions, logger, starts };
}

describe('rearmHotkeyOnGrant', () => {
  it('starts the idle hotkey once Input Monitoring is granted without a relaunch', async () => {
    const { helper, hotkey, permissions } = await harness();
    rearmHotkeyOnGrant(permissions, hotkey, new RecordingLogger());
    await hotkey.start();
    await permissions.status();
    expect(hotkey.isArmed()).toBe(false);
    expect(helper.listening).toEqual([]);

    helper.permissionState = { listen: true, post: true, accessibility: true };
    await permissions.status();

    await expect.poll(() => helper.listening).toEqual([62]);
    expect(hotkey.isArmed()).toBe(true);
  });

  it('arms the hotkey when the first read already reports the grant', async () => {
    const { helper, hotkey, permissions, starts } = await harness();
    rearmHotkeyOnGrant(permissions, hotkey, new RecordingLogger());
    await hotkey.start();
    helper.permissionState = { listen: true, post: true, accessibility: true };

    await permissions.status();

    await expect.poll(() => hotkey.isArmed()).toBe(true);
    helper.pressKey('down', 62);
    expect(starts).toEqual(['start']);
  });

  it('leaves an armed hotkey alone and stops after unsubscribing', async () => {
    const { helper, hotkey, permissions } = await harness();
    helper.permissionState = { listen: true, post: true, accessibility: true };
    await hotkey.start();
    let starts = 0;
    const counted = { start: () => ((starts += 1), hotkey.start()), isArmed: () => hotkey.isArmed() };
    const stop = rearmHotkeyOnGrant(permissions, counted, new RecordingLogger());

    await permissions.status();
    helper.permissionState = { listen: false, post: true, accessibility: true };
    await permissions.status();
    stop();
    helper.permissionState = { listen: true, post: true, accessibility: true };
    await permissions.status();

    expect(starts).toBe(0);
  });
});

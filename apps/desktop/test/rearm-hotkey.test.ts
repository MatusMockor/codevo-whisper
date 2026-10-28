import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { HotkeyService } from '../src/main/hotkey/hotkey-service';
import { HotkeyRearm } from '../src/main/hotkey/rearm-on-grant';
import { AskedPermissionsStore } from '../src/main/permissions/asked-permissions-store';
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
    asked: new AskedPermissionsStore(join(dir, 'asked-permissions.json'), logger),
    logger,
  });
  const starts: string[] = [];
  hotkey.onStart(() => starts.push('start'));
  return { helper, hotkey, permissions, logger, starts };
}

describe('HotkeyRearm', () => {
  it('starts the idle hotkey once Input Monitoring is granted without a relaunch', async () => {
    const { helper, hotkey, permissions } = await harness();
    new HotkeyRearm(permissions, hotkey, new RecordingLogger());
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
    new HotkeyRearm(permissions, hotkey, new RecordingLogger());
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
    const rearm = new HotkeyRearm(permissions, counted, new RecordingLogger());

    await permissions.status();
    helper.permissionState = { listen: false, post: true, accessibility: true };
    await permissions.status();
    rearm.dispose();
    helper.permissionState = { listen: true, post: true, accessibility: true };
    await permissions.status();

    expect(starts).toBe(0);
  });

  it('stays unarmed when listening fails after the grant and retries on the next permission read', async () => {
    const { helper, hotkey, permissions } = await harness();
    const logger = new RecordingLogger();
    let now = 0;
    const rearm = new HotkeyRearm(permissions, hotkey, logger, () => now);
    await hotkey.start();
    helper.permissionState = { listen: true, post: true, accessibility: true };
    helper.listenFails = true;

    await permissions.status();
    await rearm.settled();
    expect(logger.errors).toHaveLength(1);
    expect(hotkey.isArmed()).toBe(false);

    helper.listenFails = false;
    now = 10_000;
    await permissions.status();
    await rearm.settled();

    await expect.poll(() => hotkey.isArmed()).toBe(true);
    expect(helper.listening).toEqual([62]);
  });

  it('backs off between failed attempts and logs once per failure streak', async () => {
    const { helper, hotkey, permissions } = await harness();
    await hotkey.start();
    helper.permissionState = { listen: true, post: true, accessibility: true };
    helper.listenFails = true;
    let now = 0;
    let attempts = 0;
    const counted = { start: () => ((attempts += 1), hotkey.start()), isArmed: () => hotkey.isArmed() };
    const logger = new RecordingLogger();
    const rearm = new HotkeyRearm(permissions, counted, logger, () => now);
    const readAt = async (time: number): Promise<void> => {
      now = time;
      await permissions.status();
      await rearm.settled();
    };

    for (const time of [0, 500, 1000, 2500, 3000, 6000]) {
      await readAt(time);
    }
    expect(attempts).toBe(3);
    expect(logger.errors).toHaveLength(1);

    helper.listenFails = false;
    await readAt(7000);
    expect(attempts).toBe(4);
    expect(hotkey.isArmed()).toBe(true);
  });

  it('settles after the start that a permission read triggered', async () => {
    const { helper, hotkey, permissions } = await harness();
    const rearm = new HotkeyRearm(permissions, hotkey, new RecordingLogger());
    await hotkey.start();
    helper.permissionState = { listen: true, post: true, accessibility: true };

    await permissions.status();
    await rearm.settled();

    expect(hotkey.isArmed()).toBe(true);
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import type { Permissions } from '../src/main/helper/input-helper';
import { AskedPermissionsStore } from '../src/main/permissions/asked-permissions-store';
import { MACOS_PERMISSION_LINKS } from '../src/main/permissions/macos-permission-links';
import { PermissionsService, type MicrophoneAccess } from '../src/main/permissions/permissions-service';
import type { PermissionsStatus } from '../src/shared/permissions';
import { RecordingLogger } from './recording-logger';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-permissions-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

class UnavailableHelper extends FakeInputHelper {
  override permissions(): Promise<Permissions> {
    return Promise.reject(new Error('helper is not running'));
  }

  override requestPermission(): Promise<void> {
    return Promise.reject(new Error('helper is not running'));
  }
}

class SystemMicrophone implements MicrophoneAccess {
  asked = 0;

  constructor(public mediaStatus: string) {}

  status(): string {
    return this.mediaStatus;
  }

  ask(): Promise<boolean> {
    this.asked += 1;
    this.mediaStatus = 'granted';
    return Promise.resolve(true);
  }
}

function service(helper: FakeInputHelper, microphone = new SystemMicrophone('granted'), inputReady?: Promise<void>) {
  const opened: string[] = [];
  const logger = new RecordingLogger();
  const permissions = new PermissionsService({
    helper,
    microphone,
    links: MACOS_PERMISSION_LINKS,
    openUrl: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    asked: new AskedPermissionsStore(join(dir, 'asked-permissions.json'), logger),
    logger,
    inputReady,
  });
  return { permissions, opened, logger, microphone };
}

describe('PermissionsService', () => {
  it('maps the helper permissions and the media access status', async () => {
    const helper = new FakeInputHelper({ permissions: { listen: true, post: false, accessibility: false } });
    const microphone = new SystemMicrophone('granted');
    const { permissions } = service(helper, microphone);

    expect(await permissions.status()).toEqual({ microphone: 'granted', inputMonitoring: true, accessibility: false });

    helper.permissionState = { listen: false, post: true, accessibility: true };
    for (const [mediaStatus, expected] of [
      ['denied', 'denied'],
      ['restricted', 'denied'],
      ['not-determined', 'not-determined'],
      ['unknown', 'not-determined'],
    ] as const) {
      microphone.mediaStatus = mediaStatus;
      expect(await permissions.status()).toEqual({ microphone: expected, inputMonitoring: false, accessibility: true });
    }
  });

  it('waits until the input helper has started before reading permissions', async () => {
    const started = Promise.withResolvers<void>();
    const { permissions } = service(new UnavailableHelper(), new SystemMicrophone('granted'), started.promise);
    let settled = false;

    const status = permissions.status().finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);

    started.resolve();
    await expect(status).resolves.toEqual({ microphone: 'granted', inputMonitoring: false, accessibility: false });
  });

  it('treats an unavailable helper as missing permissions and logs it', async () => {
    const { permissions, logger } = service(new UnavailableHelper());

    expect(await permissions.status()).toEqual({ microphone: 'granted', inputMonitoring: false, accessibility: false });
    expect(logger.errors).toHaveLength(1);
  });

  it('requests the microphone from the system and input permissions from the helper', async () => {
    const helper = new FakeInputHelper();
    const microphone = new SystemMicrophone('not-determined');
    const { permissions } = service(helper, microphone);

    await permissions.request('microphone');
    await permissions.request('input-monitoring');
    await permissions.request('accessibility');

    expect(microphone.asked).toBe(1);
    expect(helper.requestedPermissions).toEqual(['listen', 'accessibility']);
    expect((await permissions.status()).microphone).toBe('granted');
  });

  it('remembers which input permissions it has asked for across instances', async () => {
    const helper = new FakeInputHelper();
    const { permissions } = service(helper, new SystemMicrophone('not-determined'));

    expect(await permissions.asked()).toEqual([]);
    await permissions.request('microphone');
    await permissions.request('accessibility');
    expect(await permissions.asked()).toEqual(['accessibility']);

    await permissions.request('input-monitoring');
    await permissions.request('accessibility');

    expect(await permissions.asked()).toEqual(['input-monitoring', 'accessibility']);
    expect(await service(new FakeInputHelper()).permissions.asked()).toEqual(['input-monitoring', 'accessibility']);
  });

  it('does not remember a request the helper failed to make', async () => {
    const { permissions } = service(new UnavailableHelper());

    await expect(permissions.request('input-monitoring')).rejects.toThrow('helper is not running');

    expect(await permissions.asked()).toEqual([]);
  });

  it('opens the System Settings pane of each permission', async () => {
    const { permissions, opened } = service(new FakeInputHelper());

    await permissions.openSettings('input-monitoring');
    await permissions.openSettings('accessibility');
    await permissions.openSettings('microphone');

    expect(opened).toEqual([
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    ]);
  });

  it('notifies about changed permissions with the previous status', async () => {
    const helper = new FakeInputHelper({ permissions: { listen: false, post: true, accessibility: true } });
    const { permissions } = service(helper);
    const changes: Array<{ next: PermissionsStatus; previous: PermissionsStatus | null }> = [];
    permissions.onChange((next, previous) => changes.push({ next, previous }));

    await permissions.status();
    await permissions.status();
    helper.permissionState = { listen: true, post: true, accessibility: true };
    await permissions.status();

    expect(changes).toEqual([
      { next: { microphone: 'granted', inputMonitoring: false, accessibility: true }, previous: null },
      { next: { microphone: 'granted', inputMonitoring: true, accessibility: true }, previous: { microphone: 'granted', inputMonitoring: false, accessibility: true } },
    ]);
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { KeyRecorder } from '../src/main/hotkey/key-recorder';
import { permissionHandlers } from '../src/main/ipc/permission-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import { AskedPermissionsStore } from '../src/main/permissions/asked-permissions-store';
import { MACOS_PERMISSION_LINKS } from '../src/main/permissions/macos-permission-links';
import { PermissionsService } from '../src/main/permissions/permissions-service';
import { AppReveal } from '../src/main/system/app-reveal';
import { RecordingDesktopShell } from '../src/main/system/desktop-shell';
import { RecordingLogger } from './recording-logger';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-permission-handlers-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function harness(platform: NodeJS.Platform = 'darwin') {
  const helper = new FakeInputHelper({ permissions: { listen: false, post: true, accessibility: false } });
  const shell = new RecordingDesktopShell();
  const logger = new RecordingLogger();
  const permissions = new PermissionsService({
    helper,
    microphone: { status: () => 'granted', ask: () => Promise.resolve(true) },
    links: MACOS_PERMISSION_LINKS,
    openUrl: (url) => shell.openExternal(url),
    asked: new AskedPermissionsStore(join(dir, 'asked-permissions.json'), logger),
    logger,
  });
  const handlers = permissionHandlers({
    permissions,
    appReveal: new AppReveal({ platform, executablePath: '/Applications/Codevo Whisper.app/Contents/MacOS/Codevo Whisper', shell }),
    recorder: new KeyRecorder(helper, { cancel: () => undefined }),
    hotkey: { isArmed: () => Promise.resolve(false) },
    relaunch: () => Promise.resolve(),
  });
  return { helper, shell, handlers };
}

describe('permissionHandlers', () => {
  it('reports the asked input permissions after a request without opening System Settings', async () => {
    const { helper, shell, handlers } = harness();

    expect(await handlers.getPermissionGuide()).toEqual({ asked: [], canRevealApp: true });
    await handlers.requestPermission('input-monitoring');

    expect(helper.requestedPermissions).toEqual(['listen']);
    expect(shell.opened).toEqual([]);
    expect(await handlers.getPermissionGuide()).toEqual({ asked: ['input-monitoring'], canRevealApp: true });

    await handlers.openPermissionSettings('input-monitoring');
    expect(shell.opened).toEqual(['x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent']);
    expect(helper.requestedPermissions).toEqual(['listen']);
  });

  it('reveals the app bundle in Finder', async () => {
    const { shell, handlers } = harness();

    await handlers.revealAppInFinder();

    expect(shell.revealed).toEqual(['/Applications/Codevo Whisper.app']);
  });

  it('offers no Finder reveal outside macOS', async () => {
    const { shell, handlers } = harness('linux');

    expect(await handlers.getPermissionGuide()).toEqual({ asked: [], canRevealApp: false });
    await handlers.revealAppInFinder();

    expect(shell.revealed).toEqual([]);
  });

  it('rejects invalid permission kinds and unexpected arguments', async () => {
    const { helper, shell, handlers } = harness();

    expect(() => handlers.requestPermission('camera')).toThrow(IpcValidationError);
    expect(() => handlers.openPermissionSettings('screen')).toThrow(IpcValidationError);
    await expect(handlers.getPermissionGuide('input-monitoring')).rejects.toThrow(IpcValidationError);
    await expect(handlers.revealAppInFinder('/etc/passwd')).rejects.toThrow(IpcValidationError);

    expect(helper.requestedPermissions).toEqual([]);
    expect(shell.opened).toEqual([]);
    expect(shell.revealed).toEqual([]);
  });
});

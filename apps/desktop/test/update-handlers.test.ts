import { describe, expect, it } from 'vitest';
import { updateHandlers } from '../src/main/ipc/update-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import { FakeAppUpdater } from '../src/main/updates/fake-app-updater';
import { UpdateService } from '../src/main/updates/update-service';
import { RELEASES_URL } from '../src/shared/updates';
import { RecordingLogger } from './recording-logger';

function harness() {
  const updater = new FakeAppUpdater();
  const updates = new UpdateService({
    updater,
    mode: 'in-app',
    currentVersion: '1.1.0',
    dictation: { isDictating: () => false, suspend: () => Promise.resolve(() => undefined) },
    logger: new RecordingLogger(),
  });
  const opened: string[] = [];
  const handlers = updateHandlers({
    updates,
    openUpdateUrl: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
  });
  return { updater, handlers, opened };
}

describe('updateHandlers', () => {
  it('reads the status, checks, installs and opens the release page', async () => {
    const { updater, handlers, opened } = harness();
    updater.latest = '1.2.0';

    expect(await handlers.getUpdateStatus()).toEqual({ currentVersion: '1.1.0', mode: 'in-app', phase: { kind: 'idle', checked: false } });
    expect((await handlers.checkForUpdates()).phase).toEqual({ kind: 'ready', version: '1.2.0' });
    expect(await handlers.installUpdate()).toBe('restarting');
    await handlers.openUpdateDownload();

    expect(updater.installs).toBe(1);
    expect(opened).toEqual([RELEASES_URL]);
  });

  it('rejects calls with arguments', async () => {
    const { updater, handlers, opened } = harness();
    updater.latest = '1.2.0';

    await expect(handlers.getUpdateStatus('x')).rejects.toThrow(IpcValidationError);
    await expect(handlers.checkForUpdates({ force: true })).rejects.toThrow(IpcValidationError);
    await expect(handlers.installUpdate(true)).rejects.toThrow(IpcValidationError);
    await expect(handlers.openUpdateDownload('https://example.com/evil.dmg')).rejects.toThrow(IpcValidationError);

    expect(updater.checks).toBe(0);
    expect(updater.installs).toBe(0);
    expect(opened).toEqual([]);
  });
});

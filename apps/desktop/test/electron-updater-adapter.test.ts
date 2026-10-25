import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { ElectronUpdaterAdapter, type UpdaterLike, type UpdaterLogger } from '../src/main/updates/electron-updater-adapter';
import { RecordingLogger } from './recording-logger';

type CheckResult = Awaited<ReturnType<UpdaterLike['checkForUpdates']>>;

class StandInUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  logger: UpdaterLogger | null = null;
  result: CheckResult = null;
  progress: number[] = [];
  readonly installs: Array<[boolean | undefined, boolean | undefined]> = [];

  checkForUpdates(): Promise<CheckResult> {
    return Promise.resolve(this.result);
  }

  downloadUpdate(): Promise<string[]> {
    for (const percent of this.progress) {
      this.emit('download-progress', { percent });
    }
    return Promise.resolve(['/tmp/update.zip']);
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installs.push([isSilent, isForceRunAfter]);
  }
}

function harness() {
  const updater = new StandInUpdater();
  const logger = new RecordingLogger();
  const adapter = new ElectronUpdaterAdapter(updater, logger);
  return { updater, logger, adapter };
}

describe('ElectronUpdaterAdapter', () => {
  it('never downloads, installs on quit or downgrades by itself', () => {
    const { updater } = harness();

    expect({ autoDownload: updater.autoDownload, autoInstallOnAppQuit: updater.autoInstallOnAppQuit, allowDowngrade: updater.allowDowngrade }).toEqual({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
    });
  });

  it('routes the updater log to the app logger', () => {
    const { updater, logger } = harness();

    updater.logger?.info('Checking for update');
    updater.logger?.warn('cannot end response');
    updater.logger?.error('Error: net::ERR_INTERNET_DISCONNECTED');

    expect(logger.infos.map((entry) => entry.message)).toEqual(['electron-updater: Checking for update', 'electron-updater: cannot end response']);
    expect(logger.errors).toEqual([{ message: 'electron-updater reported an error', error: 'Error: net::ERR_INTERNET_DISCONNECTED' }]);
  });

  it('maps the check result to the available version', async () => {
    const { updater, adapter } = harness();

    expect(await adapter.check()).toBeNull();
    updater.result = { isUpdateAvailable: false, updateInfo: { version: '1.1.0' } };
    expect(await adapter.check()).toBeNull();
    updater.result = { isUpdateAvailable: true, updateInfo: { version: '1.2.0' } };
    expect(await adapter.check()).toEqual({ version: '1.2.0' });
  });

  it('forwards the download progress only while downloading', async () => {
    const { updater, adapter } = harness();
    updater.progress = [12.5, 80];
    const seen: number[] = [];

    await adapter.download((percent) => seen.push(percent));
    updater.emit('download-progress', { percent: 99 });

    expect(seen).toEqual([12.5, 80]);
    expect(updater.listenerCount('download-progress')).toBe(0);
  });

  it('quits and relaunches into the update and rejects when the install fails', async () => {
    const { updater, adapter } = harness();

    const installing = adapter.install();
    updater.emit('error', new Error('Code signature did not pass validation'));

    await expect(installing).rejects.toThrow('Code signature did not pass validation');
    expect(updater.installs).toEqual([[false, true]]);
  });

  it('logs an updater error that no call is waiting for instead of throwing', () => {
    const { updater, logger } = harness();
    const error = new Error('Squirrel failed');

    expect(() => updater.emit('error', error)).not.toThrow();
    expect(logger.errors).toEqual([{ message: 'electron-updater emitted an error', error }]);
  });
});

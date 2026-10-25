import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ElectronUpdaterAdapter, type AdapterOptions, type UpdaterLike, type UpdaterLogger } from '../src/main/updates/electron-updater-adapter';
import { RecordingLogger } from './recording-logger';

type CheckResult = Awaited<ReturnType<UpdaterLike['checkForUpdates']>>;

const ZIP_NAME = 'codevo-whisper-1.2.0-arm64-mac.zip';
const ZIP_BODY = 'PK signed update';

class StandInToken {
  cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }
}

class StandInUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  logger: UpdaterLogger | null = null;
  result: CheckResult = null;
  checkHangs = false;
  downloadHangs = false;
  downloadedFile: string | null = null;
  progress: number[] = [];
  readonly tokens: unknown[] = [];
  readonly installs: Array<[boolean | undefined, boolean | undefined]> = [];

  checkForUpdates(): Promise<CheckResult> {
    if (this.checkHangs) {
      return new Promise(() => undefined);
    }
    return Promise.resolve(this.result);
  }

  downloadUpdate(cancellationToken?: StandInToken): Promise<string[]> {
    this.tokens.push(cancellationToken);
    if (this.downloadHangs) {
      return new Promise(() => undefined);
    }
    for (const percent of this.progress) {
      this.emit('download-progress', { percent });
    }
    if (this.downloadedFile !== null) {
      this.emit('update-downloaded', { version: '1.2.0', downloadedFile: this.downloadedFile });
    }
    return Promise.resolve([]);
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installs.push([isSilent, isForceRunAfter]);
  }
}

let scratch: string;
let zipFile: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-adapter-'));
  await mkdir(join(scratch, 'cache', 'pending'), { recursive: true });
  zipFile = join(scratch, 'cache', 'pending', ZIP_NAME);
  await writeFile(zipFile, ZIP_BODY);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function offered(sha512 = createHash('sha512').update(ZIP_BODY).digest('base64')): CheckResult {
  return {
    isUpdateAvailable: true,
    updateInfo: { version: '1.2.0', files: [{ url: 'codevo-whisper-1.2.0-x64-mac.zip', sha512: 'x64' }, { url: ZIP_NAME, sha512 }] },
  };
}

function harness(options: Partial<AdapterOptions> = {}) {
  const updater = new StandInUpdater();
  const logger = new RecordingLogger();
  const adapter = new ElectronUpdaterAdapter(updater, logger, { installable: true, createCancellationToken: () => new StandInToken(), ...options });
  return { updater, logger, adapter };
}

async function downloaded(options: Partial<AdapterOptions> = {}) {
  const parts = harness(options);
  parts.updater.result = offered();
  parts.updater.downloadedFile = zipFile;
  await parts.adapter.check();
  await parts.adapter.download(() => undefined);
  return parts;
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

  it('routes the updater log by level and keeps internal errors at warning level', () => {
    const { updater, logger } = harness();

    updater.logger?.info('Checking for update');
    updater.logger?.warn('cannot end response');
    updater.logger?.error('Error: net::ERR_INTERNET_DISCONNECTED');

    expect(logger.infos.map((entry) => entry.message)).toEqual(['electron-updater: Checking for update']);
    expect(logger.warns).toEqual([
      { message: 'electron-updater: cannot end response', detail: null },
      { message: 'electron-updater reported an error', detail: 'Error: net::ERR_INTERNET_DISCONNECTED' },
    ]);
    expect(logger.errors).toEqual([]);
  });

  it('maps the check result to the available version', async () => {
    const { updater, adapter } = harness();

    expect(await adapter.check()).toBeNull();
    updater.result = { isUpdateAvailable: false, updateInfo: { version: '1.1.0', files: [] } };
    expect(await adapter.check()).toBeNull();
    updater.result = offered();
    expect(await adapter.check()).toEqual({ version: '1.2.0' });
  });

  it('gives up on a check that does not answer in time', async () => {
    const { updater, adapter } = harness({ checkTimeoutMs: 20 });
    updater.checkHangs = true;

    await expect(adapter.check()).rejects.toThrow('The update check timed out');
  });

  it('forwards the download progress only while downloading and passes a cancellation token', async () => {
    const { updater, adapter } = harness();
    updater.result = offered();
    updater.downloadedFile = zipFile;
    updater.progress = [12.5, 80];
    const seen: number[] = [];
    await adapter.check();

    await adapter.download((percent) => seen.push(percent));
    updater.emit('download-progress', { percent: 99 });

    expect(seen).toEqual([12.5, 80]);
    expect(updater.listenerCount('download-progress')).toBe(0);
    expect(updater.listenerCount('update-downloaded')).toBe(0);
    expect(updater.tokens).toEqual([new StandInToken()]);
  });

  it('cancels a download that does not finish in time', async () => {
    const { updater, adapter } = harness({ downloadTimeoutMs: 20 });
    updater.result = offered();
    updater.downloadHangs = true;
    await adapter.check();

    await expect(adapter.download(() => undefined)).rejects.toThrow('The update download timed out');
    expect(updater.tokens).toEqual([Object.assign(new StandInToken(), { cancelled: true })]);
  });

  it('rejects a download whose file is not in the offered update', async () => {
    const { updater, adapter } = harness();
    updater.result = offered();
    updater.downloadedFile = join(scratch, 'cache', 'pending', 'other.zip');
    await adapter.check();

    await expect(adapter.download(() => undefined)).rejects.toThrow('The downloaded update is not part of the offered release');
  });

  it('re-verifies the downloaded file, then quits and relaunches into the update', async () => {
    const { updater, adapter } = await downloaded();

    void adapter.install();

    await expect.poll(() => updater.installs).toEqual([[false, true]]);
  });

  it('does not install a file that changed after the download', async () => {
    const { updater, adapter } = await downloaded();
    await writeFile(zipFile, 'PK swapped');

    await expect(adapter.install()).rejects.toThrow('The downloaded update does not match its sha512');
    expect(updater.installs).toEqual([]);
  });

  it('refuses to install before a download', async () => {
    const { updater, adapter } = harness();

    await expect(adapter.install()).rejects.toThrow('No downloaded update to install');
    expect(updater.installs).toEqual([]);
  });

  it('rejects the install on the next updater error, without a timeout, and does not pile up listeners', async () => {
    const { updater, adapter, logger } = await downloaded();
    const baseline = updater.listenerCount('error');

    for (const attempt of [1, 2, 3]) {
      const installing = adapter.install();
      await expect.poll(() => updater.installs.length).toBe(attempt);
      updater.emit('error', new Error(`Code signature did not pass validation ${attempt}`));
      await expect(installing).rejects.toThrow(`Code signature did not pass validation ${attempt}`);
      expect(updater.listenerCount('error')).toBe(baseline);
    }
    expect(logger.errors).toEqual([]);
  });

  it('refuses download and install for a package that updates manually', async () => {
    const { updater, adapter } = harness({ installable: false });
    updater.result = offered();
    updater.downloadedFile = zipFile;

    expect(await adapter.check()).toEqual({ version: '1.2.0' });
    await expect(adapter.download(() => undefined)).rejects.toThrow('This package is updated manually');
    await expect(adapter.install()).rejects.toThrow('This package is updated manually');
    expect(updater.tokens).toEqual([]);
    expect(updater.installs).toEqual([]);
  });

  it('logs an updater error once: only when no call is waiting for it', () => {
    const { updater, adapter, logger } = harness();
    const error = new Error('Squirrel failed');
    updater.checkHangs = true;
    const checking = adapter.check();

    updater.emit('error', new Error('reported through the check'));
    expect(logger.errors).toEqual([]);
    expect(() => updater.emit('error', error)).not.toThrow();
    expect(logger.errors).toEqual([]);
    void checking;

    const idle = harness();
    idle.updater.emit('error', error);
    expect(idle.logger.errors).toEqual([{ message: 'electron-updater emitted an error', error }]);
  });
});

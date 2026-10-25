import { basename } from 'node:path';
import type { Logger } from '../logging/logger';
import type { AppUpdater, AvailableUpdate } from './app-updater';
import { withDeadline } from './deadline';
import { verifyDownload } from './verify-download';

export type UpdaterLogger = {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
};

export type CancellationTokenLike = { cancel(): void };

type UpdateFile = { readonly url: string; readonly sha512: string };

type UpdateInfo = { readonly version: string; readonly files: readonly UpdateFile[] };

type CheckResult = { readonly isUpdateAvailable: boolean; readonly updateInfo: UpdateInfo };

type ProgressListener = (info: { percent: number }) => void;

type DownloadedListener = (event: { downloadedFile: string }) => void;

type ErrorListener = (error: Error) => void;

export type UpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  logger: UpdaterLogger | null;
  checkForUpdates(): Promise<CheckResult | null>;
  downloadUpdate(cancellationToken?: CancellationTokenLike): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'error', listener: ErrorListener): unknown;
  on(event: 'download-progress', listener: ProgressListener): unknown;
  on(event: 'update-downloaded', listener: DownloadedListener): unknown;
  removeListener(event: 'error', listener: ErrorListener): unknown;
  removeListener(event: 'download-progress', listener: ProgressListener): unknown;
  removeListener(event: 'update-downloaded', listener: DownloadedListener): unknown;
};

export type AdapterOptions = {
  installable: boolean;
  createCancellationToken: () => CancellationTokenLike;
  checkTimeoutMs?: number;
  downloadTimeoutMs?: number;
};

type DownloadedUpdate = { file: string; sha512: string };

const LOG_PREFIX = 'electron-updater';

const CHECK_TIMEOUT_MS = 60_000;

const DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000;

function fileName(url: string): string {
  return basename(decodeURIComponent(new URL(url, 'https://feed.invalid/').pathname));
}

function manualOnly(): Promise<never> {
  return Promise.reject(new Error('This package is updated manually'));
}

export class ElectronUpdaterAdapter implements AppUpdater {
  private pending = 0;
  private offered: UpdateInfo | null = null;
  private downloaded: DownloadedUpdate | null = null;

  constructor(
    private readonly updater: UpdaterLike,
    private readonly logger: Logger,
    private readonly options: AdapterOptions,
  ) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.logger = this.updaterLogger();
    updater.on('error', (error) => this.unclaimedError(error));
  }

  check(): Promise<AvailableUpdate | null> {
    return this.tracked(async () => {
      const result = await withDeadline(this.updater.checkForUpdates(), this.options.checkTimeoutMs ?? CHECK_TIMEOUT_MS, 'The update check timed out');
      if (result === null || !result.isUpdateAvailable) {
        this.offered = null;
        return null;
      }
      this.offered = result.updateInfo;
      return { version: result.updateInfo.version };
    });
  }

  download(onProgress: (percent: number) => void): Promise<void> {
    if (!this.options.installable) {
      return manualOnly();
    }
    return this.tracked(async () => {
      const token = this.options.createCancellationToken();
      const files: string[] = [];
      const progress: ProgressListener = (info) => onProgress(info.percent);
      const done: DownloadedListener = (event) => files.push(event.downloadedFile);
      this.updater.on('download-progress', progress);
      this.updater.on('update-downloaded', done);
      try {
        this.downloaded = null;
        const timeoutMs = this.options.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS;
        await withDeadline(this.updater.downloadUpdate(token), timeoutMs, 'The update download timed out', () => token.cancel());
        this.downloaded = this.offeredFile(files.at(-1));
      } finally {
        this.updater.removeListener('download-progress', progress);
        this.updater.removeListener('update-downloaded', done);
      }
    });
  }

  install(): Promise<void> {
    if (!this.options.installable) {
      return manualOnly();
    }
    const downloaded = this.downloaded;
    if (downloaded === null) {
      return Promise.reject(new Error('No downloaded update to install'));
    }
    return this.tracked(async () => {
      await verifyDownload(downloaded.file, downloaded.sha512);
      await new Promise<void>((_resolve, reject) => {
        const fail: ErrorListener = (error) => {
          this.updater.removeListener('error', fail);
          reject(error);
        };
        this.updater.on('error', fail);
        this.updater.quitAndInstall(false, true);
      });
    });
  }

  private offeredFile(file: string | undefined): DownloadedUpdate {
    const entry = file === undefined ? undefined : this.offered?.files.find((candidate) => fileName(candidate.url) === basename(file));
    if (file === undefined || entry === undefined) {
      throw new Error('The downloaded update is not part of the offered release');
    }
    return { file, sha512: entry.sha512 };
  }

  private async tracked<T>(work: () => Promise<T>): Promise<T> {
    this.pending += 1;
    try {
      return await work();
    } finally {
      this.pending -= 1;
    }
  }

  private unclaimedError(error: Error): void {
    if (this.pending > 0) {
      return;
    }
    this.logger.error(`${LOG_PREFIX} emitted an error`, error);
  }

  private updaterLogger(): UpdaterLogger {
    return {
      info: (message) => this.logger.info(`${LOG_PREFIX}: ${String(message)}`, null),
      warn: (message) => this.logger.warn(`${LOG_PREFIX}: ${String(message)}`, null),
      error: (message) => this.logger.warn(`${LOG_PREFIX} reported an error`, message),
    };
  }
}

import type { Logger } from '../logging/logger';
import type { AppUpdater, AvailableUpdate } from './app-updater';

export type UpdaterLogger = {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
};

type CheckResult = { readonly isUpdateAvailable: boolean; readonly updateInfo: { readonly version: string } };

type ProgressListener = (info: { percent: number }) => void;

type ErrorListener = (error: Error) => void;

export type UpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  logger: UpdaterLogger | null;
  checkForUpdates(): Promise<CheckResult | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'error', listener: ErrorListener): unknown;
  on(event: 'download-progress', listener: ProgressListener): unknown;
  once(event: 'error', listener: ErrorListener): unknown;
  removeListener(event: 'download-progress', listener: ProgressListener): unknown;
};

const LOG_PREFIX = 'electron-updater';

function updaterLogger(logger: Logger): UpdaterLogger {
  return {
    info: (message) => logger.info(`${LOG_PREFIX}: ${String(message)}`, null),
    warn: (message) => logger.info(`${LOG_PREFIX}: ${String(message)}`, null),
    error: (message) => logger.error(`${LOG_PREFIX} reported an error`, message),
  };
}

export class ElectronUpdaterAdapter implements AppUpdater {
  constructor(
    private readonly updater: UpdaterLike,
    logger: Logger,
  ) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.logger = updaterLogger(logger);
    updater.on('error', (error) => logger.error(`${LOG_PREFIX} emitted an error`, error));
  }

  async check(): Promise<AvailableUpdate | null> {
    const result = await this.updater.checkForUpdates();
    if (result === null || !result.isUpdateAvailable) {
      return null;
    }
    return { version: result.updateInfo.version };
  }

  async download(onProgress: (percent: number) => void): Promise<void> {
    const listener: ProgressListener = (info) => onProgress(info.percent);
    this.updater.on('download-progress', listener);
    try {
      await this.updater.downloadUpdate();
    } finally {
      this.updater.removeListener('download-progress', listener);
    }
  }

  install(): Promise<void> {
    return new Promise((_resolve, reject) => {
      this.updater.once('error', reject);
      this.updater.quitAndInstall(false, true);
    });
  }
}

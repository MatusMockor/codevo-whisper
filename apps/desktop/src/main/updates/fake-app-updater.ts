import type { AppUpdater, AvailableUpdate } from './app-updater';

type HeldDownload = { onProgress: (percent: number) => void; resolve: () => void };

export class FakeAppUpdater implements AppUpdater {
  latest: string | null = null;
  checkFails = false;
  downloadFails = false;
  holdDownloads = false;
  checks = 0;
  downloads = 0;
  installs = 0;
  private held: HeldDownload[] = [];
  private installing: PromiseWithResolvers<void> | null = null;

  check(): Promise<AvailableUpdate | null> {
    this.checks += 1;
    if (this.checkFails) {
      return Promise.reject(new Error('The fake update check failed'));
    }
    return Promise.resolve(this.latest === null ? null : { version: this.latest });
  }

  download(onProgress: (percent: number) => void): Promise<void> {
    this.downloads += 1;
    if (this.downloadFails) {
      return Promise.reject(new Error('The fake update download failed'));
    }
    if (!this.holdDownloads) {
      onProgress(100);
      return Promise.resolve();
    }
    const pending = Promise.withResolvers<void>();
    this.held.push({ onProgress, resolve: pending.resolve });
    return pending.promise;
  }

  install(): Promise<void> {
    this.installs += 1;
    this.installing = Promise.withResolvers<void>();
    return this.installing.promise;
  }

  pendingDownloads(): number {
    return this.held.length;
  }

  reportProgress(percent: number): void {
    for (const download of this.held) {
      download.onProgress(percent);
    }
  }

  completeDownload(): void {
    for (const download of this.held.splice(0)) {
      download.resolve();
    }
  }

  failInstall(message: string): void {
    this.installing?.reject(new Error(message));
    this.installing = null;
  }
}

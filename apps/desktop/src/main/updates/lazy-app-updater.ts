import type { AppUpdater, AvailableUpdate } from './app-updater';

export class LazyAppUpdater implements AppUpdater {
  private loaded: Promise<AppUpdater> | null = null;

  constructor(private readonly load: () => Promise<AppUpdater>) {}

  check(): Promise<AvailableUpdate | null> {
    return this.updater().then((updater) => updater.check());
  }

  download(onProgress: (percent: number) => void): Promise<void> {
    return this.updater().then((updater) => updater.download(onProgress));
  }

  install(): Promise<void> {
    return this.updater().then((updater) => updater.install());
  }

  private updater(): Promise<AppUpdater> {
    this.loaded ??= this.load().catch((error: unknown) => {
      this.loaded = null;
      throw error;
    });
    return this.loaded;
  }
}

import { app } from 'electron';
import { homedir } from 'node:os';
import type { Logger } from '../logging/logger';
import type { AppUpdater } from '../updates/app-updater';
import type { DictationGuard } from '../updates/dictation-guard';
import { ElectronUpdaterAdapter, type UpdaterLike } from '../updates/electron-updater-adapter';
import { LazyAppUpdater } from '../updates/lazy-app-updater';
import { readPackageType } from '../updates/package-type';
import { PendingUpdatePruner } from '../updates/pending-update-pruner';
import { appCacheBase, AppUpdateConfigCacheLocator } from '../updates/update-cache-dir';
import { resolveUpdateMode } from '../updates/update-policy';
import { UpdateScheduler } from '../updates/update-scheduler';
import { UpdateService } from '../updates/update-service';
import type { UpdateMode, UpdateStatus } from '../../shared/updates';

export type UpdateWiringDeps = { e2e: boolean; dictation: DictationGuard; send: (status: UpdateStatus) => void; logger: Logger };

export type Updates = { service: UpdateService; fake: Promise<AppUpdater> | null; start(): void; dispose(): void };

type UpdaterChoice = { updater: AppUpdater; mode: UpdateMode; fake: Promise<AppUpdater> | null; scheduled: boolean };

const unavailable = (): Promise<never> => Promise.reject(new Error('Updates are not supported in this build'));

const UNAVAILABLE_UPDATER: AppUpdater = Object.freeze({ check: unavailable, download: unavailable, install: unavailable });

export async function loadAutoUpdater(): Promise<UpdaterLike> {
  const { autoUpdater } = await import('electron-updater');
  return autoUpdater;
}

async function loadAdapter(mode: UpdateMode, logger: Logger): Promise<AppUpdater> {
  const { autoUpdater, CancellationToken } = await import('electron-updater');
  return new ElectronUpdaterAdapter(autoUpdater, logger, { installable: mode === 'in-app', createCancellationToken: () => new CancellationToken() });
}

async function pruneInstalledUpdate(logger: Logger): Promise<void> {
  try {
    const base = appCacheBase({ platform: process.platform, home: homedir(), xdgCacheHome: process.env['XDG_CACHE_HOME'] });
    const locator = new AppUpdateConfigCacheLocator({ resourcesPath: process.resourcesPath, base });
    await new PendingUpdatePruner({ locator, currentVersion: app.getVersion(), logger }).prune();
  } catch (error) {
    logger.warn('The update cache could not be cleaned', error);
  }
}

function fakeUpdater(): UpdaterChoice {
  const fake = import('../updates/fake-app-updater').then(({ FakeAppUpdater }): AppUpdater => new FakeAppUpdater());
  const mode = process.env['CW_E2E_UPDATE_MODE'] === 'manual' ? 'manual' : 'in-app';
  return { updater: new LazyAppUpdater(() => fake), mode, fake, scheduled: false };
}

function electronUpdater(logger: Logger): UpdaterChoice {
  const mode = resolveUpdateMode({
    platform: process.platform,
    isPackaged: app.isPackaged,
    appImage: process.env['APPIMAGE'],
    packageType: readPackageType(process.resourcesPath),
  });
  if (mode === 'unsupported') {
    return { updater: UNAVAILABLE_UPDATER, mode, fake: null, scheduled: false };
  }
  const pruned = mode === 'in-app' ? pruneInstalledUpdate(logger) : Promise.resolve();
  return { updater: new LazyAppUpdater(() => pruned.then(() => loadAdapter(mode, logger))), mode, fake: null, scheduled: true };
}

export function createUpdates({ e2e, dictation, send, logger }: UpdateWiringDeps): Updates {
  const choice = e2e ? fakeUpdater() : electronUpdater(logger);
  const service = new UpdateService({ updater: choice.updater, mode: choice.mode, currentVersion: app.getVersion(), dictation, logger });
  const scheduler = new UpdateScheduler(() => service.checkInBackground(), logger);
  const unsubscribe = service.onChange(send);
  return {
    service,
    fake: choice.fake,
    start: () => {
      if (choice.scheduled) {
        scheduler.start();
      }
    },
    dispose: () => {
      unsubscribe();
      scheduler.dispose();
    },
  };
}

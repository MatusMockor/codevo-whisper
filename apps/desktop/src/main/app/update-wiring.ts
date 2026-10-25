import { app } from 'electron';
import type { Logger } from '../logging/logger';
import type { AppUpdater } from '../updates/app-updater';
import type { DictationGuard } from '../updates/dictation-guard';
import { ElectronUpdaterAdapter } from '../updates/electron-updater-adapter';
import { resolveUpdateMode } from '../updates/update-policy';
import { UpdateScheduler } from '../updates/update-scheduler';
import { UpdateService } from '../updates/update-service';
import type { UpdateMode, UpdateStatus } from '../../shared/updates';

export type UpdateWiringDeps = { e2e: boolean; dictation: DictationGuard; send: (status: UpdateStatus) => void; logger: Logger };

export type Updates = { service: UpdateService; fake: AppUpdater | null; start(): void; dispose(): void };

type UpdaterChoice = { updater: AppUpdater; mode: UpdateMode; fake: AppUpdater | null };

const unavailable = (): Promise<never> => Promise.reject(new Error('Updates are not supported in this build'));

const UNAVAILABLE_UPDATER: AppUpdater = Object.freeze({ check: unavailable, download: unavailable, install: unavailable });

async function fakeUpdater(): Promise<UpdaterChoice> {
  const { FakeAppUpdater } = await import('../updates/fake-app-updater');
  const fake = new FakeAppUpdater();
  return { updater: fake, fake, mode: process.env['CW_E2E_UPDATE_MODE'] === 'manual' ? 'manual' : 'in-app' };
}

async function electronUpdater(logger: Logger): Promise<UpdaterChoice> {
  const mode = resolveUpdateMode({ platform: process.platform, isPackaged: app.isPackaged, appImage: process.env['APPIMAGE'] });
  if (mode === 'unsupported') {
    return { updater: UNAVAILABLE_UPDATER, mode, fake: null };
  }
  const { autoUpdater } = await import('electron-updater');
  return { updater: new ElectronUpdaterAdapter(autoUpdater, logger), mode, fake: null };
}

export async function createUpdates({ e2e, dictation, send, logger }: UpdateWiringDeps): Promise<Updates> {
  const choice = e2e ? await fakeUpdater() : await electronUpdater(logger);
  const service = new UpdateService({ updater: choice.updater, mode: choice.mode, currentVersion: app.getVersion(), dictation, logger });
  const scheduler = new UpdateScheduler(() => service.checkInBackground(), logger);
  const unsubscribe = service.onChange(send);
  return {
    service,
    fake: choice.fake,
    start: () => scheduler.start(),
    dispose: () => {
      unsubscribe();
      scheduler.dispose();
    },
  };
}

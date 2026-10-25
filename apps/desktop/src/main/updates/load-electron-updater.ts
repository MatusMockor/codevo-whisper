import type { Logger } from '../logging/logger';
import type { AppUpdater } from './app-updater';
import { ElectronUpdaterAdapter, type UpdaterLike } from './electron-updater-adapter';

export async function loadElectronUpdater(load: () => Promise<UpdaterLike>, logger: Logger): Promise<AppUpdater | null> {
  try {
    return new ElectronUpdaterAdapter(await load(), logger);
  } catch (error) {
    logger.error('The updater could not be loaded', error);
    return null;
  }
}

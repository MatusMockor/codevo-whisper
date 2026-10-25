import { app } from 'electron';
import { APP_NAME, resolveUserDataDir } from './user-data-dir';

export function configureAppIdentity(): void {
  app.setName(APP_NAME);
  app.setPath(
    'userData',
    resolveUserDataDir({ isPackaged: app.isPackaged, appDataDir: app.getPath('appData'), override: process.env['CW_USER_DATA_DIR'] }),
  );
}

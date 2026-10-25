import { app } from 'electron';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';

export interface LoginItem {
  apply(openAtLogin: boolean): void;
}

export const electronLoginItem: LoginItem = {
  apply: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
};

export function unpackagedLoginItem(logger: Logger): LoginItem {
  return {
    apply: (openAtLogin) => logger.info('Launch at login applies only to the packaged app', { openAtLogin }),
  };
}

function applySafely(item: LoginItem, openAtLogin: boolean, logger: Logger): void {
  try {
    item.apply(openAtLogin);
  } catch (error) {
    logger.error('Launch at login could not be changed', error);
  }
}

export function syncLoginItem(settings: Pick<SettingsStore, 'get' | 'onChange'>, item: LoginItem, logger: Logger): () => void {
  applySafely(item, settings.get().launchAtLogin, logger);
  return settings.onChange((next, previous) => {
    if (next.launchAtLogin === previous.launchAtLogin) {
      return;
    }
    applySafely(item, next.launchAtLogin, logger);
  });
}

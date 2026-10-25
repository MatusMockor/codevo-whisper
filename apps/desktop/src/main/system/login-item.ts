import { app } from 'electron';
import type { Logger } from '../logging/logger';
import type { SettingsStore } from '../settings/settings-store';

export interface LoginItem {
  isEnabled(): boolean;
  apply(openAtLogin: boolean): void;
}

export const electronLoginItem: LoginItem = {
  isEnabled: () => app.getLoginItemSettings().openAtLogin,
  apply: (openAtLogin) => app.setLoginItemSettings({ openAtLogin }),
};

export function unpackagedLoginItem(logger: Logger): LoginItem {
  return {
    isEnabled: () => false,
    apply: (openAtLogin) => logger.info('Launch at login applies only to the packaged app', { openAtLogin }),
  };
}

function applyWhenDifferent(item: LoginItem, openAtLogin: boolean, logger: Logger): void {
  try {
    if (item.isEnabled() === openAtLogin) {
      return;
    }
    item.apply(openAtLogin);
  } catch (error) {
    logger.error('Launch at login could not be changed', error);
  }
}

export function syncLoginItem(settings: Pick<SettingsStore, 'get' | 'onChange'>, item: LoginItem, logger: Logger): () => void {
  if (settings.get().launchAtLogin) {
    applyWhenDifferent(item, true, logger);
  }
  return settings.onChange((next, previous) => {
    if (next.launchAtLogin === previous.launchAtLogin) {
      return;
    }
    applyWhenDifferent(item, next.launchAtLogin, logger);
  });
}

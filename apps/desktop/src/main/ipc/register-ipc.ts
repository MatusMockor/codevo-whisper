import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { INVOKE_CHANNELS, type IpcInvokeApi } from '../../shared/ipc-contract';
import type { SettingsStore } from '../settings/settings-store';
import type { RendererSource } from '../windows/renderer-source';
import { broadcast } from './broadcast';
import { isTrustedSenderUrl } from './trusted-sender';
import { IpcValidationError, validateSettingsPatch } from './validate';

export type IpcDependencies = { settings: SettingsStore; source: RendererSource };

type InvokeHandlers = { readonly [K in keyof IpcInvokeApi]: (...args: unknown[]) => ReturnType<IpcInvokeApi[K]> };

function invokeHandlers({ settings }: IpcDependencies): InvokeHandlers {
  return {
    getSettings: () => Promise.resolve(settings.get()),
    updateSettings: (patch) => settings.update(validateSettingsPatch(patch)),
  };
}

function assertTrustedSender(event: IpcMainInvokeEvent, source: RendererSource): void {
  if (isTrustedSenderUrl(event.senderFrame?.url, source)) {
    return;
  }
  throw new IpcValidationError('Untrusted IPC sender');
}

export function registerIpc(dependencies: IpcDependencies): void {
  const handlers = invokeHandlers(dependencies);
  for (const name of Object.keys(handlers) as Array<keyof IpcInvokeApi>) {
    ipcMain.handle(INVOKE_CHANNELS[name], (event, ...args: unknown[]) => {
      assertTrustedSender(event, dependencies.source);
      return handlers[name](...args);
    });
  }
  dependencies.settings.onChange((next) => {
    broadcast('settings-changed', next);
  });
}

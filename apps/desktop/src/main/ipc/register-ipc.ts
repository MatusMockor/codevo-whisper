import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { INVOKE_CHANNELS, type IpcInvokeApi } from '../../shared/ipc-contract';
import type { SettingsStore } from '../settings/settings-store';
import type { RendererSource } from '../windows/renderer-source';
import { broadcast } from './broadcast';
import { coreHandlers, type CoreHandlerDeps } from './core-handlers';
import type { InvokeHandlers } from './invoke-handlers';
import { microphoneHandlers, type MicrophoneHandlerDeps } from './microphone-handlers';
import { modelHandlers, type ModelHandlerDeps } from './model-handlers';
import { permissionHandlers, type PermissionHandlerDeps } from './permission-handlers';
import { isTrustedSenderUrl } from './trusted-sender';
import { IpcValidationError } from './validate';

export type IpcDependencies = CoreHandlerDeps &
  PermissionHandlerDeps &
  ModelHandlerDeps &
  MicrophoneHandlerDeps & {
    settings: Pick<SettingsStore, 'get' | 'update' | 'onChange'>;
    source: RendererSource;
  };

function invokeHandlers(dependencies: IpcDependencies): InvokeHandlers {
  return {
    ...coreHandlers(dependencies),
    ...permissionHandlers(dependencies),
    ...modelHandlers(dependencies),
    ...microphoneHandlers(dependencies),
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

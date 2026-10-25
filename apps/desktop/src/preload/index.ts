import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type IpcApi, type IpcEventListener, type IpcEventName, type IpcEvents } from '../shared/ipc-contract';
import type { Settings } from '../shared/settings';

function subscribe<E extends IpcEventName>(event: E, listener: IpcEventListener<E>): () => void {
  if (!Object.hasOwn(EVENT_CHANNELS, event)) {
    throw new TypeError('Unknown event');
  }
  if (typeof listener !== 'function') {
    throw new TypeError('Listener must be a function');
  }
  const channel = EVENT_CHANNELS[event];
  const handler = (_event: IpcRendererEvent, payload: IpcEvents[E]): void => {
    listener(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: IpcApi = {
  getSettings: () => ipcRenderer.invoke(INVOKE_CHANNELS.getSettings) as Promise<Settings>,
  updateSettings: (patch) => ipcRenderer.invoke(INVOKE_CHANNELS.updateSettings, patch) as Promise<Settings>,
  on: subscribe,
};

contextBridge.exposeInMainWorld('codevo', Object.freeze(api));

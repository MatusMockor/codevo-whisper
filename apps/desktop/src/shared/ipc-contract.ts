import type { Settings } from './settings';

export type IpcInvokeApi = {
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
};

export type IpcEvents = {
  'settings-changed': Settings;
};

export type IpcEventName = keyof IpcEvents;

export type IpcEventListener<E extends IpcEventName> = (payload: IpcEvents[E]) => void;

export type IpcApi = IpcInvokeApi & {
  on<E extends IpcEventName>(event: E, listener: IpcEventListener<E>): () => void;
};

export const INVOKE_CHANNELS: { readonly [K in keyof IpcInvokeApi]: string } = Object.freeze({
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
});

export const EVENT_CHANNELS: { readonly [E in IpcEventName]: string } = Object.freeze({
  'settings-changed': 'settings:changed',
});

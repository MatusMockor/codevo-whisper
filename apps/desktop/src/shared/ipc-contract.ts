import type { AppStatus } from './app-status';
import type { PageId } from './pages';
import type { Settings } from './settings';
import type { DayStats } from './stats';

export type IpcInvokeApi = {
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  getStats(): Promise<DayStats[]>;
  resetStats(): Promise<void>;
  getStatus(): Promise<AppStatus>;
  getLastTranscript(): Promise<string | null>;
};

export type IpcEvents = {
  'settings-changed': Settings;
  'open-page': PageId;
  'stats-changed': DayStats[];
  'status-changed': AppStatus;
};

export type IpcEventName = keyof IpcEvents;

export type IpcEventListener<E extends IpcEventName> = (payload: IpcEvents[E]) => void;

export type IpcApi = IpcInvokeApi & {
  on<E extends IpcEventName>(event: E, listener: IpcEventListener<E>): () => void;
};

export const INVOKE_CHANNELS: { readonly [K in keyof IpcInvokeApi]: string } = Object.freeze({
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  getStats: 'stats:get',
  resetStats: 'stats:reset',
  getStatus: 'status:get',
  getLastTranscript: 'last-transcript:get',
});

export const EVENT_CHANNELS: { readonly [E in IpcEventName]: string } = Object.freeze({
  'settings-changed': 'settings:changed',
  'open-page': 'window:open-page',
  'stats-changed': 'stats:changed',
  'status-changed': 'status:changed',
});

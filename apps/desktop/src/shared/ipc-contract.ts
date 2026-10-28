import type { AppStatus } from './app-status';
import type { HotkeyRecordResult } from './hotkey-record';
import type { AudioDevice } from './microphones';
import type { ModelCatalogView, ModelState } from './models';
import type { PageId } from './pages';
import type { PermissionGuide, PermissionKind, PermissionsStatus } from './permissions';
import type { DisconnectResult, ServerView } from './server';
import type { MicrophoneSetting, Settings } from './settings';
import type { DayStats } from './stats';
import type { InstallOutcome, UpdateStatus } from './updates';

export type IpcInvokeApi = {
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  getStats(): Promise<DayStats[]>;
  resetStats(): Promise<void>;
  getStatus(): Promise<AppStatus>;
  getLastTranscript(): Promise<string | null>;
  getPermissions(): Promise<PermissionsStatus>;
  requestPermission(kind: PermissionKind): Promise<void>;
  openPermissionSettings(kind: PermissionKind): Promise<void>;
  getPermissionGuide(): Promise<PermissionGuide>;
  revealAppInFinder(): Promise<void>;
  relaunch(): Promise<void>;
  recordHotkey(): Promise<HotkeyRecordResult>;
  isHotkeyArmed(): Promise<boolean>;
  getModelCatalog(): Promise<ModelCatalogView>;
  getModelStates(): Promise<ModelState[]>;
  downloadModel(id: string): Promise<void>;
  pauseModel(id: string): Promise<void>;
  deleteModel(id: string): Promise<void>;
  activateModel(id: string): Promise<void>;
  getMicrophones(): Promise<AudioDevice[]>;
  startMicrophoneMeter(microphone: MicrophoneSetting): Promise<void>;
  stopMicrophoneMeter(): Promise<void>;
  getServer(): Promise<ServerView>;
  pairServer(token: string): Promise<void>;
  cancelServerPairing(): Promise<void>;
  checkServer(): Promise<void>;
  disconnectServer(): Promise<DisconnectResult>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<InstallOutcome>;
  openUpdateDownload(): Promise<void>;
};

export type IpcEvents = {
  'settings-changed': Settings;
  'open-page': PageId;
  'stats-changed': DayStats[];
  'status-changed': AppStatus;
  'last-transcript-changed': string | null;
  'model-states-changed': ModelState[];
  'microphones-changed': AudioDevice[];
  'microphone-level': number;
  'server-changed': ServerView;
  'update-status-changed': UpdateStatus;
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
  getPermissions: 'permissions:get',
  requestPermission: 'permissions:request',
  openPermissionSettings: 'permissions:open-settings',
  getPermissionGuide: 'permissions:guide',
  revealAppInFinder: 'app:reveal-in-finder',
  relaunch: 'app:relaunch',
  recordHotkey: 'hotkey:record',
  isHotkeyArmed: 'hotkey:armed',
  getModelCatalog: 'models:catalog',
  getModelStates: 'models:states',
  downloadModel: 'models:download',
  pauseModel: 'models:pause',
  deleteModel: 'models:delete',
  activateModel: 'models:activate',
  getMicrophones: 'microphones:list',
  startMicrophoneMeter: 'microphones:meter-start',
  stopMicrophoneMeter: 'microphones:meter-stop',
  getServer: 'server:get',
  pairServer: 'server:pair',
  cancelServerPairing: 'server:cancel-pairing',
  checkServer: 'server:check',
  disconnectServer: 'server:disconnect',
  getUpdateStatus: 'updates:status',
  checkForUpdates: 'updates:check',
  installUpdate: 'updates:install',
  openUpdateDownload: 'updates:open-download',
});

export const EVENT_CHANNELS: { readonly [E in IpcEventName]: string } = Object.freeze({
  'settings-changed': 'settings:changed',
  'open-page': 'window:open-page',
  'stats-changed': 'stats:changed',
  'status-changed': 'status:changed',
  'last-transcript-changed': 'last-transcript:changed',
  'model-states-changed': 'models:states-changed',
  'microphones-changed': 'microphones:changed',
  'microphone-level': 'microphones:level',
  'server-changed': 'server:changed',
  'update-status-changed': 'updates:status-changed',
});

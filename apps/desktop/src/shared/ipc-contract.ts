import type { AiCheck, AiKeyState, CodexCheck, CodexEffort } from './ai';
import type { HistoryPolicy, HistoryView } from './history';
import type { AppStatus } from './app-status';
import type { OutputAudioView } from './recording-audio';
import type { HotkeyRecordResult } from './hotkey-record';
import type { Meeting, MeetingSummary } from './meetings';
import type { EngineSwitch } from './engine-routing';
import type { AudioDevice } from './microphones';
import type { DiarizerView, LanguagePackView, ModelCatalogView, ModelState } from './models';
import type { PageId } from './pages';
import type { PermissionGuide, PermissionKind, PermissionsStatus } from './permissions';
import type { DisconnectResult, ServerView } from './server';
import type { EngineId, MicrophoneSetting, Settings } from './settings';
import type { FocusRequest } from './section-focus';
import type { DayStats } from './stats';
import type { InstallOutcome, UpdateStatus } from './updates';

export type IpcInvokeApi = {
  getOutputAudio(): Promise<OutputAudioView>;
  getHistory(): Promise<HistoryView>;
  configureHistory(policy: HistoryPolicy): Promise<void>;
  deleteHistoryEntry(id: string): Promise<void>;
  clearHistory(): Promise<void>;
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
  getDataFolder(): Promise<string>;
  relaunch(): Promise<void>;
  recordHotkey(): Promise<HotkeyRecordResult>;
  isHotkeyArmed(): Promise<boolean>;
  getModelCatalog(): Promise<ModelCatalogView>;
  getModelStates(): Promise<ModelState[]>;
  downloadModel(id: string): Promise<void>;
  pauseModel(id: string): Promise<void>;
  deleteModel(id: string): Promise<void>;
  activateModel(id: string): Promise<void>;
  useExistingModel(): Promise<string | null>;
  getLanguagePack(): Promise<LanguagePackView>;
  downloadLanguagePack(): Promise<void>;
  getMicrophones(): Promise<AudioDevice[]>;
  startMicrophoneMeter(microphone: readonly MicrophoneSetting[]): Promise<void>;
  stopMicrophoneMeter(): Promise<void>;
  getServer(): Promise<ServerView>;
  pairServer(token: string): Promise<void>;
  cancelServerPairing(): Promise<void>;
  checkServer(): Promise<void>;
  disconnectServer(): Promise<DisconnectResult>;
  setServerEnabled(enabled: boolean): Promise<void>;
  preferEngine(engine: EngineId): Promise<EngineSwitch>;
  takeSectionFocus(): Promise<FocusRequest | null>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<InstallOutcome>;
  openUpdateDownload(): Promise<void>;
  getAiKeyState(): Promise<AiKeyState>;
  setAiKey(key: string | null): Promise<AiKeyState>;
  checkAi(baseUrl: string): Promise<AiCheck>;
  checkCodex(model: string, effort: CodexEffort): Promise<CodexCheck>;
  getMeetings(): Promise<MeetingSummary[]>;
  getMeeting(id: string): Promise<Meeting | null>;
  startMeeting(): Promise<MeetingSummary>;
  stopMeeting(): Promise<void>;
  retranscribeMeeting(id: string): Promise<void>;
  deleteMeeting(id: string): Promise<void>;
  generateMeetingNotes(id: string): Promise<void>;
  exportMeeting(id: string): Promise<boolean>;
  getDiarizer(): Promise<DiarizerView>;
  downloadDiarizer(): Promise<void>;
  pauseDiarizer(): Promise<void>;
  deleteDiarizer(): Promise<void>;
};

export type IpcEvents = {
  'history-changed': HistoryView;
  'settings-changed': Settings;
  'open-page': PageId;
  'section-focus-requested': FocusRequest;
  'stats-changed': DayStats[];
  'status-changed': AppStatus;
  'last-transcript-changed': string | null;
  'model-states-changed': ModelState[];
  'language-pack-changed': LanguagePackView;
  'microphones-changed': AudioDevice[];
  'microphone-level': number;
  'server-changed': ServerView;
  'update-status-changed': UpdateStatus;
  'meetings-changed': MeetingSummary[];
  'diarizer-changed': DiarizerView;
};

export type IpcEventName = keyof IpcEvents;

export type IpcEventListener<E extends IpcEventName> = (payload: IpcEvents[E]) => void;

export type IpcApi = IpcInvokeApi & {
  on<E extends IpcEventName>(event: E, listener: IpcEventListener<E>): () => void;
};

export const INVOKE_CHANNELS: { readonly [K in keyof IpcInvokeApi]: string } = Object.freeze({
  getOutputAudio: 'output-audio:get',
  getHistory: 'history:get',
  configureHistory: 'history:configure',
  deleteHistoryEntry: 'history:delete',
  clearHistory: 'history:clear',
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
  getDataFolder: 'app:data-folder',
  relaunch: 'app:relaunch',
  recordHotkey: 'hotkey:record',
  isHotkeyArmed: 'hotkey:armed',
  getModelCatalog: 'models:catalog',
  getModelStates: 'models:states',
  downloadModel: 'models:download',
  pauseModel: 'models:pause',
  deleteModel: 'models:delete',
  activateModel: 'models:activate',
  useExistingModel: 'models:use-existing',
  getLanguagePack: 'language-pack:get',
  downloadLanguagePack: 'language-pack:download',
  getMicrophones: 'microphones:list',
  startMicrophoneMeter: 'microphones:meter-start',
  stopMicrophoneMeter: 'microphones:meter-stop',
  getServer: 'server:get',
  pairServer: 'server:pair',
  cancelServerPairing: 'server:cancel-pairing',
  checkServer: 'server:check',
  disconnectServer: 'server:disconnect',
  setServerEnabled: 'server:set-enabled',
  preferEngine: 'engines:prefer',
  takeSectionFocus: 'window:take-section-focus',
  getUpdateStatus: 'updates:status',
  checkForUpdates: 'updates:check',
  installUpdate: 'updates:install',
  openUpdateDownload: 'updates:open-download',
  getAiKeyState: 'ai:key-state',
  setAiKey: 'ai:set-key',
  checkAi: 'ai:check',
  checkCodex: 'ai:check-codex',
  getMeetings: 'meetings:list',
  getMeeting: 'meetings:get',
  startMeeting: 'meetings:start',
  stopMeeting: 'meetings:stop',
  retranscribeMeeting: 'meetings:retranscribe',
  deleteMeeting: 'meetings:delete',
  generateMeetingNotes: 'meetings:generate-notes',
  exportMeeting: 'meetings:export',
  getDiarizer: 'diarizer:get',
  downloadDiarizer: 'diarizer:download',
  pauseDiarizer: 'diarizer:pause',
  deleteDiarizer: 'diarizer:delete',
});

export const EVENT_CHANNELS: { readonly [E in IpcEventName]: string } = Object.freeze({
  'history-changed': 'history:changed',
  'settings-changed': 'settings:changed',
  'open-page': 'window:open-page',
  'section-focus-requested': 'window:section-focus-requested',
  'stats-changed': 'stats:changed',
  'status-changed': 'status:changed',
  'last-transcript-changed': 'last-transcript:changed',
  'model-states-changed': 'models:states-changed',
  'language-pack-changed': 'language-pack:changed',
  'microphones-changed': 'microphones:changed',
  'microphone-level': 'microphones:level',
  'server-changed': 'server:changed',
  'update-status-changed': 'updates:status-changed',
  'meetings-changed': 'meetings:changed',
  'diarizer-changed': 'diarizer:changed',
});

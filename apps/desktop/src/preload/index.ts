import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type IpcApi, type IpcEventListener, type IpcEventName, type IpcEvents } from '../shared/ipc-contract';
import type { AiCheck, AiKeyState, CodexCheck } from '../shared/ai';
import type { EngineSwitch } from '../shared/engine-routing';
import type { HistoryView } from '../shared/history';
import type { AppStatus } from '../shared/app-status';
import type { OutputAudioView } from '../shared/recording-audio';
import type { HotkeyRecordResult } from '../shared/hotkey-record';
import type { Meeting, MeetingSummary } from '../shared/meetings';
import type { AudioDevice } from '../shared/microphones';
import type { DiarizerView, LanguagePackView, ModelCatalogView, ModelState } from '../shared/models';
import type { PermissionGuide, PermissionsStatus } from '../shared/permissions';
import type { DisconnectResult, ServerView } from '../shared/server';
import type { Settings } from '../shared/settings';
import type { FocusRequest } from '../shared/section-focus';
import type { DayStats } from '../shared/stats';
import type { InstallOutcome, UpdateStatus } from '../shared/updates';

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
  getOutputAudio: () => ipcRenderer.invoke(INVOKE_CHANNELS.getOutputAudio) as Promise<OutputAudioView>,
  getHistory: () => ipcRenderer.invoke(INVOKE_CHANNELS.getHistory) as Promise<HistoryView>,
  configureHistory: (policy) => ipcRenderer.invoke(INVOKE_CHANNELS.configureHistory, policy) as Promise<void>,
  deleteHistoryEntry: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.deleteHistoryEntry, id) as Promise<void>,
  clearHistory: () => ipcRenderer.invoke(INVOKE_CHANNELS.clearHistory) as Promise<void>,
  getSettings: () => ipcRenderer.invoke(INVOKE_CHANNELS.getSettings) as Promise<Settings>,
  updateSettings: (patch) => ipcRenderer.invoke(INVOKE_CHANNELS.updateSettings, patch) as Promise<Settings>,
  getStats: () => ipcRenderer.invoke(INVOKE_CHANNELS.getStats) as Promise<DayStats[]>,
  resetStats: () => ipcRenderer.invoke(INVOKE_CHANNELS.resetStats) as Promise<void>,
  getStatus: () => ipcRenderer.invoke(INVOKE_CHANNELS.getStatus) as Promise<AppStatus>,
  getLastTranscript: () => ipcRenderer.invoke(INVOKE_CHANNELS.getLastTranscript) as Promise<string | null>,
  getPermissions: () => ipcRenderer.invoke(INVOKE_CHANNELS.getPermissions) as Promise<PermissionsStatus>,
  requestPermission: (kind) => ipcRenderer.invoke(INVOKE_CHANNELS.requestPermission, kind) as Promise<void>,
  openPermissionSettings: (kind) => ipcRenderer.invoke(INVOKE_CHANNELS.openPermissionSettings, kind) as Promise<void>,
  getPermissionGuide: () => ipcRenderer.invoke(INVOKE_CHANNELS.getPermissionGuide) as Promise<PermissionGuide>,
  revealAppInFinder: () => ipcRenderer.invoke(INVOKE_CHANNELS.revealAppInFinder) as Promise<void>,
  getDataFolder: () => ipcRenderer.invoke(INVOKE_CHANNELS.getDataFolder) as Promise<string>,
  relaunch: () => ipcRenderer.invoke(INVOKE_CHANNELS.relaunch) as Promise<void>,
  recordHotkey: () => ipcRenderer.invoke(INVOKE_CHANNELS.recordHotkey) as Promise<HotkeyRecordResult>,
  isHotkeyArmed: () => ipcRenderer.invoke(INVOKE_CHANNELS.isHotkeyArmed) as Promise<boolean>,
  getModelCatalog: () => ipcRenderer.invoke(INVOKE_CHANNELS.getModelCatalog) as Promise<ModelCatalogView>,
  getModelStates: () => ipcRenderer.invoke(INVOKE_CHANNELS.getModelStates) as Promise<ModelState[]>,
  downloadModel: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.downloadModel, id) as Promise<void>,
  pauseModel: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.pauseModel, id) as Promise<void>,
  deleteModel: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.deleteModel, id) as Promise<void>,
  activateModel: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.activateModel, id) as Promise<void>,
  useExistingModel: () => ipcRenderer.invoke(INVOKE_CHANNELS.useExistingModel) as Promise<string | null>,
  getLanguagePack: () => ipcRenderer.invoke(INVOKE_CHANNELS.getLanguagePack) as Promise<LanguagePackView>,
  downloadLanguagePack: () => ipcRenderer.invoke(INVOKE_CHANNELS.downloadLanguagePack) as Promise<void>,
  getMicrophones: () => ipcRenderer.invoke(INVOKE_CHANNELS.getMicrophones) as Promise<AudioDevice[]>,
  startMicrophoneMeter: (microphone) => ipcRenderer.invoke(INVOKE_CHANNELS.startMicrophoneMeter, microphone) as Promise<void>,
  stopMicrophoneMeter: () => ipcRenderer.invoke(INVOKE_CHANNELS.stopMicrophoneMeter) as Promise<void>,
  getServer: () => ipcRenderer.invoke(INVOKE_CHANNELS.getServer) as Promise<ServerView>,
  pairServer: (token) => ipcRenderer.invoke(INVOKE_CHANNELS.pairServer, token) as Promise<void>,
  cancelServerPairing: () => ipcRenderer.invoke(INVOKE_CHANNELS.cancelServerPairing) as Promise<void>,
  checkServer: () => ipcRenderer.invoke(INVOKE_CHANNELS.checkServer) as Promise<void>,
  disconnectServer: () => ipcRenderer.invoke(INVOKE_CHANNELS.disconnectServer) as Promise<DisconnectResult>,
  setServerEnabled: (enabled) => ipcRenderer.invoke(INVOKE_CHANNELS.setServerEnabled, enabled) as Promise<void>,
  preferEngine: (engine) => ipcRenderer.invoke(INVOKE_CHANNELS.preferEngine, engine) as Promise<EngineSwitch>,
  takeSectionFocus: () => ipcRenderer.invoke(INVOKE_CHANNELS.takeSectionFocus) as Promise<FocusRequest | null>,
  getUpdateStatus: () => ipcRenderer.invoke(INVOKE_CHANNELS.getUpdateStatus) as Promise<UpdateStatus>,
  checkForUpdates: () => ipcRenderer.invoke(INVOKE_CHANNELS.checkForUpdates) as Promise<UpdateStatus>,
  installUpdate: () => ipcRenderer.invoke(INVOKE_CHANNELS.installUpdate) as Promise<InstallOutcome>,
  openUpdateDownload: () => ipcRenderer.invoke(INVOKE_CHANNELS.openUpdateDownload) as Promise<void>,
  getAiKeyState: () => ipcRenderer.invoke(INVOKE_CHANNELS.getAiKeyState) as Promise<AiKeyState>,
  setAiKey: (key) => ipcRenderer.invoke(INVOKE_CHANNELS.setAiKey, key) as Promise<AiKeyState>,
  checkAi: (baseUrl) => ipcRenderer.invoke(INVOKE_CHANNELS.checkAi, baseUrl) as Promise<AiCheck>,
  checkCodex: (model, effort) => ipcRenderer.invoke(INVOKE_CHANNELS.checkCodex, model, effort) as Promise<CodexCheck>,
  getMeetings: () => ipcRenderer.invoke(INVOKE_CHANNELS.getMeetings) as Promise<MeetingSummary[]>,
  getMeeting: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.getMeeting, id) as Promise<Meeting | null>,
  startMeeting: () => ipcRenderer.invoke(INVOKE_CHANNELS.startMeeting) as Promise<MeetingSummary>,
  stopMeeting: () => ipcRenderer.invoke(INVOKE_CHANNELS.stopMeeting) as Promise<void>,
  retranscribeMeeting: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.retranscribeMeeting, id) as Promise<void>,
  deleteMeeting: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.deleteMeeting, id) as Promise<void>,
  generateMeetingNotes: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.generateMeetingNotes, id) as Promise<void>,
  exportMeeting: (id) => ipcRenderer.invoke(INVOKE_CHANNELS.exportMeeting, id) as Promise<boolean>,
  getDiarizer: () => ipcRenderer.invoke(INVOKE_CHANNELS.getDiarizer) as Promise<DiarizerView>,
  downloadDiarizer: () => ipcRenderer.invoke(INVOKE_CHANNELS.downloadDiarizer) as Promise<void>,
  pauseDiarizer: () => ipcRenderer.invoke(INVOKE_CHANNELS.pauseDiarizer) as Promise<void>,
  deleteDiarizer: () => ipcRenderer.invoke(INVOKE_CHANNELS.deleteDiarizer) as Promise<void>,
  on: subscribe,
};

contextBridge.exposeInMainWorld('codevo', Object.freeze(api));

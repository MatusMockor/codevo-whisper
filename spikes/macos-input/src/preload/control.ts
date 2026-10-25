import { contextBridge, ipcRenderer } from 'electron'
import type { ControlApi, ControlStatus, LogEntry } from '../shared/types.js'

const api: ControlApi = {
  getStatus: () => ipcRenderer.invoke('control:get-status'),
  updateSettings: (patch) => ipcRenderer.invoke('control:update-settings', patch),
  simulate: (kind) => ipcRenderer.invoke('control:simulate', kind),
  requestPermission: (kind) => ipcRenderer.invoke('control:request-permission', kind),
  openPane: (kind) => ipcRenderer.invoke('control:open-pane', kind),
  showOverlayTest: () => ipcRenderer.invoke('control:overlay-test'),
  restartHelper: () => ipcRenderer.invoke('control:restart-helper'),
  pasteLast: () => ipcRenderer.invoke('control:paste-last'),
  revealLog: () => ipcRenderer.invoke('control:reveal-log'),
  onStatus: (listener) => {
    ipcRenderer.on('control:status', (_event, status: ControlStatus) => listener(status))
  },
  onLog: (listener) => {
    ipcRenderer.on('control:log', (_event, entry: LogEntry) => listener(entry))
  },
}

contextBridge.exposeInMainWorld('spike', api)

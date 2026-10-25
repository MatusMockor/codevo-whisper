import { contextBridge, ipcRenderer } from 'electron'
import type { OverlayApi, OverlayState } from '../shared/types.js'

const api: OverlayApi = {
  onState: (listener) => {
    ipcRenderer.on('overlay:state', (_event, state: OverlayState) => listener(state))
  },
  copy: () => ipcRenderer.send('overlay:copy'),
}

contextBridge.exposeInMainWorld('overlay', api)

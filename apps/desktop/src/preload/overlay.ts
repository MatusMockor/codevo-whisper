import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { OVERLAY_CHANNELS, OVERLAY_CONTROLS_OFF, type OverlayBridge, type OverlayState } from '../shared/overlay-contract';

const listeners = new Set<(state: OverlayState) => void>();
let latest: OverlayState | null = null;

ipcRenderer.on(OVERLAY_CHANNELS.state, (_event: IpcRendererEvent, state: OverlayState) => {
  latest = state;
  for (const listener of listeners) {
    listener(state);
  }
});

const bridge: OverlayBridge = {
  controls: !process.argv.includes(OVERLAY_CONTROLS_OFF),
  onState: (listener) => {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }
    listeners.add(listener);
    if (latest !== null) {
      listener(latest);
    }
    return () => {
      listeners.delete(listener);
    };
  },
  act: (action) => {
    ipcRenderer.send(OVERLAY_CHANNELS.action, action);
  },
};

contextBridge.exposeInMainWorld('codevoOverlay', Object.freeze(bridge));

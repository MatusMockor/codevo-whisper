import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CAPTURE_CHANNELS, type CaptureBridge, type CaptureCommand } from '../shared/capture-contract';

const bridge: CaptureBridge = {
  onCommand: (listener) => {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }
    ipcRenderer.on(CAPTURE_CHANNELS.command, (_event: IpcRendererEvent, command: CaptureCommand) => {
      listener(command);
    });
  },
  reply: (reply) => {
    ipcRenderer.send(CAPTURE_CHANNELS.reply, reply);
  },
  frame: (pcm) => {
    ipcRenderer.send(CAPTURE_CHANNELS.frame, pcm);
  },
  level: (rms) => {
    ipcRenderer.send(CAPTURE_CHANNELS.level, rms);
  },
  devicesChanged: (devices) => {
    ipcRenderer.send(CAPTURE_CHANNELS.devices, devices);
  },
};

contextBridge.exposeInMainWorld('codevoCapture', Object.freeze(bridge));

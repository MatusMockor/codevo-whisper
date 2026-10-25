import { BrowserWindow } from 'electron';
import { EVENT_CHANNELS, type IpcEventName, type IpcEvents } from '../../shared/ipc-contract';

export function broadcast<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    window.webContents.send(EVENT_CHANNELS[event], payload);
  }
}

import { BrowserWindow } from 'electron'
import type { ControlStatus, LogEntry } from '../../shared/types.js'

export class ControlWindow {
  readonly window: BrowserWindow

  constructor(htmlPath: string, preloadPath: string) {
    this.window = new BrowserWindow({
      width: 820,
      height: 900,
      title: 'Codevo Whisper - macOS input spike',
      webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true },
    })
    void this.window.loadFile(htmlPath)
  }

  sendStatus(status: ControlStatus): void {
    this.send('control:status', status)
  }

  sendLog(entry: LogEntry): void {
    this.send('control:log', entry)
  }

  focusForTest(): void {
    this.window.show()
    this.window.focus()
  }

  private send(channel: string, payload: unknown): void {
    if (this.window.isDestroyed() || this.window.webContents.isLoading()) {
      return
    }
    this.window.webContents.send(channel, payload)
  }
}

import { uIOhook, type UiohookKeyboardEvent } from 'uiohook-napi'
import type { HotkeyKey, KeyPhase, SourceStatus } from '../../shared/types.js'
import type { HotkeySource, RawKeyListener } from './HotkeySource.js'
import { keyCodes } from './keys.js'

export class UiohookSource implements HotkeySource {
  readonly id = 'uiohook' as const
  private readonly listeners: RawKeyListener[] = []
  private current: SourceStatus = { running: false }
  private keycode: number | null = null
  private hooked = false

  constructor() {
    uIOhook.on('keydown', (event) => this.handle('down', event))
    uIOhook.on('keyup', (event) => this.handle('up', event))
  }

  async start(key: HotkeyKey): Promise<SourceStatus> {
    const keycode = keyCodes[key].uiohook
    if (keycode === null) {
      this.current = { running: false, error: `uiohook-has-no-keycode-for-${key}` }
      return this.current
    }
    this.keycode = keycode
    this.current = this.hook()
    return this.current
  }

  async stop(): Promise<void> {
    this.keycode = null
    this.current = { running: false }
    if (!this.hooked) {
      return
    }
    uIOhook.stop()
    this.hooked = false
  }

  status(): SourceStatus {
    return this.current
  }

  onEvent(listener: RawKeyListener): void {
    this.listeners.push(listener)
  }

  private hook(): SourceStatus {
    if (this.hooked) {
      return { running: true }
    }
    try {
      uIOhook.start()
      this.hooked = true
      return { running: true }
    } catch (error) {
      return { running: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private handle(phase: KeyPhase, event: UiohookKeyboardEvent): void {
    if (event.keycode !== this.keycode) {
      return
    }
    const raw = { source: this.id, phase, keycode: event.keycode, ts: Date.now() }
    this.listeners.forEach((listener) => listener(raw))
  }
}

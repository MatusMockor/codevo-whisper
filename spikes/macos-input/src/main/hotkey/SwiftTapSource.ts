import type { HotkeyKey, SourceStatus } from '../../shared/types.js'
import type { HelperMessage } from '../helper/HelperProcess.js'
import type { InputHelper } from '../helper/InputHelper.js'
import type { HotkeySource, RawKeyEvent, RawKeyListener } from './HotkeySource.js'
import { keyCodes } from './keys.js'

export class SwiftTapSource implements HotkeySource {
  readonly id = 'swift' as const
  private readonly listeners: RawKeyListener[] = []
  private current: SourceStatus = { running: false }
  private keycode: number | null = null

  constructor(private readonly helper: InputHelper) {
    helper.onEvent((message) => this.handle(message))
  }

  async start(key: HotkeyKey): Promise<SourceStatus> {
    this.keycode = keyCodes[key].mac
    const response = await this.helper.listenStart([this.keycode])
    this.current = response.running === true ? { running: true } : { running: false, error: String(response.reason ?? 'unknown') }
    return this.current
  }

  async stop(): Promise<void> {
    this.keycode = null
    this.current = { running: false }
    await this.helper.listenStop().catch(() => undefined)
  }

  status(): SourceStatus {
    return this.current
  }

  onEvent(listener: RawKeyListener): void {
    this.listeners.push(listener)
  }

  private handle(message: HelperMessage): void {
    const phase = message.event
    if (phase !== 'down' && phase !== 'up') {
      return
    }
    if (message.keycode !== this.keycode) {
      return
    }
    const event: RawKeyEvent = { source: this.id, phase, keycode: Number(message.keycode), ts: Number(message.ts) }
    this.listeners.forEach((listener) => listener(event))
  }
}

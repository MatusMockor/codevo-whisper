import type { PermissionKind, PermissionStatus } from '../../shared/types.js'
import type { HelperEventListener, HelperMessage, HelperProcess } from './HelperProcess.js'

export interface FrontmostApp {
  pid: number
  bundleId?: string
  name?: string
  window?: { windowId?: number }
}

export interface SecureInputState {
  enabled: boolean
  pid?: number
}

export interface ModifierFlags {
  hid: number
  combined: number
}

export interface FocusedElementInfo {
  editable: boolean | null
  role: string | null
  subrole: string | null
  reason: string
  [key: string]: unknown
}

export interface InputHelper {
  readonly pid: number | null
  onEvent(listener: HelperEventListener): void
  frontmost(): Promise<FrontmostApp>
  secureInput(): Promise<SecureInputState>
  permissions(): Promise<PermissionStatus>
  requestPermission(kind: PermissionKind): Promise<HelperMessage>
  clipboardSave(): Promise<HelperMessage>
  clipboardWrite(text: string, transient: boolean): Promise<number>
  clipboardChangeCount(): Promise<number>
  clipboardRestore(options: { expectedChangeCount?: number; expectedText?: string; force?: boolean }): Promise<HelperMessage>
  paste(): Promise<HelperMessage>
  focusedElement(): Promise<FocusedElementInfo>
  modifierFlags(): Promise<ModifierFlags>
  focusFinderDesktopForTest(): Promise<HelperMessage>
  listenStart(keycodes: number[]): Promise<HelperMessage>
  listenStop(): Promise<HelperMessage>
}

export class ProcessInputHelper implements InputHelper {
  constructor(private readonly process: HelperProcess) {}

  get pid(): number | null {
    return this.process.pid
  }

  onEvent(listener: HelperEventListener): void {
    this.process.onEvent(listener)
  }

  async frontmost(): Promise<FrontmostApp> {
    return (await this.process.request('frontmost')) as unknown as FrontmostApp
  }

  async secureInput(): Promise<SecureInputState> {
    return (await this.process.request('secure-input')) as unknown as SecureInputState
  }

  async permissions(): Promise<PermissionStatus> {
    const response = await this.process.request('permissions')
    return {
      listenEvent: response.listenEvent === true,
      postEvent: response.postEvent === true,
      accessibility: response.accessibility === true,
    }
  }

  requestPermission(kind: PermissionKind): Promise<HelperMessage> {
    return this.process.request('request-permission', { kind }, 60000)
  }

  clipboardSave(): Promise<HelperMessage> {
    return this.process.request('clipboard-save')
  }

  async clipboardWrite(text: string, transient: boolean): Promise<number> {
    const response = await this.process.request('clipboard-write', { text, transient })
    return Number(response.changeCount)
  }

  async clipboardChangeCount(): Promise<number> {
    const response = await this.process.request('clipboard-changecount')
    return Number(response.changeCount)
  }

  clipboardRestore(options: { expectedChangeCount?: number; expectedText?: string; force?: boolean }): Promise<HelperMessage> {
    return this.process.request('clipboard-restore', { ...options })
  }

  paste(): Promise<HelperMessage> {
    return this.process.request('paste')
  }

  async focusedElement(): Promise<FocusedElementInfo> {
    const response = await this.process.request('focused-element', {}, 1500)
    const { id: _id, cmd: _cmd, ...info } = response
    return info as FocusedElementInfo
  }

  async modifierFlags(): Promise<ModifierFlags> {
    const response = await this.process.request('modifier-flags')
    return { hid: Number(response.flags), combined: Number(response.combinedFlags) }
  }

  focusFinderDesktopForTest(): Promise<HelperMessage> {
    return this.process.request('selftest-focus-desktop', {}, 3000)
  }

  listenStart(keycodes: number[]): Promise<HelperMessage> {
    return this.process.request('listen-start', { keycodes })
  }

  listenStop(): Promise<HelperMessage> {
    return this.process.request('listen-stop')
  }
}

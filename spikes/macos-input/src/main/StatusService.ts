import { systemPreferences } from 'electron'
import type { ControlStatus, PermissionStatus } from '../shared/types.js'
import type { InputHelper } from './helper/InputHelper.js'
import type { HotkeyRouter } from './hotkey/HotkeyRouter.js'
import type { EventLog } from './logger.js'
import type { DictationSession } from './session/DictationSession.js'
import type { SettingsStore } from './settings.js'

export class StatusService {
  private permissions: PermissionStatus | null = null
  private electronAccessibility = false
  private timer: NodeJS.Timeout | null = null
  private readonly listeners: Array<(status: ControlStatus) => void> = []

  constructor(
    private readonly helper: InputHelper,
    private readonly router: HotkeyRouter,
    private readonly session: DictationSession,
    private readonly settings: SettingsStore,
    private readonly log: EventLog,
  ) {}

  onStatus(listener: (status: ControlStatus) => void): void {
    this.listeners.push(listener)
  }

  startPolling(intervalMs = 3000): void {
    this.timer = setInterval(() => void this.refresh(), intervalMs)
  }

  stopPolling(): void {
    if (!this.timer) {
      return
    }
    clearInterval(this.timer)
    this.timer = null
  }

  async refresh(): Promise<ControlStatus> {
    const permissions = await this.helper.permissions().catch(() => null)
    const electronAccessibility = systemPreferences.isTrustedAccessibilityClient(false)
    this.logChanges(permissions, electronAccessibility)
    this.permissions = permissions
    this.electronAccessibility = electronAccessibility
    return this.broadcast()
  }

  broadcast(): ControlStatus {
    const status = this.snapshot()
    this.listeners.forEach((listener) => listener(status))
    return status
  }

  snapshot(): ControlStatus {
    return {
      runId: this.log.runId,
      logPath: this.log.path,
      settings: this.settings.get(),
      sessionState: this.session.currentState(),
      helperPid: this.helper.pid,
      permissions: this.permissions,
      electronAccessibility: this.electronAccessibility,
      sources: this.router.statuses(),
    }
  }

  private logChanges(permissions: PermissionStatus | null, electronAccessibility: boolean): void {
    const next = JSON.stringify({ permissions, electronAccessibility })
    const previous = JSON.stringify({ permissions: this.permissions, electronAccessibility: this.electronAccessibility })
    if (next === previous && this.permissions !== null) {
      return
    }
    this.log.write('permissions', { helper: permissions, electronAccessibility })
  }
}

import { app as electronApp, powerMonitor } from 'electron'
import { join } from 'node:path'
import type { ControlStatus, OverlayState, Settings, SimulateKind } from '../shared/types.js'
import { HelperProcess } from './helper/HelperProcess.js'
import { ProcessInputHelper, type InputHelper } from './helper/InputHelper.js'
import type { RawKeyEvent } from './hotkey/HotkeySource.js'
import { HotkeyRouter } from './hotkey/HotkeyRouter.js'
import { keyCodes } from './hotkey/keys.js'
import { SwiftTapSource } from './hotkey/SwiftTapSource.js'
import { UiohookSource } from './hotkey/UiohookSource.js'
import type { EventLog } from './logger.js'
import { ClipboardRestorer } from './paste/ClipboardRestorer.js'
import { PasteFlow } from './paste/PasteFlow.js'
import { DictationSession } from './session/DictationSession.js'
import { FakeTranscript } from './session/FakeTranscript.js'
import { OverlayFocusAudit } from './session/OverlayFocusAudit.js'
import { ResetGuard } from './session/ResetGuard.js'
import { SettingsStore } from './settings.js'
import { StatusService } from './StatusService.js'
import { ControlWindow } from './windows/ControlWindow.js'
import { OverlayWindow } from './windows/OverlayWindow.js'

export interface AppPaths {
  root: string
  helperBinary: string
}

export class App {
  readonly helper: InputHelper
  readonly overlay: OverlayWindow
  readonly control: ControlWindow
  readonly session: DictationSession
  readonly router: HotkeyRouter
  readonly status: StatusService
  readonly audit: OverlayFocusAudit
  readonly guard: ResetGuard

  constructor(
    paths: AppPaths,
    readonly settings: SettingsStore,
    readonly log: EventLog,
    private readonly helperProcess: HelperProcess,
  ) {
    const dist = join(paths.root, 'dist')
    this.helper = new ProcessInputHelper(helperProcess)
    this.overlay = new OverlayWindow(join(dist, 'renderer/overlay.html'), join(dist, 'preload/overlay.js'), log, settings.get())
    this.control = new ControlWindow(join(dist, 'renderer/control.html'), join(dist, 'preload/control.js'))
    this.audit = new OverlayFocusAudit(this.helper, this.overlay, log)
    this.guard = new ResetGuard(powerMonitor, log)
    this.session = new DictationSession({
      overlay: this.overlay,
      audit: this.audit,
      inserter: new PasteFlow(this.helper, new ClipboardRestorer(this.helper, log), settings, log),
      probe: this.helper,
      copier: this.helper,
      transcript: new FakeTranscript(),
      guard: this.guard,
      settings,
      log,
    })
    this.router = new HotkeyRouter({ swift: new SwiftTapSource(this.helper), uiohook: new UiohookSource() }, this.session, log)
    this.status = new StatusService(this.helper, this.router, this.session, settings, log)
    this.wire()
  }

  async start(hotkeys: boolean): Promise<void> {
    this.log.write('hotkeys-enabled', { enabled: hotkeys })
    if (hotkeys) {
      await this.router.apply(this.settings.get())
    }
    await this.status.refresh()
    this.status.startPolling()
  }

  async shutdown(): Promise<void> {
    this.status.stopPolling()
    await this.router.stopAll()
    this.helperProcess.stop()
  }

  async updateSettings(patch: Partial<Settings>): Promise<ControlStatus> {
    const previous = this.settings.get()
    const next = this.settings.update(patch)
    this.log.write('settings-changed', { settings: next })
    if (next.skipTransformProcessType !== previous.skipTransformProcessType) {
      this.overlay.recreate(next)
    }
    if (next.candidate !== previous.candidate || next.key !== previous.key || next.observeBoth !== previous.observeBoth) {
      await this.router.apply(next)
    }
    return this.status.refresh()
  }

  async simulate(kind: SimulateKind): Promise<void> {
    this.log.write('simulate', { kind })
    if (kind === 'delayed') {
      setTimeout(() => this.simulateKey('down'), 3000)
      setTimeout(() => this.simulateKey('up'), 5000)
      return
    }
    this.simulateKey(kind)
  }

  async overlayTest(): Promise<void> {
    this.log.write('overlay-test', { phase: 'scheduled', showInMs: 3000, visibleMs: 5000 })
    await delay(3000)
    const before = await this.helper.frontmost().catch(() => null)
    this.overlay.show(this.testState())
    await this.audit.check('overlay-test', before)
    await delay(4700)
    this.overlay.hide()
  }

  async restartHelper(): Promise<void> {
    this.helperProcess.stop()
    await this.helperProcess.start()
    this.log.write('helper-restarted', { pid: this.helperProcess.pid })
    await this.router.apply(this.settings.get())
    await this.status.refresh()
  }

  private simulateKey(phase: 'down' | 'up'): void {
    const event: RawKeyEvent = { source: 'simulated', phase, keycode: keyCodes[this.settings.get().key].mac, ts: Date.now() }
    this.log.write(`key-${phase}`, { source: 'simulated', keycode: event.keycode, eventTs: event.ts, active: true })
    if (phase === 'down') {
      this.session.press(event)
      return
    }
    this.session.release(event)
  }

  private testState(): OverlayState {
    const settings = this.settings.get()
    return {
      hotkey: 'up',
      candidate: settings.candidate,
      key: settings.key,
      sessionState: 'idle',
      startedAt: Date.now(),
      endedAt: null,
      transcript: 'Overlay test - keep typing in the app behind this panel',
      message: 'Overlay test (5 s)',
      tone: 'info',
      canCopy: false,
    }
  }

  private wire(): void {
    this.log.onEntry((entry) => this.control.sendLog(entry))
    this.status.onStatus((status) => this.control.sendStatus(status))
    this.session.onState(() => this.status.broadcast())
    this.helper.onEvent((message) => this.logHelperEvent(message))
    electronApp.on('did-become-active', () => this.log.write('app-activation', { active: true }))
    electronApp.on('did-resign-active', () => this.log.write('app-activation', { active: false }))
  }

  private logHelperEvent(message: Record<string, unknown>): void {
    if (message.event === 'down' || message.event === 'up') {
      return
    }
    this.log.write('helper-event', message)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

import type { OverlayState, SessionState } from '../../shared/types.js'
import type { EventLog } from '../logger.js'
import type { FrontmostApp } from '../helper/InputHelper.js'
import type { RawKeyEvent } from '../hotkey/HotkeySource.js'
import type { KeyTarget } from '../hotkey/HotkeyRouter.js'
import type { LastTranscript } from '../paste/LastTranscript.js'
import type { Inserter, InsertOutcome } from '../paste/PasteFlow.js'
import type { TextFieldProbe } from '../paste/TextFieldProbe.js'
import type { SettingsStore } from '../settings.js'
import type { FakeTranscript } from './FakeTranscript.js'
import type { FrontmostProbe, OverlayFocusAudit } from './OverlayFocusAudit.js'
import type { ResetGuard, ResetReason } from './ResetGuard.js'

export interface OverlayView {
  show(state: OverlayState): void
  update(patch: Partial<OverlayState>): void
  hide(): void
}

export interface TextCopier {
  clipboardWrite(text: string, transient: boolean): Promise<number>
}

export interface SessionDeps {
  overlay: OverlayView
  audit: OverlayFocusAudit
  inserter: Inserter
  probe: FrontmostProbe
  copier: TextCopier
  transcript: FakeTranscript
  memory: LastTranscript
  fieldWarmup: TextFieldProbe
  guard: ResetGuard
  settings: SettingsStore
  log: EventLog
}

interface ActiveSession {
  id: number
  startedAt: number
  target: FrontmostApp | null
  text: string
  cancelled: boolean
}

const busyStates: SessionState[] = ['recording', 'transcribing', 'inserting']

export class DictationSession implements KeyTarget {
  private state: SessionState = 'idle'
  private session: ActiveSession | null = null
  private counter = 0
  private idleTimer: NodeJS.Timeout | null = null
  private readonly stateListeners: Array<(state: SessionState) => void> = []

  constructor(private readonly deps: SessionDeps) {
    deps.guard.onReset((reason) => this.reset(reason))
  }

  currentState(): SessionState {
    return this.state
  }

  onState(listener: (state: SessionState) => void): void {
    this.stateListeners.push(listener)
  }

  press(event: RawKeyEvent): void {
    if (busyStates.includes(this.state)) {
      this.deps.log.write('down-ignored', { source: event.source, state: this.state, sessionId: this.session?.id ?? null })
      return
    }
    void this.begin(event)
  }

  release(event: RawKeyEvent): void {
    const session = this.session
    if (this.state !== 'recording' || !session) {
      this.deps.log.write('up-ignored', { source: event.source, state: this.state, sessionId: session?.id ?? null })
      return
    }
    void this.finish(session, event)
  }

  reset(reason: ResetReason): void {
    const session = this.session
    if (!session || !busyStates.includes(this.state)) {
      this.deps.log.write('reset-skipped', { reason, state: this.state })
      return
    }
    session.cancelled = true
    this.deps.transcript.stop()
    this.deps.guard.disarm()
    this.deps.log.write('session-reset', { reason, sessionId: session.id, state: this.state, heldMs: Date.now() - session.startedAt })
    this.showResult(session, { kind: 'error', message: `Session reset: ${reason}`, tone: 'warn', offerCopy: false })
  }

  async copyLast(): Promise<void> {
    const session = this.session
    if (!session) {
      this.deps.log.write('copy-clicked', { sessionId: null, copied: false })
      return
    }
    const target = await this.deps.probe.frontmost().catch(() => null)
    const changeCount = await this.deps.copier.clipboardWrite(session.text, false)
    this.deps.log.write('copy-clicked', { sessionId: session.id, copied: true, changeCount })
    this.deps.overlay.update({ message: 'Copied to clipboard', tone: 'ok', canCopy: false })
    await this.deps.audit.check('copy-click', target)
  }

  private async begin(event: RawKeyEvent): Promise<void> {
    this.clearIdleTimer()
    const session: ActiveSession = { id: ++this.counter, startedAt: Date.now(), target: null, text: '', cancelled: false }
    this.session = session
    this.setState('recording')
    this.deps.log.write('session-start', { sessionId: session.id, source: event.source, keycode: event.keycode, keyLatencyMs: session.startedAt - event.ts })
    session.target = await this.deps.probe.frontmost().catch(() => null)
    this.deps.log.write('target-captured', { sessionId: session.id, target: session.target })
    if (session.cancelled || this.session !== session || this.state !== 'recording') {
      return
    }
    this.deps.guard.arm(session.id, this.deps.settings.get().maxSessionMs)
    this.deps.overlay.show(this.overlayState(session))
    this.deps.transcript.start((text) => this.deps.overlay.update({ transcript: text }))
    void this.warmUpTextField(session)
    await this.deps.audit.check(`session-${session.id}`, session.target)
  }

  private async warmUpTextField(session: ActiveSession): Promise<void> {
    const field = await this.deps.fieldWarmup.inspect()
    this.deps.log.write('focused-element', { sessionId: session.id, origin: 'session', phase: 'key-down', app: session.target?.bundleId ?? null, ...field })
  }

  private async finish(session: ActiveSession, event: RawKeyEvent): Promise<void> {
    this.deps.guard.disarm()
    this.deps.transcript.stop()
    session.text = this.deps.transcript.finalText(session.id)
    this.setState('transcribing')
    this.deps.log.write('session-release', { sessionId: session.id, source: event.source, heldMs: Date.now() - session.startedAt })
    this.deps.overlay.update({ hotkey: 'up', sessionState: 'transcribing', endedAt: Date.now(), transcript: session.text, message: 'Transcribing (simulated)' })
    await delay(this.deps.settings.get().transcriptionMs)
    if (session.cancelled) {
      return
    }
    this.deps.memory.remember(session.id, session.text)
    this.setState('inserting')
    const outcome = await this.deps.inserter.insert({ text: session.text, target: session.target, sessionId: session.id, origin: 'session' })
    if (session.cancelled) {
      return
    }
    this.showResult(session, outcome)
  }

  private showResult(session: ActiveSession, outcome: InsertOutcome): void {
    this.setState('result')
    this.deps.overlay.update({ sessionState: 'result', endedAt: Date.now(), message: outcome.message, tone: outcome.tone, canCopy: outcome.offerCopy })
    this.idleTimer = setTimeout(() => this.end(session), outcome.offerCopy ? 6000 : 1800)
  }

  private end(session: ActiveSession): void {
    this.idleTimer = null
    if (this.session !== session) {
      return
    }
    this.setState('idle')
    this.deps.overlay.hide()
    this.deps.log.write('session-end', { sessionId: session.id, durationMs: Date.now() - session.startedAt })
  }

  private overlayState(session: ActiveSession): OverlayState {
    const settings = this.deps.settings.get()
    return {
      hotkey: 'down',
      candidate: settings.candidate,
      key: settings.key,
      sessionState: 'recording',
      startedAt: session.startedAt,
      endedAt: null,
      transcript: '',
      message: `Session ${session.id} - target ${session.target?.name ?? 'unknown'}`,
      tone: 'info',
      canCopy: false,
    }
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) {
      return
    }
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private setState(state: SessionState): void {
    this.state = state
    this.stateListeners.forEach((listener) => listener(state))
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

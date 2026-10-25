import type { OverlayState, SessionState } from '../../shared/types.js'
import type { EventLog } from '../logger.js'
import type { OverlayView } from '../session/DictationSession.js'
import type { FrontmostProbe } from '../session/OverlayFocusAudit.js'
import type { SettingsStore } from '../settings.js'
import type { LastTranscript } from './LastTranscript.js'
import type { ModifierGate } from './ModifierGate.js'
import type { Inserter } from './PasteFlow.js'

export type PasteLastTrigger = 'shortcut' | 'button'

export interface SessionStateProbe {
  currentState(): SessionState
}

export interface PasteLastDeps {
  inserter: Inserter
  probe: FrontmostProbe
  memory: LastTranscript
  gate: ModifierGate
  overlay: OverlayView
  session: SessionStateProbe
  settings: SettingsStore
  log: EventLog
}

const busyStates: SessionState[] = ['recording', 'transcribing', 'inserting']
const buttonDelayMs = 3000
const visibleMs = 2200

export class PasteLastAction {
  private running = false
  private hideTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: PasteLastDeps) {}

  async run(trigger: PasteLastTrigger): Promise<void> {
    this.deps.log.write('paste-last-requested', { trigger, sessionId: this.deps.memory.get()?.sessionId ?? null, state: this.deps.session.currentState() })
    if (this.running) {
      this.deps.log.write('paste-last-ignored', { trigger, reason: 'already-running' })
      return
    }
    this.running = true
    try {
      await this.execute(trigger)
    } finally {
      this.running = false
    }
  }

  private async execute(trigger: PasteLastTrigger): Promise<void> {
    await this.prepare(trigger)
    const state = this.deps.session.currentState()
    if (busyStates.includes(state)) {
      this.deps.log.write('paste-last-ignored', { trigger, reason: 'session-busy', state })
      return
    }
    const last = this.deps.memory.get()
    if (!last) {
      this.deps.log.write('paste-last-result', { trigger, kind: 'no-transcript' })
      this.flash('Žiadny posledný prepis', '', 'warn')
      return
    }
    const target = await this.deps.probe.frontmost().catch(() => null)
    const outcome = await this.deps.inserter.insert({ text: last.text, target, sessionId: last.sessionId, origin: 'paste-last' })
    this.deps.log.write('paste-last-result', { trigger, sessionId: last.sessionId, kind: outcome.kind, target: target?.bundleId ?? null })
    this.flash(outcome.message, last.text, outcome.tone)
  }

  private async prepare(trigger: PasteLastTrigger): Promise<void> {
    if (trigger === 'button') {
      await delay(buttonDelayMs)
      return
    }
    const wait = await this.deps.gate.waitForRelease()
    this.deps.log.write('paste-last-modifiers', { ...wait })
  }

  private flash(message: string, transcript: string, tone: OverlayState['tone']): void {
    const settings = this.deps.settings.get()
    this.deps.overlay.show({
      hotkey: 'up',
      candidate: settings.candidate,
      key: settings.key,
      sessionState: this.deps.session.currentState(),
      startedAt: null,
      endedAt: null,
      transcript,
      message: `Vložiť posledný prepis: ${message}`,
      tone,
      canCopy: false,
    })
    this.scheduleHide()
  }

  private scheduleHide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
    }
    this.hideTimer = setTimeout(() => this.hide(), visibleMs)
  }

  private hide(): void {
    this.hideTimer = null
    if (this.deps.session.currentState() !== 'idle') {
      return
    }
    this.deps.overlay.hide()
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

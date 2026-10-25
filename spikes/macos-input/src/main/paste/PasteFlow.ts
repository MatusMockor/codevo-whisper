import type { EventLog, LogData } from '../logger.js'
import type { FocusedElementInfo, FrontmostApp, InputHelper } from '../helper/InputHelper.js'
import type { SettingsStore } from '../settings.js'
import type { ClipboardRestorer } from './ClipboardRestorer.js'
import { compareFocus } from './FocusCheck.js'
import type { TextFieldProbe } from './TextFieldProbe.js'

export type InsertOrigin = 'session' | 'paste-last'

export interface InsertRequest {
  text: string
  target: FrontmostApp | null
  sessionId: number
  origin: InsertOrigin
}

export interface InsertOutcome {
  kind: 'pasted' | 'focus-changed' | 'secure-input' | 'copied-no-text-field' | 'error'
  message: string
  tone: 'ok' | 'warn'
  offerCopy: boolean
}

export interface Inserter {
  insert(request: InsertRequest): Promise<InsertOutcome>
}

export class PasteFlow implements Inserter {
  constructor(
    private readonly helper: InputHelper,
    private readonly restorer: ClipboardRestorer,
    private readonly textField: TextFieldProbe,
    private readonly settings: SettingsStore,
    private readonly log: EventLog,
  ) {}

  async insert(request: InsertRequest): Promise<InsertOutcome> {
    try {
      return await this.run(request)
    } catch (error) {
      this.write(request, 'paste-result', { kind: 'error', error: String(error) })
      return { kind: 'error', message: `Error: ${String(error)}`, tone: 'warn', offerCopy: true }
    }
  }

  private async run(request: InsertRequest): Promise<InsertOutcome> {
    const current = await this.helper.frontmost()
    const focus = compareFocus(request.target, current, this.settings.get().compareWindow)
    this.write(request, 'focus-check', { result: focus, target: request.target, current })
    if (focus !== 'same') {
      this.write(request, 'paste-result', { kind: 'focus-changed', focus, pasted: false })
      return { kind: 'focus-changed', message: `Focus changed (${focus}) - nothing pasted`, tone: 'warn', offerCopy: true }
    }
    const secure = await this.helper.secureInput()
    this.write(request, 'secure-input-check', { ...secure })
    if (secure.enabled) {
      return this.fallbackToClipboard(request, secure.pid ?? null)
    }
    const field = await this.textField.inspect()
    this.write(request, 'focused-element', { phase: 'paste', app: current.bundleId ?? null, ...field })
    if (field.editable === false) {
      return this.copyWithoutTextField(request, current, field)
    }
    return this.paste(request, current, field)
  }

  private async fallbackToClipboard(request: InsertRequest, securePid: number | null): Promise<InsertOutcome> {
    const changeCount = await this.leaveOnClipboard(request.text, 'secure-input-fallback')
    this.write(request, 'secure-input-detected', { securePid, fallback: 'clipboard', changeCount })
    this.write(request, 'paste-result', { kind: 'secure-input', pasted: false })
    return { kind: 'secure-input', message: 'Secure input active - text left in clipboard', tone: 'warn', offerCopy: false }
  }

  private async copyWithoutTextField(request: InsertRequest, current: FrontmostApp, field: FocusedElementInfo): Promise<InsertOutcome> {
    const changeCount = await this.leaveOnClipboard(request.text, 'no-text-field')
    this.write(request, 'clipboard-written', { changeCount, transient: false, restore: false, text: request.text })
    this.write(request, 'paste-result', {
      kind: 'copied-no-text-field',
      pasted: false,
      target: current.bundleId ?? null,
      role: field.role,
      subrole: field.subrole,
      reason: field.reason,
    })
    return { kind: 'copied-no-text-field', message: 'Skopírované - vlož cez ⌘V', tone: 'warn', offerCopy: false }
  }

  private async paste(request: InsertRequest, current: FrontmostApp, field: FocusedElementInfo): Promise<InsertOutcome> {
    const settings = this.settings.get()
    await this.restorer.flush('new-paste')
    const saved = await this.helper.clipboardSave()
    this.write(request, 'clipboard-saved', { items: saved.items, types: saved.types, changeCount: saved.changeCount })
    const changeCount = await this.helper.clipboardWrite(request.text, settings.transientClipboard)
    this.write(request, 'clipboard-written', { changeCount, transient: settings.transientClipboard, text: request.text })
    const sent = await this.helper.paste()
    this.write(request, 'paste-result', {
      kind: 'pasted',
      target: current.bundleId ?? null,
      posted: sent.posted,
      postAccess: sent.postAccess,
      ax: { editable: field.editable, role: field.role, subrole: field.subrole, reason: field.reason },
    })
    this.restorer.schedule({ sessionId: request.sessionId, changeCount, text: request.text, delayMs: settings.restoreDelayMs })
    if (sent.postAccess !== true) {
      return { kind: 'pasted', message: 'Cmd+V sent without Accessibility - probably dropped', tone: 'warn', offerCopy: true }
    }
    return { kind: 'pasted', message: `Pasted into ${current.name ?? current.bundleId ?? 'app'}`, tone: 'ok', offerCopy: false }
  }

  private async leaveOnClipboard(text: string, trigger: string): Promise<number> {
    await this.restorer.flush(trigger)
    return this.helper.clipboardWrite(text, false)
  }

  private write(request: InsertRequest, type: string, data: LogData): void {
    this.log.write(type, { sessionId: request.sessionId, origin: request.origin, ...data })
  }
}

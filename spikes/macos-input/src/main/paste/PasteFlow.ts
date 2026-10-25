import type { EventLog } from '../logger.js'
import type { FrontmostApp, InputHelper } from '../helper/InputHelper.js'
import type { SettingsStore } from '../settings.js'
import type { ClipboardRestorer } from './ClipboardRestorer.js'
import { compareFocus } from './FocusCheck.js'

export interface InsertOutcome {
  kind: 'pasted' | 'focus-changed' | 'secure-input' | 'error'
  message: string
  tone: 'ok' | 'warn'
  offerCopy: boolean
}

export interface Inserter {
  insert(text: string, target: FrontmostApp | null, sessionId: number): Promise<InsertOutcome>
}

export class PasteFlow implements Inserter {
  constructor(
    private readonly helper: InputHelper,
    private readonly restorer: ClipboardRestorer,
    private readonly settings: SettingsStore,
    private readonly log: EventLog,
  ) {}

  async insert(text: string, target: FrontmostApp | null, sessionId: number): Promise<InsertOutcome> {
    try {
      return await this.run(text, target, sessionId)
    } catch (error) {
      this.log.write('paste-result', { sessionId, kind: 'error', error: String(error) })
      return { kind: 'error', message: `Error: ${String(error)}`, tone: 'warn', offerCopy: true }
    }
  }

  private async run(text: string, target: FrontmostApp | null, sessionId: number): Promise<InsertOutcome> {
    const current = await this.helper.frontmost()
    const focus = compareFocus(target, current, this.settings.get().compareWindow)
    this.log.write('focus-check', { sessionId, result: focus, target, current })
    if (focus !== 'same') {
      this.log.write('paste-result', { sessionId, kind: 'focus-changed', focus, pasted: false })
      return { kind: 'focus-changed', message: `Focus changed (${focus}) - nothing pasted`, tone: 'warn', offerCopy: true }
    }
    const secure = await this.helper.secureInput()
    this.log.write('secure-input-check', { sessionId, ...secure })
    if (secure.enabled) {
      return this.fallbackToClipboard(text, sessionId, secure.pid ?? null)
    }
    return this.paste(text, current, sessionId)
  }

  private async fallbackToClipboard(text: string, sessionId: number, securePid: number | null): Promise<InsertOutcome> {
    await this.restorer.flush('secure-input-fallback')
    const changeCount = await this.helper.clipboardWrite(text, false)
    this.log.write('secure-input-detected', { sessionId, securePid, fallback: 'clipboard', changeCount })
    this.log.write('paste-result', { sessionId, kind: 'secure-input', pasted: false })
    return { kind: 'secure-input', message: 'Secure input active - text left in clipboard', tone: 'warn', offerCopy: false }
  }

  private async paste(text: string, current: FrontmostApp, sessionId: number): Promise<InsertOutcome> {
    const settings = this.settings.get()
    await this.restorer.flush('new-paste')
    const saved = await this.helper.clipboardSave()
    this.log.write('clipboard-saved', { sessionId, items: saved.items, types: saved.types, changeCount: saved.changeCount })
    const changeCount = await this.helper.clipboardWrite(text, settings.transientClipboard)
    this.log.write('clipboard-written', { sessionId, changeCount, transient: settings.transientClipboard, text })
    const sent = await this.helper.paste()
    this.log.write('paste-result', { sessionId, kind: 'pasted', target: current.bundleId ?? null, posted: sent.posted, postAccess: sent.postAccess })
    this.restorer.schedule({ sessionId, changeCount, text, delayMs: settings.restoreDelayMs })
    if (sent.postAccess !== true) {
      return { kind: 'pasted', message: 'Cmd+V sent without Accessibility - probably dropped', tone: 'warn', offerCopy: true }
    }
    return { kind: 'pasted', message: `Pasted into ${current.name ?? current.bundleId ?? 'app'}`, tone: 'ok', offerCopy: false }
  }
}

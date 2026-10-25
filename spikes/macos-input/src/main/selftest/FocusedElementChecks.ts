import type { LogEntry } from '../../shared/types.js'
import type { App } from '../app.js'
import type { FocusedElementInfo } from '../helper/InputHelper.js'
import type { LogWaiter } from './LogWaiter.js'
import type { Check } from './SelfTest.js'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const textarea = "document.querySelector('#paste-target')"

export async function focusedElementChecks(spike: App, checks: Check[]): Promise<void> {
  await delay(2200)
  const modifiers = await spike.helper.modifierFlags()
  checks.push({ name: 'no-command-stuck-after-synthetic-paste', pass: (modifiers.hid & 0x100000) === 0, detail: modifiers })
  const desktop = await focusFinderDesktop(spike)
  checks.push({ name: 'focused-element-finder-desktop-not-editable', pass: desktop.editable === false, detail: desktop })
  spike.control.focusForTest()
  await delay(500)
  await spike.control.window.webContents.executeJavaScript(`${textarea}.value = ''; ${textarea}.focus()`)
  await delay(200)
  const own = await spike.helper.focusedElement()
  spike.log.write('selftest-focused-element', { context: 'control-textarea', ...own })
  checks.push({ name: 'focused-element-control-textarea-editable', pass: own.editable === true, detail: own })
}

export async function noTextFieldChecks(spike: App, waiter: LogWaiter, checks: Check[]): Promise<void> {
  spike.settings.update({ transcriptionMs: 500, restoreDelayMs: 300 })
  const saved = await spike.helper.clipboardSave()
  spike.log.write('selftest-clipboard-guard', { phase: 'saved', items: saved.items, types: saved.types })
  try {
    await sessionIntoDesktop(spike, waiter, checks)
  } finally {
    const restored = await spike.helper.clipboardRestore({ force: true })
    checks.push({ name: 'user-clipboard-restored-after-no-text-field', pass: restored.restored === true, detail: restored })
  }
}

async function sessionIntoDesktop(spike: App, waiter: LogWaiter, checks: Check[]): Promise<void> {
  const desktop = await focusFinderDesktop(spike)
  if (desktop.editable !== false) {
    checks.push({ name: 'no-text-field-session-copies', pass: false, detail: { skipped: 'desktop not reported as non-editable', desktop } })
    return
  }
  const sessionEntries = collect(spike)
  const result = waiter.waitFor((entry) => entry.type === 'paste-result' && entry.origin === 'session', 6000)
  await spike.simulate('down')
  await delay(400)
  await spike.simulate('up')
  const entry = await result
  await delay(1200)
  const seen = sessionEntries.stop()
  const sessionId = entry?.sessionId
  const touched = seen.filter((item) => item.sessionId === sessionId && (item.type === 'clipboard-saved' || item.type === 'clipboard-restore'))
  checks.push({ name: 'no-text-field-session-copies', pass: entry?.kind === 'copied-no-text-field', detail: entry })
  checks.push({ name: 'no-text-field-no-save-no-restore', pass: entry !== null && touched.length === 0, detail: touched })
  const written = seen.find((item) => item.type === 'clipboard-written' && item.sessionId === sessionId)
  const changeCount = await spike.helper.clipboardChangeCount()
  checks.push({ name: 'no-text-field-clipboard-keeps-transcript', pass: written?.changeCount === changeCount, detail: { written: written?.changeCount, now: changeCount } })
  await pasteLastIntoDesktop(spike, waiter, checks, sessionId)
}

async function pasteLastIntoDesktop(spike: App, waiter: LogWaiter, checks: Check[], sessionId: unknown): Promise<void> {
  await delay(2200)
  const desktop = await focusFinderDesktop(spike)
  if (desktop.editable !== false) {
    checks.push({ name: 'paste-last-uses-same-checks', pass: false, detail: { skipped: 'desktop not reported as non-editable', desktop } })
    return
  }
  const modifiers = waiter.waitFor((entry) => entry.type === 'paste-last-modifiers', 4000)
  const result = waiter.waitFor((entry) => entry.type === 'paste-last-result', 4000)
  await spike.pasteLast('shortcut')
  const wait = await modifiers
  checks.push({ name: 'paste-last-modifier-gate-sees-no-held-keys', pass: wait?.released === true, detail: wait })
  const entry = await result
  checks.push({ name: 'paste-last-uses-same-checks', pass: entry?.kind === 'copied-no-text-field' && entry.sessionId === sessionId, detail: entry })
}

async function focusFinderDesktop(spike: App): Promise<FocusedElementInfo> {
  const fixture = await spike.helper.focusFinderDesktopForTest()
  const frontmost = await spike.helper.frontmost()
  const info = await spike.helper.focusedElement()
  spike.log.write('selftest-focused-element', { context: 'finder-desktop', fixture, frontmost: frontmost.bundleId ?? null, ...info })
  return info
}

function collect(spike: App): { stop(): LogEntry[] } {
  const entries: LogEntry[] = []
  let active = true
  spike.log.onEntry((entry) => {
    if (active) {
      entries.push(entry)
    }
  })
  return {
    stop: () => {
      active = false
      return entries
    },
  }
}

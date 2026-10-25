import { app as electronApp, powerMonitor } from 'electron'
import { execFile } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import { promisify } from 'node:util'
import type { LogEntry } from '../../shared/types.js'
import type { App } from '../app.js'
import type { FrontmostApp } from '../helper/InputHelper.js'
import { focusedElementChecks, noTextFieldChecks } from './FocusedElementChecks.js'
import { LogWaiter } from './LogWaiter.js'

const run = promisify(execFile)

export interface Check {
  name: string
  pass: boolean
  info?: boolean
  detail?: unknown
}

const ofType = (type: string, extra: (entry: LogEntry) => boolean = () => true) => (entry: LogEntry) => entry.type === type && extra(entry)
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function runSelfTest(spike: App): Promise<boolean> {
  const checks: Check[] = []
  const waiter = new LogWaiter(spike.log)
  const original = await spike.helper.frontmost()
  spike.log.write('selftest-start', { originalFrontmost: original.bundleId ?? null })
  await environmentChecks(spike, checks)
  await overlayChecks(spike, checks)
  await focusChangeCheck(spike, waiter, checks)
  await sameFocusPasteCheck(spike, waiter, checks)
  await resetChecks(spike, waiter, checks)
  await focusedElementChecks(spike, checks)
  await noTextFieldChecks(spike, waiter, checks)
  spike.settings.update({ transcriptionMs: 1000, restoreDelayMs: 500, maxSessionMs: 120000 })
  await reactivate(original.bundleId)
  const failed = checks.filter((check) => !check.pass && !check.info)
  spike.log.write('selftest-result', { passed: checks.length - failed.length, failed: failed.length, checks })
  console.log(JSON.stringify({ selftest: failed.length === 0 ? 'pass' : 'fail', checks }, null, 2))
  return failed.length === 0
}

async function environmentChecks(spike: App, checks: Check[]): Promise<void> {
  const permissions = await spike.helper.permissions()
  checks.push({ name: 'helper-permissions', pass: true, info: true, detail: permissions })
  checks.push({ name: 'sources', pass: true, info: true, detail: spike.router.statuses() })
  const secure = await spike.helper.secureInput()
  checks.push({ name: 'secure-input-query', pass: typeof secure.enabled === 'boolean', detail: secure })
}

async function activateFinder(spike: App): Promise<FrontmostApp> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await run('open', ['-a', 'Finder'])
    await delay(700)
    const frontmost = await spike.helper.frontmost()
    if (frontmost.bundleId === 'com.apple.finder') {
      return frontmost
    }
  }
  return spike.helper.frontmost()
}

async function overlayChecks(spike: App, checks: Check[]): Promise<void> {
  await delay(1500)
  const finder = await activateFinder(spike)
  checks.push({ name: 'finder-frontmost', pass: finder.bundleId === 'com.apple.finder', detail: finder.bundleId })
  spike.overlay.show({
    hotkey: 'up', candidate: 'swift', key: 'rightOption', sessionState: 'idle', startedAt: Date.now(), endedAt: null,
    transcript: 'Self-test overlay', message: 'Self-test', tone: 'info', canCopy: false,
  })
  const kept = await spike.audit.check('selftest-overlay', finder)
  checks.push({ name: 'overlay-showInactive-keeps-focus', pass: kept })
  checks.push({ name: 'overlay-visible', pass: spike.overlay.isVisible() })
  checks.push({ name: 'overlay-not-focused', pass: !spike.overlay.isFocused() })
  const overlayText = await spike.overlay.renderedText()
  checks.push({ name: 'overlay-renders-state', pass: overlayText.includes('Self-test overlay') && overlayText.includes('Right Option'), detail: overlayText })
  const controlRows = Number(await spike.control.window.webContents.executeJavaScript("document.querySelectorAll('#status > div').length"))
  checks.push({ name: 'control-renders-status', pass: controlRows >= 20, detail: controlRows })
  await delay(800)
  spike.overlay.hide()
}

async function focusChangeCheck(spike: App, waiter: LogWaiter, checks: Check[]): Promise<void> {
  spike.settings.update({ transcriptionMs: 1500 })
  const finder = await activateFinder(spike)
  checks.push({ name: 'finder-frontmost-before-focus-change', pass: finder.bundleId === 'com.apple.finder', detail: finder.bundleId })
  const result = waiter.waitFor(ofType('paste-result'), 6000)
  await spike.simulate('down')
  await delay(500)
  await spike.simulate('up')
  await delay(300)
  electronApp.focus({ steal: true })
  spike.control.focusForTest()
  const entry = await result
  checks.push({ name: 'focus-change-blocks-paste', pass: entry?.kind === 'focus-changed', detail: entry?.focus ?? entry?.kind ?? 'timeout' })
}

async function sameFocusPasteCheck(spike: App, waiter: LogWaiter, checks: Check[]): Promise<void> {
  spike.settings.update({ transcriptionMs: 500, restoreDelayMs: 300 })
  spike.control.focusForTest()
  await delay(500)
  await spike.control.window.webContents.executeJavaScript("document.querySelector('#paste-target').value = ''; document.querySelector('#paste-target').focus()")
  const pasted = waiter.waitFor(ofType('paste-result'), 6000)
  const restored = waiter.waitFor(ofType('clipboard-restore'), 8000)
  await spike.simulate('down')
  await delay(400)
  await spike.simulate('up')
  const pasteEntry = await pasted
  checks.push({ name: 'same-focus-runs-paste', pass: pasteEntry?.kind === 'pasted', detail: pasteEntry })
  const restoreEntry = await restored
  checks.push({ name: 'clipboard-restored-after-delay', pass: restoreEntry?.restored === true, detail: restoreEntry })
  const value = String(await spike.control.window.webContents.executeJavaScript("document.querySelector('#paste-target').value"))
  checks.push({ name: 'text-landed-in-own-textarea', pass: value.includes('Codevo test'), info: true, detail: value || '(empty - expected without Accessibility)' })
}

async function resetChecks(spike: App, waiter: LogWaiter, checks: Check[]): Promise<void> {
  await delay(2200)
  spike.settings.update({ maxSessionMs: 1500 })
  const maxReset = waiter.waitFor(ofType('session-reset', (entry) => entry.reason === 'max-duration'), 5000)
  await spike.simulate('down')
  checks.push({ name: 'reset-max-duration', pass: (await maxReset) !== null })
  const ignoredUp = waiter.waitFor(ofType('up-ignored'), 1000)
  await spike.simulate('up')
  checks.push({ name: 'late-up-ignored', pass: (await ignoredUp) !== null })
  for (const event of ['lock-screen', 'suspend']) {
    await pressThenEmit(spike, waiter, checks, event)
  }
}

async function pressThenEmit(spike: App, waiter: LogWaiter, checks: Check[], event: string): Promise<void> {
  spike.settings.update({ maxSessionMs: 120000 })
  const started = waiter.waitFor(ofType('session-start'), 2000)
  await spike.simulate('down')
  checks.push({ name: `next-press-starts-session-before-${event}`, pass: (await started) !== null })
  await delay(300)
  const reset = waiter.waitFor(ofType('session-reset', (entry) => entry.reason === event), 2000)
  ;(powerMonitor as unknown as EventEmitter).emit(event)
  checks.push({ name: `reset-on-${event}`, pass: (await reset) !== null })
  await spike.simulate('up')
}

async function reactivate(bundleId: string | undefined): Promise<void> {
  if (!bundleId) {
    return
  }
  await run('open', ['-b', bundleId]).catch(() => undefined)
}

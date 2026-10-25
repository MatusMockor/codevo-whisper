import type { ControlApi, ControlStatus, LogEntry, PermissionKind, Settings } from '../shared/types.js'

const api = (window as unknown as { spike: ControlApi }).spike
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const numberFields: Array<keyof Settings> = ['transcriptionMs', 'restoreDelayMs', 'maxSessionMs']
const boolFields: Array<keyof Settings> = ['observeBoth', 'compareWindow', 'transientClipboard', 'skipTransformProcessType']
const selectFields: Array<keyof Settings> = ['candidate', 'key']
const maxLogLines = 300

function flag(value: boolean | undefined): string {
  return value ? '<span class="ok">yes</span>' : '<span class="bad">no</span>'
}

function renderStatus(status: ControlStatus): void {
  const rows: Array<[string, string]> = [
    ['Run id', status.runId],
    ['Log file', status.logPath],
    ['Session state', status.sessionState],
    ['Helper pid', String(status.helperPid ?? 'not running')],
    ['Input Monitoring (helper)', flag(status.permissions?.listenEvent)],
    ['Post events (helper)', flag(status.permissions?.postEvent)],
    ['Accessibility (helper)', flag(status.permissions?.accessibility)],
    ['Accessibility (Electron)', flag(status.electronAccessibility)],
    ['Swift source', sourceText(status.sources.swift)],
    ['uiohook source', sourceText(status.sources.uiohook)],
    ['Posledný prepis', lastText(status.lastTranscript)],
  ]
  byId('status').innerHTML = rows.map(([label, value]) => `<div>${label}</div><div>${value}</div>`).join('')
}

function lastText(last: ControlStatus['lastTranscript']): string {
  if (!last) {
    return 'none'
  }
  return escapeHtml(`#${last.sessionId}: ${last.text}`)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function sourceText(source: { running: boolean; error?: string }): string {
  if (source.running) {
    return '<span class="ok">running</span>'
  }
  return source.error ? `<span class="bad">${source.error}</span>` : 'stopped'
}

function editable(field: keyof Settings): HTMLInputElement | null {
  const element = byId<HTMLInputElement>(field)
  return document.activeElement === element ? null : element
}

function renderSettings(settings: Settings): void {
  selectFields.forEach((field) => { const element = editable(field); if (element) element.value = String(settings[field]) })
  numberFields.forEach((field) => { const element = editable(field); if (element) element.value = String(settings[field]) })
  boolFields.forEach((field) => { const element = editable(field); if (element) element.checked = Boolean(settings[field]) })
}

function appendLog(entry: LogEntry): void {
  const log = byId('log')
  const { ts, runId, t, type, ...rest } = entry
  const line = document.createElement('div')
  line.textContent = `${ts.slice(11, 23)} ${type} ${JSON.stringify(rest)}`
  log.append(line)
  while (log.childElementCount > maxLogLines) {
    log.firstElementChild?.remove()
  }
  log.scrollTop = log.scrollHeight
}

function bindSettings(): void {
  selectFields.forEach((field) => byId(field).addEventListener('change', (event) => {
    void api.updateSettings({ [field]: (event.target as HTMLSelectElement).value } as Partial<Settings>)
  }))
  numberFields.forEach((field) => byId(field).addEventListener('change', (event) => {
    void api.updateSettings({ [field]: Number((event.target as HTMLInputElement).value) } as Partial<Settings>)
  }))
  boolFields.forEach((field) => byId(field).addEventListener('change', (event) => {
    void api.updateSettings({ [field]: (event.target as HTMLInputElement).checked } as Partial<Settings>)
  }))
}

function bindActions(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-permission]').forEach((button) => {
    button.addEventListener('click', () => void api.requestPermission(button.dataset.permission as PermissionKind))
  })
  document.querySelectorAll<HTMLButtonElement>('[data-pane]').forEach((button) => {
    button.addEventListener('click', () => void api.openPane(button.dataset.pane as PermissionKind))
  })
  byId('overlay-test').addEventListener('click', () => void api.showOverlayTest())
  byId('simulate-delayed').addEventListener('click', () => void api.simulate('delayed'))
  byId('simulate-hold').addEventListener('mousedown', () => void api.simulate('down'))
  byId('simulate-hold').addEventListener('mouseup', () => void api.simulate('up'))
  byId('paste-last').addEventListener('click', () => void api.pasteLast())
  byId('restart-helper').addEventListener('click', () => void api.restartHelper())
  byId('reveal-log').addEventListener('click', () => void api.revealLog())
}

api.onStatus((status) => {
  renderStatus(status)
  renderSettings(status.settings)
})
api.onLog(appendLog)
bindSettings()
bindActions()
void api.getStatus().then((status) => {
  renderStatus(status)
  renderSettings(status.settings)
})

import type { OverlayApi, OverlayState } from '../shared/types.js'

const api = (window as unknown as { overlay: OverlayApi }).overlay
const byId = (id: string) => document.getElementById(id) as HTMLElement
const keyLabels: Record<OverlayState['key'], string> = { rightOption: 'Right Option', leftOption: 'Left Option', fn: 'Fn', rightCommand: 'Right Command', rightControl: 'Right Control' }
let current: OverlayState | null = null

function elapsed(state: OverlayState): string {
  if (state.startedAt === null) {
    return ''
  }
  const end = state.endedAt ?? Date.now()
  return `${((end - state.startedAt) / 1000).toFixed(1)} s`
}

function render(state: OverlayState): void {
  byId('dot').className = state.hotkey === 'down' ? 'dot down' : 'dot'
  byId('hotkey').textContent = `${keyLabels[state.key]} ${state.hotkey}`
  byId('meta').textContent = `${state.candidate} - ${state.sessionState}`
  byId('elapsed').textContent = elapsed(state)
  byId('transcript').textContent = state.transcript
  byId('message').textContent = state.message
  byId('message').className = `message ${state.tone}`
  byId('copy').hidden = !state.canCopy
}

api.onState((state) => {
  current = state
  render(state)
})

byId('copy').addEventListener('click', () => api.copy())

setInterval(() => current && render(current), 100)

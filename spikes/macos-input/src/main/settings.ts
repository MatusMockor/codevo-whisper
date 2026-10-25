import type { Settings } from '../shared/types.js'

export type SettingsListener = (next: Settings, previous: Settings) => void

export const defaultSettings: Settings = {
  candidate: 'swift',
  key: 'rightControl',
  observeBoth: false,
  transcriptionMs: 1000,
  restoreDelayMs: 500,
  maxSessionMs: 120000,
  compareWindow: true,
  transientClipboard: true,
  skipTransformProcessType: true,
}

export class SettingsStore {
  private current: Settings
  private readonly listeners: SettingsListener[] = []

  constructor(initial: Settings) {
    this.current = initial
  }

  get(): Settings {
    return this.current
  }

  update(patch: Partial<Settings>): Settings {
    const previous = this.current
    this.current = { ...previous, ...patch }
    this.listeners.forEach((listener) => listener(this.current, previous))
    return this.current
  }

  onChange(listener: SettingsListener): void {
    this.listeners.push(listener)
  }
}

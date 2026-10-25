import type { Candidate, HotkeyKey, KeyPhase, SourceStatus } from '../../shared/types.js'

export interface RawKeyEvent {
  source: Candidate | 'simulated'
  phase: KeyPhase
  keycode: number
  ts: number
}

export type RawKeyListener = (event: RawKeyEvent) => void

export interface HotkeySource {
  readonly id: Candidate
  start(key: HotkeyKey): Promise<SourceStatus>
  stop(): Promise<void>
  status(): SourceStatus
  onEvent(listener: RawKeyListener): void
}

export type Candidate = 'swift' | 'uiohook'
export type HotkeyKey = 'rightOption' | 'leftOption' | 'fn' | 'rightCommand' | 'rightControl'
export type KeyPhase = 'down' | 'up'
export type SessionState = 'idle' | 'recording' | 'transcribing' | 'inserting' | 'result'
export type PermissionKind = 'listen' | 'post' | 'accessibility'
export type SimulateKind = 'down' | 'up' | 'delayed'

export interface Settings {
  candidate: Candidate
  key: HotkeyKey
  observeBoth: boolean
  transcriptionMs: number
  restoreDelayMs: number
  maxSessionMs: number
  compareWindow: boolean
  transientClipboard: boolean
  skipTransformProcessType: boolean
}

export interface SourceStatus {
  running: boolean
  error?: string
}

export interface PermissionStatus {
  listenEvent: boolean
  postEvent: boolean
  accessibility: boolean
}

export interface ControlStatus {
  runId: string
  logPath: string
  settings: Settings
  sessionState: SessionState
  helperPid: number | null
  permissions: PermissionStatus | null
  electronAccessibility: boolean
  sources: Record<Candidate, SourceStatus>
}

export interface OverlayState {
  hotkey: KeyPhase
  candidate: Candidate
  key: HotkeyKey
  sessionState: SessionState
  startedAt: number | null
  endedAt: number | null
  transcript: string
  message: string
  tone: 'info' | 'ok' | 'warn'
  canCopy: boolean
}

export interface LogEntry {
  ts: string
  t: number
  runId: string
  type: string
  [key: string]: unknown
}

export interface ControlApi {
  getStatus(): Promise<ControlStatus>
  updateSettings(patch: Partial<Settings>): Promise<ControlStatus>
  simulate(kind: SimulateKind): Promise<void>
  requestPermission(kind: PermissionKind): Promise<void>
  openPane(kind: PermissionKind): Promise<void>
  showOverlayTest(): Promise<void>
  restartHelper(): Promise<void>
  revealLog(): Promise<void>
  onStatus(listener: (status: ControlStatus) => void): void
  onLog(listener: (entry: LogEntry) => void): void
}

export interface OverlayApi {
  onState(listener: (state: OverlayState) => void): void
  copy(): void
}

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LogEntry } from '../shared/types.js'

export type LogData = Record<string, unknown>
export type LogListener = (entry: LogEntry) => void

export interface EventLog {
  readonly path: string
  readonly runId: string
  write(type: string, data?: LogData): void
  onEntry(listener: LogListener): void
}

export class JsonlLog implements EventLog {
  private readonly listeners: LogListener[] = []

  constructor(readonly path: string, readonly runId: string) {
    mkdirSync(dirname(path), { recursive: true })
  }

  write(type: string, data: LogData = {}): void {
    const now = Date.now()
    const entry: LogEntry = { ts: new Date(now).toISOString(), t: now, runId: this.runId, type, ...data }
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`)
    this.listeners.forEach((listener) => listener(entry))
  }

  onEntry(listener: LogListener): void {
    this.listeners.push(listener)
  }
}

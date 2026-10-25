import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { EventLog } from '../logger.js'

export type HelperMessage = Record<string, unknown>
export type HelperEventListener = (message: HelperMessage) => void

interface Pending {
  resolve: (message: HelperMessage) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class HelperProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly listeners: HelperEventListener[] = []
  private readyResolver: (() => void) | null = null

  constructor(private readonly binaryPath: string, private readonly log: EventLog) {}

  get pid(): number | null {
    return this.child?.pid ?? null
  }

  start(): Promise<void> {
    const child = spawn(this.binaryPath, ['serve'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    const ready = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      this.readyResolver = resolve
    })
    createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line))
    createInterface({ input: child.stderr }).on('line', (line) => this.log.write('helper-stderr', { line }))
    child.on('exit', (code, signal) => this.handleExit(child, code, signal))
    return ready
  }

  stop(): void {
    this.child?.stdin.end()
    this.child?.kill()
    this.child = null
  }

  onEvent(listener: HelperEventListener): void {
    this.listeners.push(listener)
  }

  request(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 2000): Promise<HelperMessage> {
    const child = this.child
    if (!child) {
      return Promise.reject(new Error('helper-not-running'))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(id, new Error(`helper-timeout:${cmd}`)), timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`)
    })
  }

  private handleLine(line: string): void {
    const message = this.parse(line)
    if (!message) {
      this.log.write('helper-invalid-line', { line })
      return
    }
    if (typeof message.id === 'number') {
      this.settle(message.id, message)
      return
    }
    if (message.event === 'ready') {
      this.readyResolver?.()
      this.readyResolver = null
    }
    this.listeners.forEach((listener) => listener(message))
  }

  private parse(line: string): HelperMessage | null {
    try {
      return JSON.parse(line) as HelperMessage
    } catch {
      return null
    }
  }

  private settle(id: number, message: HelperMessage): void {
    const pending = this.pending.get(id)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.resolve(message)
  }

  private fail(id: number, error: Error): void {
    const pending = this.pending.get(id)
    if (!pending) {
      return
    }
    this.pending.delete(id)
    pending.reject(error)
  }

  private handleExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): void {
    this.log.write('helper-exit', { pid: child.pid ?? null, code, signal })
    if (this.child === child) {
      this.child = null
    }
    ;[...this.pending.keys()].forEach((id) => this.fail(id, new Error('helper-exited')))
  }
}

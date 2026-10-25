import type { LogEntry } from '../../shared/types.js'
import type { EventLog } from '../logger.js'

type Predicate = (entry: LogEntry) => boolean

interface Waiter {
  predicate: Predicate
  resolve: (entry: LogEntry | null) => void
}

export class LogWaiter {
  private waiters: Waiter[] = []

  constructor(log: EventLog) {
    log.onEntry((entry) => this.handle(entry))
  }

  waitFor(predicate: Predicate, timeoutMs: number): Promise<LogEntry | null> {
    return new Promise((resolve) => {
      const waiter: Waiter = { predicate, resolve }
      this.waiters.push(waiter)
      setTimeout(() => this.settle(waiter, null), timeoutMs)
    })
  }

  private handle(entry: LogEntry): void {
    this.waiters.filter((waiter) => waiter.predicate(entry)).forEach((waiter) => this.settle(waiter, entry))
  }

  private settle(waiter: Waiter, entry: LogEntry | null): void {
    if (!this.waiters.includes(waiter)) {
      return
    }
    this.waiters = this.waiters.filter((candidate) => candidate !== waiter)
    waiter.resolve(entry)
  }
}

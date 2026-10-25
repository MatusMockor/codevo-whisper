import type { EventLog } from '../logger.js'

export type ResetReason = 'max-duration' | 'lock-screen' | 'suspend'
export type ResetListener = (reason: ResetReason) => void

export interface PowerEvents {
  on(event: string, listener: () => void): unknown
}

const resetEvents: ResetReason[] = ['lock-screen', 'suspend']
const loggedEvents = ['unlock-screen', 'resume', 'shutdown', 'user-did-resign-active', 'user-did-become-active']

export class ResetGuard {
  private timer: NodeJS.Timeout | null = null
  private readonly listeners: ResetListener[] = []

  constructor(power: PowerEvents, private readonly log: EventLog) {
    resetEvents.forEach((event) => power.on(event, () => this.handlePower(event)))
    loggedEvents.forEach((event) => power.on(event, () => this.log.write('power-event', { event })))
  }

  onReset(listener: ResetListener): void {
    this.listeners.push(listener)
  }

  arm(sessionId: number, maxMs: number): void {
    this.disarm()
    this.timer = setTimeout(() => {
      this.timer = null
      this.log.write('reset-rule-triggered', { rule: 'max-duration', sessionId, maxMs })
      this.trigger('max-duration')
    }, maxMs)
  }

  disarm(): void {
    if (!this.timer) {
      return
    }
    clearTimeout(this.timer)
    this.timer = null
  }

  private handlePower(event: ResetReason): void {
    this.log.write('power-event', { event })
    this.log.write('reset-rule-triggered', { rule: event })
    this.trigger(event)
  }

  private trigger(reason: ResetReason): void {
    this.listeners.forEach((listener) => listener(reason))
  }
}

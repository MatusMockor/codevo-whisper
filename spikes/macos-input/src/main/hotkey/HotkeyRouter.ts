import type { Candidate, Settings, SourceStatus } from '../../shared/types.js'
import type { EventLog } from '../logger.js'
import type { HotkeySource, RawKeyEvent } from './HotkeySource.js'

export interface KeyTarget {
  press(event: RawKeyEvent): void
  release(event: RawKeyEvent): void
}

export class HotkeyRouter {
  private active: Candidate = 'swift'

  constructor(
    private readonly sources: Record<Candidate, HotkeySource>,
    private readonly target: KeyTarget,
    private readonly log: EventLog,
  ) {
    Object.values(sources).forEach((source) => source.onEvent((event) => this.route(event)))
  }

  async apply(settings: Settings): Promise<void> {
    this.active = settings.candidate
    await Promise.all(Object.values(this.sources).map((source) => source.stop()))
    const wanted = Object.values(this.sources).filter((source) => settings.observeBoth || source.id === settings.candidate)
    for (const source of wanted) {
      const status = await source.start(settings.key)
      this.log.write('hotkey-source', { source: source.id, key: settings.key, active: source.id === this.active, ...status })
    }
  }

  statuses(): Record<Candidate, SourceStatus> {
    return { swift: this.sources.swift.status(), uiohook: this.sources.uiohook.status() }
  }

  async stopAll(): Promise<void> {
    await Promise.all(Object.values(this.sources).map((source) => source.stop()))
  }

  private route(event: RawKeyEvent): void {
    const active = event.source === this.active
    this.log.write(`key-${event.phase}`, { source: event.source, keycode: event.keycode, eventTs: event.ts, active })
    if (!active) {
      return
    }
    this.dispatch(event)
  }

  private dispatch(event: RawKeyEvent): void {
    if (event.phase === 'down') {
      this.target.press(event)
      return
    }
    this.target.release(event)
  }
}

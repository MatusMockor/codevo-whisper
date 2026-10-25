import type { EventLog } from '../logger.js'
import type { InputHelper } from '../helper/InputHelper.js'

interface RestoreJob {
  sessionId: number
  changeCount: number
  text: string
  delayMs: number
  scheduledAt: number
}

export class ClipboardRestorer {
  private pending: { job: RestoreJob; timer: NodeJS.Timeout } | null = null

  constructor(private readonly helper: InputHelper, private readonly log: EventLog) {}

  schedule(job: Omit<RestoreJob, 'scheduledAt'>): void {
    const full = { ...job, scheduledAt: Date.now() }
    const timer = setTimeout(() => void this.run('timer'), job.delayMs)
    this.pending = { job: full, timer }
  }

  async flush(trigger: string): Promise<void> {
    if (!this.pending) {
      return
    }
    clearTimeout(this.pending.timer)
    await this.run(trigger)
  }

  private async run(trigger: string): Promise<void> {
    const pending = this.pending
    if (!pending) {
      return
    }
    this.pending = null
    const { job } = pending
    const result = await this.helper
      .clipboardRestore({ expectedChangeCount: job.changeCount, expectedText: job.text })
      .catch((error: unknown) => ({ restored: false, reason: String(error) }))
    this.log.write('clipboard-restore', {
      sessionId: job.sessionId,
      trigger,
      delayMs: job.delayMs,
      elapsedMs: Date.now() - job.scheduledAt,
      ...result,
    })
  }
}

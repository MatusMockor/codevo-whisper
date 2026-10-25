import type { EventLog } from '../logger.js'
import type { FrontmostApp } from '../helper/InputHelper.js'

export interface FrontmostProbe {
  frontmost(): Promise<FrontmostApp>
}

export interface OverlayProbe {
  isVisible(): boolean
  isFocused(): boolean
}

export class OverlayFocusAudit {
  constructor(
    private readonly probe: FrontmostProbe,
    private readonly overlay: OverlayProbe,
    private readonly log: EventLog,
    private readonly delayMs = 300,
  ) {}

  check(context: string, expected: FrontmostApp | null): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.probe
          .frontmost()
          .then((actual) => resolve(this.report(context, expected, actual)))
          .catch((error: unknown) => {
            this.log.write('overlay-focus-check', { context, error: String(error) })
            resolve(false)
          })
      }, this.delayMs)
    })
  }

  private report(context: string, expected: FrontmostApp | null, actual: FrontmostApp): boolean {
    const kept = expected === null || expected.pid === actual.pid
    this.log.write('overlay-focus-check', {
      context,
      expectedPid: expected?.pid ?? null,
      expectedApp: expected?.bundleId ?? null,
      actualPid: actual.pid,
      actualApp: actual.bundleId ?? null,
      focusKept: kept,
      overlayVisible: this.overlay.isVisible(),
      overlayFocused: this.overlay.isFocused(),
    })
    return kept
  }
}

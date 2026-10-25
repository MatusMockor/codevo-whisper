import type { HelperMessage } from '../helper/HelperProcess.js'
import type { InputHelper } from '../helper/InputHelper.js'
import type { EventLog } from '../logger.js'
import type { PasteLastTrigger } from '../paste/PasteLastAction.js'

export interface PasteLastRunner {
  run(trigger: PasteLastTrigger): Promise<void>
}

export class ShortcutListener {
  constructor(
    helper: Pick<InputHelper, 'onEvent'>,
    private readonly action: PasteLastRunner,
    private readonly log: EventLog,
  ) {
    helper.onEvent((message) => this.handle(message))
  }

  private handle(message: HelperMessage): void {
    if (message.event !== 'shortcut' || message.name !== 'paste-last') {
      return
    }
    const eventTs = Number(message.ts)
    this.log.write('shortcut', { name: message.name, keycode: message.keycode, flags: message.flags, eventTs, latencyMs: Date.now() - eventTs, targetAlsoReceives: true })
    void this.action.run('shortcut')
  }
}

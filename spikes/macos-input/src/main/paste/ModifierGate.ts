import type { InputHelper, ModifierFlags } from '../helper/InputHelper.js'

const controlAndCommand = 0x40000 | 0x100000
const none: ModifierFlags = { hid: 0, combined: 0 }

export interface ModifierWait {
  released: boolean
  waitedMs: number
  hidFlags: number
  combinedFlags: number
}

export class ModifierGate {
  constructor(
    private readonly helper: Pick<InputHelper, 'modifierFlags'>,
    private readonly timeoutMs = 1000,
    private readonly pollMs = 30,
  ) {}

  async waitForRelease(): Promise<ModifierWait> {
    const started = Date.now()
    let flags = await this.read()
    while (held(flags) && Date.now() - started < this.timeoutMs) {
      await delay(this.pollMs)
      flags = await this.read()
    }
    return { released: !held(flags), waitedMs: Date.now() - started, hidFlags: flags.hid, combinedFlags: flags.combined }
  }

  private read(): Promise<ModifierFlags> {
    return this.helper.modifierFlags().catch(() => none)
  }
}

function held(flags: ModifierFlags): boolean {
  return (flags.hid & controlAndCommand) !== 0
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

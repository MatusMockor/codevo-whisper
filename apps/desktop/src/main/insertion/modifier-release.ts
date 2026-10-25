import type { InputHelper } from '../helper/input-helper';

export type Sleep = (ms: number) => Promise<void>;

const RELEASE_TIMEOUT_MS = 1000;
const POLL_INTERVAL_MS = 50;

export async function waitForShortcutRelease(helper: Pick<InputHelper, 'modifierFlags'>, sleep: Sleep): Promise<boolean> {
  for (let waited = 0; ; waited += POLL_INTERVAL_MS) {
    const flags = await helper.modifierFlags();
    if (!flags.control && !flags.command) {
      return true;
    }
    if (waited >= RELEASE_TIMEOUT_MS) {
      return false;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

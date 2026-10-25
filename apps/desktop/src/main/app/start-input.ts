import type { InputHelper } from '../helper/input-helper';
import type { Logger } from '../logging/logger';

export type Startable = { start(): Promise<void> };

export function startInput(helper: Pick<InputHelper, 'start'>, hotkeys: Startable, logger: Logger): Promise<void> {
  return helper
    .start()
    .then(() => hotkeys.start())
    .catch((error: unknown) => {
      logger.error('The hotkey is unavailable', error);
    });
}

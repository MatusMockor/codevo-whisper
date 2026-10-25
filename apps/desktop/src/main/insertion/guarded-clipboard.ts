import type { InputHelper } from '../helper/input-helper';
import type { Logger } from '../logging/logger';

export type ClipboardHelper = Pick<InputHelper, 'saveClipboard' | 'writeClipboard' | 'restoreSavedClipboard'>;

export async function writeClipboardOrRestore(helper: ClipboardHelper, text: string, logger: Logger): Promise<boolean> {
  await helper.saveClipboard();
  try {
    await helper.writeClipboard(text);
    return true;
  } catch (error) {
    logger.error('The clipboard could not be written, restoring the saved clipboard', error);
    await helper.restoreSavedClipboard();
    return false;
  }
}

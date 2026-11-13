import { LockedTargetLostError, type ClipboardPurpose, type InputHelper } from '../helper/input-helper';
import type { Logger } from '../logging/logger';

export type ClipboardHelper = Pick<InputHelper, 'saveClipboard' | 'writeClipboard' | 'restoreSavedClipboard'>;

export async function writeClipboardOrRestore(helper: ClipboardHelper, text: string, logger: Logger, purpose: ClipboardPurpose = { kind: 'copy' }, captureId?: string): Promise<boolean> {
  try {
    await helper.saveClipboard(purpose);
    await helper.writeClipboard(text, captureId);
    return true;
  } catch (error) {
    logger.error('The clipboard could not be written, restoring the saved clipboard', error);
    await helper.restoreSavedClipboard();
    if (error instanceof LockedTargetLostError) throw error;
    return false;
  }
}

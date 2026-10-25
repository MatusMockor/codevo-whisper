import type { InputHelper } from '../helper/input-helper';

export type ClipboardHelper = Pick<InputHelper, 'saveClipboard' | 'writeClipboard' | 'restoreSavedClipboard'>;

export async function writeClipboardOrRestore(helper: ClipboardHelper, text: string): Promise<boolean> {
  await helper.saveClipboard();
  try {
    await helper.writeClipboard(text);
    return true;
  } catch {
    await helper.restoreSavedClipboard();
    return false;
  }
}

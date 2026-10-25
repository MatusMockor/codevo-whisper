import type { InputHelper } from '../helper/input-helper';
import { HOTKEY_LABELS, isHotkeyKeycode } from '../../shared/hotkey-labels';
import type { HotkeySetting } from '../../shared/settings';

export type RecordResult = NonNullable<HotkeySetting> | 'unsupported' | 'timeout';

const DEFAULT_RECORD_TIMEOUT_MS = 10_000;

export class KeyRecorder {
  constructor(private readonly helper: InputHelper) {}

  async record(timeoutMs = DEFAULT_RECORD_TIMEOUT_MS): Promise<RecordResult> {
    const keycode = await this.helper.recordKey(timeoutMs);
    if (keycode === null) {
      return 'timeout';
    }
    if (!isHotkeyKeycode(keycode)) {
      return 'unsupported';
    }
    return { keycode, label: HOTKEY_LABELS[keycode] };
  }
}

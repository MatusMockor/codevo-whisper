import type { InputHelper } from '../helper/input-helper';
import type { HotkeyRecordResult } from '../../shared/hotkey-record';
import type { HotkeyService } from './hotkey-service';

export type RecordResult = HotkeyRecordResult;

const DEFAULT_RECORD_TIMEOUT_MS = 10_000;

export class KeyRecorder {
  constructor(private readonly helper: InputHelper, private readonly hotkey: Pick<HotkeyService, 'cancel'>) {}

  record(timeoutMs = DEFAULT_RECORD_TIMEOUT_MS): Promise<RecordResult> {
    this.hotkey.cancel();
    return this.helper.recordHotkey(timeoutMs);
  }
}

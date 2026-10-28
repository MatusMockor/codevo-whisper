import { describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { KeyRecorder } from '../src/main/hotkey/key-recorder';

const COMBO = { kind: 'key', keycode: 49, modifiers: ['control'], label: '⌃Space' } as const;

describe('KeyRecorder', () => {
  it.each([COMBO, { kind: 'modifiers', keycodes: [58, 59], label: '⌃⌥' }, 'unsupported', 'timeout', 'cancelled'] as const)('returns the complete helper result: %j', async (recordedHotkey) => {
    const helper = new FakeInputHelper({ recordedHotkey });
    const recorder = new KeyRecorder(helper, { cancel: () => undefined });
    expect(await recorder.record(500)).toEqual(recordedHotkey);
    expect(helper.recordTimeouts).toEqual([500]);
  });
});

import { describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { KeyRecorder } from '../src/main/hotkey/key-recorder';

describe('KeyRecorder', () => {
  it('returns the recorded key with its label', async () => {
    const helper = new FakeInputHelper({ recordedKey: 61 });

    const result = await new KeyRecorder(helper).record();

    expect(result).toEqual({ keycode: 61, label: 'Pravý ⌥ Option' });
    expect(helper.recordTimeouts).toEqual([10_000]);
  });

  it.each([
    [63, 'Fn / 🌐'],
    [58, 'Ľavý ⌥ Option'],
    [61, 'Pravý ⌥ Option'],
    [54, 'Pravý ⌘ Command'],
    [62, 'Pravý ⌃ Control'],
  ])('labels keycode %i as %s', async (keycode, label) => {
    const helper = new FakeInputHelper({ recordedKey: keycode });

    expect(await new KeyRecorder(helper).record()).toEqual({ keycode, label });
  });

  it('returns unsupported for a letter key', async () => {
    const helper = new FakeInputHelper({ recordedKey: 0 });

    expect(await new KeyRecorder(helper).record()).toBe('unsupported');
  });

  it('returns timeout', async () => {
    const helper = new FakeInputHelper({ recordedKey: null });

    expect(await new KeyRecorder(helper).record(500)).toBe('timeout');
    expect(helper.recordTimeouts).toEqual([500]);
  });
});

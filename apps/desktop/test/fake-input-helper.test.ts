import { describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import type { KeyEvent } from '../src/main/helper/input-helper';

describe('FakeInputHelper', () => {
  it('restores the saved clipboard only while it still holds the expected text', async () => {
    const helper = new FakeInputHelper({ clipboard: 'original' });

    await helper.saveClipboard();
    await helper.writeClipboard('dictated');
    await helper.paste();
    const restored = await helper.restoreClipboard('dictated');
    await helper.saveClipboard();
    await helper.writeClipboard('second');
    helper.clipboard = 'user copied';
    const kept = await helper.restoreClipboard('second');

    expect(restored).toBe(true);
    expect(kept).toBe(false);
    expect(helper.clipboard).toBe('user copied');
    expect(helper.pasted).toEqual(['dictated']);
  });

  it('emits only the keys it listens to', async () => {
    const helper = new FakeInputHelper();
    const keys: KeyEvent[] = [];
    helper.onKey((event) => keys.push(event));

    await helper.listen([63]);
    helper.pressKey('down', 61, 1);
    helper.pressKey('down', 63, 2);

    expect(keys).toEqual([{ phase: 'down', keycode: 63, ts: 2 }]);
  });

  it('answers the scripted OS state', async () => {
    const target = { bundleId: 'com.apple.Notes', pid: 9, name: 'Notes', windowId: null };
    const helper = new FakeInputHelper({ frontmost: target, editable: false, role: 'AXList', secureInput: true, recordedKey: 58 });
    const shortcuts: string[] = [];
    helper.onShortcut((name) => shortcuts.push(name));

    helper.pressPasteLast();

    expect(await helper.frontmost()).toEqual(target);
    expect(await helper.focusedElement()).toEqual({ editable: false, role: 'AXList' });
    expect(await helper.secureInput()).toBe(true);
    expect(await helper.recordKey(1000)).toBe(58);
    expect(shortcuts).toEqual(['paste-last']);
  });
});

import { describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import type { HotkeyEvent } from '../src/shared/hotkey';

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

  it('clears the clipboard on a failed write like the helper and force restores the saved one', async () => {
    const helper = new FakeInputHelper({ clipboard: 'original', clipboardWriteFails: true });

    await helper.saveClipboard();
    await expect(helper.writeClipboard('dictated')).rejects.toThrow('clipboard-write-failed');
    const cleared = helper.clipboard;
    const restored = await helper.restoreSavedClipboard();

    expect(cleared).toBe('');
    expect(restored).toBe(true);
    expect(helper.clipboard).toBe('original');
    expect(await helper.restoreSavedClipboard()).toBe(false);
  });

  it('answers the scripted modifier flags and counts the queries', async () => {
    const helper = new FakeInputHelper({ modifiers: { control: true, command: false, option: false, shift: true } });

    expect(await helper.modifierFlags()).toEqual({ control: true, command: false, option: false, shift: true });
    helper.modifiers = { control: false, command: false, option: false, shift: false };
    expect(await helper.modifierFlags()).toEqual({ control: false, command: false, option: false, shift: false });
    expect(helper.modifierQueries).toBe(2);
  });

  it('emits logical edges only while configured', async () => {
    const helper = new FakeInputHelper();
    const keys: HotkeyEvent[] = [];
    helper.onHotkey((event) => keys.push(event));

    helper.emitHotkey('down', 1);
    await helper.listen({ kind: 'modifiers', keycodes: [63] });
    helper.emitHotkey('down', 2);

    expect(keys).toEqual([{ phase: 'down', ts: 2 }]);
  });

  it('answers the scripted OS state', async () => {
    const target = { bundleId: 'com.apple.Notes', pid: 9, name: 'Notes', windowId: null };
    const helper = new FakeInputHelper({ frontmost: target, editable: false, role: 'AXList', secureInput: true, recordedHotkey: { kind: 'modifiers', keycodes: [58], label: 'Ľavý ⌥ Option' } });
    const shortcuts: string[] = [];
    helper.onShortcut((name) => shortcuts.push(name));

    helper.pressPasteLast();

    expect(await helper.frontmost()).toEqual(target);
    expect(await helper.focusedElement()).toEqual({ editable: false, role: 'AXList' });
    expect(await helper.secureInput()).toBe(true);
    expect(await helper.recordHotkey(1000)).toEqual({ kind: 'modifiers', keycodes: [58], label: 'Ľavý ⌥ Option' });
    expect(shortcuts).toEqual(['paste-last']);
  });
});

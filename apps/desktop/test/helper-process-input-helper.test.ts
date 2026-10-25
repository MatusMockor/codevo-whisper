import { afterEach, describe, expect, it } from 'vitest';
import type { HelperProcess } from '../src/main/helper/helper-process';
import { HelperProcessInputHelper } from '../src/main/helper/helper-process-input-helper';
import type { InputLostReason, KeyEvent } from '../src/main/helper/input-helper';
import { protocolHelper } from './protocol-helper';

let channel: HelperProcess | null = null;
let helper: HelperProcessInputHelper | null = null;

afterEach(async () => {
  await helper?.stop();
  helper = null;
  channel = null;
});

async function started(timeoutMs?: number): Promise<{ channel: HelperProcess; helper: HelperProcessInputHelper }> {
  channel = protocolHelper(timeoutMs);
  helper = new HelperProcessInputHelper(channel);
  await helper.start();
  return { channel, helper };
}

describe('HelperProcessInputHelper', () => {
  it('maps helper responses to typed results', async () => {
    const { helper } = await started();

    expect(await helper.permissions()).toEqual({ listen: true, post: false, accessibility: true });
    expect(await helper.frontmost()).toEqual({ bundleId: 'com.apple.TextEdit', pid: 42, name: 'TextEdit', windowId: 7 });
    expect(await helper.focusedElement()).toEqual({ editable: null, role: 'AXWebArea' });
    await expect(helper.paste()).rejects.toThrow('paste-failed:no-event-source');
  });

  it('rejects a clipboard write the helper could not perform', async () => {
    const { channel, helper } = await started();
    await channel.request('respond-next', { cmd: 'clipboard-write', response: { written: false, reason: 'set-string-failed' } });

    await expect(helper.writeClipboard('dictated')).rejects.toThrow('clipboard-write-failed:set-string-failed');
    await expect(helper.writeClipboard('dictated')).resolves.toBeUndefined();
  });

  it('rejects malformed secure-input and restore results instead of assuming them', async () => {
    const { channel, helper } = await started();
    await channel.request('respond-next', { cmd: 'secure-input', response: {} });
    await channel.request('respond-next', { cmd: 'clipboard-restore', response: { restored: 'true' } });

    await expect(helper.secureInput()).rejects.toThrow('secure-input-invalid');
    await expect(helper.restoreClipboard('dictated')).rejects.toThrow('clipboard-restore-invalid');
    expect(await helper.secureInput()).toBe(false);
    expect(await helper.restoreClipboard('dictated')).toBe(true);
  });

  it('gives the focused element query longer than the default timeout', async () => {
    const { channel, helper } = await started(100);
    await channel.request('respond-next', { cmd: 'focused-element', response: { editable: true, role: 'AXTextArea' }, delayMs: 250 });

    expect(await helper.focusedElement()).toEqual({ editable: true, role: 'AXTextArea' });
  });

  it('forwards key events and the paste-last shortcut', async () => {
    const { channel, helper } = await started();
    const keys: KeyEvent[] = [];
    const shortcuts: string[] = [];
    const unsubscribe = helper.onKey((event) => keys.push(event));
    helper.onShortcut((name) => shortcuts.push(name));

    await channel.request('emit', { event: { event: 'key', phase: 'down', keycode: 61, ts: 5 } });
    await channel.request('emit', { event: { event: 'shortcut', name: 'paste-last' } });
    unsubscribe();
    await channel.request('emit', { event: { event: 'key', phase: 'up', keycode: 61, ts: 6 } });

    expect(keys).toEqual([{ phase: 'down', keycode: 61, ts: 5 }]);
    expect(shortcuts).toEqual(['paste-last']);
  });

  it('returns the recorded key, an unsupported key or null on timeout', async () => {
    const { channel, helper } = await started();

    const recorded = helper.recordKey(1000);
    await channel.request('emit', { event: { event: 'recorded', keycode: 62 } });
    const unsupported = helper.recordKey(1000);
    await channel.request('emit', { event: { event: 'record-unsupported', keycode: 0 } });

    expect(await recorded).toBe(62);
    expect(await unsupported).toBe(0);
    expect(await helper.recordKey(50)).toBeNull();
  });

  it('reports lost input on tap events and after a helper restart', async () => {
    const { channel, helper } = await started();
    const reasons: InputLostReason[] = [];
    helper.onInputLost((reason) => reasons.push(reason));

    await channel.request('emit', { event: { event: 'tap-reenabled', reason: 'timeout' } });
    await channel.request('emit', { event: { event: 'tap-error', reason: 'tap-create-failed' } });
    await channel.request('emit', { event: { event: 'key', phase: 'down', keycode: 61, ts: 5 } });
    await expect(channel.request('crash')).rejects.toThrow('helper-exited');

    await expect.poll(() => reasons).toEqual(['tap-reenabled', 'tap-error', 'helper-restarted']);
  });

  it('listens again after the helper restarts', async () => {
    const { channel, helper } = await started();
    await helper.listen([61, 63]);

    await expect(channel.request('crash')).rejects.toThrow('helper-exited');
    await expect.poll(async () => (await channel.request('listen-state')).keycodes).toEqual([61, 63]);
  });
});

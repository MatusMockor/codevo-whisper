import { afterEach, describe, expect, it } from 'vitest';
import type { HelperProcess } from '../src/main/helper/helper-process';
import { HelperProcessInputHelper } from '../src/main/helper/helper-process-input-helper';
import type { InputLostReason } from '../src/main/helper/input-helper';
import type { HotkeyEvent } from '../src/shared/hotkey';
import { protocolHelper } from './protocol-helper';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

let channel: HelperProcess | null = null;
let helper: HelperProcessInputHelper | null = null;

afterEach(async () => {
  await helper?.stop();
  helper = null;
  channel = null;
});

async function started(timeoutMs?: number): Promise<{ channel: HelperProcess; helper: HelperProcessInputHelper }> {
  channel = protocolHelper(timeoutMs);
  helper = new HelperProcessInputHelper(channel, undefined, 'darwin');
  await helper.start();
  return { channel, helper };
}

describe('HelperProcessInputHelper', () => {
  it('does no audio work with both switches off and exposes unavailable production platforms', async () => {
    const { channel, helper } = await started();
    const lease = await helper.beginRecordingAudio(DEFAULT_SETTINGS);
    await lease.finish({ playStop: true });
    expect((await channel.request('audio-state'))['operations']).toEqual([]);
    const unsupported = new HelperProcessInputHelper(channel, undefined, 'linux');
    expect(await unsupported.getOutputAudio()).toEqual({ kind: 'unavailable', reason: 'platform' });
    await expect(unsupported.beginRecordingAudio({ ...DEFAULT_SETTINGS, muteWhileRecording: true })).rejects.toThrow('recording-audio-unavailable');
  });
  it('requires explicit audio acknowledgments and cleans the same token after begin failure or timeout', async () => {
    const { channel, helper } = await started(50);
    for (const response of [{ begun: false }, {}, { begun: 'true' }]) {
      await channel.request('respond-next', { cmd: 'recording-audio-begin', response });
      await expect(helper.beginRecordingAudio({ ...DEFAULT_SETTINGS, muteWhileRecording: true })).rejects.toThrow('recording-audio-begin-failed');
    }
    await channel.request('respond-next', { cmd: 'recording-audio-begin', response: { begun: true }, delayMs: 100 });
    await expect(helper.beginRecordingAudio({ ...DEFAULT_SETTINGS, muteWhileRecording: true })).rejects.toThrow();
    expect((await channel.request('audio-state'))['operations']).toEqual([1, 2, 3, 4].map((token) => ({ cmd: 'recording-audio-end', token, playStop: false })));
    const lease = await helper.beginRecordingAudio({ ...DEFAULT_SETTINGS, audioFeedback: true });
    await channel.request('respond-next', { cmd: 'recording-audio-end', response: { ended: false, reason: 'restore-pending' } });
    await expect(lease.finish({ playStop: true })).rejects.toThrow('recording-audio-end-failed');
  });
  it('rejects malformed output inventories instead of assuming mute capability', async () => {
    const { channel, helper } = await started();
    for (const response of [{ kind: 'available', outputs: [], canMute: 'yes' }, { kind: 'available', outputs: [{ id: '', label: 'bad' }], canMute: true }, {}]) {
      await channel.request('respond-next', { cmd: 'output-audio', response });
      await expect(helper.getOutputAudio()).rejects.toThrow('output-audio-invalid');
    }
  });
  it('discovers real protocol outputs and sends integer preferences through a private idempotent lease', async () => {
    const { channel, helper } = await started();
    expect(await helper.getOutputAudio()).toEqual({ kind: 'available', outputs: [{ id: 'speakers', label: 'Speakers' }], canMute: true });
    const lease = await helper.beginRecordingAudio({ ...DEFAULT_SETTINGS, muteWhileRecording: true, audioFeedback: true, feedbackVolume: 73, feedbackOutputId: 'speakers' });
    await Promise.all([lease.finish({ playStop: true }), lease.finish({ playStop: true })]);
    const { operations } = await channel.request('audio-state');
    expect(operations).toEqual([
      { cmd: 'recording-audio-begin', token: 1, mute: true, feedback: true, outputId: 'speakers', volume: 73 },
      { cmd: 'recording-audio-end', token: 1, playStop: true },
    ]);
  });
  it('requires positive posting acknowledgments for every text and submit command', async () => {
    const { channel, helper } = await started();
    for (const response of [{ posted: false, reason: 'post-access-denied' }, {}, { posted: 'true' }]) {
      for (const cmd of ['paste', 'type-text', 'submit']) {
        await channel.request('respond-next', { cmd, response });
        const operation = cmd === 'paste' ? helper.paste() : cmd === 'type-text' ? helper.typeText('🚀 ') : helper.submit('enter');
        await expect(operation).rejects.toThrow();
      }
    }
  });
  it('lets direct typing finish beyond the ordinary helper request deadline without retry', async () => {
    const { channel, helper } = await started(100);
    await channel.request('respond-next', { cmd: 'type-text', response: { posted: true }, delayMs: 250 });
    await expect(helper.typeText('🚀 '.repeat(10000))).resolves.toBeUndefined();
  });
  it('preserves long Unicode text and suffix through the real process protocol before submit', async () => {
    const { channel, helper } = await started();
    const text = 'Žilina é 🚀 '.repeat(10000);
    await helper.typeText(text);
    await helper.submit('primary-enter');
    expect((await channel.request('output-state'))['operations']).toEqual([
      { cmd: 'type-text', text }, { cmd: 'submit', mode: 'primary-enter' },
    ]);
  });
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

  it('maps the physical modifier flags and rejects malformed ones', async () => {
    const { channel, helper } = await started();
    const respond = (response: Record<string, unknown>) => channel.request('respond-next', { cmd: 'modifier-flags', response });

    await respond({ flags: 0x40000 | 0x100000 | 0x100, combinedFlags: 0 });
    const shortcutHeld = await helper.modifierFlags();
    await respond({ flags: 0x20000 | 0x80000, combinedFlags: 0x40000 });
    const optionShift = await helper.modifierFlags();
    await respond({ flags: 'none' });

    expect(shortcutHeld).toEqual({ control: true, command: true, option: false, shift: false });
    expect(optionShift).toEqual({ control: false, command: false, option: true, shift: true });
    await expect(helper.modifierFlags()).rejects.toThrow('modifier-flags-invalid');
    expect(await helper.modifierFlags()).toEqual({ control: false, command: false, option: false, shift: false });
  });

  it('force restores the saved clipboard without the expected text check', async () => {
    const { channel, helper } = await started();
    await channel.request('respond-next', { cmd: 'clipboard-restore', response: { restored: false, reason: 'nothing-saved' } });

    expect(await helper.restoreSavedClipboard()).toBe(false);
    expect(await helper.restoreSavedClipboard()).toBe(true);
  });

  it('gives the focused element query longer than the default timeout', async () => {
    const { channel, helper } = await started(100);
    await channel.request('respond-next', { cmd: 'focused-element', response: { editable: true, role: 'AXTextArea' }, delayMs: 250 });

    expect(await helper.focusedElement()).toEqual({ editable: true, role: 'AXTextArea' });
  });

  it('forwards logical edges only for the latest confirmed binding and preserves paste-last', async () => {
    const { channel, helper } = await started();
    const edges: HotkeyEvent[] = [];
    const shortcuts: string[] = [];
    helper.onHotkey((event) => edges.push(event));
    helper.onShortcut((name) => shortcuts.push(name));
    await helper.listen({ kind: 'key', keycode: 49, modifiers: ['control'] });
    const first = await channel.request('listen-state');
    await channel.request('emit', { event: { event: 'hotkey', listenId: first.listenId, phase: 'down', ts: 5 } });
    await helper.listen({ kind: 'modifiers', keycodes: [58, 59] });
    await channel.request('emit', { event: { event: 'hotkey', listenId: first.listenId, phase: 'up', ts: 6 } });
    const current = await channel.request('listen-state');
    await channel.request('emit', { event: { event: 'hotkey', listenId: current.listenId, phase: 'down', ts: 7 } });
    await channel.request('emit', { event: { event: 'shortcut', name: 'paste-last' } });
    expect(edges).toEqual([{ phase: 'down', ts: 5 }, { phase: 'down', ts: 7 }]);
    expect(shortcuts).toEqual(['paste-last']);
    expect(current).toMatchObject({ kind: 'modifiers', keycodes: [58, 59] });
  });

  it('records full combinations and ignores results from an older recording', async () => {
    const { channel, helper } = await started();
    const recorded = helper.recordHotkey(1000);
    const first = await channel.request('record-state');
    const binding = { kind: 'key', keycode: 49, modifiers: ['control'], label: '⌃Space' };
    await channel.request('emit', { event: { event: 'recorded', recordingId: first.recordingId, ...binding } });
    expect(await recorded).toEqual(binding);
    const pending = helper.recordHotkey(1000);
    const current = await channel.request('record-state');
    await channel.request('emit', { event: { event: 'recorded', recordingId: first.recordingId, ...binding } });
    await channel.request('emit', { event: { event: 'record-cancelled', recordingId: current.recordingId } });
    expect(await pending).toBe('cancelled');
    for (const result of ['unsupported', 'timeout'] as const) {
      const next = helper.recordHotkey(1000);
      const state = await channel.request('record-state');
      await channel.request('emit', { event: { event: `record-${result}`, recordingId: state.recordingId } });
      expect(await next).toBe(result);
    }
  });

  it('times out when the helper emits no recording result', async () => {
    const { helper } = await started();

    await expect(helper.recordHotkey(50)).resolves.toBe('timeout');
  }, 1500);

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

  it('reports the helper as dead when it stays down after its restart', async () => {
    const { channel, helper } = await started();
    const reasons: InputLostReason[] = [];
    helper.onInputLost((reason) => reasons.push(reason));

    await expect(channel.request('crash')).rejects.toThrow('helper-exited');
    await expect.poll(() => reasons).toEqual(['helper-restarted']);
    await expect(channel.request('crash')).rejects.toThrow('helper-exited');

    await expect.poll(() => reasons).toEqual(['helper-restarted', 'helper-died']);
  });

  it('listens again after the helper restarts', async () => {
    const { channel, helper } = await started();
    await helper.listen({ kind: 'key', keycode: 49, modifiers: ['control'] });

    await expect(channel.request('crash')).rejects.toThrow('helper-exited');
    await expect.poll(async () => await channel.request('listen-state')).toMatchObject({ kind: 'key', keycode: 49, modifiers: ['control'] });
  });
});

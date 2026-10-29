import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeInputHelper, type FakeInputHelperState } from '../src/main/helper/fake-input-helper';
import { HelperProcessInputHelper } from '../src/main/helper/helper-process-input-helper';
import type { AppTarget } from '../src/main/helper/input-helper';
import { InsertionService } from '../src/main/insertion/insertion-service';
import { LastTranscript } from '../src/main/insertion/last-transcript';
import { SettingsStore } from '../src/main/settings/settings-store';
import type { Settings } from '../src/shared/settings';
import { protocolHelper } from './protocol-helper';
import { RecordingLogger } from './recording-logger';

const TEXT_EDIT: AppTarget = { bundleId: 'com.apple.TextEdit', pid: 100, name: 'TextEdit', windowId: 1 };
const NOTES: AppTarget = { bundleId: 'com.apple.Notes', pid: 200, name: 'Notes', windowId: 4 };
const HELD = { control: true, command: true, option: false, shift: false };
const PROTOCOL_TARGET: AppTarget = { bundleId: 'com.apple.TextEdit', pid: 42, name: 'TextEdit', windowId: 7 };

type Setup = {
  helper?: Partial<FakeInputHelperState>;
  settings?: Partial<Settings>;
  onSleep?: (ms: number, helper: FakeInputHelper) => void | Promise<void>;
};

let dir: string;
let processHelper: HelperProcessInputHelper | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-insertion-'));
});

afterEach(async () => {
  await processHelper?.stop();
  processHelper = null;
  await rm(dir, { recursive: true, force: true });
});

async function protocolService(platform: NodeJS.Platform = 'darwin') {
  const settings = new SettingsStore(join(dir, 'settings.json'), new RecordingLogger());
  await settings.load();
  const channel = protocolHelper();
  processHelper = new HelperProcessInputHelper(channel, new RecordingLogger(), platform);
  await processHelper.start();
  const logger = new RecordingLogger();
  const lastTranscript = new LastTranscript();
  const service = new InsertionService(processHelper, settings, lastTranscript, () => Promise.resolve(), logger);
  return { channel, logger, service, settings, helper: processHelper, lastTranscript };
}

async function prepared(setup: Setup = {}) {
  const settings = new SettingsStore(join(dir, 'settings.json'), new RecordingLogger());
  await settings.load();
  await settings.update({ ...setup.settings });
  const helper = new FakeInputHelper({ frontmost: TEXT_EDIT, clipboard: 'original', ...setup.helper });
  const lastTranscript = new LastTranscript();
  const sleeps: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    sleeps.push(ms);
    await setup.onSleep?.(ms, helper);
  };
  const logger = new RecordingLogger();
  const service = new InsertionService(helper, settings, lastTranscript, sleep, logger);
  return { helper, lastTranscript, sleeps, service, logger, settings };
}

describe('InsertionService', () => {
  it('copies an automatic Linux null target without mutating target text', async () => {
    const { service, channel } = await protocolService('linux');
    await channel.request('respond-next', { cmd: 'frontmost', response: { pid: null } });
    await channel.request('respond-next', { cmd: 'check-delivery', response: { kind: 'copy', reason: 'unverified-target' } });
    expect(await service.insert('Žilina 🚀', null)).toBe('copied-unverified-target');
    expect((await channel.request('clipboard-state'))['text']).toBe('Žilina 🚀');
    expect((await channel.request('output-state'))['operations']).toEqual([]);
  });
  it('preflights Linux replay with submit off and retains copy-only text', async () => {
    const { service, channel, lastTranscript } = await protocolService('linux');
    lastTranscript.set('previous');
    await channel.request('respond-next', { cmd: 'check-delivery', response: { kind: 'copy', reason: 'unverified-target' } });
    expect(await service.pasteLast()).toBe('copied-unverified-target');
    expect((await channel.request('clipboard-state'))['text']).toBe('previous');
    expect((await channel.request('output-state'))['operations']).toEqual([]);
  });
  it('blocks Linux protected or changed targets and copies unsupported direct typing', async () => {
    const { service, channel, settings } = await protocolService('linux');
    for (const [reason, expected] of [['protected-input', 'blocked-secure-input'], ['focus-changed', 'blocked-focus-changed']] as const) {
      await channel.request('respond-next', { cmd: 'check-delivery', response: { kind: 'blocked', reason } });
      expect(await service.insert('dictated', PROTOCOL_TARGET)).toBe(expected);
    }
    await settings.update({ insertion: 'type' });
    await channel.request('respond-next', { cmd: 'check-delivery', response: { kind: 'copy', reason: 'unverified-target' } });
    expect(await service.insert('dictated', PROTOCOL_TARGET)).toBe('copied-unsupported-output');
    expect((await channel.request('clipboard-state'))['text']).toBe('dictated');
    expect((await channel.request('output-state'))['operations']).toEqual([]);
  });
  it('keeps delivered text but blocks submit when the delivery target is unknown', async () => {
    const { service, helper } = await prepared({ settings: { insertion: 'type', autoSubmit: 'enter' }, helper: { frontmost: null } });
    expect(await service.insert('dictated', null)).toBe('delivered-submit-blocked');
    expect(helper.typed).toEqual(['dictated']);
    expect(helper.submitted).toEqual([]);
  });
  it('keeps positively pasted text delivered when clipboard restoration fails before submit', async () => {
    const { service, helper, logger } = await prepared({ settings: { autoSubmit: 'enter' } });
    helper.restoreClipboard = () => Promise.reject(new Error('clipboard unavailable'));
    expect(await service.insert('dictated', TEXT_EDIT)).toBe('pasted');
    expect(helper.pasted).toEqual(['dictated']);
    expect(helper.submitted).toEqual(['enter']);
    expect(logger.errors.map((entry) => entry.message)).toEqual(['The clipboard could not be restored after the paste']);
  });
  it('never submits after denied or malformed delivery acknowledgments from the helper process', async () => {
    const { service, channel, settings, helper } = await protocolService();
    const target = await helper.frontmost();
    for (const insertion of ['paste', 'type'] as const) {
      await settings.update({ insertion, autoSubmit: 'enter' });
      for (const response of [{ posted: false, reason: 'post-access-denied' }, {}, { posted: 'true' }]) {
        await channel.request('respond-next', { cmd: insertion === 'type' ? 'type-text' : 'paste', response });
        expect(await service.insert('dictated', target)).toBe(insertion === 'paste' ? 'copied-paste-failed' : 'failed-type');
        expect((await channel.request('output-state'))['operations']).toEqual([]);
      }
    }
  });
  it('does not query a submit target when automatic submit is off during replay', async () => {
    const { service, helper, lastTranscript } = await prepared();
    lastTranscript.set('dictated');
    helper.frontmost = () => Promise.reject(new Error('submit target query must not run'));
    helper.submit = () => Promise.reject(new Error('submit must not run'));
    expect(await service.pasteLast()).toBe('pasted');
    expect(helper.pasted).toEqual(['dictated']);
    expect(helper.clipboard).toBe('original');
  });
  it('keeps submit inside the queue and applies current settings when the next operation begins', async () => {
    const { service, helper, settings } = await prepared({ settings: { insertion: 'type', autoSubmit: 'enter' } });
    let release = () => {};
    let entered = () => {};
    const submitting = new Promise<void>((resolve) => { entered = resolve; });
    helper.submit = () => new Promise<void>((resolve) => { release = resolve; entered(); });
    const first = service.insert('first', TEXT_EDIT);
    await submitting;
    const second = service.insert('second', TEXT_EDIT);
    await settings.update({ insertion: 'clipboard', autoSubmit: 'off' });
    expect(helper.typed).toEqual(['first']);
    expect(helper.clipboard).toBe('original');
    release();
    expect(await first).toBe('typed');
    expect(await second).toBe('copied-by-setting');
    expect(helper.typed).toEqual(['first']);
    expect(helper.clipboard).toBe('second');
  });
  it('reports delivered text when the submit query or action fails and never retries it', async () => {
    for (const failure of ['query', 'submit'] as const) {
      const { service, helper } = await prepared({ settings: { insertion: 'type', autoSubmit: 'enter' } });
      helper.typeText = (text) => {
        helper.typed.push(text);
        if (failure === 'query') helper.focusedElement = () => Promise.reject(new Error('query failed'));
        return Promise.resolve();
      };
      let submits = 0;
      helper.submit = () => { submits += 1; return Promise.reject(new Error('submit timed out')); };
      expect(await service.insert('dictated', TEXT_EDIT)).toBe('delivered-submit-failed');
      expect(helper.typed).toEqual(['dictated']);
      expect(helper.pasted).toEqual([]);
      expect(submits).toBe(failure === 'submit' ? 1 : 0);
      expect(helper.clipboard).toBe('original');
    }
  });
  it('rechecks focus, secure input, editability and every modifier after the paste settling interval', async () => {
    const mutations: Array<(helper: FakeInputHelper) => void> = [
      (helper) => { helper.frontmostApp = NOTES; },
      (helper) => { helper.frontmostApp = { ...TEXT_EDIT, windowId: 2 }; },
      (helper) => { helper.frontmostApp = null; },
      (helper) => { helper.secureInputEnabled = true; },
      (helper) => { helper.editable = false; },
      (helper) => { helper.editable = null; },
      ...(['control', 'command', 'option', 'shift'] as const).map((key) => (helper: FakeInputHelper) => { helper.modifiers[key] = true; }),
      (helper) => { helper.focusedElement = () => { helper.frontmostApp = NOTES; return Promise.resolve({ editable: true, role: 'AXTextArea' }); }; },
    ];
    for (const mutate of mutations) {
      const { service, helper, sleeps } = await prepared({ settings: { autoSubmit: 'enter' }, onSleep: (_ms, fake) => mutate(fake) });
      expect(await service.insert('dictated', TEXT_EDIT)).toBe('delivered-submit-blocked');
      expect(helper.pasted).toEqual(['dictated']);
      expect(helper.submitted).toEqual([]);
      expect(helper.clipboard).toBe('original');
      expect(sleeps).toEqual([500]);
    }
  });
  it('never types or submits blocked, empty, copy-only, fallback or failed clipboard deliveries', async () => {
    const cases: Array<{ setup: Setup; text: string; outcome: string }> = [
      { setup: { helper: { frontmost: NOTES } }, text: 'dictated', outcome: 'blocked-focus-changed' },
      { setup: { helper: { secureInput: true } }, text: 'dictated', outcome: 'blocked-secure-input' },
      { setup: { helper: { editable: false } }, text: 'dictated', outcome: 'copied-no-text-field' },
      { setup: {}, text: '  ', outcome: 'nothing-to-insert' },
      { setup: { settings: { insertion: 'clipboard' } }, text: 'dictated', outcome: 'copied-by-setting' },
      { setup: { helper: { clipboardWriteFails: true }, settings: { clipboardPolicy: 'leave' } }, text: 'dictated', outcome: 'failed-clipboard-write' },
    ];
    for (const { setup, text, outcome } of cases) {
      const { service, helper } = await prepared({ ...setup, settings: { insertion: 'type', autoSubmit: 'enter', ...setup.settings } });
      expect(await service.insert(text, TEXT_EDIT)).toBe(outcome);
      expect(helper.typed).toEqual([]);
      expect(helper.pasted).toEqual([]);
      expect(helper.submitted).toEqual([]);
      if (outcome === 'failed-clipboard-write') expect(helper.clipboard).toBe('original');
    }
  });
  it('keeps delivery, clipboard policy and submit from a single snapshot until the next operation', async () => {
    const { service, helper, settings } = await prepared();
    helper.secureInput = async () => {
      await settings.update({ insertion: 'type', clipboardPolicy: 'leave', autoSubmit: 'enter' });
      return false;
    };
    expect(await service.insert('first', TEXT_EDIT)).toBe('pasted');
    expect(helper.clipboard).toBe('original');
    expect(helper.submitted).toEqual([]);
    expect(await service.insert('second', TEXT_EDIT)).toBe('typed');
    expect(helper.clipboard).toBe('second');
    expect(helper.pasted).toEqual(['first']);
    expect(helper.typed).toEqual(['second']);
    expect(helper.submitted).toEqual(['enter']);
  });
  it('submits only after positive direct text delivery with a neutral keyboard', async () => {
    const { service, helper } = await prepared({ settings: { insertion: 'type', autoSubmit: 'primary-enter' } });
    helper.submit = (mode) => {
      expect(helper.typed).toEqual(['Žilina 🚀 ']);
      helper.submitted.push(mode);
      return Promise.resolve();
    };
    expect(await service.insert('Žilina 🚀', TEXT_EDIT, { appendTrailingSpace: true })).toBe('typed');
    expect(helper.submitted).toEqual(['primary-enter']);
  });
  it('reports copied fallback separately when typing fails and never retries or pastes', async () => {
    for (const clipboardPolicy of ['restore', 'leave'] as const) {
      const { service, helper } = await prepared({ settings: { insertion: 'type', clipboardPolicy } });
      let attempts = 0;
      helper.typeText = () => { attempts += 1; return Promise.reject(new Error('permission denied')); };
      expect(await service.insert('dictated', TEXT_EDIT)).toBe(clipboardPolicy === 'leave' ? 'copied-type-failed' : 'failed-type');
      expect(helper.clipboard).toBe(clipboardPolicy === 'leave' ? 'dictated' : 'original');
      expect(attempts).toBe(1);
      expect(helper.pasted).toEqual([]);
    }
  });
  it('leaves the transcript on the clipboard for either delivery method when requested', async () => {
    for (const insertion of ['paste', 'type'] as const) {
      const { service, helper } = await prepared({ settings: { insertion, clipboardPolicy: 'leave' } });
      expect(await service.insert('Žilina 🚀', TEXT_EDIT)).toBe(insertion === 'type' ? 'typed' : 'pasted');
      expect(helper.clipboard).toBe('Žilina 🚀');
    }
  });
  it('types exact Unicode and suffix without touching the clipboard under restore', async () => {
    const { service, helper, sleeps, lastTranscript } = await prepared({ settings: { insertion: 'type' } });
    helper.saveClipboard = () => Promise.reject(new Error('clipboard must stay untouched'));
    expect(await service.insert(' Žilina é 🚀 ', TEXT_EDIT, { appendTrailingSpace: true })).toBe('typed');
    lastTranscript.set('Žilina é 🚀', { appendTrailingSpace: true });
    expect(await service.pasteLast()).toBe('typed');
    expect(helper.typed).toEqual(['Žilina é 🚀 ', 'Žilina é 🚀 ']);
    expect(helper.clipboard).toBe('original');
    expect(helper.pasted).toEqual([]);
    expect(sleeps).toEqual([]);
  });
  it('delivers a safe explicit suffix and replays the stored bytes on copy and paste', async () => {
    const { service, helper, lastTranscript } = await prepared();
    expect(await service.insert(' Žilina\n\u001b[201~  ', TEXT_EDIT, { appendTrailingSpace: true })).toBe('pasted');
    expect(helper.pasted).toEqual(['Žilina [201~ ']);
    lastTranscript.set(' Žilina\n ', { appendTrailingSpace: true });
    await service.copyLast();
    expect(helper.clipboard).toBe('Žilina ');
    await service.pasteLast();
    expect(helper.pasted).toEqual(['Žilina [201~ ', 'Žilina ']);
    expect(await service.insert('\n\u0000 ', TEXT_EDIT, { appendTrailingSpace: true })).toBe('nothing-to-insert');
  });
  it('pastes into an editable field and restores the clipboard', async () => {
    const clipboardDuringWait: string[] = [];
    const { helper, sleeps, service } = await prepared({ onSleep: (_ms, fake) => void clipboardDuringWait.push(fake.clipboard) });

    const outcome = await service.insert('dictated', TEXT_EDIT);

    expect(outcome).toBe('pasted');
    expect(helper.pasted).toEqual(['dictated']);
    expect(sleeps).toEqual([500]);
    expect(clipboardDuringWait).toEqual(['dictated']);
    expect(helper.clipboard).toBe('original');
  });

  it('does not restore when the clipboard changed meanwhile', async () => {
    const { helper, service } = await prepared({
      onSleep: (_ms, fake) => {
        fake.clipboard = 'user copied';
      },
    });

    const outcome = await service.insert('dictated', TEXT_EDIT);

    expect(outcome).toBe('pasted');
    expect(helper.clipboard).toBe('user copied');
  });

  it('copies only when the focused element is not editable', async () => {
    const { helper, sleeps, service } = await prepared({ helper: { editable: false, role: 'AXList' } });

    const outcome = await service.insert('dictated', TEXT_EDIT);

    expect(outcome).toBe('copied-no-text-field');
    expect(helper.pasted).toEqual([]);
    expect(sleeps).toEqual([]);
    expect(helper.clipboard).toBe('dictated');
  });

  it('pastes when editability is unknown', async () => {
    const { helper, service } = await prepared({ helper: { editable: null, role: 'AXWebArea' } });

    const outcome = await service.insert('dictated', TEXT_EDIT);

    expect(outcome).toBe('pasted');
    expect(helper.pasted).toEqual(['dictated']);
  });

  it('blocks when the frontmost app changed', async () => {
    const { helper, service } = await prepared({ helper: { frontmost: NOTES } });

    const outcome = await service.insert('dictated', TEXT_EDIT);

    expect(outcome).toBe('blocked-focus-changed');
    expect(helper.pasted).toEqual([]);
    expect(helper.clipboard).toBe('original');
  });

  it('blocks when the target window changed or no app is frontmost', async () => {
    const otherWindow = await prepared({ helper: { frontmost: { ...TEXT_EDIT, windowId: 2 } } });
    const nothingFrontmost = await prepared({ helper: { frontmost: null } });

    expect(await otherWindow.service.insert('dictated', TEXT_EDIT)).toBe('blocked-focus-changed');
    expect(await nothingFrontmost.service.insert('dictated', TEXT_EDIT)).toBe('blocked-focus-changed');
    expect([...otherWindow.helper.pasted, ...nothingFrontmost.helper.pasted]).toEqual([]);
  });

  it('blocks on secure input', async () => {
    const { helper, service } = await prepared({ helper: { secureInput: true } });

    const outcome = await service.insert('dictated', TEXT_EDIT);

    expect(outcome).toBe('blocked-secure-input');
    expect(helper.pasted).toEqual([]);
    expect(helper.clipboard).toBe('original');
  });

  it('pastes and restores sanitized text, never control or bidi characters', async () => {
    const { helper, service } = await prepared();

    const outcome = await service.insert(`echo ok\r\nrm -rf ~\u001b[201~\u0000 \u202eevil\u200b`, TEXT_EDIT);

    expect(outcome).toBe('pasted');
    expect(helper.pasted).toEqual(['echo ok rm -rf ~[201~ evil']);
    expect(helper.clipboard).toBe('original');
  });

  it('copies sanitized text when the setting asks for the clipboard', async () => {
    const { helper, service } = await prepared({ settings: { insertion: 'clipboard' } });

    expect(await service.insert('jeden\ndva\u2066', TEXT_EDIT)).toBe('copied-by-setting');
    expect(helper.clipboard).toBe('jeden dva');
  });

  it('copies sanitized text when the focused element is not editable', async () => {
    const { helper, service } = await prepared({ helper: { editable: false } });

    expect(await service.insert('jeden\ndva\u2066', TEXT_EDIT)).toBe('copied-no-text-field');
    expect(helper.clipboard).toBe('jeden dva');
  });

  it('skips text that is empty after sanitizing without touching the clipboard', async () => {
    const { helper, sleeps, service } = await prepared();

    const outcome = await service.insert(' \r\n\u001b\u200b\u202e ', TEXT_EDIT);

    expect(outcome).toBe('nothing-to-insert');
    expect(helper.pasted).toEqual([]);
    expect(sleeps).toEqual([]);
    expect(helper.clipboard).toBe('original');
  });

  it('paste last and copy last deliver the sanitized last transcript', async () => {
    const { helper, lastTranscript, service } = await prepared();
    lastTranscript.set('predch\u00e1dzaj\u00faci\n\u001b[201~text\u200f');

    expect(await service.copyLast()).toBe('copied');
    expect(helper.clipboard).toBe('predchádzajúci [201~text');
    expect(await service.pasteLast()).toBe('pasted');
    expect(helper.pasted).toEqual(['predchádzajúci [201~text']);
  });

  it('copies by setting', async () => {
    const { helper, sleeps, service } = await prepared({ settings: { insertion: 'clipboard' } });

    const outcome = await service.insert('dictated', TEXT_EDIT);

    expect(outcome).toBe('copied-by-setting');
    expect(helper.pasted).toEqual([]);
    expect(sleeps).toEqual([]);
    expect(helper.clipboard).toBe('dictated');
  });

  it('restores the saved clipboard and never pastes when the clipboard write fails', async () => {
    const pasting = await prepared({ helper: { clipboardWriteFails: true } });
    const copying = await prepared({ helper: { clipboardWriteFails: true, editable: false } });

    expect(await pasting.service.insert('dictated', TEXT_EDIT)).toBe('failed-clipboard-write');
    expect(await copying.service.insert('dictated', TEXT_EDIT)).toBe('failed-clipboard-write');
    expect(pasting.helper.pasted).toEqual([]);
    expect(pasting.helper.clipboard).toBe('original');
    expect(copying.helper.clipboard).toBe('original');
  });

  it('logs the reason of a clipboard write failure it handles', async () => {
    const { logger, service } = await prepared({ helper: { clipboardWriteFails: true } });

    await service.insert('dictated', TEXT_EDIT);

    expect(logger.errors.map((entry) => entry.message)).toEqual(['The clipboard could not be written, restoring the saved clipboard']);
    expect(String(logger.errors[0]?.error)).toContain('clipboard-write-failed:set-string-failed');
  });

  it('keeps the transcript on the clipboard when the paste cannot be posted', async () => {
    const { logger, service } = await protocolService();

    const outcome = await service.insert('dictated', PROTOCOL_TARGET);

    expect(outcome).toBe('copied-paste-failed');
    expect(logger.errors.map((entry) => entry.message)).toEqual(['The paste failed, the transcript stays on the clipboard']);
    expect(String(logger.errors[0]?.error)).toContain('paste-failed:no-event-source');
  });

  it('reports pasted and logs when only the clipboard restore fails after a successful paste', async () => {
    const { channel, logger, service } = await protocolService();
    await channel.request('respond-next', { cmd: 'paste', response: { posted: true } });
    await channel.request('respond-next', { cmd: 'clipboard-restore', response: { error: 'pasteboard-busy' } });

    const outcome = await service.insert('dictated', PROTOCOL_TARGET);

    expect(outcome).toBe('pasted');
    expect(logger.errors.map((entry) => entry.message)).toEqual(['The clipboard could not be restored after the paste']);
    expect(String(logger.errors[0]?.error)).toContain('helper-error:clipboard-restore:pasteboard-busy');
  });

  it('copy last puts the last transcript on the clipboard without pasting', async () => {
    const { helper, lastTranscript, service } = await prepared();
    lastTranscript.set('previous');

    const outcome = await service.copyLast();

    expect(outcome).toBe('copied');
    expect(helper.clipboard).toBe('previous');
    expect(helper.pasted).toEqual([]);
  });

  it('copy last reports a missing transcript or a failed clipboard write', async () => {
    const empty = await prepared();
    const failing = await prepared({ helper: { clipboardWriteFails: true } });
    failing.lastTranscript.set('previous');

    expect(await empty.service.copyLast()).toBe('no-transcript');
    expect(await failing.service.copyLast()).toBe('failed-clipboard-write');
    expect(empty.helper.clipboard).toBe('original');
    expect(failing.helper.clipboard).toBe('original');
  });

  it('runs one insertion at a time so clipboard restores do not interleave', async () => {
    const { helper, lastTranscript, service } = await prepared();
    lastTranscript.set('second');

    const outcomes = await Promise.all([service.insert('first', TEXT_EDIT), service.pasteLast()]);

    expect(outcomes).toEqual(['pasted', 'pasted']);
    expect(helper.pasted).toEqual(['first', 'second']);
    expect(helper.clipboard).toBe('original');
  });

  it('paste last uses the last transcript and current focus', async () => {
    const { helper, lastTranscript, service } = await prepared({ helper: { frontmost: NOTES } });
    lastTranscript.set('previous');

    const outcome = await service.pasteLast();

    expect(outcome).toBe('pasted');
    expect(helper.pasted).toEqual(['previous']);
    expect(helper.clipboard).toBe('original');
  });

  it('paste last without a transcript returns no-transcript', async () => {
    const { helper, service } = await prepared();

    const outcome = await service.pasteLast();

    expect(outcome).toBe('no-transcript');
    expect(helper.pasted).toEqual([]);
    expect(helper.clipboard).toBe('original');
  });

  it('paste last waits until Control and Command are released', async () => {
    const { helper, lastTranscript, service } = await prepared({
      helper: { modifiers: HELD },
      onSleep: (ms, fake) => {
        if (ms === 500 || fake.modifierQueries < 3) {
          return;
        }
        fake.modifiers = { control: false, command: false, option: true, shift: true };
      },
    });
    lastTranscript.set('previous');

    const outcome = await service.pasteLast();

    expect(outcome).toBe('pasted');
    expect(helper.modifierQueries).toBe(4);
    expect(helper.pasted).toEqual(['previous']);
  });

  it('paste last gives up when Control or Command stays held for 1000 ms', async () => {
    const { helper, lastTranscript, sleeps, service } = await prepared({ helper: { modifiers: { ...HELD, control: false } } });
    lastTranscript.set('previous');

    const outcome = await service.pasteLast();

    expect(outcome).toBe('blocked-modifiers-held');
    expect(sleeps.reduce((total, ms) => total + ms, 0)).toBe(1000);
    expect(helper.pasted).toEqual([]);
    expect(helper.clipboard).toBe('original');
  });
});

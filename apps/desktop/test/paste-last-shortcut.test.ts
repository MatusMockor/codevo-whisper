import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeInputHelper } from '../src/main/helper/fake-input-helper';
import { HelperProcessInputHelper } from '../src/main/helper/helper-process-input-helper';
import { InsertionService } from '../src/main/insertion/insertion-service';
import { LastTranscript } from '../src/main/insertion/last-transcript';
import { bindPasteLastShortcut } from '../src/main/insertion/paste-last-shortcut';
import { SettingsStore } from '../src/main/settings/settings-store';
import { protocolHelper } from './protocol-helper';
import { RecordingLogger } from './recording-logger';

const immediate = (): Promise<void> => Promise.resolve();

let dir: string;
let processHelper: HelperProcessInputHelper | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-paste-last-'));
});

afterEach(async () => {
  await processHelper?.stop();
  processHelper = null;
  await rm(dir, { recursive: true, force: true });
});

async function loadedSettings(): Promise<SettingsStore> {
  const settings = new SettingsStore(join(dir, 'settings.json'), new RecordingLogger());
  await settings.load();
  return settings;
}

describe('bindPasteLastShortcut', () => {
  it('pastes the last transcript on the shortcut and logs the outcome', async () => {
    const helper = new FakeInputHelper({ clipboard: 'original' });
    const lastTranscript = new LastTranscript();
    lastTranscript.set('previous');
    const logger = new RecordingLogger();
    bindPasteLastShortcut(helper, new InsertionService(helper, await loadedSettings(), lastTranscript, immediate), logger);

    helper.pressPasteLast();
    await expect.poll(() => logger.infos).toEqual([{ message: 'Paste last transcript', detail: 'pasted' }]);

    expect(helper.pasted).toEqual(['previous']);
    expect(helper.clipboard).toBe('original');
  });

  it('pastes the sanitized last transcript on the shortcut', async () => {
    const helper = new FakeInputHelper({ clipboard: 'original' });
    const lastTranscript = new LastTranscript();
    lastTranscript.set('git status\ngit push --force\u001b[201~\u2067');
    const logger = new RecordingLogger();
    bindPasteLastShortcut(helper, new InsertionService(helper, await loadedSettings(), lastTranscript, immediate), logger);

    helper.pressPasteLast();
    await expect.poll(() => logger.infos).toEqual([{ message: 'Paste last transcript', detail: 'pasted' }]);

    expect(helper.pasted).toEqual(['git status git push --force[201~']);
    expect(helper.clipboard).toBe('original');
  });

  it.each(['darwin', 'linux'] as const)('logs a paste the helper could not post and keeps the transcript on the clipboard on %s', async (platform) => {
    const channel = protocolHelper();
    processHelper = new HelperProcessInputHelper(channel, undefined, platform);
    const lastTranscript = new LastTranscript();
    lastTranscript.set('previous');
    const logger = new RecordingLogger();
    bindPasteLastShortcut(processHelper, new InsertionService(processHelper, await loadedSettings(), lastTranscript, immediate, logger), logger);
    await processHelper.start();
    await channel.request('respond-next', { cmd: 'check-delivery', response: { kind: 'allowed', operationId: 'fixture-paste', pid: 42, bundleId: 'com.apple.TextEdit', name: 'TextEdit', windowId: 7 } });

    await channel.request('emit', { event: { event: 'shortcut', name: 'paste-last' } });

    await expect.poll(() => logger.infos).toEqual([{ message: 'Paste last transcript', detail: 'copied-paste-failed' }]);
    expect(String(logger.errors[0]?.error)).toContain('paste-failed:no-event-source');
    await expect(channel.request('clipboard-state')).resolves.toMatchObject({ text: 'previous' });
  });

  it.each(['darwin', 'linux'] as const)('logs a failing insertion instead of rejecting unhandled on %s', async (platform) => {
    const channel = protocolHelper();
    processHelper = new HelperProcessInputHelper(channel, undefined, platform);
    const lastTranscript = new LastTranscript();
    lastTranscript.set('previous');
    const logger = new RecordingLogger();
    bindPasteLastShortcut(processHelper, new InsertionService(processHelper, await loadedSettings(), lastTranscript, immediate, logger), logger);
    await processHelper.start();
    await channel.request('respond-next', { cmd: platform === 'linux' ? 'check-delivery' : 'secure-input', response: { error: 'gone' } });

    await channel.request('emit', { event: { event: 'shortcut', name: 'paste-last' } });

    await expect.poll(() => logger.errors.map((entry) => entry.message)).toEqual(['Paste last transcript failed']);
    expect(logger.infos).toEqual([]);
  });
});

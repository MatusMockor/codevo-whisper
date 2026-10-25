import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FeedError } from '../release/feed-error.ts';
import { notaryPhase, recordSubmission, readSubmission } from '../release/notary-state.ts';

let state = '';

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), 'cw-notary-state-'));
});

afterEach(() => {
  rmSync(state, { recursive: true, force: true });
});

function writeApp(content = 'signed app zip'): void {
  writeFileSync(join(state, 'app.zip'), content);
}

function writeDist(content = 'dmg'): void {
  mkdirSync(join(state, 'dist'), { recursive: true });
  writeFileSync(join(state, 'dist', 'codevo-whisper-1.2.0-arm64-mac.dmg'), content);
  writeFileSync(join(state, 'dist', 'codevo-whisper-1.2.0-arm64-mac.zip'), 'zip');
  writeFileSync(join(state, 'dist', 'latest-mac.yml'), 'version: 1.2.0');
}

describe('notary state', () => {
  it('starts in phase none', async () => {
    expect(await notaryPhase(state)).toBe('none');
  });

  it('is app-submitted once the app submission is recorded', async () => {
    writeApp();
    await recordSubmission(state, 'app', 'sub-app-1', ['app.zip']);

    expect(await notaryPhase(state)).toBe('app-submitted');
    expect(await readSubmission(state, 'app')).toBe('sub-app-1');
  });

  it('is dmg-submitted once the dmg submission is recorded', async () => {
    writeApp();
    await recordSubmission(state, 'app', 'sub-app-1', ['app.zip']);
    writeDist();
    await recordSubmission(state, 'dmg', 'sub-dmg-1', ['dist/codevo-whisper-1.2.0-arm64-mac.dmg', 'dist/codevo-whisper-1.2.0-arm64-mac.zip', 'dist/latest-mac.yml']);

    expect(await notaryPhase(state)).toBe('dmg-submitted');
    expect(await readSubmission(state, 'dmg')).toBe('sub-dmg-1');
  });

  it('refuses to resume when the saved app changed', async () => {
    writeApp();
    await recordSubmission(state, 'app', 'sub-app-1', ['app.zip']);
    writeApp('rebuilt app zip');

    await expect(notaryPhase(state)).rejects.toThrow(/app\.zip: sha256 differs/);
  });

  it('refuses to resume when a saved dmg file is missing', async () => {
    writeApp();
    await recordSubmission(state, 'app', 'sub-app-1', ['app.zip']);
    writeDist();
    await recordSubmission(state, 'dmg', 'sub-dmg-1', ['dist/codevo-whisper-1.2.0-arm64-mac.dmg']);
    rmSync(join(state, 'dist', 'codevo-whisper-1.2.0-arm64-mac.dmg'));

    await expect(notaryPhase(state)).rejects.toThrow(FeedError);
  });

  it('rejects a submission id that is not a notary id', async () => {
    writeApp();

    await expect(recordSubmission(state, 'app', 'id; rm -rf /', ['app.zip'])).rejects.toThrow(/submission id/);
  });

  it('rejects a recorded file outside the state directory', async () => {
    await expect(recordSubmission(state, 'app', 'sub-app-1', ['../app.zip'])).rejects.toThrow(/inside/);
  });
});

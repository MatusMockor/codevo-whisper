import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appHandlers } from '../src/main/ipc/app-handlers';
import { IpcValidationError } from '../src/main/ipc/validate';
import { homeRelativePath } from '../src/main/system/home-relative-path';

const home = join('/home', 'owner');

describe('homeRelativePath', () => {
  it('abbreviates the home directory to a tilde', () => {
    expect(homeRelativePath(join(home, '.config', 'Codevo Whisper'), home)).toBe(join('~', '.config', 'Codevo Whisper'));
    expect(homeRelativePath(home, home)).toBe('~');
  });

  it('keeps paths outside the home directory as they are', () => {
    expect(homeRelativePath('/tmp/cw-e2e-abc', home)).toBe('/tmp/cw-e2e-abc');
    expect(homeRelativePath(`${home}-other/data`, home)).toBe(`${home}-other/data`);
    expect(homeRelativePath('/tmp/cw-e2e-abc', '')).toBe('/tmp/cw-e2e-abc');
  });
});

describe('appHandlers', () => {
  it('returns the data folder and rejects unexpected arguments', async () => {
    const handlers = appHandlers({ dataFolder: () => homeRelativePath(join(home, '.config', 'Codevo Whisper'), home) });

    await expect(handlers.getDataFolder()).resolves.toBe(join('~', '.config', 'Codevo Whisper'));
    await expect(handlers.getDataFolder('extra')).rejects.toThrow(IpcValidationError);
  });
});

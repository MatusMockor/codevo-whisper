import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AskedPermissionsStore, parseAskedPermissions } from '../src/main/permissions/asked-permissions-store';
import { RecordingLogger } from './recording-logger';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-asked-'));
  file = join(dir, 'asked-permissions.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('AskedPermissionsStore', () => {
  it('starts empty without a file and persists each asked kind once', async () => {
    const store = new AskedPermissionsStore(file, new RecordingLogger());

    expect(await store.asked()).toEqual([]);
    await Promise.all([store.remember('accessibility'), store.remember('input-monitoring'), store.remember('accessibility')]);

    expect(await store.asked()).toEqual(['input-monitoring', 'accessibility']);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, asked: ['input-monitoring', 'accessibility'] });
    expect(await new AskedPermissionsStore(file, new RecordingLogger()).asked()).toEqual(['input-monitoring', 'accessibility']);
  });

  it('ignores a corrupt or foreign file and rewrites it on the next request', async () => {
    await writeFile(file, '{ not json');
    const store = new AskedPermissionsStore(file, new RecordingLogger());

    expect(await store.asked()).toEqual([]);
    await store.remember('input-monitoring');

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, asked: ['input-monitoring'] });
  });

  it('keeps the asked kind for this session and logs when the file cannot be read or written', async () => {
    await mkdir(file);
    const logger = new RecordingLogger();
    const store = new AskedPermissionsStore(file, logger);

    await store.remember('accessibility');

    expect(await store.asked()).toEqual(['accessibility']);
    expect(logger.errors.map((entry) => entry.message)).toEqual(['The asked permissions could not be read', 'The asked permissions could not be saved']);
  });
});

describe('parseAskedPermissions', () => {
  it('accepts only the current version with known input kinds', () => {
    expect(parseAskedPermissions(JSON.stringify({ version: 1, asked: ['accessibility', 'input-monitoring', 'accessibility'] }))).toEqual(['input-monitoring', 'accessibility']);
    expect(parseAskedPermissions(JSON.stringify({ version: 2, asked: ['accessibility'] }))).toEqual([]);
    expect(parseAskedPermissions(JSON.stringify({ version: 1, asked: ['accessibility', 'microphone'] }))).toEqual([]);
    expect(parseAskedPermissions(JSON.stringify({ version: 1, asked: 'accessibility' }))).toEqual([]);
    expect(parseAskedPermissions(JSON.stringify(['accessibility']))).toEqual([]);
    expect(parseAskedPermissions('null')).toEqual([]);
  });
});

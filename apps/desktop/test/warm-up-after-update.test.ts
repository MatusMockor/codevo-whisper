import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelManager } from '../src/main/models/model-manager';
import { warmUpAfterUpdate } from '../src/main/models/warm-up-after-update';
import { SettingsStore } from '../src/main/settings/settings-store';
import { testEntry } from './model-fixtures';
import { RecordingLogger } from './recording-logger';

const MODEL_BODY = 'GGUF';

let scratch: string;
let modelsDir: string;
let stampFile: string;
let settings: SettingsStore;
let warmed: string[];
let logger: RecordingLogger;

function models(): ModelManager {
  return new ModelManager({ dir: modelsDir, catalog: [testEntry('alpha', MODEL_BODY)], settings, warmUp: () => Promise.resolve() });
}

function warmUpWith(manager: ModelManager, appVersion: string, failing = false): Promise<void> {
  return warmUpAfterUpdate({
    file: stampFile,
    appVersion,
    models: manager,
    warmUp: (path) => {
      warmed.push(path);
      return failing ? Promise.reject(new Error('warm-up failed')) : Promise.resolve();
    },
    logger,
  });
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-warm-after-update-'));
  modelsDir = join(scratch, 'models');
  stampFile = join(scratch, 'warm-up.json');
  await mkdir(modelsDir);
  await writeFile(join(modelsDir, 'alpha.gguf'), MODEL_BODY);
  settings = new SettingsStore(join(scratch, 'settings.json'));
  await settings.load();
  await settings.update({ localModelId: 'alpha' });
  warmed = [];
  logger = new RecordingLogger();
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('warmUpAfterUpdate', () => {
  it('warms the active model once per app version', async () => {
    const manager = models();

    await warmUpWith(manager, '1.0.0');
    await warmUpWith(manager, '1.0.0');
    await warmUpWith(manager, '1.1.0');

    expect(warmed).toEqual([join(modelsDir, 'alpha.gguf'), join(modelsDir, 'alpha.gguf')]);
    expect(JSON.parse(await readFile(stampFile, 'utf8'))).toEqual({ appVersion: '1.1.0' });
  });

  it('skips a missing or broken model and remembers the version', async () => {
    await writeFile(join(modelsDir, 'alpha.gguf'), 'XXXX');

    await warmUpWith(models(), '1.0.0');

    expect(warmed).toEqual([]);
    expect(JSON.parse(await readFile(stampFile, 'utf8'))).toEqual({ appVersion: '1.0.0' });
  });

  it('logs a failed warm-up and tries again on the next start', async () => {
    const manager = models();

    await warmUpWith(manager, '1.0.0', true);
    await warmUpWith(manager, '1.0.0');

    expect(warmed).toHaveLength(2);
    expect(logger.errors.map((entry) => entry.message)).toEqual(['Warm-up after an app update failed']);
  });

  it('treats an unreadable stamp as a new version', async () => {
    await writeFile(stampFile, '{not json');

    await warmUpWith(models(), '1.0.0');

    expect(warmed).toHaveLength(1);
  });
});

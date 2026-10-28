import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalEngine } from '../src/main/engines/local-engine';
import { ModelManager } from '../src/main/models/model-manager';
import { warmUpAfterUpdate } from '../src/main/models/warm-up-after-update';
import { SettingsStore } from '../src/main/settings/settings-store';
import { RecordingLogger } from './recording-logger';
import { testEntry } from './model-fixtures';
import { FAKE_WORKER, readRecordedCalls } from './support/resident-fixture';

let dir: string;
let settings: SettingsStore;
let engine: LocalEngine;
let models: ModelManager;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'resident-warmup-'));
  await mkdir(join(dir, 'models'));
  await writeFile(join(dir, 'models/alpha.gguf'), 'GGUF');
  settings = new SettingsStore(join(dir, 'settings.json'));
  await settings.load();
  await settings.update({ localModelId: 'alpha' });
  models = new ModelManager({ dir: join(dir, 'models'), catalog: [testEntry('alpha', 'GGUF')], settings, warmUp: (path) => engine.warmUp(path) });
  engine = new LocalEngine({ binary: FAKE_WORKER, models, settings, arch: 'arm64' });
  vi.stubEnv('FAKE_CLI_ARGS_FILE', join(dir, 'calls'));
});
afterEach(async () => {
  await engine.dispose();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
it('activation and update warmup run silent inference on the same resident', async () => {
  await models.activate('alpha');
  await warmUpAfterUpdate({ file: join(dir, 'stamp'), appVersion: '2', models, warmUp: (path) => engine.warmUp(path), logger: new RecordingLogger() });
  expect(await readRecordedCalls(join(dir, 'calls'))).toHaveLength(2);
  expect(JSON.parse(await readFile(join(dir, 'stamp'), 'utf8'))).toEqual({ appVersion: '2' });
});
it('logs retryable inference failure without stamping update success', async () => {
  vi.stubEnv('CW_WORKER_FAIL', '1');
  const logger = new RecordingLogger();
  await expect(engine.warmUp(join(dir, 'models/alpha.gguf'))).rejects.toMatchObject({ reason: 'exit' });
  await warmUpAfterUpdate({ file: join(dir, 'stamp'), appVersion: '2', models, warmUp: (path) => engine.warmUp(path), logger });
  await expect(readFile(join(dir, 'stamp'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(logger.errors.map((entry) => entry.message)).toEqual(['Warm-up after an app update failed']);
});
it('does not stamp a warmup superseded by a model change during READY', async () => {
  vi.stubEnv('CW_WORKER_LOAD_MS', '300');
  vi.stubEnv('CW_WORKER_STARTS', join(dir, 'starts'));
  const logger = new RecordingLogger();
  const warming = warmUpAfterUpdate({ file: join(dir, 'stamp'), appVersion: '2', models, warmUp: (path) => engine.warmUp(path), logger });
  await expect.poll(() => readFile(join(dir, 'starts'), 'utf8').catch(() => '')).not.toBe('');
  await settings.update({ localModelId: null });
  await warming;
  await expect(readFile(join(dir, 'stamp'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(logger.errors).toHaveLength(1);
});

it.each([['arm64', 'metal'], ['x64', 'cpu']] as const)('warms the selected path with the %s Auto backend', async (arch, backend) => {
  await engine.dispose();
  engine = new LocalEngine({ binary: FAKE_WORKER, models, settings, arch, platform: 'darwin' });
  await engine.warmUp(join(dir, 'models/alpha.gguf'));
  const calls = await readRecordedCalls(join(dir, 'calls'));
  expect(calls.map((call) => [call[call.indexOf('--model') + 1], call[call.indexOf('--backend') + 1]])).toEqual([[join(dir, 'models/alpha.gguf'), backend]]);
});

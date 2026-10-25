import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineSelector } from '../src/main/engines/engine-selector';
import { LocalEngine } from '../src/main/engines/local-engine';
import { ModelManager } from '../src/main/models/model-manager';
import { SettingsStore } from '../src/main/settings/settings-store';
import { FAKE_CLI } from '../../../packages/stt-runner/test/support/fake-cli';
import { stampedPcm } from './in-process-capture';
import { testEntry } from './model-fixtures';

const MODEL_BODY = 'GGUF';

let scratch: string;
let settings: SettingsStore;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-selector-'));
  vi.stubEnv('FAKE_CLI_ARGS_FILE', join(scratch, 'args.txt'));
  vi.stubEnv('FAKE_CLI_MODE', 'echo-chunk');
  settings = new SettingsStore(join(scratch, 'settings.json'));
  await settings.load();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

async function localEngine(withModel: boolean): Promise<LocalEngine> {
  const modelsDir = join(scratch, 'models');
  await mkdir(modelsDir, { recursive: true });
  if (withModel) {
    await writeFile(join(modelsDir, 'tiny.gguf'), MODEL_BODY);
    await settings.update({ localModelId: 'tiny' });
  }
  const models = new ModelManager({ dir: modelsDir, catalog: [testEntry('tiny', MODEL_BODY)], settings, warmUp: () => Promise.resolve() });
  return new LocalEngine({ binary: FAKE_CLI, models, settings, arch: 'arm64' });
}

describe('EngineSelector', () => {
  it('starts the first ready engine and streams the pushed audio into it', async () => {
    const selector = new EngineSelector([await localEngine(true)]);

    const preparation = await selector.prepare(['local']);

    expect(preparation.ready).toBe(true);
    const engine = preparation.ready ? preparation.engine : null;
    expect(engine?.id).toBe('local');
    const dictation = engine?.start({ language: 'sk', signal: new AbortController().signal });
    dictation?.push(stampedPcm(3, 1));
    dictation?.push(stampedPcm(3, 1));
    expect(await dictation?.finish()).toBe('3:64000');
  });

  it('skips an order entry without a registered engine', async () => {
    const selector = new EngineSelector([await localEngine(true)]);

    const preparation = await selector.prepare(['server', 'local']);

    expect(preparation.ready && preparation.engine.id).toBe('local');
  });

  it('reports the reason of the first engine in the order when none is ready', async () => {
    const selector = new EngineSelector([await localEngine(false)]);

    expect(await selector.prepare(['local'])).toEqual({ ready: false, reason: 'no-model' });
  });

  it('is not ready without any engine for the order', async () => {
    const selector = new EngineSelector([await localEngine(true)]);

    expect(await selector.prepare(['server'])).toEqual({ ready: false });
  });
});

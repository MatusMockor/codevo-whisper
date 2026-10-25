import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LocalEngine } from '../src/main/engines/local-engine';
import { ModelManager } from '../src/main/models/model-manager';
import { SettingsStore } from '../src/main/settings/settings-store';
import { sha256OfFile, testEntry } from './model-fixtures';
import { readWavPcm } from './wav-fixture';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ARCH = process.arch === 'x64' ? 'x64' : 'arm64';
const BINARY = join(REPO_ROOT, 'apps', 'desktop', 'resources', 'bin', ARCH, 'transcribe-cli');
const SAMPLE = join(REPO_ROOT, 'spikes', 'transcribe-macos', 'sample.wav');
const MODEL = process.env['CW_REAL_MODEL'] === undefined ? null : resolve(REPO_ROOT, process.env['CW_REAL_MODEL']);
const AVAILABLE = MODEL !== null && existsSync(MODEL) && existsSync(BINARY) && existsSync(SAMPLE);

const EXPECTED =
  'Ahoj, toto je skúška prepisu slovenskej reči na grafickej karte. Potrebujem skontrolovať náš editor a potom odoslať zmenu.';

async function realModels(model: string, scratch: string): Promise<{ models: ModelManager; settings: SettingsStore }> {
  const dir = join(scratch, 'models');
  await mkdir(dir);
  await symlink(model, join(dir, 'real.gguf'));
  const settings = new SettingsStore(join(scratch, 'settings.json'));
  await settings.load();
  await settings.update({ localModelId: 'real' });
  const entry = { ...testEntry('real', ''), sizeBytes: (await stat(model)).size, sha256: await sha256OfFile(model) };
  return { models: new ModelManager({ dir, catalog: [entry], settings, warmUp: () => Promise.resolve() }), settings };
}

describe.skipIf(!AVAILABLE)('LocalEngine with the real transcribe-cli', () => {
  it('transcribes the Slovak sample with Parakeet', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'cw-real-engine-'));
    try {
      const { models, settings } = await realModels(MODEL ?? '', scratch);
      const engine = new LocalEngine({ binary: BINARY, models, settings, arch: ARCH });

      await expect(engine.isReady()).resolves.toEqual({ ready: true });
      const text = await engine.transcribe(await readWavPcm(SAMPLE), 'sk', new AbortController().signal);

      expect(text).toBe(EXPECTED);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 120_000);
});

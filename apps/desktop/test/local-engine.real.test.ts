import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LocalEngine } from '../src/main/engines/local-engine';
import { FileActiveModel } from './file-active-model';
import { readWavPcm } from './wav-fixture';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ARCH = process.arch === 'x64' ? 'x64' : 'arm64';
const BINARY = join(REPO_ROOT, 'apps', 'desktop', 'resources', 'bin', ARCH, 'transcribe-cli');
const SAMPLE = join(REPO_ROOT, 'spikes', 'transcribe-macos', 'sample.wav');
const MODEL = process.env['CW_REAL_MODEL'] === undefined ? null : resolve(REPO_ROOT, process.env['CW_REAL_MODEL']);
const AVAILABLE = MODEL !== null && existsSync(MODEL) && existsSync(BINARY) && existsSync(SAMPLE);

const EXPECTED =
  'Ahoj, toto je skúška prepisu slovenskej reči na grafickej karte. Potrebujem skontrolovať náš editor a potom odoslať zmenu.';

describe.skipIf(!AVAILABLE)('LocalEngine with the real transcribe-cli', () => {
  it('transcribes the Slovak sample with Parakeet', async () => {
    const engine = new LocalEngine({ binary: BINARY, models: new FileActiveModel(MODEL), arch: ARCH });

    await expect(engine.isReady()).resolves.toEqual({ ready: true });
    const text = await engine.transcribe(await readWavPcm(SAMPLE), 'sk', new AbortController().signal);

    expect(text).toBe(EXPECTED);
  }, 120_000);
});

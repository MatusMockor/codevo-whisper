import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@codevo-whisper/language-routing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSttConfig } from '../src/config';
import { createEngine } from '../src/create-engine';
import type { Engine } from '../src/engine';
import { startSttServer, type SttServer } from '../src/server';
import { pcm, send } from './support/http-client';

const FAKE_CLI = fileURLToPath(new URL('../../../packages/stt-runner/test/support/fake-transcribe-cli.sh', import.meta.url));
const TWO_SECONDS = 32_000;

let scratch: string;
let argsFile: string;
let server: SttServer;
let engine: Engine;

function candidateLines(top: SupportedLanguage): string {
  const ranked = [top, ...SUPPORTED_LANGUAGES.filter((code) => code !== top)];
  const rest = 0.0001;
  const first = 1 - rest * (ranked.length - 1);
  return ranked.map((code, index) => `candidate: ${index + 1} ${code} index=${index} p=${(index === 0 ? first : rest).toFixed(4)} logit=1.0\n`).join('');
}

async function identifyAs(top: SupportedLanguage): Promise<void> {
  const file = join(scratch, `langid-${top}.txt`);
  await writeFile(file, candidateLines(top));
  vi.stubEnv('FAKE_CLI_LID_OUTPUT_FILE', file);
}

async function recordedCalls(): Promise<string[][]> {
  const text = await readFile(argsFile, 'utf8');
  return text
    .split('--\n')
    .filter((call) => call.length > 0)
    .map((call) => call.trimEnd().split('\n'));
}

function optionOf(call: readonly string[], name: string): string | undefined {
  const index = call.indexOf(name);
  return index === -1 ? undefined : call[index + 1];
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-stt-cli-routing-'));
  argsFile = join(scratch, 'args.txt');
  vi.stubEnv('FAKE_CLI_ARGS_FILE', argsFile);
  vi.stubEnv('FAKE_CLI_MODE', 'model-language');
  engine = createEngine({ ...loadSttConfig({ STT_ENGINE: 'cli' }), binary: FAKE_CLI, threads: 1 }, { routing: true });
  server = await startSttServer({ transcriber: engine.transcriber, router: engine.router, models: engine.models, port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await server.stop();
  await engine.close();
  await rm(scratch, { recursive: true, force: true });
});

describe('language routing on the per-call CLI', () => {
  it('reports the supported languages and the models without a warm-up', async () => {
    expect(await send(server, '/capabilities', { method: 'GET' })).toEqual({
      status: 200,
      body: {
        languages: [...SUPPORTED_LANGUAGES],
        models: { transcription: 'Parakeet Ultra (F16)', conditioned: 'Canary 1B v2 (Q8)', languageId: 'VoxLingua107 (rozpoznanie jazyka)' },
      },
    });
  });

  it('identifies on the CPU over every supported language and conditions the transcript on the winner', async () => {
    await identifyAs('cs');

    const reply = await send(server, '/transcribe?language=auto&languages=sk,cs&kind=partial', { body: pcm(TWO_SECONDS) });

    expect(reply).toEqual({ status: 200, body: { text: 'canary-1b-v2-Q8_0:cs', language: 'cs', route: 'conditioned' } });
    const [identification, transcription] = await recordedCalls();
    expect(optionOf(identification ?? [], '--model')).toBe('/models/lang-id-voxlingua107-ecapa-Q8_0.gguf');
    expect(optionOf(identification ?? [], '--backend')).toBe('cpu');
    expect(optionOf(identification ?? [], '--allow')).toBe(SUPPORTED_LANGUAGES.join(','));
    expect(optionOf(transcription ?? [], '--model')).toBe('/models/canary-1b-v2-Q8_0.gguf');
    expect(optionOf(transcription ?? [], '--backend')).toBe('vulkan');
    expect(optionOf(transcription ?? [], '--language')).toBe('cs');
  });

  it('keeps confidently foreign speech on the verbatim model', async () => {
    await identifyAs('de');

    const reply = await send(server, '/transcribe?language=auto&languages=sk,cs', { body: pcm(TWO_SECONDS) });

    expect(reply).toEqual({ status: 200, body: { text: 'parakeet-ultra-F16:auto', language: null, route: 'verbatim-foreign' } });
  });

  it('falls back to the verbatim model when language ID fails', async () => {
    vi.stubEnv('FAKE_CLI_FAIL_MODEL', '/models/lang-id-voxlingua107-ecapa-Q8_0.gguf');

    const reply = await send(server, '/transcribe?language=auto&languages=sk,cs', { body: pcm(TWO_SECONDS) });

    expect(reply).toEqual({ status: 200, body: { text: 'parakeet-ultra-F16:auto', language: null, route: 'verbatim-fallback' } });
  });
});

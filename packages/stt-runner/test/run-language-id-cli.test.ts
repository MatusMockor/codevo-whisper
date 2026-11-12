import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLanguageIdCliOutput } from '../src/language-id-cli-output';
import type { LanguageCode } from '../src/languages';
import { runLanguageIdCli, type LanguageIdCliOptions } from '../src/run-language-id-cli';
import { TranscribeCliError } from '../src/transcribe-cli-error';
import { FAKE_CLI, readRecordedCalls } from './support/fake-cli';

const RECORDED_OUTPUT = fileURLToPath(new URL('./support/langid-cli-output.txt', import.meta.url));
const SK_CS_EN: readonly LanguageCode[] = ['sk', 'cs', 'en'];

let scratch: string;
let argsFile: string;

function options(overrides: Partial<LanguageIdCliOptions> = {}): LanguageIdCliOptions {
  return {
    binary: FAKE_CLI,
    model: '/models/lang-id-voxlingua107-ecapa-Q8_0.gguf',
    backend: 'cpu',
    threads: 2,
    allowed: SK_CS_EN,
    pcm: new Uint8Array(32_000),
    ...overrides,
  };
}

async function writeOutput(text: string): Promise<void> {
  const file = join(scratch, 'output.txt');
  await writeFile(file, text);
  vi.stubEnv('FAKE_CLI_OUTPUT_FILE', file);
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-langid-cli-test-'));
  argsFile = join(scratch, 'args.txt');
  vi.stubEnv('FAKE_CLI_ARGS_FILE', argsFile);
  vi.stubEnv('FAKE_CLI_MODE', 'output-file');
  vi.stubEnv('FAKE_CLI_OUTPUT_FILE', RECORDED_OUTPUT);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe('runLanguageIdCli', () => {
  it('asks for every allowed candidate and writes them to a temp file', async () => {
    await runLanguageIdCli(options());

    const [call] = await readRecordedCalls(argsFile);
    const output = call?.[call.indexOf('--output') + 1] ?? '';
    expect(call).toEqual([
      '--model',
      '/models/lang-id-voxlingua107-ecapa-Q8_0.gguf',
      '--backend',
      'cpu',
      '--threads',
      '2',
      '--allow',
      'sk,cs,en',
      '--top',
      '0',
      '--quiet',
      '--output',
      join(dirname(output), 'candidates.txt'),
      join(dirname(output), 'audio.wav'),
    ]);
    expect(existsSync(dirname(output))).toBe(false);
  });

  it('parses the recorded candidate lines into ranked scores', async () => {
    await expect(runLanguageIdCli(options())).resolves.toEqual([
      { code: 'cs', p: 0.912345 },
      { code: 'sk', p: 0.080011 },
      { code: 'en', p: 0.007644 },
    ]);
  });

  it('rejects output that does not match the allowed set', async () => {
    await writeOutput('candidate: 1 sk index=86 p=0.9 logit=1.0\ncandidate: 2 de index=30 p=0.1 logit=0.1\n');

    await expect(runLanguageIdCli(options({ allowed: ['sk', 'cs'] }))).rejects.toBeInstanceOf(TranscribeCliError);
  });

  it('rejects a missing output file', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'stdout');
    vi.stubEnv('FAKE_CLI_STDOUT_FILE', RECORDED_OUTPUT);

    await expect(runLanguageIdCli(options())).rejects.toMatchObject({ reason: 'missing-output' });
  });

  it('rejects a failing process with its stderr', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'fail');

    await expect(runLanguageIdCli(options())).rejects.toMatchObject({ reason: 'exit', message: expect.stringContaining('model load failed') as string });
  });

  it('rejects a missing binary', async () => {
    await expect(runLanguageIdCli(options({ binary: join(scratch, 'missing-cli') }))).rejects.toMatchObject({ reason: 'spawn' });
  });

  it('kills on timeout', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'hang');

    await expect(runLanguageIdCli(options({ timeoutMs: 300 }))).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('refuses an invalid allowed set or an aborted signal without starting the CLI', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runLanguageIdCli(options({ allowed: [] }))).rejects.toBeInstanceOf(RangeError);
    await expect(runLanguageIdCli(options({ allowed: ['sk', 'sk'] }))).rejects.toBeInstanceOf(RangeError);
    await expect(runLanguageIdCli(options({ signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(existsSync(argsFile)).toBe(false);
  });
});

describe('parseLanguageIdCliOutput', () => {
  it('reads the candidate lines transcribe-cli writes with --output', () => {
    expect(parseLanguageIdCliOutput('candidate: 1 sk index=86 p=1.000000 logit=3.1000\n', ['sk'])).toEqual([{ code: 'sk', p: 1 }]);
  });

  it.each([
    ['ranks out of order', 'candidate: 2 sk index=86 p=0.9 logit=1\ncandidate: 1 cs index=17 p=0.1 logit=0'],
    ['a stdout summary line', 'language: sk index=86 p=0.9\ncandidate: 2 cs index=17 p=0.1 logit=0'],
    ['a missing logit', 'candidate: 1 sk index=86 p=0.9\ncandidate: 2 cs index=17 p=0.1 logit=0'],
    ['unranked probabilities', 'candidate: 1 sk index=86 p=0.1 logit=0\ncandidate: 2 cs index=17 p=0.9 logit=1'],
    ['probabilities with no mass', 'candidate: 1 sk index=86 p=0 logit=1\ncandidate: 2 cs index=17 p=0 logit=0'],
    ['a truncated list', 'candidate: 1 sk index=86 p=0.9 logit=1'],
  ])('rejects %s', (_name, text) => {
    expect(() => parseLanguageIdCliOutput(text, ['sk', 'cs'])).toThrow(TranscribeCliError);
  });
});

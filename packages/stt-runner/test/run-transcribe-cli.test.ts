import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTranscribeCli, type TranscribeCliOptions } from '../src/run-transcribe-cli';
import { TranscribeCliError } from '../src/transcribe-cli-error';
import { FAKE_CLI, readRecordedCalls } from './support/fake-cli';
import { abortWhenProcessSettles } from './support/late-abort';

let scratch: string;
let argsFile: string;

function options(overrides: Partial<TranscribeCliOptions> = {}): TranscribeCliOptions {
  return {
    binary: FAKE_CLI,
    model: '/models/parakeet.gguf',
    backend: 'metal',
    threads: 4,
    language: 'sk',
    pcm: new Uint8Array(3200),
    ...overrides,
  };
}

async function recordedTempDir(): Promise<string> {
  const [call] = await readRecordedCalls(argsFile);
  const output = call?.[call.indexOf('--output') + 1];
  expect(output).toBeDefined();
  return dirname(output ?? '');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-runner-test-'));
  argsFile = join(scratch, 'args.txt');
  vi.stubEnv('FAKE_CLI_ARGS_FILE', argsFile);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe('runTranscribeCli', () => {
  it('passes the expected arguments', async () => {
    await runTranscribeCli(options({ backend: 'cpu', threads: 2, language: 'cs' }));

    const [call] = await readRecordedCalls(argsFile);
    const tempDir = await recordedTempDir();
    expect(call).toEqual([
      '--model',
      '/models/parakeet.gguf',
      '--backend',
      'cpu',
      '--language',
      'cs',
      '--threads',
      '2',
      '--timestamps',
      'none',
      '--quiet',
      '--output',
      join(tempDir, 'transcript.txt'),
      join(tempDir, 'audio.wav'),
    ]);
  });

  it('omits the language hint for auto', async () => {
    await runTranscribeCli(options({ language: 'auto' }));

    const [call] = await readRecordedCalls(argsFile);
    expect(call).not.toContain('--language');
    expect(call).not.toContain('auto');
  });

  it('feeds the PCM as a WAV file', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'echo-chunk');
    const pcm = new Uint8Array(6400);
    new DataView(pcm.buffer).setInt16(0, 1234, true);

    await expect(runTranscribeCli(options({ pcm }))).resolves.toBe('1234:6400');
  });

  it('returns trimmed text', async () => {
    vi.stubEnv('FAKE_CLI_TEXT', 'Ahoj, toto je skúška.');

    await expect(runTranscribeCli(options())).resolves.toBe('Ahoj, toto je skúška.');
  });

  it('rejects oversized output', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'oversize');

    await expect(runTranscribeCli(options())).rejects.toMatchObject({ reason: 'output-too-large' });
  });

  it('rejects a failing process with its stderr', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'fail');

    const error: unknown = await runTranscribeCli(options()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TranscribeCliError);
    expect(error).toMatchObject({ reason: 'exit' });
    expect((error as Error).message).toContain('model load failed');
  });

  it('rejects a missing binary', async () => {
    await expect(runTranscribeCli(options({ binary: join(scratch, 'missing-cli') }))).rejects.toMatchObject({ reason: 'spawn' });
  });

  it('kills on timeout', async () => {
    const pidFile = join(scratch, 'pid');
    vi.stubEnv('FAKE_CLI_MODE', 'hang');
    vi.stubEnv('FAKE_CLI_PID_FILE', pidFile);
    const started = Date.now();

    await expect(runTranscribeCli(options({ timeoutMs: 300 }))).rejects.toMatchObject({ reason: 'timeout' });

    expect(Date.now() - started).toBeLessThan(5000);
    expect(isAlive(Number(await readFile(pidFile, 'utf8')))).toBe(false);
  });

  it('kills on abort', async () => {
    const pidFile = join(scratch, 'pid');
    vi.stubEnv('FAKE_CLI_MODE', 'hang');
    vi.stubEnv('FAKE_CLI_PID_FILE', pidFile);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);

    await expect(runTranscribeCli(options({ signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' });

    expect(isAlive(Number(await readFile(pidFile, 'utf8')))).toBe(false);
  });

  it('returns no text when aborted after the process finished', async () => {
    const controller = abortWhenProcessSettles();

    await expect(runTranscribeCli(options({ signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readRecordedCalls(argsFile)).resolves.toHaveLength(1);
  });

  it('does not start when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runTranscribeCli(options({ signal: controller.signal }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(existsSync(argsFile)).toBe(false);
  });

  it('removes the temp dir after success and failure', async () => {
    await runTranscribeCli(options());
    const successDir = await recordedTempDir();
    expect(existsSync(successDir)).toBe(false);

    await rm(argsFile);
    vi.stubEnv('FAKE_CLI_MODE', 'fail');
    await expect(runTranscribeCli(options())).rejects.toThrow();
    const failureDir = await recordedTempDir();
    expect(failureDir).not.toBe(successDir);
    expect(existsSync(failureDir)).toBe(false);
  });
});

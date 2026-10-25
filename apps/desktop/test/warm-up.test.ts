import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWarmUp } from '../src/main/models/warm-up';
import { FAKE_CLI, readRecordedCalls } from '../../../packages/stt-runner/test/support/fake-cli';

let scratch: string;
let argsFile: string;

function argValue(call: string[] | undefined, flag: string): string | undefined {
  return call?.[call.indexOf(flag) + 1];
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-warm-up-'));
  argsFile = join(scratch, 'args.txt');
  vi.stubEnv('FAKE_CLI_ARGS_FILE', argsFile);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe('createWarmUp', () => {
  it('runs one transcription of silence with the backend of the architecture', async () => {
    await createWarmUp({ binary: FAKE_CLI, arch: 'arm64' })('/models/alpha.gguf');
    await createWarmUp({ binary: FAKE_CLI, arch: 'x64' })('/models/beta.gguf');

    const calls = await readRecordedCalls(argsFile);
    expect(calls.map((call) => [argValue(call, '--model'), argValue(call, '--backend')])).toEqual([
      ['/models/alpha.gguf', 'metal'],
      ['/models/beta.gguf', 'cpu'],
    ]);
  });

  it('fails when the transcription fails', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'fail');

    await expect(createWarmUp({ binary: FAKE_CLI, arch: 'arm64' })('/models/alpha.gguf')).rejects.toMatchObject({ reason: 'exit' });
  });
});

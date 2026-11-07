import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runProcess } from '../src/run-process';
import { FAKE_CLI } from './support/fake-cli';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-process-test-'));
  vi.stubEnv('FAKE_CLI_MODE', 'stdout');
  vi.stubEnv('FAKE_CLI_STDOUT_FILE', join(scratch, 'stdout.txt'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe('runProcess', () => {
  it('returns stdout when asked to capture it', async () => {
    await writeFile(join(scratch, 'stdout.txt'), 'words: 1\n  [   0.10 ->    0.20] ahoj\n');

    await expect(runProcess(FAKE_CLI, ['x.wav'], { timeoutMs: 5000, stdoutLimitBytes: 1000 })).resolves.toBe('words: 1\n  [   0.10 ->    0.20] ahoj\n');
  });

  it('ignores stdout by default', async () => {
    await writeFile(join(scratch, 'stdout.txt'), 'noise');

    await expect(runProcess(FAKE_CLI, ['x.wav'], { timeoutMs: 5000 })).resolves.toBe('');
  });

  it('rejects stdout over the limit', async () => {
    await writeFile(join(scratch, 'stdout.txt'), 'a'.repeat(2000));

    await expect(runProcess(FAKE_CLI, ['x.wav'], { timeoutMs: 5000, stdoutLimitBytes: 1000 })).rejects.toMatchObject({ reason: 'output-too-large' });
  });
});

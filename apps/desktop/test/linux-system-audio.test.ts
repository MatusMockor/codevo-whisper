import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PipeWireSystemAudio } from '../src/main/meetings/linux-system-audio';

const FAKE_PW_RECORD = fileURLToPath(new URL('./support/fake-pw-record.sh', import.meta.url));

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-pw-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

function collect(output: PassThrough): { bytes: () => number } {
  let total = 0;
  output.on('data', (chunk: Buffer) => {
    total += chunk.byteLength;
  });
  return { bytes: () => total };
}

it('records the default sink monitor as 16 kHz mono s16 and stops cleanly', async () => {
  vi.stubEnv('FAKE_PW_ARGS_FILE', join(scratch, 'args'));
  const source = new PipeWireSystemAudio(FAKE_PW_RECORD);
  const output = new PassThrough();
  const received = collect(output);
  const started = vi.fn();
  const failed = vi.fn();

  source.start(output, { started, failed });
  await vi.waitFor(() => expect(received.bytes()).toBe(6400));
  await source.stop();

  expect(started).toHaveBeenCalledOnce();
  expect(failed).not.toHaveBeenCalled();
  expect(output.writableEnded).toBe(false);
  expect((await readFile(join(scratch, 'args'), 'utf8')).trim().split('\n')).toEqual(['-P', '{ stream.capture.sink=true }', '--rate', '16000', '--channels', '1', '--format', 's16', '-']);
});

it('reports a missing pw-record with a Slovak note', async () => {
  const source = new PipeWireSystemAudio(join(scratch, 'missing-pw-record'));
  const failed = vi.fn();

  source.start(new PassThrough(), { started: vi.fn(), failed });

  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(failed.mock.calls[0]?.[0]).toContain('pw-record');
  await source.stop();
});

it('reports an early exit once', async () => {
  vi.stubEnv('FAKE_PW_MODE', 'exit');
  const source = new PipeWireSystemAudio(FAKE_PW_RECORD);
  const failed = vi.fn();

  source.start(new PassThrough(), { started: vi.fn(), failed });

  await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
  expect(failed.mock.calls[0]?.[0]).toContain('2');
  await source.stop();
  expect(failed).toHaveBeenCalledOnce();
});

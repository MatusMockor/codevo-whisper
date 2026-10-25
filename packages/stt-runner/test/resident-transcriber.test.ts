import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResidentTranscriber, type ResidentTranscriberOptions } from '../src/worker/resident-transcriber';
import { TranscribeCliError } from '../src/transcribe-cli-error';

const FAKE_WORKER = fileURLToPath(new URL('./support/fake-worker.js', import.meta.url));

let scratch: string;
let transcriber: ResidentTranscriber | undefined;

function create(overrides: Partial<ResidentTranscriberOptions> = {}): ResidentTranscriber {
  transcriber = new ResidentTranscriber({ binary: FAKE_WORKER, model: '/models/parakeet.gguf', backend: 'vulkan', threads: 4, ...overrides });
  return transcriber;
}

function pcm(samples: number): Uint8Array {
  return new Uint8Array(samples * 2);
}

function pidOf(text: string): string {
  return text.split(':')[0] ?? '';
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-worker-test-'));
});

afterEach(async () => {
  await transcriber?.close();
  transcriber = undefined;
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe('ResidentTranscriber', () => {
  it('keeps one worker process across calls and passes the language', async () => {
    const worker = create();

    const first = await worker.transcribe({ pcm: pcm(1600), language: 'sk' });
    const second = await worker.transcribe({ pcm: pcm(3200), language: 'auto' });

    expect(first).toMatch(/^\d+:sk:1600$/);
    expect(second).toBe(`${pidOf(first)}:auto:3200`);
  });

  it('starts the worker with the model, backend and thread count', async () => {
    const argsFile = join(scratch, 'args.txt');
    vi.stubEnv('FAKE_WORKER_ARGS_FILE', argsFile);
    await create({ backend: 'cpu', threads: 2 }).transcribe({ pcm: pcm(10), language: 'cs' });

    expect(await readFile(argsFile, 'utf8')).toBe('--model /models/parakeet.gguf --backend cpu --threads 2\n');
  });

  it('warms the model up once and reuses that worker', async () => {
    const argsFile = join(scratch, 'args.txt');
    vi.stubEnv('FAKE_WORKER_ARGS_FILE', argsFile);
    const worker = create();

    await worker.warmUp();
    await worker.transcribe({ pcm: pcm(1), language: 'sk' });
    expect((await readFile(argsFile, 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('reports a failed warm-up and still retries on the next call', async () => {
    vi.stubEnv('FAKE_WORKER_LOAD', 'fail');
    const worker = create();
    await expect(worker.warmUp()).rejects.toMatchObject({ reason: 'spawn' });
    vi.stubEnv('FAKE_WORKER_LOAD', '');

    await expect(worker.transcribe({ pcm: pcm(2), language: 'sk' })).resolves.toMatch(/:sk:2$/);
  });

  it('serves concurrent calls one after another', async () => {
    vi.stubEnv('FAKE_WORKER_DELAY_MS', '50');
    const worker = create();

    const texts = await Promise.all([1, 2, 3].map((samples) => worker.transcribe({ pcm: pcm(samples), language: 'sk' })));

    expect(texts.map((text) => text.split(':').slice(1).join(':'))).toEqual(['sk:1', 'sk:2', 'sk:3']);
    expect(new Set(texts.map(pidOf)).size).toBe(1);
  });

  it('abort rejects promptly and the next call runs on a fresh worker', async () => {
    vi.stubEnv('FAKE_WORKER_SLOW_SAMPLES', '2');
    const worker = create();
    const before = pidOf(await worker.transcribe({ pcm: pcm(1), language: 'sk' }));
    const controller = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');
    const started = Date.now();
    const pending = worker.transcribe({ pcm: pcm(2), language: 'sk', signal: controller.signal });
    setTimeout(() => controller.abort(reason), 50);

    await expect(pending).rejects.toBe(reason);
    expect(Date.now() - started).toBeLessThan(2_000);
    const after = await worker.transcribe({ pcm: pcm(3), language: 'sk' });
    expect(after).toMatch(/:sk:3$/);
    expect(pidOf(after)).not.toBe(before);
  });

  it('a call queued behind an aborted call runs on the fresh worker', async () => {
    vi.stubEnv('FAKE_WORKER_SLOW_SAMPLES', '1');
    const worker = create();
    const controller = new AbortController();
    const aborted = worker.transcribe({ pcm: pcm(1), language: 'sk', signal: controller.signal });
    const queued = worker.transcribe({ pcm: pcm(2), language: 'en' });
    setTimeout(() => controller.abort(), 50);

    await expect(aborted).rejects.toBeInstanceOf(DOMException);
    await expect(queued).resolves.toMatch(/:en:2$/);
  });

  it('rejects an already aborted call without touching the worker', async () => {
    const argsFile = join(scratch, 'args.txt');
    vi.stubEnv('FAKE_WORKER_ARGS_FILE', argsFile);
    const controller = new AbortController();
    controller.abort();

    await expect(create().transcribe({ pcm: pcm(1), language: 'sk', signal: controller.signal })).rejects.toBeInstanceOf(DOMException);
    await expect(readFile(argsFile, 'utf8')).rejects.toThrow();
  });

  it('a crash rejects the call in flight and the next call recovers', async () => {
    vi.stubEnv('FAKE_WORKER_CRASH_SAMPLES', '1234');
    const worker = create();

    await expect(worker.transcribe({ pcm: pcm(1234), language: 'sk' })).rejects.toMatchObject({ reason: 'exit' });
    await expect(worker.transcribe({ pcm: pcm(5), language: 'sk' })).resolves.toMatch(/:sk:5$/);
  });

  it('a timeout rejects with timeout and replaces the worker', async () => {
    vi.stubEnv('FAKE_WORKER_SLOW_SAMPLES', '1');
    const worker = create({ timeoutMs: 100 });

    const failure = worker.transcribe({ pcm: pcm(1), language: 'sk' });
    await expect(failure).rejects.toBeInstanceOf(TranscribeCliError);
    await expect(failure).rejects.toMatchObject({ reason: 'timeout' });
    await expect(worker.transcribe({ pcm: pcm(4), language: 'sk' })).resolves.toMatch(/:sk:4$/);
  });

  it('reports a model that cannot be loaded as a spawn failure', async () => {
    vi.stubEnv('FAKE_WORKER_LOAD', 'fail');

    await expect(create().transcribe({ pcm: pcm(1), language: 'sk' })).rejects.toMatchObject({
      reason: 'spawn',
      message: expect.stringContaining('model load failed') as string,
    });
  });

  it('reports a missing binary as a spawn failure', async () => {
    await expect(create({ binary: join(scratch, 'missing') }).transcribe({ pcm: pcm(1), language: 'sk' })).rejects.toMatchObject({
      reason: 'spawn',
    });
  });

  it('rejects a reply larger than the transcript limit', async () => {
    vi.stubEnv('FAKE_WORKER_REPLY_TEXT', 'x'.repeat(16_001));

    await expect(create().transcribe({ pcm: pcm(1), language: 'sk' })).rejects.toMatchObject({ reason: 'output-too-large' });
  });

  it('trims the transcript like the CLI path', async () => {
    vi.stubEnv('FAKE_WORKER_REPLY_TEXT', '  ahoj svet \n');

    await expect(create().transcribe({ pcm: pcm(1), language: 'sk' })).resolves.toBe('ahoj svet');
  });
});

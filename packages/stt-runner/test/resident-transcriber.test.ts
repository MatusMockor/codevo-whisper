import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESIDENT_DEFAULTS, ResidentTranscriber, type ResidentTranscriberOptions } from '../src/worker/resident-transcriber';
import { TranscribeCliError } from '../src/transcribe-cli-error';

const FAKE_WORKER = fileURLToPath(new URL('./support/fake-worker.js', import.meta.url));

let scratch: string;
let transcriber: ResidentTranscriber | undefined;

function create(overrides: Partial<ResidentTranscriberOptions> = {}): ResidentTranscriber {
  transcriber = new ResidentTranscriber({
    binary: FAKE_WORKER,
    model: '/models/parakeet.gguf',
    backend: 'vulkan',
    threads: 4,
    abortGraceMs: 100,
    backoff: { initialMs: 50, maxMs: 400 },
    ...overrides,
  });
  return transcriber;
}

function pcm(samples: number): Uint8Array {
  return new Uint8Array(samples * 2);
}

async function spawnTimes(file: string): Promise<number[]> {
  const text = await readFile(file, 'utf8').catch(() => '');
  return text
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map(Number);
}

async function waitForFile(file: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const present = await readFile(file, 'utf8').then(
      () => true,
      () => false,
    );
    if (present) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect.fail(`${file} was never written`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && isAlive(pid); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(isAlive(pid)).toBe(false);
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

  it('abort rejects promptly, kills the worker after the grace and respawns only on the next call', async () => {
    const spawns = join(scratch, 'spawns.txt');
    vi.stubEnv('FAKE_WORKER_SPAWNS_FILE', spawns);
    vi.stubEnv('FAKE_WORKER_SLOW_SAMPLES', '2');
    const worker = create();
    const before = Number(pidOf(await worker.transcribe({ pcm: pcm(1), language: 'sk' })));
    const controller = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');
    const started = Date.now();
    const pending = worker.transcribe({ pcm: pcm(2), language: 'sk', signal: controller.signal });
    setTimeout(() => controller.abort(reason), 50);

    await expect(pending).rejects.toBe(reason);
    expect(Date.now() - started).toBeLessThan(1_000);
    await waitForExit(before);
    expect(await spawnTimes(spawns)).toHaveLength(1);
    const after = await worker.transcribe({ pcm: pcm(3), language: 'sk' });
    expect(after).toMatch(/:sk:3$/);
    expect(Number(pidOf(after))).not.toBe(before);
    expect(await spawnTimes(spawns)).toHaveLength(2);
  });

  it('keeps the worker when an aborted call answers within the grace', async () => {
    vi.stubEnv('FAKE_WORKER_SLOW_SAMPLES', '2');
    vi.stubEnv('FAKE_WORKER_SLOW_MS', '200');
    const worker = create({ abortGraceMs: 2_000 });
    const before = pidOf(await worker.transcribe({ pcm: pcm(1), language: 'sk' }));
    const controller = new AbortController();
    const pending = worker.transcribe({ pcm: pcm(2), language: 'sk', signal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    await expect(pending).rejects.toBeInstanceOf(DOMException);
    expect(pidOf(await worker.transcribe({ pcm: pcm(3), language: 'sk' }))).toBe(before);
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

  it('backs off exponentially between respawns after failures and resets after a success', async () => {
    const spawns = join(scratch, 'spawns.txt');
    vi.stubEnv('FAKE_WORKER_SPAWNS_FILE', spawns);
    vi.stubEnv('FAKE_WORKER_CRASH_SAMPLES', '9');
    const worker = create({ backoff: { initialMs: 100, maxMs: 1_000 } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(worker.transcribe({ pcm: pcm(9), language: 'sk' })).rejects.toMatchObject({ reason: 'exit' });
    }
    await expect(worker.transcribe({ pcm: pcm(1), language: 'sk' })).resolves.toMatch(/:sk:1$/);
    await expect(worker.transcribe({ pcm: pcm(9), language: 'sk' })).rejects.toMatchObject({ reason: 'exit' });
    await expect(worker.transcribe({ pcm: pcm(1), language: 'sk' })).resolves.toMatch(/:sk:1$/);

    const times = await spawnTimes(spawns);
    const gaps = times.slice(1).map((time, index) => time - (times[index] ?? 0));
    expect(gaps).toHaveLength(4);
    expect(gaps[0]).toBeGreaterThanOrEqual(100);
    expect(gaps[1]).toBeGreaterThanOrEqual(200);
    expect(gaps[2]).toBeGreaterThanOrEqual(400);
    expect(gaps[3]).toBeGreaterThanOrEqual(100);
    expect(gaps[3]).toBeLessThan(400);
  });

  it('is not ready until the worker answered ready', async () => {
    vi.stubEnv('FAKE_WORKER_LOAD_DELAY_MS', '200');
    const worker = create();
    expect(worker.ready()).toBe(false);
    const warming = worker.warmUp();
    expect(worker.ready()).toBe(false);

    await warming;
    expect(worker.ready()).toBe(true);
  });

  it('kills a worker that misses the startup deadline and reports not ready', async () => {
    const spawns = join(scratch, 'spawns.txt');
    vi.stubEnv('FAKE_WORKER_SPAWNS_FILE', spawns);
    vi.stubEnv('FAKE_WORKER_LOAD_DELAY_MS', '5000');
    const worker = create({ startupTimeoutMs: 100 });

    await expect(worker.warmUp()).rejects.toMatchObject({ reason: 'timeout' });
    expect(worker.ready()).toBe(false);
    vi.stubEnv('FAKE_WORKER_LOAD_DELAY_MS', '0');
    await expect(worker.transcribe({ pcm: pcm(1), language: 'sk' })).resolves.toMatch(/:sk:1$/);
    expect(worker.ready()).toBe(true);
    expect(await spawnTimes(spawns)).toHaveLength(2);
  });

  it('uses a 30 s call timeout, a 120 s startup deadline and a 2 s abort grace by default', () => {
    expect(RESIDENT_DEFAULTS).toEqual({ timeoutMs: 30_000, startupTimeoutMs: 120_000, abortGraceMs: 2_000, backoff: { initialMs: 500, maxMs: 30_000 } });
  });

  it('rejects an already aborted call without touching the worker', async () => {
    const argsFile = join(scratch, 'args.txt');
    vi.stubEnv('FAKE_WORKER_ARGS_FILE', argsFile);
    const controller = new AbortController();
    controller.abort();

    await expect(create().transcribe({ pcm: pcm(1), language: 'sk', signal: controller.signal })).rejects.toBeInstanceOf(DOMException);
    await expect(readFile(argsFile, 'utf8')).rejects.toThrow();
  });

  it('close rejects queued and later calls and starts no new worker', async () => {
    const argsFile = join(scratch, 'args.txt');
    vi.stubEnv('FAKE_WORKER_ARGS_FILE', argsFile);
    vi.stubEnv('FAKE_WORKER_SLOW_SAMPLES', '1');
    const worker = create();
    const running = worker.transcribe({ pcm: pcm(1), language: 'sk' });
    const queued = worker.transcribe({ pcm: pcm(2), language: 'sk' });
    await waitForFile(argsFile);
    await worker.close();

    await expect(running).rejects.toBeInstanceOf(TranscribeCliError);
    await expect(queued).rejects.toMatchObject({ message: expect.stringContaining('closed') as string });
    await expect(worker.transcribe({ pcm: pcm(3), language: 'sk' })).rejects.toBeInstanceOf(TranscribeCliError);
    await expect(worker.warmUp()).rejects.toBeInstanceOf(TranscribeCliError);
    expect((await readFile(argsFile, 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('replaces a worker that died while idle before the next call', async () => {
    const worker = create();
    const before = Number(pidOf(await worker.transcribe({ pcm: pcm(1), language: 'sk' })));
    process.kill(before, 'SIGKILL');
    await waitForExit(before);

    const after = await worker.transcribe({ pcm: pcm(2), language: 'sk' });
    expect(after).toMatch(/:sk:2$/);
    expect(Number(pidOf(after))).not.toBe(before);
  });

  it('rejects a call with more than 30 s of audio and keeps serving', async () => {
    const worker = create();

    await expect(worker.transcribe({ pcm: pcm(480_001), language: 'sk' })).rejects.toBeInstanceOf(RangeError);
    await expect(worker.transcribe({ pcm: pcm(480_000), language: 'sk' })).resolves.toMatch(/:sk:480000$/);
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

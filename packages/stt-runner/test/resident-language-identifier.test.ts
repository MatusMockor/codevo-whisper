import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGE_CODES, type LanguageCode } from '../src/languages';
import { TranscribeCliError } from '../src/transcribe-cli-error';
import { ResidentLanguageIdentifier, type ResidentLanguageIdentifierOptions } from '../src/worker/resident-language-identifier';
import { ResidentTranscriber } from '../src/worker/resident-transcriber';
import { spawnTimes, waitForFile } from './support/process-observer';

const FAKE_WORKER = fileURLToPath(new URL('./support/fake-worker.js', import.meta.url));
const LID_MODEL = '/models/lang-id-voxlingua107-ecapa-Q8_0.gguf';
const SK_CS_EN: readonly LanguageCode[] = ['sk', 'cs', 'en'];

let scratch: string;
let spawns: string;
const closers: { close: () => Promise<void> }[] = [];

function create(overrides: Partial<ResidentLanguageIdentifierOptions> = {}): ResidentLanguageIdentifier {
  const identifier = new ResidentLanguageIdentifier({
    binary: FAKE_WORKER,
    model: LID_MODEL,
    backend: 'cpu',
    threads: 2,
    abortGraceMs: 100,
    backoff: { initialMs: 50, maxMs: 400 },
    ...overrides,
  });
  closers.push(identifier);
  return identifier;
}

function pcm(samples: number): Uint8Array {
  return new Uint8Array(samples * 2);
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-langid-test-'));
  spawns = join(scratch, 'spawns.txt');
  vi.stubEnv('FAKE_WORKER_SPAWNS_FILE', spawns);
});

afterEach(async () => {
  await Promise.all(closers.splice(0).map((closer) => closer.close()));
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe('ResidentLanguageIdentifier', () => {
  it('returns the ranked scores over the allowed codes from one resident process', async () => {
    vi.stubEnv('FAKE_WORKER_LID_TOP', 'cs');
    vi.stubEnv('FAKE_WORKER_LID_P', '0.995');
    const identifier = create();

    const first = await identifier.identify({ pcm: pcm(16_000), allowed: SK_CS_EN });
    const second = await identifier.identify({ pcm: pcm(8_000), allowed: ['en', 'sk'] });

    expect(first).toEqual([
      { code: 'cs', p: 0.995 },
      { code: 'sk', p: 0.0025 },
      { code: 'en', p: 0.0025 },
    ]);
    expect(second).toEqual([
      { code: 'en', p: 0.995 },
      { code: 'sk', p: 0.005 },
    ]);
    expect(await spawnTimes(spawns)).toHaveLength(1);
  });

  it('reads the exponent form the native worker prints for tiny probabilities', async () => {
    vi.stubEnv('FAKE_WORKER_LID_TOP', 'sk');
    vi.stubEnv('FAKE_WORKER_LID_P', '0.999994695');

    const [top, second, third] = await create().identify({ pcm: pcm(16_000), allowed: SK_CS_EN });

    expect(top).toEqual({ code: 'sk', p: 0.999994695 });
    expect(second?.code).toBe('cs');
    expect(second?.p).toBeCloseTo(2.6525e-6, 12);
    expect(third?.code).toBe('en');
  });

  it('rejects audio the worker finds too short and keeps the same worker', async () => {
    vi.stubEnv('FAKE_WORKER_LID_MIN_SAMPLES', '8000');
    const identifier = create();

    await expect(identifier.identify({ pcm: pcm(7_999), allowed: SK_CS_EN })).rejects.toMatchObject({ reason: 'exit', message: expect.stringContaining('input audio too short') as string });
    await expect(identifier.identify({ pcm: pcm(8_000), allowed: SK_CS_EN })).resolves.toHaveLength(3);
    expect(await spawnTimes(spawns)).toHaveLength(1);
  });

  it('sends all 25 supported codes in one request', async () => {
    const scores = await create().identify({ pcm: pcm(1), allowed: LANGUAGE_CODES });

    expect(scores.map((score) => score.code)).toEqual([...LANGUAGE_CODES]);
  });

  it('starts the worker with the model, backend and thread count', async () => {
    const argsFile = join(scratch, 'args.txt');
    vi.stubEnv('FAKE_WORKER_ARGS_FILE', argsFile);
    await create().identify({ pcm: pcm(1), allowed: ['sk'] });

    expect(await readFile(argsFile, 'utf8')).toBe(`--model ${LID_MODEL} --backend cpu --threads 2\n`);
  });

  it('is ready only after warm-up and reuses the warmed worker', async () => {
    vi.stubEnv('FAKE_WORKER_LOAD_DELAY_MS', '100');
    const identifier = create();
    expect(identifier.ready()).toBe(false);

    await identifier.warmUp();
    expect(identifier.ready()).toBe(true);
    await identifier.identify({ pcm: pcm(1), allowed: ['sk'] });
    expect(await spawnTimes(spawns)).toHaveLength(1);
  });

  it('reports a model that cannot be loaded as a spawn failure', async () => {
    vi.stubEnv('FAKE_WORKER_LOAD', 'fail');

    await expect(create().identify({ pcm: pcm(1), allowed: ['sk'] })).rejects.toMatchObject({ reason: 'spawn' });
  });

  it('a crash rejects the call in flight and the next call recovers on a new process', async () => {
    vi.stubEnv('FAKE_WORKER_CRASH_SAMPLES', '77');
    const identifier = create();

    await expect(identifier.identify({ pcm: pcm(77), allowed: SK_CS_EN })).rejects.toMatchObject({ reason: 'exit' });
    await expect(identifier.identify({ pcm: pcm(1), allowed: SK_CS_EN })).resolves.toHaveLength(3);
    expect(await spawnTimes(spawns)).toHaveLength(2);
  });

  it('backs off exponentially between respawns and resets after a success', async () => {
    vi.stubEnv('FAKE_WORKER_CRASH_SAMPLES', '9');
    const identifier = create({ backoff: { initialMs: 100, maxMs: 1_000 } });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(identifier.identify({ pcm: pcm(9), allowed: ['sk'] })).rejects.toMatchObject({ reason: 'exit' });
    }
    await expect(identifier.identify({ pcm: pcm(1), allowed: ['sk'] })).resolves.toEqual([{ code: 'sk', p: 1 }]);
    await expect(identifier.identify({ pcm: pcm(9), allowed: ['sk'] })).rejects.toMatchObject({ reason: 'exit' });
    await expect(identifier.identify({ pcm: pcm(1), allowed: ['sk'] })).resolves.toEqual([{ code: 'sk', p: 1 }]);

    const times = await spawnTimes(spawns);
    const gaps = times.slice(1).map((time, index) => time - (times[index] ?? 0));
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toBeGreaterThanOrEqual(100);
    expect(gaps[1]).toBeGreaterThanOrEqual(200);
    expect(gaps[2]).toBeGreaterThanOrEqual(100);
  });

  it('abort rejects promptly with the reason, abandons the worker after the grace and respawns on the next call', async () => {
    vi.stubEnv('FAKE_WORKER_SLOW_SAMPLES', '2');
    const identifier = create();
    await identifier.identify({ pcm: pcm(1), allowed: SK_CS_EN });
    const controller = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');
    const started = Date.now();
    const pending = identifier.identify({ pcm: pcm(2), allowed: SK_CS_EN, signal: controller.signal });
    setTimeout(() => controller.abort(reason), 50);

    await expect(pending).rejects.toBe(reason);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(await spawnTimes(spawns)).toHaveLength(1);
    await expect(identifier.identify({ pcm: pcm(3), allowed: SK_CS_EN })).resolves.toHaveLength(3);
    expect(await spawnTimes(spawns)).toHaveLength(2);
  });

  it('rejects an already aborted call without starting a worker', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(create().identify({ pcm: pcm(1), allowed: ['sk'], signal: controller.signal })).rejects.toBeInstanceOf(DOMException);
    expect(await spawnTimes(spawns)).toHaveLength(0);
  });

  it('a timeout rejects with timeout and replaces the worker', async () => {
    vi.stubEnv('FAKE_WORKER_SLOW_SAMPLES', '1');
    const identifier = create({ timeoutMs: 100 });

    await expect(identifier.identify({ pcm: pcm(1), allowed: ['sk'] })).rejects.toMatchObject({ reason: 'timeout' });
    await expect(identifier.identify({ pcm: pcm(4), allowed: ['sk'] })).resolves.toEqual([{ code: 'sk', p: 1 }]);
    expect(await spawnTimes(spawns)).toHaveLength(2);
  });

  it('refuses an invalid allowed set before starting a worker and keeps serving', async () => {
    const identifier = create();

    await expect(identifier.identify({ pcm: pcm(1), allowed: [] })).rejects.toBeInstanceOf(RangeError);
    await expect(identifier.identify({ pcm: pcm(1), allowed: ['xx' as LanguageCode] })).rejects.toBeInstanceOf(RangeError);
    expect(await spawnTimes(spawns)).toHaveLength(0);
    await expect(identifier.identify({ pcm: pcm(1), allowed: ['sk'] })).resolves.toEqual([{ code: 'sk', p: 1 }]);
  });

  it('rejects a malformed reply and keeps the same worker', async () => {
    vi.stubEnv('FAKE_WORKER_REPLY_TEXT', 'sk 1\ncs 1\n');
    const identifier = create();

    await expect(identifier.identify({ pcm: pcm(1), allowed: ['sk', 'cs'] })).rejects.toBeInstanceOf(TranscribeCliError);
    await expect(identifier.identify({ pcm: pcm(2), allowed: ['sk', 'cs'] })).rejects.toMatchObject({ message: expect.stringContaining('invalid language scores') as string });
    expect(await spawnTimes(spawns)).toHaveLength(1);
  });

  it('rejects a reply larger than the score limit', async () => {
    vi.stubEnv('FAKE_WORKER_REPLY_TEXT', 'x'.repeat(2_049));

    await expect(create().identify({ pcm: pcm(1), allowed: ['sk'] })).rejects.toMatchObject({ reason: 'output-too-large' });
  });

  it('gets a wrong role failure from an ASR worker and the ASR resident gets one from a LID worker', async () => {
    const identifier = create({ model: '/models/parakeet.gguf' });
    const transcriber = new ResidentTranscriber({ binary: FAKE_WORKER, model: LID_MODEL, backend: 'cpu', threads: 2 });
    closers.push(transcriber);

    await expect(identifier.identify({ pcm: pcm(1), allowed: ['sk'] })).rejects.toMatchObject({ reason: 'exit', message: expect.stringContaining('wrong role') as string });
    await expect(transcriber.transcribe({ pcm: pcm(1), language: 'sk' })).rejects.toMatchObject({ reason: 'exit', message: expect.stringContaining('wrong role') as string });
    await expect(identifier.identify({ pcm: pcm(2), allowed: ['sk'] })).rejects.toMatchObject({ message: expect.stringContaining('wrong role') as string });
    expect(await spawnTimes(spawns)).toHaveLength(2);
  });

  it('close rejects queued and later calls and starts no new worker', async () => {
    vi.stubEnv('FAKE_WORKER_SLOW_SAMPLES', '1');
    const identifier = create();
    const running = identifier.identify({ pcm: pcm(1), allowed: ['sk'] });
    const queued = identifier.identify({ pcm: pcm(2), allowed: ['sk'] });
    await waitForFile(spawns);
    await identifier.close();

    await expect(running).rejects.toBeInstanceOf(TranscribeCliError);
    await expect(queued).rejects.toMatchObject({ message: expect.stringContaining('closed') as string });
    await expect(identifier.identify({ pcm: pcm(3), allowed: ['sk'] })).rejects.toBeInstanceOf(TranscribeCliError);
    expect(await spawnTimes(spawns)).toHaveLength(1);
  });
});

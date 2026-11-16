import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSttConfig } from '../src/config';
import { createEngine, type EngineOptions } from '../src/create-engine';
import type { Engine } from '../src/engine';
import { startSttServer, type SttServer } from '../src/server';
import { pcm, send, type Reply } from './support/http-client';

const FAKE_WORKER = fileURLToPath(new URL('../../../packages/stt-runner/test/support/fake-worker.js', import.meta.url));
const TWO_SECONDS = 32_000;
const WHISPER_PATH = '/models/whisper-large-v3-F16.gguf';
const PARAKEET = { id: 'parakeet-ultra', name: 'Parakeet Ultra (F16)', available: true, default: true };
const WHISPER = { id: 'whisper-large-v3', name: 'Whisper Large v3 (F16)', available: true, default: false };

type TextReply = { status: number; body: { text: string; language?: string | null; route?: string } };

let scratch: string;
let argsFile: string;
let server: SttServer | undefined;
let engine: Engine | undefined;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-stt-models-'));
  argsFile = join(scratch, 'args.txt');
  vi.stubEnv('FAKE_WORKER_ARGS_FILE', argsFile);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await server?.stop();
  await engine?.close();
  server = undefined;
  engine = undefined;
  await rm(scratch, { recursive: true, force: true });
});

async function serve(options: EngineOptions = { routing: false, whisper: true }): Promise<SttServer> {
  engine = createEngine({ ...loadSttConfig({}), workerBinary: FAKE_WORKER, threads: 1 }, options);
  server = await startSttServer({ transcriber: engine.transcriber, router: engine.router, models: engine.models, catalog: engine.catalog, port: 0, host: '127.0.0.1' });
  await engine.transcriber.warmUp();
  return server;
}

async function spawnedModels(): Promise<string[]> {
  const text = await readFile(argsFile, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(' ')[1] ?? '');
}

async function whisperSpawns(): Promise<number> {
  return (await spawnedModels()).filter((model) => model === WHISPER_PATH).length;
}

function transcribe(stt: SttServer, query: string, samples = TWO_SECONDS): Promise<TextReply> {
  return send(stt, `/transcribe?${query}`, { body: pcm(samples) }) as Promise<TextReply>;
}

function workerOf(reply: Reply): string {
  return ((reply.body as { text?: string }).text ?? '').split(':')[0] ?? '';
}

describe('selectable transcription models', () => {
  it('lists the default and the Whisper model with their availability', async () => {
    const present = await serve();

    expect((await send(present, '/capabilities', { method: 'GET' })).body).toMatchObject({ transcriptionModels: [PARAKEET, WHISPER] });
    await present.stop();
    await engine?.close();

    const missing = await serve({ routing: false });
    expect((await send(missing, '/capabilities', { method: 'GET' })).body).toMatchObject({ transcriptionModels: [PARAKEET, { ...WHISPER, available: false }] });
  });

  it('serves a request without a model and one naming the default from the resident default worker', async () => {
    const stt = await serve();

    const implicit = await transcribe(stt, 'language=sk');
    const explicit = await transcribe(stt, 'language=sk&model=parakeet-ultra');

    expect(implicit.body.text).toMatch(/^\d+:sk:32000$/);
    expect(workerOf(explicit)).toBe(workerOf(implicit));
    expect(await whisperSpawns()).toBe(0);
  });

  it('answers 400 for an unknown model and 409 for a model whose file is missing', async () => {
    const stt = await serve({ routing: false });

    for (const model of ['whisper', 'Whisper-Large-V3', '', 'canary-1b-v2']) {
      expect(await transcribe(stt, `language=sk&model=${encodeURIComponent(model)}`), model).toEqual({ status: 400, body: { error: 'unknown model' } });
    }
    expect(await transcribe(stt, 'language=sk&model=whisper-large-v3')).toEqual({ status: 409, body: { error: 'model unavailable' } });
    expect(await whisperSpawns()).toBe(0);
    expect((await transcribe(stt, 'language=sk')).status).toBe(200);
  });

  it('loads Whisper on first use only and keeps it resident beside the default model', async () => {
    const stt = await serve();
    expect(await whisperSpawns()).toBe(0);

    const first = await transcribe(stt, 'language=sk&model=whisper-large-v3');
    const second = await transcribe(stt, 'language=en&model=whisper-large-v3');
    const parakeet = await transcribe(stt, 'language=sk');

    expect(first).toEqual({ status: 200, body: { text: expect.stringMatching(/^\d+:sk:32000$/) as unknown } });
    expect(second.body.text).toBe(`${workerOf(first)}:en:32000`);
    expect(workerOf(parakeet)).not.toBe(workerOf(first));
    expect(await whisperSpawns()).toBe(1);
    expect(await spawnedModels()).toEqual(['/models/parakeet-ultra-F16.gguf', WHISPER_PATH]);
  });

  it('bypasses language routing and hints the single selected language', async () => {
    const stt = await serve();

    expect(await transcribe(stt, 'language=auto&languages=cs&kind=partial&model=whisper-large-v3')).toEqual({
      status: 200,
      body: { text: expect.stringMatching(/^\d+:cs:32000$/) as unknown, language: 'cs', route: 'direct' },
    });
    expect(await transcribe(stt, 'language=sk&languages=sk&model=whisper-large-v3')).toEqual({ status: 400, body: { error: 'invalid PCM or language' } });
    expect(await transcribe(stt, 'language=auto&languages=sk&model=parakeet-ultra')).toEqual({ status: 409, body: { error: 'languages unavailable' } });
  });

  it('lets Whisper detect the language when several languages are selected', async () => {
    const stt = await serve();

    expect(await transcribe(stt, 'language=auto&languages=sk,cs,en&model=whisper-large-v3')).toEqual({
      status: 200,
      body: { text: expect.stringMatching(/^\d+:auto:32000$/) as unknown, language: null, route: 'direct' },
    });
  });

  it('passes the vocabulary to Whisper as it does to the default model', async () => {
    vi.stubEnv('FAKE_WORKER_VOCABULARY', '1');
    const stt = await serve();

    expect(await transcribe(stt, 'language=auto&languages=sk,cs&vocabulary=Kumiba&vocabulary=%C5%BDilina&model=whisper-large-v3')).toEqual({
      status: 200,
      body: { text: '["Kumiba","Žilina"]', language: null, route: 'direct' },
    });
    expect((await transcribe(stt, 'language=sk&vocabulary=Kumiba&model=whisper-large-v3')).body).toEqual({ text: '["Kumiba"]' });
  });

  it('shares one Whisper load between concurrent first requests and keeps the sidecar single-flight', async () => {
    const stt = await serve();
    vi.stubEnv('FAKE_WORKER_LOAD_DELAY_MS', '300');
    vi.stubEnv('FAKE_WORKER_DELAY_MS', '200');

    const replies = await Promise.all([transcribe(stt, 'language=sk&model=whisper-large-v3'), transcribe(stt, 'language=cs&model=whisper-large-v3')]);

    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 503]);
    expect(await whisperSpawns()).toBe(1);
  });

  it('keeps the default model serving other devices while Whisper loads', async () => {
    const stt = await serve();
    vi.stubEnv('FAKE_WORKER_LOAD_DELAY_MS', '800');
    let whisperDone = false;

    const whisper = transcribe(stt, 'language=sk&model=whisper-large-v3').then((reply) => {
      whisperDone = true;
      return reply;
    });
    await expect.poll(whisperSpawns, { interval: 10 }).toBe(1);
    const parakeet = await transcribe(stt, 'language=sk');

    expect(parakeet.status).toBe(200);
    expect(whisperDone).toBe(false);
    expect((await whisper).status).toBe(200);
  });

  it('drops a Whisper request whose client left during the load instead of transcribing it', async () => {
    const stt = await serve();
    vi.stubEnv('FAKE_WORKER_LOAD_DELAY_MS', '300');
    vi.stubEnv('FAKE_WORKER_DELAY_MS', '1500');
    const { port } = stt.address() as AddressInfo;
    const abandoned = request({ host: '127.0.0.1', port, path: '/transcribe?language=sk&model=whisper-large-v3', method: 'POST', headers: { 'content-type': 'application/octet-stream' } });
    abandoned.on('error', () => undefined);
    abandoned.end(Buffer.from(pcm(TWO_SECONDS)));

    await expect.poll(whisperSpawns, { interval: 10 }).toBe(1);
    abandoned.destroy();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect((await transcribe(stt, 'language=sk')).status).toBe(200);
  });

  it('answers 502 when Whisper fails to load and loads it again on the next request', async () => {
    const errors: string[] = [];
    engine = createEngine({ ...loadSttConfig({}), workerBinary: FAKE_WORKER, threads: 1 }, { routing: false, whisper: true });
    const { transcriber, router, models, catalog } = engine;
    server = await startSttServer({ transcriber, router, models, catalog, port: 0, host: '127.0.0.1', onError: (code) => errors.push(code) });
    await engine.transcriber.warmUp();
    vi.stubEnv('FAKE_WORKER_LOAD', 'fail');

    expect(await transcribe(server, 'language=sk&model=whisper-large-v3')).toEqual({ status: 502, body: { error: 'model failed to load' } });
    expect(errors).toEqual(['502']);
    expect((await transcribe(server, 'language=sk')).status).toBe(200);

    vi.stubEnv('FAKE_WORKER_LOAD', '');
    expect((await transcribe(server, 'language=sk&model=whisper-large-v3')).body.text).toMatch(/^\d+:sk:32000$/);
    expect(await whisperSpawns()).toBe(2);
  });

  it('keeps the Whisper model available on the per-call CLI engine', () => {
    engine = createEngine(loadSttConfig({ STT_ENGINE: 'cli' }), { routing: false, whisper: true });

    expect(engine.catalog.report()).toEqual([PARAKEET, WHISPER]);
  });
});

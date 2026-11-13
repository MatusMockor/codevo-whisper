import { fileURLToPath } from 'node:url';
import { SUPPORTED_LANGUAGES } from '@codevo-whisper/language-routing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSttConfig } from '../src/config';
import { createEngine } from '../src/create-engine';
import type { Engine } from '../src/engine';
import { startSttServer, type SttServer } from '../src/server';
import type { RetryBackoff } from '../src/warm-up-retry';
import { pcm, send } from './support/http-client';

const FAKE_WORKER = fileURLToPath(new URL('../../../packages/stt-runner/test/support/fake-worker.js', import.meta.url));
const TWO_SECONDS = 32_000;
const CYRILLIC_DRIFT = 'привіт як справи';

const ROUTING_MODELS = { transcription: 'Parakeet Ultra (F16)', conditioned: 'Canary 1B v2 (Q8)', languageId: 'VoxLingua107 (rozpoznanie jazyka)' };

type WorkerEnv = Readonly<Record<string, string>>;

let server: SttServer | undefined;
let engine: Engine | undefined;

async function startWith(warmUp: () => Promise<unknown>, env: WorkerEnv): Promise<void> {
  Object.entries(env).forEach(([name, value]) => vi.stubEnv(name, value));
  await warmUp();
  vi.unstubAllEnvs();
}

async function serve(routing: boolean, warmUpBackoff?: RetryBackoff): Promise<{ engine: Engine; server: SttServer }> {
  engine = createEngine({ ...loadSttConfig({}), workerBinary: FAKE_WORKER, threads: 1 }, { routing, ...(warmUpBackoff === undefined ? {} : { warmUpBackoff }) });
  server = await startSttServer({ transcriber: engine.transcriber, router: engine.router, models: engine.models, port: 0, host: '127.0.0.1' });
  return { engine, server };
}

async function serveReady(languageModels: WorkerEnv, verbatim: WorkerEnv = {}): Promise<SttServer> {
  const started = await serve(true);
  await startWith(() => started.engine.warmUpLanguageModels(), languageModels);
  await startWith(() => started.engine.transcriber.warmUp(), verbatim);
  return started.server;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await server?.stop();
  await engine?.close();
  server = undefined;
  engine = undefined;
});

describe('language routing on resident workers', () => {
  it('reports no languages and no language models without the language models', async () => {
    const started = await serve(false);
    await started.engine.transcriber.warmUp();

    expect(await send(started.server, '/capabilities', { method: 'GET' })).toEqual({
      status: 200,
      body: { languages: [], models: { transcription: 'Parakeet Ultra (F16)', conditioned: null, languageId: null } },
    });
    expect(await send(started.server, '/transcribe?language=auto&languages=sk', { body: pcm(TWO_SECONDS) })).toEqual({
      status: 409,
      body: { error: 'languages unavailable' },
    });
  });

  it('reports the supported languages once all three workers are ready', async () => {
    const started = await serve(true);

    expect(await send(started.server, '/capabilities', { method: 'GET' })).toEqual({ status: 200, body: { languages: [], models: ROUTING_MODELS } });
    await started.engine.transcriber.warmUp();
    expect(await send(started.server, '/capabilities', { method: 'GET' })).toEqual({ status: 200, body: { languages: [], models: ROUTING_MODELS } });
    await started.engine.warmUpLanguageModels();
    expect(await send(started.server, '/capabilities', { method: 'GET' })).toEqual({ status: 200, body: { languages: [...SUPPORTED_LANGUAGES], models: ROUTING_MODELS } });
    expect((await send(started.server, '/health', { method: 'GET' })).body).toEqual({ status: 'UP', busy: false });
  });

  it('retries a failed language model warm-up until routing becomes available', async () => {
    const started = await serve(true, { initialMs: 10, maxMs: 40 });
    await started.engine.transcriber.warmUp();
    vi.stubEnv('FAKE_WORKER_LOAD', 'fail');
    const retries: number[] = [];

    const warmedUp = started.engine.warmUpLanguageModels((delayMs) => {
      retries.push(delayMs);
      vi.unstubAllEnvs();
    });

    expect(await warmedUp).toBe(true);
    expect(retries).toEqual([10]);
    expect(await send(started.server, '/capabilities', { method: 'GET' })).toEqual({ status: 200, body: { languages: [...SUPPORTED_LANGUAGES], models: ROUTING_MODELS } });
  });

  it('stops retrying the language model warm-up on shutdown', async () => {
    const started = await serve(true, { initialMs: 60_000, maxMs: 60_000 });
    vi.stubEnv('FAKE_WORKER_LOAD', 'fail');
    let firstRetry = (): void => undefined;
    const retrying = new Promise<void>((resolve) => {
      firstRetry = resolve;
    });
    const warmedUp = started.engine.warmUpLanguageModels(() => firstRetry());
    await retrying;

    await started.engine.close();

    expect(await warmedUp).toBe(false);
    expect(await send(started.server, '/capabilities', { method: 'GET' })).toEqual({ status: 200, body: { languages: [], models: ROUTING_MODELS } });
  });

  it('routes a confident final segment to the conditioned model', async () => {
    const ready = await serveReady({ FAKE_WORKER_LID_TOP: 'cs', FAKE_WORKER_LID_P: '0.995' }, { FAKE_WORKER_REPLY_TEXT: CYRILLIC_DRIFT });

    const reply = await send(ready, '/transcribe?language=auto&languages=sk,cs&kind=final', { body: pcm(TWO_SECONDS) });

    expect(reply).toEqual({ status: 200, body: { text: expect.stringMatching(/^\d+:cs:32000$/) as unknown, language: 'cs', route: 'conditioned' } });
  });

  it('defaults to a final segment', async () => {
    const ready = await serveReady({ FAKE_WORKER_LID_TOP: 'cs', FAKE_WORKER_LID_P: '0.995' }, { FAKE_WORKER_REPLY_TEXT: CYRILLIC_DRIFT });

    expect((await send(ready, '/transcribe?language=auto&languages=sk,cs', { body: pcm(TWO_SECONDS) })).body).toMatchObject({ language: 'cs', route: 'conditioned' });
  });

  it('keeps confidently foreign speech verbatim', async () => {
    const ready = await serveReady({ FAKE_WORKER_LID_TOP: 'uk', FAKE_WORKER_LID_P: '0.995' });

    const reply = await send(ready, '/transcribe?language=auto&languages=sk,cs', { body: pcm(TWO_SECONDS) });

    expect(reply).toEqual({ status: 200, body: { text: expect.stringMatching(/^\d+:auto:32000$/) as unknown, language: null, route: 'verbatim-foreign' } });
  });

  it('answers a confident partial segment from the conditioned model alone', async () => {
    const ready = await serveReady({ FAKE_WORKER_LID_TOP: 'sk', FAKE_WORKER_LID_P: '0.995' });

    const reply = await send(ready, '/transcribe?language=auto&languages=sk,cs&kind=partial', { body: pcm(TWO_SECONDS) });

    expect(reply).toEqual({ status: 200, body: { text: expect.stringMatching(/^\d+:sk:32000$/) as unknown, language: 'sk', route: 'conditioned' } });
  });

  it('keeps the plain path when no languages are sent', async () => {
    const ready = await serveReady({ FAKE_WORKER_LID_TOP: 'cs', FAKE_WORKER_LID_P: '0.995' });

    const reply = await send(ready, '/transcribe?language=sk', { body: pcm(TWO_SECONDS) });

    expect(reply).toEqual({ status: 200, body: { text: expect.stringMatching(/^\d+:sk:32000$/) as unknown } });
  });

  it('passes the vocabulary to the plain transcriber', async () => {
    const started = await serve(false);
    await startWith(() => started.engine.transcriber.warmUp(), { FAKE_WORKER_VOCABULARY: '1' });

    expect(await send(started.server, '/transcribe?language=sk&vocabulary=Kumiba&vocabulary=%C5%BDilina', { body: pcm(TWO_SECONDS) })).toEqual({
      status: 200,
      body: { text: '["Kumiba","Žilina"]' },
    });
    expect((await send(started.server, '/transcribe?language=sk', { body: pcm(TWO_SECONDS) })).body).toEqual({ text: '[]' });
  });

  it('passes the vocabulary to the conditioned model of a routed segment', async () => {
    const ready = await serveReady({ FAKE_WORKER_LID_TOP: 'sk', FAKE_WORKER_LID_P: '0.995', FAKE_WORKER_VOCABULARY: '1' });

    const reply = await send(ready, '/transcribe?language=auto&languages=sk,cs&kind=partial&vocabulary=Kumiba&vocabulary=Codevo+Whisper', { body: pcm(TWO_SECONDS) });

    expect(reply).toEqual({ status: 200, body: { text: '["Kumiba","Codevo Whisper"]', language: 'sk', route: 'conditioned' } });
  });

  it('passes the vocabulary to the verbatim model of a routed segment', async () => {
    const ready = await serveReady({ FAKE_WORKER_LID_TOP: 'uk', FAKE_WORKER_LID_P: '0.995' }, { FAKE_WORKER_VOCABULARY: '1' });

    const reply = await send(ready, '/transcribe?language=auto&languages=sk,cs&vocabulary=Kumiba', { body: pcm(TWO_SECONDS) });

    expect(reply).toEqual({ status: 200, body: { text: '["Kumiba"]', language: null, route: 'verbatim-foreign' } });
  });

  it('answers 400 for invalid language lists and kinds', async () => {
    const ready = await serveReady({ FAKE_WORKER_LID_TOP: 'cs', FAKE_WORKER_LID_P: '0.995' });
    const invalid = [
      '/transcribe?language=sk&languages=sk',
      '/transcribe?languages=sk',
      '/transcribe?language=auto&languages=',
      '/transcribe?language=auto&languages=sk,xx',
      '/transcribe?language=auto&languages=sk,sk',
      '/transcribe?language=auto&languages=sk,cs,en,de,pl,hu',
      '/transcribe?language=auto&languages=SK',
      '/transcribe?language=auto&languages=sk&kind=draft',
      '/transcribe?language=sk&kind=draft',
    ];

    for (const path of invalid) {
      expect(await send(ready, path, { body: pcm(TWO_SECONDS) }), path).toEqual({ status: 400, body: { error: 'invalid PCM or language' } });
    }
    expect((await send(ready, '/transcribe?language=auto&languages=sk,cs,en,de,pl', { body: pcm(TWO_SECONDS) })).status).toBe(200);
  });

  it('keeps routing available after a language worker crashed and recovers it on the next segment', async () => {
    const ready = await serveReady({ FAKE_WORKER_LID_TOP: 'cs', FAKE_WORKER_LID_P: '0.995', FAKE_WORKER_CRASH_SAMPLES: '16000' }, { FAKE_WORKER_REPLY_TEXT: CYRILLIC_DRIFT });
    vi.stubEnv('FAKE_WORKER_LID_TOP', 'cs');
    vi.stubEnv('FAKE_WORKER_LID_P', '0.995');

    const crashed = await send(ready, '/transcribe?language=auto&languages=sk,cs', { body: pcm(16_000) });

    expect(crashed).toEqual({ status: 200, body: { text: CYRILLIC_DRIFT, language: null, route: 'verbatim-fallback' } });
    expect((await send(ready, '/capabilities', { method: 'GET' })).body).toMatchObject({ languages: [...SUPPORTED_LANGUAGES] });
    expect((await send(ready, '/transcribe?language=auto&languages=sk,cs', { body: pcm(TWO_SECONDS) })).body).toMatchObject({ language: 'cs', route: 'conditioned' });
  });

  it('stays single-flight for routed segments', async () => {
    const ready = await serveReady({ FAKE_WORKER_LID_TOP: 'sk', FAKE_WORKER_LID_P: '0.995', FAKE_WORKER_DELAY_MS: '300' });
    const first = send(ready, '/transcribe?language=auto&languages=sk&kind=partial', { body: pcm(TWO_SECONDS) });
    await expect.poll(async () => (await send(ready, '/health', { method: 'GET' })).body, { interval: 10 }).toEqual({ status: 'UP', busy: true });

    expect((await send(ready, '/transcribe?language=auto&languages=sk', { body: pcm(TWO_SECONDS) })).status).toBe(503);
    expect((await first).status).toBe(200);
  });
});

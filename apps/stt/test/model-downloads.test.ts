import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogOf, type CatalogModel, type ModelFamily, type PinnedCatalog } from '../src/catalog-models';
import { loadSttConfig } from '../src/config';
import { createEngine } from '../src/create-engine';
import type { DiskSpace } from '../src/disk-space';
import { LocalModelFileStore, type ModelFileStore } from '../src/model-file-store';
import type { Engine } from '../src/engine';
import { DOWNLOAD_SPACE_MARGIN_BYTES, partialPathOf, removePartials } from '../src/model-downloads';
import { startSttServer, type SttServer } from '../src/server';
import { pcm, send, type Reply } from './support/http-client';
import { sha256, startModelHost, type ModelHost } from './support/model-host';

const FAKE_WORKER = fileURLToPath(new URL('../../../packages/stt-runner/test/support/fake-worker.js', import.meta.url));
const TWO_SECONDS = 32_000;
const PARAKEET_Q8 = 'parakeet-ultra-q8';
const WHISPER = 'whisper-large-v3';
const TURBO = 'whisper-large-v3-turbo';
const CONTENT: Readonly<Record<string, Buffer>> = {
  [PARAKEET_Q8]: Buffer.from('parakeet q8 '.repeat(3000)),
  [WHISPER]: Buffer.from('whisper f16 '.repeat(4000)),
  [TURBO]: Buffer.from('whisper turbo '.repeat(2000)),
};
const FAMILIES: Readonly<Record<string, ModelFamily>> = { [PARAKEET_Q8]: 'parakeet', [WHISPER]: 'whisper', [TURBO]: 'whisper' };

type CatalogBody = { downloadsEnabled: boolean; models: Array<{ id: string; state: string; receivedBytes: number | null; removable: boolean; sizeBytes: number }> };

type Setup = {
  installed?: readonly string[];
  env?: NodeJS.ProcessEnv;
  freeBytes?: number;
  space?: DiskSpace;
  files?: ModelFileStore;
  routing?: boolean;
  sha256?: Readonly<Record<string, string>>;
};

class FixedDiskSpace implements DiskSpace {
  readonly asked: string[] = [];

  constructor(private readonly bytes: number) {}

  availableBytes(directory: string): Promise<number> {
    this.asked.push(directory);
    return Promise.resolve(this.bytes);
  }
}

class Gate {
  private opened = false;
  private readonly waiting: Array<() => void> = [];
  entered = 0;

  async pass(): Promise<void> {
    this.entered += 1;
    if (this.opened) {
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    this.opened = true;
    this.waiting.splice(0).forEach((resolve) => resolve());
  }
}

class GatedDiskSpace implements DiskSpace {
  readonly gate = new Gate();

  async availableBytes(): Promise<number> {
    await this.gate.pass();
    return Number.MAX_SAFE_INTEGER;
  }
}

class GatedFileStore implements ModelFileStore {
  readonly gate = new Gate();
  private readonly local = new LocalModelFileStore();

  exists(target: string): Promise<boolean> {
    return this.local.exists(target);
  }

  async remove(target: string): Promise<void> {
    await this.gate.pass();
    await this.local.remove(target);
  }
}

let scratch: string;
let models: string;
let argsFile: string;
let host: ModelHost;
let server: SttServer | undefined;
let engine: Engine | undefined;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-stt-downloads-'));
  models = join(scratch, 'models');
  argsFile = join(scratch, 'args.txt');
  vi.stubEnv('FAKE_WORKER_ARGS_FILE', argsFile);
  host = await startModelHost();
  Object.entries(CONTENT).forEach(([id, content]) => host.host(`${id}.gguf`, content));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await server?.stop();
  await engine?.close();
  await host.close();
  server = undefined;
  engine = undefined;
  await rm(scratch, { recursive: true, force: true });
});

function targetOf(id: string): string {
  return join(models, `${id}.gguf`);
}

function catalogModel(id: string, overrides: Partial<CatalogModel> = {}): CatalogModel {
  const content = CONTENT[id] ?? Buffer.alloc(0);
  return { id, name: id, family: FAMILIES[id] ?? 'whisper', url: host.url(`${id}.gguf`), sha256: sha256(content), size: content.length, target: targetOf(id), ...overrides };
}

function testCatalog(hashes: Readonly<Record<string, string>> = {}): PinnedCatalog {
  const primary: CatalogModel = { ...catalogModel(PARAKEET_Q8), id: 'parakeet-ultra', name: 'Parakeet Ultra (F16)', family: 'parakeet', target: '/models/parakeet-ultra-F16.gguf' };
  return catalogOf(
    primary,
    [PARAKEET_Q8, WHISPER, TURBO].map((id) => catalogModel(id, hashes[id] === undefined ? {} : { sha256: hashes[id] })),
  );
}

async function install(id: string): Promise<void> {
  await mkdir(models, { recursive: true });
  await writeFile(targetOf(id), CONTENT[id] ?? '');
}

async function serve(setup: Setup = {}): Promise<SttServer> {
  for (const id of setup.installed ?? []) {
    await install(id);
  }
  const space = setup.space ?? new FixedDiskSpace(setup.freeBytes ?? Number.MAX_SAFE_INTEGER);
  engine = createEngine(
    { ...loadSttConfig(setup.env ?? {}), workerBinary: FAKE_WORKER, threads: 1 },
    {
      routing: setup.routing ?? false,
      catalog: testCatalog(setup.sha256),
      installed: setup.installed ?? [],
      downloads: { space },
      ...(setup.files === undefined ? {} : { files: setup.files }),
    },
  );
  const { transcriber, router, models: names, catalog, management } = engine;
  server = await startSttServer({ transcriber, router, models: names, catalog, management, port: 0, host: '127.0.0.1' });
  await engine.transcriber.warmUp();
  return server;
}

async function catalog(stt: SttServer): Promise<CatalogBody> {
  return (await send(stt, '/catalog', { method: 'GET' })).body as CatalogBody;
}

async function stateOf(stt: SttServer, id: string): Promise<string> {
  return (await catalog(stt)).models.find((model) => model.id === id)?.state ?? 'absent';
}

function download(stt: SttServer, id: string): Promise<Reply> {
  return send(stt, `/models/${id}/download`);
}

function remove(stt: SttServer, id: string): Promise<Reply> {
  return send(stt, `/models/${id}`, { method: 'DELETE' });
}

function cancel(stt: SttServer, id: string): Promise<Reply> {
  return send(stt, `/models/${id}/cancel`);
}

function prepare(stt: SttServer, id: string): Promise<Reply> {
  return send(stt, `/prepare?model=${id}`);
}

function transcribe(stt: SttServer, query: string): Promise<Reply> {
  return send(stt, `/transcribe?${query}`, { body: pcm(TWO_SECONDS) });
}

function workerOf(reply: Reply): number {
  return Number(((reply.body as { text?: string }).text ?? '').split(':')[0]);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function availableModels(stt: SttServer): Promise<string[]> {
  const { transcriptionModels } = (await send(stt, '/capabilities', { method: 'GET' })).body as { transcriptionModels: Array<{ id: string; available: boolean }> };
  return transcriptionModels.filter((model) => model.available).map((model) => model.id);
}

async function residentWorker(stt: SttServer, id: string): Promise<number> {
  expect(await prepare(stt, id)).toEqual({ status: 200, body: { status: 'ready' } });
  return workerOf(await transcribe(stt, `language=sk&model=${id}`));
}

describe('model catalog', () => {
  it('lists every catalog model with its family, size and state', async () => {
    const stt = await serve({ installed: [WHISPER] });

    expect(await catalog(stt)).toEqual({
      downloadsEnabled: true,
      models: [
        { id: 'parakeet-ultra', name: 'Parakeet Ultra (F16)', family: 'parakeet', sizeBytes: CONTENT[PARAKEET_Q8]?.length, removable: false, state: 'installed', receivedBytes: null },
        { id: PARAKEET_Q8, name: PARAKEET_Q8, family: 'parakeet', sizeBytes: CONTENT[PARAKEET_Q8]?.length, removable: true, state: 'missing', receivedBytes: null },
        { id: WHISPER, name: WHISPER, family: 'whisper', sizeBytes: CONTENT[WHISPER]?.length, removable: true, state: 'installed', receivedBytes: null },
        { id: TURBO, name: TURBO, family: 'whisper', sizeBytes: CONTENT[TURBO]?.length, removable: true, state: 'missing', receivedBytes: null },
      ],
    });
  });

  it('answers 404 for model routes on a server without model management', async () => {
    engine = createEngine({ ...loadSttConfig({}), workerBinary: FAKE_WORKER, threads: 1 }, { routing: false });
    const { transcriber, router, models: names, catalog: offered } = engine;
    server = await startSttServer({ transcriber, router, models: names, catalog: offered, port: 0, host: '127.0.0.1' });

    expect(await send(server, '/catalog', { method: 'GET' })).toEqual({ status: 404, body: { error: 'not found' } });
    expect((await download(server, TURBO)).status).toBe(404);
  });
});

describe('model downloads', () => {
  it('downloads a model, verifies it and serves it without a restart', async () => {
    const stt = await serve();
    expect(await transcribe(stt, `language=sk&model=${TURBO}`)).toEqual({ status: 409, body: { error: 'model unavailable' } });

    expect(await download(stt, TURBO)).toEqual({ status: 202, body: { status: 'started' } });
    await expect.poll(() => stateOf(stt, TURBO), { interval: 10 }).toBe('installed');

    expect(await readFile(targetOf(TURBO))).toEqual(CONTENT[TURBO]);
    expect(existsSync(partialPathOf(targetOf(TURBO)))).toBe(false);
    expect(await availableModels(stt)).toEqual(['parakeet-ultra', TURBO]);
    expect(await residentWorker(stt, TURBO)).toBeGreaterThan(0);
    expect(await download(stt, TURBO)).toEqual({ status: 200, body: { status: 'installed' } });
    expect(host.requests()).toEqual([`${TURBO}.gguf`]);
  });

  it('marks a download whose hash does not match as failed and keeps no file', async () => {
    const stt = await serve({ sha256: { [TURBO]: '0'.repeat(64) } });

    expect((await download(stt, TURBO)).status).toBe(202);
    await expect.poll(() => stateOf(stt, TURBO), { interval: 10 }).toBe('failed');

    expect(existsSync(targetOf(TURBO))).toBe(false);
    expect(existsSync(partialPathOf(targetOf(TURBO)))).toBe(false);
    expect(await availableModels(stt)).toEqual(['parakeet-ultra']);
    expect(await download(stt, TURBO)).toEqual({ status: 202, body: { status: 'started' } });
    expect(await stateOf(stt, TURBO)).toBe('downloading');
  });

  it('marks a download that is larger than the pinned size as failed', async () => {
    host.host(`${TURBO}.gguf`, Buffer.concat([CONTENT[TURBO] ?? Buffer.alloc(0), Buffer.from('extra')]));
    const stt = await serve();

    expect((await download(stt, TURBO)).status).toBe(202);
    await expect.poll(() => stateOf(stt, TURBO), { interval: 10 }).toBe('failed');
    expect(existsSync(targetOf(TURBO))).toBe(false);
  });

  it('reports the progress of a running download and cancels it', async () => {
    host.hold(`${TURBO}.gguf`);
    const stt = await serve();
    const half = Math.floor((CONTENT[TURBO]?.length ?? 0) / 2);

    expect((await download(stt, TURBO)).status).toBe(202);
    await expect.poll(async () => (await catalog(stt)).models.find((model) => model.id === TURBO)?.receivedBytes, { interval: 10 }).toBe(half);
    expect(await stateOf(stt, TURBO)).toBe('downloading');
    expect(existsSync(partialPathOf(targetOf(TURBO)))).toBe(true);

    expect(await cancel(stt, TURBO)).toEqual({ status: 200, body: { status: 'cancelled' } });

    expect(await stateOf(stt, TURBO)).toBe('missing');
    expect(existsSync(partialPathOf(targetOf(TURBO)))).toBe(false);
    expect(existsSync(targetOf(TURBO))).toBe(false);
    expect(await cancel(stt, TURBO)).toEqual({ status: 200, body: { status: 'idle' } });
    expect(await cancel(stt, 'parakeet-ultra')).toEqual({ status: 200, body: { status: 'idle' } });
    expect(await cancel(stt, 'canary-1b-v2')).toEqual({ status: 400, body: { error: 'unknown model' } });
  });

  it('runs one download at a time', async () => {
    host.hold(`${TURBO}.gguf`);
    const stt = await serve();

    expect((await download(stt, TURBO)).status).toBe(202);
    expect(await download(stt, WHISPER)).toEqual({ status: 409, body: { error: 'download busy' } });
    expect(await download(stt, TURBO)).toEqual({ status: 202, body: { status: 'started' } });
    expect(await remove(stt, TURBO)).toEqual({ status: 409, body: { error: 'download busy' } });

    host.release(`${TURBO}.gguf`);
    await expect.poll(() => stateOf(stt, TURBO), { interval: 10 }).toBe('installed');
    expect((await download(stt, WHISPER)).status).toBe(202);
    await expect.poll(() => host.requests(), { interval: 10 }).toEqual([`${TURBO}.gguf`, `${WHISPER}.gguf`]);
  });

  it('refuses a download when the models volume lacks the model size plus the safety margin', async () => {
    const size = CONTENT[TURBO]?.length ?? 0;
    const stt = await serve({ freeBytes: size + DOWNLOAD_SPACE_MARGIN_BYTES - 1 });

    expect(await download(stt, TURBO)).toEqual({ status: 507, body: { error: 'insufficient space' } });
    expect(await stateOf(stt, TURBO)).toBe('missing');
    expect(host.requests()).toEqual([]);
    expect(await download(stt, WHISPER)).toEqual({ status: 507, body: { error: 'insufficient space' } });
  });

  it('refuses downloads and removals when the kill switch is off', async () => {
    const stt = await serve({ installed: [WHISPER], env: { STT_MODEL_DOWNLOADS: 'disabled' } });

    expect((await catalog(stt)).downloadsEnabled).toBe(false);
    expect(await download(stt, TURBO)).toEqual({ status: 403, body: { error: 'downloads disabled' } });
    expect(await remove(stt, WHISPER)).toEqual({ status: 403, body: { error: 'downloads disabled' } });
    expect(await cancel(stt, TURBO)).toEqual({ status: 200, body: { status: 'idle' } });
    expect(existsSync(targetOf(WHISPER))).toBe(true);
    expect(host.requests()).toEqual([]);
  });

  it('removes partial downloads left over from an earlier run', async () => {
    await install(WHISPER);
    await writeFile(partialPathOf(targetOf(TURBO)), 'partial');
    await writeFile(partialPathOf(targetOf(WHISPER)), 'partial');

    await removePartials(testCatalog().alternatives);

    expect(existsSync(partialPathOf(targetOf(TURBO)))).toBe(false);
    expect(existsSync(partialPathOf(targetOf(WHISPER)))).toBe(false);
    expect(existsSync(targetOf(WHISPER))).toBe(true);
  });
});

describe('model removal', () => {
  it('refuses to remove the default model and unknown models', async () => {
    const stt = await serve();

    expect(await remove(stt, 'parakeet-ultra')).toEqual({ status: 409, body: { error: 'model not removable' } });
    expect(await download(stt, 'parakeet-ultra')).toEqual({ status: 200, body: { status: 'installed' } });
    expect(await remove(stt, 'canary-1b-v2')).toEqual({ status: 400, body: { error: 'unknown model' } });
    expect(await download(stt, 'canary-1b-v2')).toEqual({ status: 400, body: { error: 'unknown model' } });
    expect(await send(stt, '/models/Whisper/download')).toEqual({ status: 404, body: { error: 'not found' } });
    expect(await send(stt, `/models/${TURBO}/download`, { method: 'GET' })).toEqual({ status: 404, body: { error: 'not found' } });
  });

  it('unloads the resident worker of a model before it deletes the file', async () => {
    const stt = await serve({ installed: [WHISPER] });
    const worker = await residentWorker(stt, WHISPER);

    expect(await remove(stt, WHISPER)).toEqual({ status: 200, body: { status: 'removed' } });

    expect(isAlive(worker)).toBe(false);
    expect(existsSync(targetOf(WHISPER))).toBe(false);
    expect(await stateOf(stt, WHISPER)).toBe('missing');
    expect(await transcribe(stt, `language=sk&model=${WHISPER}`)).toEqual({ status: 409, body: { error: 'model unavailable' } });
    expect(await remove(stt, WHISPER)).toEqual({ status: 200, body: { status: 'missing' } });
    expect((await transcribe(stt, 'language=sk')).status).toBe(200);
  });

  it('refuses to remove a model while it transcribes', async () => {
    vi.stubEnv('FAKE_WORKER_DELAY_MS', '400');
    const slow = await serve({ installed: [WHISPER] });
    await residentWorker(slow, WHISPER);

    const running = transcribe(slow, `language=sk&model=${WHISPER}`);
    await expect.poll(async () => ((await send(slow, '/health', { method: 'GET' })).body as { busy: boolean }).busy, { interval: 10 }).toBe(true);

    expect(await remove(slow, WHISPER)).toEqual({ status: 409, body: { error: 'model in use' } });
    expect((await running).status).toBe(200);
    expect(await remove(slow, WHISPER)).toEqual({ status: 200, body: { status: 'removed' } });
  });
});

describe('model residency', () => {
  it('keeps at most the configured alternatives resident and unloads the least recently used idle one', async () => {
    const stt = await serve({ installed: [PARAKEET_Q8, WHISPER, TURBO] });
    const parakeet = workerOf(await transcribe(stt, 'language=sk'));
    const q8 = await residentWorker(stt, PARAKEET_Q8);
    const whisper = await residentWorker(stt, WHISPER);
    expect(workerOf(await transcribe(stt, `language=sk&model=${PARAKEET_Q8}`))).toBe(q8);

    const turbo = await residentWorker(stt, TURBO);

    await expect.poll(() => isAlive(whisper), { interval: 10 }).toBe(false);
    expect([isAlive(parakeet), isAlive(q8), isAlive(turbo)]).toEqual([true, true, true]);
    expect(workerOf(await transcribe(stt, `language=sk&model=${PARAKEET_Q8}`))).toBe(q8);
    expect(await transcribe(stt, `language=sk&model=${WHISPER}`)).toEqual({ status: 503, body: { error: 'model loading' } });
  });

  it('keeps one alternative resident when the limit is one', async () => {
    const stt = await serve({ installed: [WHISPER, TURBO], env: { STT_MAX_RESIDENT_MODELS: '1' } });
    const whisper = await residentWorker(stt, WHISPER);

    const turbo = await residentWorker(stt, TURBO);

    expect(isAlive(whisper)).toBe(false);
    expect(isAlive(turbo)).toBe(true);
    expect(await residentWorker(stt, WHISPER)).not.toBe(whisper);
    await expect.poll(() => isAlive(turbo), { interval: 10 }).toBe(false);
  });
});

function residentModels(ids: readonly string[]): string[] {
  return ids.filter((id) => engine?.catalog.managed(id)?.ready() === true);
}

describe('model lifecycle races', () => {
  it('keeps the residency limit when two models are prepared at the same time', async () => {
    vi.stubEnv('FAKE_WORKER_LOAD_DELAY_MS', '200');
    const stt = await serve({ installed: [WHISPER, TURBO], env: { STT_MAX_RESIDENT_MODELS: '1' } });

    const replies = await Promise.all([prepare(stt, WHISPER), prepare(stt, TURBO)]);

    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(residentModels([WHISPER, TURBO])).toHaveLength(1);
  });

  it('refuses a download of a model while its removal is still deleting the file', async () => {
    const files = new GatedFileStore();
    const stt = await serve({ installed: [WHISPER], files });
    const removal = remove(stt, WHISPER);
    await expect.poll(() => files.gate.entered, { interval: 10 }).toBe(1);

    expect(await download(stt, WHISPER)).toEqual({ status: 409, body: { error: 'model in use' } });
    expect(await stateOf(stt, WHISPER)).toBe('missing');

    files.gate.open();
    expect(await removal).toEqual({ status: 200, body: { status: 'removed' } });
    expect(existsSync(targetOf(WHISPER))).toBe(false);
    expect(await download(stt, WHISPER)).toEqual({ status: 202, body: { status: 'started' } });
    await expect.poll(() => stateOf(stt, WHISPER), { interval: 10 }).toBe('installed');
    expect(await readFile(targetOf(WHISPER))).toEqual(CONTENT[WHISPER]);
  });

  it('treats a model that is still being prepared as in use and refuses to remove it', async () => {
    vi.stubEnv('FAKE_WORKER_LOAD_DELAY_MS', '300');
    const stt = await serve({ installed: [WHISPER, TURBO], env: { STT_MAX_RESIDENT_MODELS: '1' } });
    expect(await prepare(stt, WHISPER)).toEqual({ status: 200, body: { status: 'ready' } });

    const preparation = prepare(stt, TURBO);
    await expect.poll(() => residentModels([WHISPER]), { interval: 5 }).toEqual([]);

    expect(await remove(stt, TURBO)).toEqual({ status: 409, body: { error: 'model in use' } });
    expect(await preparation).toEqual({ status: 200, body: { status: 'ready' } });
    expect(existsSync(targetOf(TURBO))).toBe(true);
    expect(await remove(stt, TURBO)).toEqual({ status: 200, body: { status: 'removed' } });
    expect(residentModels([TURBO])).toEqual([]);
  });

  it('answers a cancel during the free space check only after the reservation is released', async () => {
    const space = new GatedDiskSpace();
    const stt = await serve({ space });
    const first = download(stt, TURBO);
    await expect.poll(() => space.gate.entered, { interval: 10 }).toBe(1);

    const opening = setTimeout(() => space.gate.open(), 200);

    expect(await cancel(stt, TURBO)).toEqual({ status: 200, body: { status: 'cancelled' } });
    clearTimeout(opening);
    expect(space.gate.isOpen()).toBe(true);
    expect((await first).status).toBe(202);
    expect(await stateOf(stt, TURBO)).toBe('missing');
    expect(await download(stt, TURBO)).toEqual({ status: 202, body: { status: 'started' } });
    await expect.poll(() => stateOf(stt, TURBO), { interval: 10 }).toBe('installed');
    expect(host.requests()).toEqual([`${TURBO}.gguf`]);
  });
});

describe('model families', () => {
  it('routes a Parakeet alternative through the language models on its own worker and serves Whisper directly', async () => {
    vi.stubEnv('FAKE_WORKER_LID_TOP', 'uk');
    vi.stubEnv('FAKE_WORKER_LID_P', '0.995');
    const stt = await serve({ installed: [PARAKEET_Q8, WHISPER], routing: true });
    expect(await engine?.warmUpLanguageModels()).toBe(true);
    const parakeet = workerOf(await transcribe(stt, 'language=sk'));
    const q8 = await residentWorker(stt, PARAKEET_Q8);
    await residentWorker(stt, WHISPER);

    const routed = await transcribe(stt, `language=auto&languages=sk,cs&model=${PARAKEET_Q8}`);
    const direct = await transcribe(stt, `language=auto&languages=sk,cs&model=${WHISPER}`);

    expect(routed).toEqual({ status: 200, body: { text: `${q8}:auto:32000`, language: null, route: 'verbatim-foreign' } });
    expect(q8).not.toBe(parakeet);
    expect(direct.body).toMatchObject({ language: null, route: 'direct' });
  });
});

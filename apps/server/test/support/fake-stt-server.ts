import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DICTATION_LANGUAGES, MAX_DICTATION_LANGUAGES, type CatalogEntry } from '@codevo-whisper/protocol';
import { FakeModelCatalog, type FakeCatalog } from './fake-model-catalog';

export type FakeSttResponse = { status: number; body: unknown };

export type FakeSttRequest = { language: string; bytes: number; languages?: string[]; kind?: string; vocabulary?: string[]; model?: string };

export type FakeSttBehaviour = {
  respond?: (pcm: Uint8Array, language: string, request: FakeSttRequest) => FakeSttResponse;
  capabilities?: FakeSttResponse;
  delayMs?: number;
  delayFor?: (pcm: Uint8Array) => number;
  loadDelayMs?: Readonly<Record<string, number>>;
  failingLoads?: readonly string[];
  catalog?: FakeCatalog;
};

export type FakeSttServer = {
  url: string;
  requests: FakeSttRequest[];
  capabilityRequests(): number;
  setCapabilities(response: FakeSttResponse): void;
  aborted(): number;
  maxActive(): number;
  preparations(): string[];
  loadingModels(): string[];
  loadedModels(): string[];
  catalogRequests(): number;
  modelOperations(): string[];
  completeDownload(id: string): void;
  failDownload(id: string): void;
  setModelInUse(id: string, inUse: boolean): void;
  catalogEntries(): CatalogEntry[];
  close(): Promise<void>;
};

const MIN_BYTES = 640;
const MAX_BYTES = 960_000;
const LANGUAGES = ['sk', 'en', 'cs', 'auto'];
const KINDS = ['final', 'partial'];
const OLD_STT: FakeSttResponse = { status: 404, body: { error: 'not found' } };

export const ROUTING_MODELS = { transcription: 'Parakeet Ultra (F16)', conditioned: 'Canary 1B v2 (Q8)', languageId: 'VoxLingua107 (rozpoznanie jazyka)' };

export const ROUTING_STT = { status: 200, body: { languages: [...DICTATION_LANGUAGES], models: ROUTING_MODELS } } satisfies FakeSttResponse;

export const PARAKEET_OPTION = { id: 'parakeet-ultra', name: 'Parakeet Ultra (F16)', available: true, default: true };

export const WHISPER_OPTION = { id: 'whisper-large-v3', name: 'Whisper Large v3 (F16)', available: true, default: false };

export const MODEL_SELECTION_STT = { status: 200, body: { ...ROUTING_STT.body, transcriptionModels: [PARAKEET_OPTION, WHISPER_OPTION] } } satisfies FakeSttResponse;

type OfferedModel = { id: string; available: boolean; default: boolean };

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed) {
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function requestOf(url: URL, bytes: number): FakeSttRequest {
  const language = url.searchParams.get('language') ?? '';
  const languages = url.searchParams.get('languages');
  const terms = url.searchParams.getAll('vocabulary');
  const vocabulary = terms.length === 0 ? {} : { vocabulary: terms };
  const id = url.searchParams.get('model');
  const model = id === null ? {} : { model: id };
  if (languages === null) {
    return { language, ...vocabulary, ...model, bytes };
  }
  return { language, languages: languages.split(','), kind: url.searchParams.get('kind') ?? 'final', ...vocabulary, ...model, bytes };
}

function isValidSelection(request: FakeSttRequest): boolean {
  const { languages } = request;
  if (languages === undefined) {
    return true;
  }
  const known = languages.every((code) => (DICTATION_LANGUAGES as readonly string[]).includes(code));
  const sized = languages.length >= 1 && languages.length <= MAX_DICTATION_LANGUAGES && new Set(languages).size === languages.length;
  return known && sized && request.language === 'auto' && KINDS.includes(request.kind ?? '');
}

function routes(capabilities: FakeSttResponse): boolean {
  const languages = (capabilities.body as { languages?: unknown } | null)?.languages;
  return capabilities.status === 200 && Array.isArray(languages) && languages.length > 0;
}

function skipsRouting(model: string | undefined, capabilities: FakeSttResponse): boolean {
  return model !== undefined && offeredModels(capabilities).some((offered) => offered.id === model && !offered.default);
}

function offeredModels(capabilities: FakeSttResponse): readonly OfferedModel[] {
  const models = (capabilities.body as { transcriptionModels?: unknown } | null)?.transcriptionModels;
  return Array.isArray(models) ? (models as OfferedModel[]) : [];
}

function modelRefusal(id: string | undefined, capabilities: FakeSttResponse): FakeSttResponse | null {
  if (id === undefined) {
    return null;
  }
  const offered = offeredModels(capabilities).find((model) => model.id === id);
  if (offered === undefined) {
    return { status: 400, body: { error: 'unknown model' } };
  }
  if (!offered.available) {
    return { status: 409, body: { error: 'model unavailable' } };
  }
  return null;
}

function validationStatus(request: IncomingMessage, pcm: Uint8Array, query: FakeSttRequest, capabilities: FakeSttResponse): number | null {
  if (request.headers['content-type'] !== 'application/octet-stream') {
    return 415;
  }
  if (!LANGUAGES.includes(query.language) || !isValidSelection(query) || pcm.length < MIN_BYTES || pcm.length % 2 !== 0) {
    return 400;
  }
  if (pcm.length > MAX_BYTES) {
    return 413;
  }
  if (query.languages !== undefined && !skipsRouting(query.model, capabilities) && !routes(capabilities)) {
    return 409;
  }
  return null;
}

function withAvailability(capabilities: FakeSttResponse, id: string, available: boolean): FakeSttResponse {
  const body = capabilities.body as { transcriptionModels?: unknown } | null;
  if (!Array.isArray(body?.transcriptionModels)) {
    return capabilities;
  }
  const transcriptionModels = (body.transcriptionModels as OfferedModel[]).map((model) => (model.id === id ? { ...model, available } : model));
  return { ...capabilities, body: { ...body, transcriptionModels } };
}

function defaultResponse(_pcm: Uint8Array, _language: string, request: FakeSttRequest): FakeSttResponse {
  if (request.languages === undefined) {
    return { status: 200, body: { text: 'ahoj svet' } };
  }
  return { status: 200, body: { text: 'ahoj svet', language: request.languages[0] ?? null, route: 'conditioned' } };
}

function wait(ms: number, response: ServerResponse): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), ms);
    response.once('close', () => {
      clearTimeout(timer);
      resolve(response.writableFinished);
    });
  });
}

export async function startFakeSttServer(behaviour: FakeSttBehaviour = {}): Promise<FakeSttServer> {
  const requests: FakeSttRequest[] = [];
  let active = 0;
  let maxActive = 0;
  let aborted = 0;
  let capabilityRequests = 0;
  let capabilities = behaviour.capabilities ?? OLD_STT;
  const respond = behaviour.respond ?? defaultResponse;
  const loads = new Map<string, Promise<void>>();
  const loaded = new Set<string>();
  const preparations: string[] = [];
  const catalog = behaviour.catalog === undefined ? null : new FakeModelCatalog(behaviour.catalog, (id, available) => {
    capabilities = withAvailability(capabilities, id, available);
  });

  const isLoading = (model: string): boolean => behaviour.loadDelayMs?.[model] !== undefined && !loaded.has(model);

  const load = (model: string): Promise<void> => {
    const delayMs = behaviour.loadDelayMs?.[model];
    if (delayMs === undefined || loaded.has(model)) {
      return Promise.resolve();
    }
    const pending =
      loads.get(model) ??
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)).then(() => {
        loaded.add(model);
        loads.delete(model);
      });
    loads.set(model, pending);
    return pending;
  };

  const handleTranscribe = async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {
    let pcm: Uint8Array;
    try {
      pcm = await readBody(request);
    } catch (error) {
      if (request.destroyed && !request.complete && error instanceof Error && 'code' in error && error.code === 'ECONNRESET') {
        aborted += 1;
        return;
      }
      throw error;
    }
    const query = requestOf(url, pcm.length);
    const refused = modelRefusal(query.model, capabilities);
    if (refused !== null) {
      send(response, refused.status, refused.body);
      return;
    }
    if (query.model !== undefined && isLoading(query.model)) {
      void load(query.model);
      send(response, 503, { error: 'model loading' });
      return;
    }
    const invalid = validationStatus(request, pcm, query, capabilities);
    if (invalid !== null) {
      send(response, invalid, { error: 'invalid request' });
      return;
    }
    requests.push(query);
    active += 1;
    maxActive = Math.max(maxActive, active);
    const completed = await wait(behaviour.delayFor?.(pcm) ?? behaviour.delayMs ?? 0, response);
    active -= 1;
    if (!completed) {
      aborted += 1;
      return;
    }
    const result = respond(pcm, query.language, query);
    send(response, result.status, result.body);
  };

  const handlePrepare = async (response: ServerResponse, model: string): Promise<void> => {
    preparations.push(model);
    const refused = modelRefusal(model, capabilities);
    if (refused !== null) {
      send(response, refused.status, refused.body);
      return;
    }
    if (behaviour.failingLoads?.includes(model) === true) {
      send(response, 502, { error: 'model failed to load' });
      return;
    }
    await load(model);
    send(response, 200, { status: 'ready' });
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fake-stt');
    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, { status: 'UP', busy: active > 0 });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/capabilities') {
      capabilityRequests += 1;
      send(response, capabilities.status, capabilities.body);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/prepare') {
      request.resume();
      void handlePrepare(response, url.searchParams.get('model') ?? '');
      return;
    }
    if (request.method === 'POST' && url.pathname === '/transcribe') {
      void handleTranscribe(request, response, url);
      return;
    }
    const answer = catalog?.handle(request.method ?? '', url.pathname) ?? null;
    if (answer !== null) {
      request.resume();
      send(response, answer.status, answer.body);
      return;
    }
    send(response, 404, { error: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    capabilityRequests: () => capabilityRequests,
    setCapabilities: (response) => {
      capabilities = response;
    },
    aborted: () => aborted,
    maxActive: () => maxActive,
    preparations: () => [...preparations],
    loadingModels: () => [...loads.keys()],
    loadedModels: () => [...loaded],
    catalogRequests: () => catalog?.catalogRequests ?? 0,
    modelOperations: () => [...(catalog?.operations ?? [])],
    completeDownload: (id) => catalog?.complete(id),
    failDownload: (id) => catalog?.fail(id),
    setModelInUse: (id, inUse) => catalog?.setInUse(id, inUse),
    catalogEntries: () => catalog?.entries() ?? [],
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

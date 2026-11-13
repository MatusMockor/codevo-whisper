import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DICTATION_LANGUAGES, MAX_DICTATION_LANGUAGES } from '@codevo-whisper/protocol';

export type FakeSttResponse = { status: number; body: unknown };

export type FakeSttRequest = { language: string; bytes: number; languages?: string[]; kind?: string; vocabulary?: string[] };

export type FakeSttBehaviour = {
  respond?: (pcm: Uint8Array, language: string, request: FakeSttRequest) => FakeSttResponse;
  capabilities?: FakeSttResponse;
  delayMs?: number;
  delayFor?: (pcm: Uint8Array) => number;
};

export type FakeSttServer = {
  url: string;
  requests: FakeSttRequest[];
  capabilityRequests(): number;
  setCapabilities(response: FakeSttResponse): void;
  aborted(): number;
  maxActive(): number;
  close(): Promise<void>;
};

const MIN_BYTES = 640;
const MAX_BYTES = 960_000;
const LANGUAGES = ['sk', 'en', 'cs', 'auto'];
const KINDS = ['final', 'partial'];
const OLD_STT: FakeSttResponse = { status: 404, body: { error: 'not found' } };

export const ROUTING_MODELS = { transcription: 'Parakeet Ultra (F16)', conditioned: 'Canary 1B v2 (Q8)', languageId: 'VoxLingua107 (rozpoznanie jazyka)' };

export const ROUTING_STT = { status: 200, body: { languages: [...DICTATION_LANGUAGES], models: ROUTING_MODELS } } satisfies FakeSttResponse;

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
  if (languages === null) {
    return { language, ...vocabulary, bytes };
  }
  return { language, languages: languages.split(','), kind: url.searchParams.get('kind') ?? 'final', ...vocabulary, bytes };
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
  if (query.languages !== undefined && !routes(capabilities)) {
    return 409;
  }
  return null;
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
    if (request.method === 'POST' && url.pathname === '/transcribe') {
      void handleTranscribe(request, response, url);
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
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

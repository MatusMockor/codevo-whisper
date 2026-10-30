import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeSttResponse = { status: number; body: unknown };

export type FakeSttBehaviour = {
  respond?: (pcm: Uint8Array, language: string) => FakeSttResponse;
  delayMs?: number;
  delayFor?: (pcm: Uint8Array) => number;
};

export type FakeSttServer = {
  url: string;
  requests: Array<{ language: string; bytes: number }>;
  aborted(): number;
  maxActive(): number;
  close(): Promise<void>;
};

const MIN_BYTES = 640;
const MAX_BYTES = 960_000;
const LANGUAGES = ['sk', 'en', 'cs', 'auto'];

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

function validationStatus(request: IncomingMessage, pcm: Uint8Array, language: string): number | null {
  if (request.headers['content-type'] !== 'application/octet-stream') {
    return 415;
  }
  if (!LANGUAGES.includes(language) || pcm.length < MIN_BYTES || pcm.length % 2 !== 0) {
    return 400;
  }
  if (pcm.length > MAX_BYTES) {
    return 413;
  }
  return null;
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
  const requests: Array<{ language: string; bytes: number }> = [];
  let active = 0;
  let maxActive = 0;
  let aborted = 0;
  const respond = behaviour.respond ?? (() => ({ status: 200, body: { text: 'ahoj svet' } }));

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
    const language = url.searchParams.get('language') ?? '';
    const invalid = validationStatus(request, pcm, language);
    if (invalid !== null) {
      send(response, invalid, { error: 'invalid request' });
      return;
    }
    requests.push({ language, bytes: pcm.length });
    active += 1;
    maxActive = Math.max(maxActive, active);
    const completed = await wait(behaviour.delayFor?.(pcm) ?? behaviour.delayMs ?? 0, response);
    active -= 1;
    if (!completed) {
      aborted += 1;
      return;
    }
    const result = respond(pcm, language);
    send(response, result.status, result.body);
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fake-stt');
    if (request.method === 'GET' && url.pathname === '/health') {
      send(response, 200, { status: 'UP', busy: active > 0 });
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
    aborted: () => aborted,
    maxActive: () => maxActive,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

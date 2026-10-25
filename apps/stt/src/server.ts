import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { TranscribeCliError, type TranscribeLanguage } from '@codevo-whisper/stt-runner';
import { readPcm } from './read-pcm';
import type { Transcriber } from './transcriber';

export type SttServer = Server & { stop(): Promise<void> };

export type SttServerOptions = { transcriber: Transcriber; port: number; host: string; onError?: (code: string) => void };

const LANGUAGES: readonly string[] = ['sk', 'en', 'cs', 'auto'];

function reply(response: ServerResponse, status: number, body: object): void {
  if (response.headersSent || response.destroyed) {
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
  response.end(JSON.stringify(body));
}

function isOctetStream(request: IncomingMessage): boolean {
  const [mediaType] = (request.headers['content-type'] ?? '').split(';');
  return mediaType?.trim().toLowerCase() === 'application/octet-stream';
}

function failureStatus(error: unknown): number {
  if (error instanceof TranscribeCliError && error.reason === 'timeout') {
    return 504;
  }
  return 502;
}

class SingleFlightHandler {
  private busy = false;

  constructor(private readonly options: SttServerOptions) {}

  isBusy(): boolean {
    return this.busy;
  }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (!isOctetStream(request)) {
      reply(response, 415, { error: 'expected application/octet-stream' });
      return;
    }
    if (this.busy) {
      reply(response, 503, { error: 'busy' });
      return;
    }
    this.busy = true;
    try {
      await this.transcribe(request, response, url.searchParams.get('language') ?? '');
    } finally {
      this.busy = false;
    }
  }

  private async transcribe(request: IncomingMessage, response: ServerResponse, language: string): Promise<void> {
    const body = await readPcm(request);
    if (body.kind === 'aborted') {
      request.destroy();
      return;
    }
    if (body.kind === 'too-long') {
      reply(response, 413, { error: 'audio is too long' });
      return;
    }
    if (body.kind === 'invalid' || !LANGUAGES.includes(language)) {
      reply(response, 400, { error: 'invalid PCM or language' });
      return;
    }
    const controller = new AbortController();
    response.once('close', () => controller.abort());
    try {
      const text = await this.options.transcriber.transcribe(body.pcm, language as TranscribeLanguage, controller.signal);
      reply(response, 200, { text });
    } catch (error) {
      const status = failureStatus(error);
      this.options.onError?.(String(status));
      reply(response, status, { error: 'transcription failed' });
    }
  }
}

export async function startSttServer(options: SttServerOptions): Promise<SttServer> {
  const handler = new SingleFlightHandler(options);
  const server = createServer((request, response) => {
    request.on('error', () => request.destroy());
    response.on('error', () => response.destroy());
    const url = new URL(request.url ?? '/', 'http://stt');
    if (request.method === 'GET' && url.pathname === '/health') {
      reply(response, 200, { status: 'UP', busy: handler.isBusy() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/transcribe') {
      handler.handle(request, response, url).catch(() => {
        reply(response, 500, { error: 'internal error' });
        request.destroy();
      });
      return;
    }
    reply(response, 404, { error: 'not found' });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });
  return Object.assign(server, {
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
}

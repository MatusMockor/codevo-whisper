import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { TranscribeCliError } from '@codevo-whisper/stt-runner';
import type { LanguageRouter } from './language-router';
import type { ServerModels } from './model-names';
import { readPcm } from './read-pcm';
import { parseTranscribeQuery, type TranscribeQuery } from './transcribe-query';
import type { Transcriber } from './transcriber';
import { TranscriptionJobs } from './transcription-job';

export type SttServer = Server & { stop(): Promise<void> };

export type SttServerOptions = {
  transcriber: Transcriber;
  router: LanguageRouter;
  models: ServerModels;
  port: number;
  host: string;
  onError?: (code: string) => void;
};

const REQUEST_TIMEOUT_MS = 60_000;

function parseUrl(raw: string | undefined): URL | null {
  return URL.parse(raw ?? '/', 'http://stt');
}

function reply(response: ServerResponse, status: number, body: object): void {
  if (response.headersSent || response.destroyed) {
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json' });
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

  constructor(
    private readonly jobs: TranscriptionJobs,
    private readonly onError: ((code: string) => void) | undefined,
  ) {}

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
      await this.transcribe(request, response, parseTranscribeQuery(url.searchParams));
    } finally {
      this.busy = false;
    }
  }

  private async transcribe(request: IncomingMessage, response: ServerResponse, query: TranscribeQuery): Promise<void> {
    const body = await readPcm(request);
    if (body.kind === 'aborted') {
      request.destroy();
      return;
    }
    if (body.kind === 'too-long') {
      reply(response, 413, { error: 'audio is too long' });
      return;
    }
    if (body.kind === 'invalid' || query.kind === 'invalid') {
      reply(response, 400, { error: 'invalid PCM or language' });
      return;
    }
    const job = this.jobs.for(query);
    if (job === null) {
      reply(response, 409, { error: 'languages unavailable' });
      return;
    }
    const controller = new AbortController();
    response.once('close', () => controller.abort());
    try {
      reply(response, 200, await job.run(body.pcm, controller.signal));
    } catch (error) {
      const status = failureStatus(error);
      this.onError?.(String(status));
      reply(response, status, { error: 'transcription failed' });
    }
  }
}

export async function startSttServer(options: SttServerOptions): Promise<SttServer> {
  const { router, models } = options;
  const handler = new SingleFlightHandler(new TranscriptionJobs(options.transcriber, router), options.onError);
  const server = createServer((request, response) => {
    request.on('error', () => request.destroy());
    response.once('finish', () => request.resume());
    response.on('error', () => response.destroy());
    const url = parseUrl(request.url);
    if (url === null) {
      reply(response, 400, { error: 'invalid request URL' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      const ready = options.transcriber.ready();
      reply(response, ready ? 200 : 503, { status: ready ? 'UP' : 'DOWN', busy: handler.isBusy() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/capabilities') {
      reply(response, 200, { languages: router.languages(), models });
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
  server.requestTimeout = REQUEST_TIMEOUT_MS;
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

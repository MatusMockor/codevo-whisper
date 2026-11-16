import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { MAX_VOCABULARY_TERMS, TranscribeCliError } from '@codevo-whisper/stt-runner';
import type { LanguageRouter } from './language-router';
import type { ServerModels } from './model-names';
import { readPcm } from './read-pcm';
import { parseTranscribeQuery, type TranscribeQuery } from './transcribe-query';
import type { Transcriber } from './transcriber';
import type { TranscriptionModel } from './transcription-model';
import type { ModelLookup, TranscriptionModelCatalog } from './transcription-model-catalog';

export type SttServer = Server & { stop(): Promise<void> };

export type SttServerOptions = {
  transcriber: Transcriber;
  router: LanguageRouter;
  models: ServerModels;
  catalog: TranscriptionModelCatalog;
  port: number;
  host: string;
  onError?: (code: string) => void;
};

const REQUEST_TIMEOUT_MS = 60_000;
const PERCENT_ENCODED_TERM_BYTES = 3 * 256;
const MAX_HEADER_BYTES = 16 * 1024 + MAX_VOCABULARY_TERMS * ('&vocabulary='.length + PERCENT_ENCODED_TERM_BYTES);

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

type Refusal = { status: number; body: { error: string } };

const LOOKUP_REFUSALS: Readonly<Record<Exclude<ModelLookup['kind'], 'found'>, Refusal>> = {
  unknown: { status: 400, body: { error: 'unknown model' } },
  unavailable: { status: 409, body: { error: 'model unavailable' } },
};

const LOADING: Refusal = { status: 503, body: { error: 'model loading' } };

function prepared(model: TranscriptionModel): Promise<boolean> {
  return model.prepare().then(
    () => true,
    () => false,
  );
}

function foundModel(catalog: TranscriptionModelCatalog, url: URL, response: ServerResponse): TranscriptionModel | null {
  const lookup = catalog.lookup(url.searchParams.get('model'));
  if (lookup.kind !== 'found') {
    const refusal = LOOKUP_REFUSALS[lookup.kind];
    reply(response, refusal.status, refusal.body);
    return null;
  }
  return lookup.model;
}

async function prepareModel(catalog: TranscriptionModelCatalog, url: URL, response: ServerResponse, onError: ((code: string) => void) | undefined): Promise<void> {
  const model = foundModel(catalog, url, response);
  if (model === null) {
    return;
  }
  if (!(await prepared(model))) {
    onError?.('502');
    reply(response, 502, { error: 'model failed to load' });
    return;
  }
  reply(response, 200, { status: 'ready' });
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
    private readonly catalog: TranscriptionModelCatalog,
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
    const model = foundModel(this.catalog, url, response);
    if (model === null) {
      return;
    }
    if (!model.ready()) {
      model.prepare().catch(() => undefined);
      reply(response, LOADING.status, LOADING.body);
      return;
    }
    if (this.busy) {
      reply(response, 503, { error: 'busy' });
      return;
    }
    this.busy = true;
    try {
      await this.transcribe(request, response, model, parseTranscribeQuery(url.searchParams));
    } finally {
      this.busy = false;
    }
  }

  private async transcribe(request: IncomingMessage, response: ServerResponse, model: TranscriptionModel, query: TranscribeQuery): Promise<void> {
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
    const job = model.jobFor(query);
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
  const { router, models, catalog } = options;
  const handler = new SingleFlightHandler(catalog, options.onError);
  const server = createServer({ maxHeaderSize: MAX_HEADER_BYTES }, (request, response) => {
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
      reply(response, 200, { languages: router.languages(), models, transcriptionModels: catalog.report() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/prepare') {
      prepareModel(catalog, url, response, options.onError).catch(() => reply(response, 500, { error: 'internal error' }));
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

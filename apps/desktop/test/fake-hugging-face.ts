import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const HUGGING_FACE_ORIGIN = 'https://huggingface.co';

export type FakeFile = {
  body: Uint8Array;
  chunkBytes?: number;
  chunkDelayMs?: number;
  stallAfterBytes?: number;
  ignoreRange?: boolean;
};

export type RecordedRequest = { path: string; range: string | null };

function parseRangeStart(header: string | undefined): number | null {
  const match = /^bytes=(\d+)-$/.exec(header ?? '');
  return match?.[1] === undefined ? null : Number(match[1]);
}

export class FakeHuggingFace {
  readonly requests: RecordedRequest[] = [];
  private readonly files = new Map<string, FakeFile>();
  private readonly server: Server;
  private origin = '';

  constructor() {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.origin = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  closeConnections(): void {
    this.server.closeAllConnections();
  }

  serve(path: string, file: FakeFile): void {
    this.files.set(path, file);
  }

  readonly fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(HUGGING_FACE_ORIGIN)) {
      return Promise.reject(new Error(`Unexpected request to ${url}`));
    }
    return fetch(`${this.origin}${url.slice(HUGGING_FACE_ORIGIN.length)}`, init);
  };

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = request.url ?? '';
    this.requests.push({ path, range: request.headers.range ?? null });
    const file = this.files.get(path);
    if (file === undefined) {
      response.writeHead(404).end();
      return;
    }
    const start = file.ignoreRange === true ? 0 : (parseRangeStart(request.headers.range) ?? 0);
    if (start >= file.body.byteLength) {
      response.writeHead(416, { 'Content-Range': `bytes */${file.body.byteLength}` }).end();
      return;
    }
    const status = start > 0 ? 206 : 200;
    const headers: Record<string, string> = { 'Content-Length': String(file.body.byteLength - start), 'Accept-Ranges': 'bytes' };
    if (status === 206) {
      headers['Content-Range'] = `bytes ${start}-${file.body.byteLength - 1}/${file.body.byteLength}`;
    }
    response.writeHead(status, headers);
    await this.stream(file, start, response);
  }

  private async stream(file: FakeFile, start: number, response: ServerResponse): Promise<void> {
    const chunkBytes = file.chunkBytes ?? 16 * 1024;
    const stallAt = file.stallAfterBytes ?? Infinity;
    for (let offset = start; offset < file.body.byteLength; offset += chunkBytes) {
      if (response.destroyed) {
        return;
      }
      if (offset >= stallAt) {
        return;
      }
      response.write(file.body.subarray(offset, Math.min(offset + chunkBytes, stallAt, file.body.byteLength)));
      await delay(file.chunkDelayMs ?? 0);
    }
    response.end();
  }
}

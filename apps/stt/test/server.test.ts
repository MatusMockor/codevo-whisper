import { request } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliTranscriber } from '../src/cli-transcriber';
import { startSttServer, type SttServer } from '../src/server';

const FAKE_CLI = fileURLToPath(new URL('../../../packages/stt-runner/test/support/fake-transcribe-cli.sh', import.meta.url));

type Reply = { status: number; body: unknown };

let server: SttServer;

function isBusy(reply: Reply): boolean {
  return typeof reply.body === 'object' && reply.body !== null && (reply.body as { busy?: unknown }).busy === true;
}

function send(path: string, options: { method?: string; contentType?: string; body?: Uint8Array } = {}): Promise<Reply> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: '127.0.0.1', port, path, method: options.method ?? 'POST', headers: { 'content-type': options.contentType ?? 'application/octet-stream' } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode ?? 0, body: text === '' ? null : (JSON.parse(text) as unknown) });
        });
      },
    );
    outgoing.on('error', reject);
    outgoing.on('socket', (socket) => socket.on('error', () => undefined));
    outgoing.end(options.body === undefined ? undefined : Buffer.from(options.body));
  });
}

beforeEach(async () => {
  const transcriber = new CliTranscriber({ binary: FAKE_CLI, model: '/models/fake.gguf', backend: 'cpu', threads: 2 });
  server = await startSttServer({ transcriber, port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await server.stop();
});

describe('STT sidecar', () => {
  it('returns the transcript for valid PCM', async () => {
    vi.stubEnv('FAKE_CLI_TEXT', 'ahoj svet');

    expect(await send('/transcribe?language=sk', { body: new Uint8Array(32_000) })).toEqual({ status: 200, body: { text: 'ahoj svet' } });
  });

  it('answers 415 for a wrong content type', async () => {
    expect((await send('/transcribe?language=sk', { contentType: 'audio/wav', body: new Uint8Array(32_000) })).status).toBe(415);
  });

  it('answers 400 for 639 bytes, an odd length and an unknown language', async () => {
    expect((await send('/transcribe?language=sk', { body: new Uint8Array(639) })).status).toBe(400);
    expect((await send('/transcribe?language=sk', { body: new Uint8Array(32_001) })).status).toBe(400);
    expect((await send('/transcribe?language=de', { body: new Uint8Array(32_000) })).status).toBe(400);
    expect((await send('/transcribe', { body: new Uint8Array(32_000) })).status).toBe(400);
  });

  it('accepts 640 and 960000 bytes and answers 413 above 960000', async () => {
    expect((await send('/transcribe?language=auto', { body: new Uint8Array(640) })).status).toBe(200);
    expect((await send('/transcribe?language=en', { body: new Uint8Array(960_000) })).status).toBe(200);
    expect((await send('/transcribe?language=sk', { body: new Uint8Array(960_002) })).status).toBe(413);
  });

  it('answers 503 to a concurrent request and reports busy on /health', async () => {
    vi.stubEnv('FAKE_CLI_DELAY_S', '0.5');
    const first = send('/transcribe?language=sk', { body: new Uint8Array(32_000) });
    for (let health = await send('/health', { method: 'GET' }); !isBusy(health); health = await send('/health', { method: 'GET' })) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(await send('/health', { method: 'GET' })).toEqual({ status: 200, body: { status: 'UP', busy: true } });
    expect((await send('/transcribe?language=sk', { body: new Uint8Array(32_000) })).status).toBe(503);
    expect((await first).status).toBe(200);
    expect(await send('/health', { method: 'GET' })).toEqual({ status: 200, body: { status: 'UP', busy: false } });
  });

  it('answers 502 when the engine fails and 504 when it times out', async () => {
    vi.stubEnv('FAKE_CLI_MODE', 'fail');
    expect((await send('/transcribe?language=sk', { body: new Uint8Array(32_000) })).status).toBe(502);
    await server.stop();

    const transcriber = new CliTranscriber({ binary: FAKE_CLI, model: '/models/fake.gguf', backend: 'cpu', threads: 2, timeoutMs: 100 });
    server = await startSttServer({ transcriber, port: 0, host: '127.0.0.1' });
    vi.stubEnv('FAKE_CLI_MODE', 'hang');
    expect((await send('/transcribe?language=sk', { body: new Uint8Array(32_000) })).status).toBe(504);
  });

  it('survives a client that resets the socket mid-body', async () => {
    const { port } = server.address() as AddressInfo;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const socket = connect(port, '127.0.0.1');
      socket.on('error', () => undefined);
      await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
      socket.write('POST /transcribe?language=sk HTTP/1.1\r\nHost: stt\r\nContent-Type: application/octet-stream\r\nContent-Length: 32000\r\n\r\n');
      await new Promise((resolve) => socket.write(Buffer.alloc(1000), resolve));
      socket.resetAndDestroy();
      await new Promise((resolve) => socket.once('close', resolve));
    }

    expect(await send('/health', { method: 'GET' })).toEqual({ status: 200, body: { status: 'UP', busy: false } });
    expect((await send('/transcribe?language=sk', { body: new Uint8Array(32_000) })).status).toBe(200);
  });

  it('answers 400 to a malformed request URL and keeps running', async () => {
    const { port } = server.address() as AddressInfo;
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => undefined);
    const response = await new Promise<string>((resolve) => {
      let text = '';
      socket.on('data', (chunk: Buffer) => {
        text += chunk.toString('latin1');
      });
      socket.on('close', () => resolve(text));
      socket.write('GET http://[ HTTP/1.1\r\nHost: stt\r\nConnection: close\r\n\r\n');
    });

    expect(response).toMatch(/^HTTP\/1\.1 400/);
    expect((await send('/health', { method: 'GET' })).status).toBe(200);
  });

  it('answers 404 for unknown routes', async () => {
    expect((await send('/other', { method: 'GET' })).status).toBe(404);
  });
});

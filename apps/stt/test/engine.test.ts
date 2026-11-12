import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CliTranscriber } from '../src/cli-transcriber';
import { loadSttConfig } from '../src/config';
import { createEngine } from '../src/create-engine';
import type { Engine } from '../src/engine';
import { startSttServer, type SttServer } from '../src/server';

const FAKE_WORKER = fileURLToPath(new URL('../../../packages/stt-runner/test/support/fake-worker.js', import.meta.url));

let server: SttServer | undefined;
let engine: Engine | undefined;

function get(path: string): Promise<{ status: number; body: unknown }> {
  const { port } = server?.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

function post(path: string, body: Uint8Array): Promise<{ status: number; text: string }> {
  const { port } = server?.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/octet-stream' } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { text?: string };
        resolve({ status: response.statusCode ?? 0, text: parsed.text ?? '' });
      });
    });
    outgoing.on('error', reject);
    outgoing.end(Buffer.from(body));
  });
}

afterEach(async () => {
  await server?.stop();
  await engine?.close();
  server = undefined;
  engine = undefined;
});

describe('engine selection', () => {
  it('serves every request from one resident worker by default', async () => {
    engine = createEngine({ ...loadSttConfig({}), workerBinary: FAKE_WORKER }, { routing: false });
    server = await startSttServer({ transcriber: engine.transcriber, router: engine.router, models: engine.models, port: 0, host: '127.0.0.1' });

    const first = await post('/transcribe?language=sk', new Uint8Array(32_000));
    const second = await post('/transcribe?language=auto', new Uint8Array(6_400));

    expect(first.status).toBe(200);
    expect(first.text).toMatch(/^\d+:sk:16000$/);
    expect(second.text).toBe(`${first.text.split(':')[0] ?? ''}:auto:3200`);
  });

  it('reports DOWN until the resident worker answered ready', async () => {
    engine = createEngine({ ...loadSttConfig({}), workerBinary: FAKE_WORKER }, { routing: false });
    server = await startSttServer({ transcriber: engine.transcriber, router: engine.router, models: engine.models, port: 0, host: '127.0.0.1' });

    expect(await get('/health')).toEqual({ status: 503, body: { status: 'DOWN', busy: false } });
    await engine.transcriber.warmUp();
    expect(await get('/health')).toEqual({ status: 200, body: { status: 'UP', busy: false } });
  });

  it('keeps the per-call CLI engine available', () => {
    engine = createEngine(loadSttConfig({ STT_ENGINE: 'cli' }), { routing: false });

    expect(engine.transcriber).toBeInstanceOf(CliTranscriber);
  });
});

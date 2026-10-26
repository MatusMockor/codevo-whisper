import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ProtocolError } from '@codevo-whisper/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STT_TIMEOUT_MS, HttpSttClient, MAX_STT_RESPONSE_BYTES } from '../src/stt/http-stt-client';
import { startFakeSttServer, type FakeSttServer } from './support/fake-stt-server';
import { pcmSeconds } from './support/pcm';
import { waitUntil } from './support/wait-until';

let fake: FakeSttServer | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

async function closedPortUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

const signal = (): AbortSignal => new AbortController().signal;

type RawServer = { url: string; close(): Promise<void> };

async function rawServer(write: (response: ServerResponse) => void): Promise<RawServer> {
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => write(response));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('HttpSttClient', () => {
  it('sends PCM with language and returns text', async () => {
    fake = await startFakeSttServer({ respond: (pcm, language) => ({ status: 200, body: { text: `${language}:${pcm.length}` } }) });
    const client = new HttpSttClient(fake.url);

    expect(await client.transcribe(pcmSeconds(0.1), 'sk', signal())).toBe('sk:3200');
    expect(fake.requests).toEqual([{ language: 'sk', bytes: 3200 }]);
  });

  it('maps 503 to busy', async () => {
    fake = await startFakeSttServer({ respond: () => ({ status: 503, body: { error: 'busy' } }) });

    await expect(new HttpSttClient(fake.url).transcribe(pcmSeconds(0.1), 'sk', signal())).rejects.toMatchObject({ code: 'busy' });
  });

  it('maps 500 and connection refused to stt_unavailable', async () => {
    fake = await startFakeSttServer({ respond: () => ({ status: 500, body: { error: 'engine' } }) });

    await expect(new HttpSttClient(fake.url).transcribe(pcmSeconds(0.1), 'sk', signal())).rejects.toMatchObject({
      code: 'stt_unavailable',
    });
    await expect(new HttpSttClient(await closedPortUrl()).transcribe(pcmSeconds(0.1), 'sk', signal())).rejects.toMatchObject({
      code: 'stt_unavailable',
    });
  });

  it('maps a malformed response and a timeout to stt_unavailable', async () => {
    fake = await startFakeSttServer({ respond: () => ({ status: 200, body: { words: [] } }), delayMs: 0 });
    await expect(new HttpSttClient(fake.url).transcribe(pcmSeconds(0.1), 'sk', signal())).rejects.toBeInstanceOf(ProtocolError);
    await fake.close();

    fake = await startFakeSttServer({ delayMs: 1000 });
    await expect(new HttpSttClient(fake.url, 50).transcribe(pcmSeconds(0.1), 'sk', signal())).rejects.toMatchObject({
      code: 'stt_unavailable',
    });
  });

  it('waits 40 s by default and reads at most 128 KiB of response', () => {
    expect(DEFAULT_STT_TIMEOUT_MS).toBe(40_000);
    expect(MAX_STT_RESPONSE_BYTES).toBe(128 * 1024);
  });

  it('rejects a streamed body above the limit even without Content-Length', async () => {
    const raw = await rawServer((response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"text":"');
      const chunk = 'a'.repeat(16 * 1024);
      for (let index = 0; index < 12; index += 1) {
        response.write(chunk);
      }
      response.end('"}');
    });
    try {
      await expect(new HttpSttClient(raw.url).transcribe(pcmSeconds(0.1), 'sk', signal())).rejects.toMatchObject({
        code: 'stt_unavailable',
        message: expect.stringContaining('too large') as string,
      });
    } finally {
      await raw.close();
    }
  });

  it('rejects a declared Content-Length above the limit', async () => {
    const body = JSON.stringify({ text: 'a'.repeat(MAX_STT_RESPONSE_BYTES) });
    const raw = await rawServer((response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) });
      response.end(body);
    });
    try {
      await expect(new HttpSttClient(raw.url).transcribe(pcmSeconds(0.1), 'sk', signal())).rejects.toMatchObject({ code: 'stt_unavailable' });
    } finally {
      await raw.close();
    }
  });

  it('rejects invalid UTF-8 in the response body', async () => {
    const raw = await rawServer((response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(Buffer.concat([Buffer.from('{"text":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}')]));
    });
    try {
      await expect(new HttpSttClient(raw.url).transcribe(pcmSeconds(0.1), 'sk', signal())).rejects.toMatchObject({ code: 'stt_unavailable' });
    } finally {
      await raw.close();
    }
  });

  it('accepts text at the protocol limit and rejects longer text', async () => {
    let text = 'á'.repeat(16_000);
    fake = await startFakeSttServer({ respond: () => ({ status: 200, body: { text } }) });
    const client = new HttpSttClient(fake.url);

    expect(await client.transcribe(pcmSeconds(0.1), 'sk', signal())).toBe(text);
    text = 'a'.repeat(16_001);
    await expect(client.transcribe(pcmSeconds(0.1), 'sk', signal())).rejects.toMatchObject({ code: 'stt_unavailable' });
  });

  it('aborts on signal', async () => {
    fake = await startFakeSttServer({ delayMs: 1000 });
    const controller = new AbortController();
    const pending = new HttpSttClient(fake.url).transcribe(pcmSeconds(0.1), 'sk', controller.signal);
    await waitUntil(() => fake?.requests.length === 1);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await waitUntil(() => fake?.aborted() === 1);
  });
});

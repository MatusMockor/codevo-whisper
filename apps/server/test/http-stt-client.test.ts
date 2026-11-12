import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ProtocolError } from '@codevo-whisper/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { UNKNOWN_MODELS } from '@codevo-whisper/protocol';
import { DEFAULT_STT_TIMEOUT_MS, HttpSttClient, MAX_CAPABILITIES_RESPONSE_BYTES, MAX_STT_RESPONSE_BYTES } from '../src/stt/http-stt-client';
import { NO_CAPABILITIES } from '../src/stt/stt-capabilities';
import { ROUTING_MODELS, ROUTING_STT, startFakeSttServer, type FakeSttServer } from './support/fake-stt-server';
import type { SttRequest } from '../src/stt/stt-client';
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

const legacy = (pcm: Uint8Array): SttRequest => ({ pcm, language: 'sk', languages: null, kind: 'final' });

const routed = (pcm: Uint8Array, kind: SttRequest['kind'] = 'final'): SttRequest => ({ pcm, language: 'auto', languages: ['sk', 'cs'], kind });

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

    expect(await client.transcribe(legacy(pcmSeconds(0.1)), signal())).toEqual({ text: 'sk:3200', language: null, route: null });
    expect(fake.requests).toEqual([{ language: 'sk', bytes: 3200 }]);
  });

  it('maps 503 to busy', async () => {
    fake = await startFakeSttServer({ respond: () => ({ status: 503, body: { error: 'busy' } }) });

    await expect(new HttpSttClient(fake.url).transcribe(legacy(pcmSeconds(0.1)), signal())).rejects.toMatchObject({ code: 'busy' });
  });

  it('maps 500 and connection refused to stt_unavailable', async () => {
    fake = await startFakeSttServer({ respond: () => ({ status: 500, body: { error: 'engine' } }) });

    await expect(new HttpSttClient(fake.url).transcribe(legacy(pcmSeconds(0.1)), signal())).rejects.toMatchObject({
      code: 'stt_unavailable',
    });
    await expect(new HttpSttClient(await closedPortUrl()).transcribe(legacy(pcmSeconds(0.1)), signal())).rejects.toMatchObject({
      code: 'stt_unavailable',
    });
  });

  it('maps a malformed response and a timeout to stt_unavailable', async () => {
    fake = await startFakeSttServer({ respond: () => ({ status: 200, body: { words: [] } }), delayMs: 0 });
    await expect(new HttpSttClient(fake.url).transcribe(legacy(pcmSeconds(0.1)), signal())).rejects.toBeInstanceOf(ProtocolError);
    await fake.close();

    fake = await startFakeSttServer({ delayMs: 1000 });
    await expect(new HttpSttClient(fake.url, 50).transcribe(legacy(pcmSeconds(0.1)), signal())).rejects.toMatchObject({
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
      await expect(new HttpSttClient(raw.url).transcribe(legacy(pcmSeconds(0.1)), signal())).rejects.toMatchObject({
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
      await expect(new HttpSttClient(raw.url).transcribe(legacy(pcmSeconds(0.1)), signal())).rejects.toMatchObject({ code: 'stt_unavailable' });
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
      await expect(new HttpSttClient(raw.url).transcribe(legacy(pcmSeconds(0.1)), signal())).rejects.toMatchObject({ code: 'stt_unavailable' });
    } finally {
      await raw.close();
    }
  });

  it('accepts text at the protocol limit and rejects longer text', async () => {
    let text = 'á'.repeat(16_000);
    fake = await startFakeSttServer({ respond: () => ({ status: 200, body: { text } }) });
    const client = new HttpSttClient(fake.url);

    expect((await client.transcribe(legacy(pcmSeconds(0.1)), signal())).text).toBe(text);
    text = 'a'.repeat(16_001);
    await expect(client.transcribe(legacy(pcmSeconds(0.1)), signal())).rejects.toMatchObject({ code: 'stt_unavailable' });
  });

  it('aborts on signal', async () => {
    fake = await startFakeSttServer({ delayMs: 1000 });
    const controller = new AbortController();
    const pending = new HttpSttClient(fake.url).transcribe(legacy(pcmSeconds(0.1)), controller.signal);
    await waitUntil(() => fake?.requests.length === 1);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await waitUntil(() => fake?.aborted() === 1);
  });
});

describe('HttpSttClient with dictation languages', () => {
  it('sends the ordered languages and the segment kind and returns the detected language and route', async () => {
    fake = await startFakeSttServer({ capabilities: ROUTING_STT, respond: () => ({ status: 200, body: { text: 'ahoj', language: 'cs', route: 'conditioned-fix' } }) });
    const client = new HttpSttClient(fake.url);

    expect(await client.transcribe(routed(pcmSeconds(0.1), 'partial'), signal())).toEqual({ text: 'ahoj', language: 'cs', route: 'conditioned-fix' });
    expect(fake.requests).toEqual([{ language: 'auto', languages: ['sk', 'cs'], kind: 'partial', bytes: 3200 }]);
  });

  it('maps 409 to languages_unavailable', async () => {
    fake = await startFakeSttServer();

    await expect(new HttpSttClient(fake.url).transcribe(routed(pcmSeconds(0.1)), signal())).rejects.toMatchObject({ code: 'languages_unavailable' });
  });

  it('maps 409 to stt_unavailable for a legacy request so an old client never sees the new error code', async () => {
    fake = await startFakeSttServer({ respond: () => ({ status: 409, body: { error: 'languages unavailable' } }) });

    await expect(new HttpSttClient(fake.url).transcribe(legacy(pcmSeconds(0.1)), signal())).rejects.toMatchObject({ code: 'stt_unavailable' });
  });

  it('keeps every known route and drops any other route string', async () => {
    const known = ['auto', 'verbatim-short', 'verbatim-foreign', 'verbatim-unsure', 'conditioned-fix', 'verbatim-guard', 'conditioned', 'verbatim-fallback'];
    let route = '';
    fake = await startFakeSttServer({ capabilities: ROUTING_STT, respond: () => ({ status: 200, body: { text: 'ahoj', language: 'sk', route } }) });
    const client = new HttpSttClient(fake.url);

    for (route of known) {
      expect((await client.transcribe(routed(pcmSeconds(0.1)), signal())).route).toBe(route);
    }
    for (route of ['secret', 'conditioned-', 'Conditioned', 'auto ', '']) {
      expect((await client.transcribe(routed(pcmSeconds(0.1)), signal())).route).toBeNull();
    }
  });

  it('treats a missing language as unattributed and a malformed route as unknown', async () => {
    fake = await startFakeSttServer({ capabilities: ROUTING_STT, respond: () => ({ status: 200, body: { text: 'ahoj', route: 'Conditioned!' } }) });

    expect(await new HttpSttClient(fake.url).transcribe(routed(pcmSeconds(0.1)), signal())).toEqual({ text: 'ahoj', language: null, route: null });
  });

  it('rejects a detected language outside the dictation languages', async () => {
    fake = await startFakeSttServer({ capabilities: ROUTING_STT, respond: () => ({ status: 200, body: { text: 'ahoj', language: 'ja', route: 'conditioned' } }) });

    await expect(new HttpSttClient(fake.url).transcribe(routed(pcmSeconds(0.1)), signal())).rejects.toMatchObject({ code: 'stt_unavailable' });
  });

  it('ignores language fields in the reply to a legacy request', async () => {
    fake = await startFakeSttServer({ respond: () => ({ status: 200, body: { text: 'ahoj', language: 'ja', route: 'conditioned' } }) });

    expect(await new HttpSttClient(fake.url).transcribe(legacy(pcmSeconds(0.1)), signal())).toEqual({ text: 'ahoj', language: null, route: null });
  });

  it('applies the text limit to routed replies', async () => {
    fake = await startFakeSttServer({ capabilities: ROUTING_STT, respond: () => ({ status: 200, body: { text: 'a'.repeat(16_001), language: 'sk', route: 'conditioned' } }) });

    await expect(new HttpSttClient(fake.url).transcribe(routed(pcmSeconds(0.1)), signal())).rejects.toMatchObject({ code: 'stt_unavailable' });
  });
});

describe('HttpSttClient capabilities', () => {
  it('reads the languages and models of the stt', async () => {
    fake = await startFakeSttServer({ capabilities: ROUTING_STT });

    expect(await new HttpSttClient(fake.url).capabilities()).toEqual({ languages: ROUTING_STT.body.languages, models: ROUTING_MODELS });
  });

  it('treats a 404 from an old stt, an error status and an unreachable stt as no capabilities', async () => {
    fake = await startFakeSttServer();
    expect(await new HttpSttClient(fake.url).capabilities()).toEqual(NO_CAPABILITIES);
    fake.setCapabilities({ status: 500, body: { error: 'internal error' } });
    expect(await new HttpSttClient(fake.url).capabilities()).toEqual(NO_CAPABILITIES);
    expect(await new HttpSttClient(await closedPortUrl()).capabilities()).toEqual({ languages: [], models: UNKNOWN_MODELS });
  });

  it('drops a malformed language list and keeps valid model names', async () => {
    const models = { transcription: 'Parakeet Ultra (F16)', conditioned: 'x'.repeat(65), languageId: 'Vox\nLingua' };
    fake = await startFakeSttServer({ capabilities: { status: 200, body: { languages: ['sk', 'ja'], models } } });

    expect(await new HttpSttClient(fake.url).capabilities()).toEqual({ languages: [], models: { ...UNKNOWN_MODELS, transcription: 'Parakeet Ultra (F16)' } });
  });

  it('drops duplicated languages and models that are not an object', async () => {
    fake = await startFakeSttServer({ capabilities: { status: 200, body: { languages: ['sk', 'sk'], models: ['Parakeet'] } } });

    expect(await new HttpSttClient(fake.url).capabilities()).toEqual(NO_CAPABILITIES);
  });

  it('treats a reply above the size limit and invalid JSON as no capabilities', async () => {
    const huge = await rawServer((response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ languages: [], models: { transcription: 'a'.repeat(MAX_CAPABILITIES_RESPONSE_BYTES) } }));
    });
    const garbage = await rawServer((response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"languages":');
    });
    try {
      expect(await new HttpSttClient(huge.url).capabilities()).toEqual(NO_CAPABILITIES);
      expect(await new HttpSttClient(garbage.url).capabilities()).toEqual(NO_CAPABILITIES);
    } finally {
      await huge.close();
      await garbage.close();
    }
  });

  it('gives up on an stt that does not answer within a second', async () => {
    const silent = await rawServer(() => undefined);
    try {
      const started = Date.now();
      expect(await new HttpSttClient(silent.url).capabilities()).toEqual(NO_CAPABILITIES);
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      await silent.close();
    }
  });
});

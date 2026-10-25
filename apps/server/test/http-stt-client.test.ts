import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ProtocolError } from '@codevo-whisper/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpSttClient } from '../src/stt/http-stt-client';
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

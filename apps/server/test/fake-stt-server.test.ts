import { connect } from 'node:net';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { startFakeSttServer, type FakeSttServer } from './support/fake-stt-server';

let server: FakeSttServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

it('handles a reset during an STT upload and serves the next transcription', async () => {
  server = await startFakeSttServer();
  const socket = connect(Number(new URL(server.url).port), '127.0.0.1');
  socket.on('error', () => socket.destroy());
  await once(socket, 'connect');
  const continued = once(socket, 'data');
  socket.write('POST /transcribe?language=sk HTTP/1.1\r\nHost: stt\r\nContent-Type: application/octet-stream\r\nContent-Length: 32000\r\nExpect: 100-continue\r\n\r\n');
  const reply: unknown = (await continued)[0];
  expect(Buffer.isBuffer(reply) && reply.toString().includes('100 Continue')).toBe(true);
  await new Promise<void>((resolve, reject) => socket.write(Buffer.alloc(640), (error) => error ? reject(error) : resolve()));
  const closed = once(socket, 'close');
  socket.resetAndDestroy();
  await closed;
  await expect.poll(() => server?.aborted()).toBe(1);
  expect(server.requests).toEqual([]);
  const response = await fetch(`${server.url}/transcribe?language=sk`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(640) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ text: 'ahoj svet' });
});

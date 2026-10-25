import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeSttServer, type FakeSttServer } from './support/fake-stt-server';
import { startRecordingProxy, type RecordingProxy } from './support/recording-proxy';
import { sendAudio } from './support/send-audio';
import { startHarness, type Harness } from './support/server-harness';
import { createTempDir } from './support/temp-dir';
import { connectSession } from './support/test-client';

const SECRET_TEXT = 'tajny-prepis-12345';
const WINDOW = 64;

let dir: Awaited<ReturnType<typeof createTempDir>>;
let fake: FakeSttServer;
let harness: Harness;
let proxy: RecordingProxy;

function distinctivePcm(bytes: number): Uint8Array {
  const pcm = new Uint8Array(bytes);
  let state = 0x9e3779b9;
  for (let index = 0; index < bytes; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    pcm[index] = state >>> 24;
  }
  return pcm;
}

function windows(bytes: Uint8Array): Set<string> {
  const text = Buffer.from(bytes).toString('latin1');
  const result = new Set<string>();
  for (let offset = 0; offset + WINDOW <= text.length; offset += 1) {
    result.add(text.slice(offset, offset + WINDOW));
  }
  return result;
}

beforeEach(async () => {
  dir = await createTempDir();
  fake = await startFakeSttServer({ respond: () => ({ status: 200, body: { text: SECRET_TEXT } }) });
  harness = await startHarness(dir.path, fake.url);
  proxy = await startRecordingProxy(harness.gateway.port);
});

afterEach(async () => {
  await proxy.close();
  await harness.close();
  await fake.close();
  await dir.remove();
});

describe('ciphertext on the wire', () => {
  it('carries neither PCM runs nor transcript text in the clear', async () => {
    const device = await harness.addDevice();
    const session = await connectSession(`ws://127.0.0.1:${proxy.port}`, device, harness.serverKey.publicKey);
    const pcm = distinctivePcm(5 * 32_000);
    expect(await session.next()).toMatchObject({ type: 'ready' });
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcm);
    session.send({ type: 'finish' });
    expect(await session.next()).toEqual({ type: 'final', segmentId: 0, text: SECRET_TEXT });
    expect(await session.next()).toEqual({ type: 'done' });

    const wire = proxy.bytes();
    const wireWindows = windows(wire);
    const leaked = [...windows(pcm)].filter((window) => wireWindows.has(window));
    expect(wire.length).toBeGreaterThan(pcm.length);
    expect(leaked).toHaveLength(0);
    expect(Buffer.from(wire).includes(Buffer.from(SECRET_TEXT, 'utf8'))).toBe(false);
  });
});

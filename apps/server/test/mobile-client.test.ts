import { afterEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import { encodePairingToken } from '@codevo-whisper/protocol';
import { startHarness } from './support/server-harness';
import { startFakeSttServer } from './support/fake-stt-server';
import { createTempDir } from './support/temp-dir';
import { openPairingWindow } from './support/admin';
import { pcmSeconds } from './support/pcm';
import { pairDevice, parsePairing, startSession } from '../../mobile/src/core/pairing';
import type { OpenWire } from '../../mobile/src/core/connection';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});
const open: OpenWire = (endpoint) => {
  const ws = new WebSocket(endpoint);
  ws.binaryType = 'arraybuffer';
  return {
    get bufferedAmount() {
      return ws.bufferedAmount;
    },
    send: (bytes) => ws.send(bytes),
    close: () => ws.close(),
    subscribe: (events) => {
      ws.on('open', () => events.open());
      ws.on('message', (data) => events.frame(data));
      ws.on('error', () => events.failed());
      ws.on('close', (code) => events.closed(code));
    },
  };
};

it('pairs by operator approval then transcribes over real encrypted gateway', async () => {
  const dir = await createTempDir();
  cleanup.push(() => dir.remove());
  const fake = await startFakeSttServer({ respond: () => ({ status: 200, body: { text: 'Ahoj z mobilu' } }) });
  cleanup.push(() => fake.close());
  const server = await startHarness(dir.path, fake.url);
  cleanup.push(() => server.close());
  const window = await openPairingWindow(server.config.adminSocket);
  let stored: string | null = null;
  let connectionFingerprint = '';
  const pairing = pairDevice({
    token: encodePairingToken({ ...window.token, endpoint: server.url }),
    name: 'Mobile',
    vault: {
      load: () => Promise.resolve(stored),
      save: (value) => {
        stored = value;
        return Promise.resolve();
      },
      remove: () => Promise.resolve(),
    },
    open,
    signal: new AbortController().signal,
    awaitingApproval: (f) => {
      connectionFingerprint = f.connection;
    },
  });
  const request = await window.admin.next();
  expect(request).toMatchObject({ event: 'request', handshakeFingerprint: connectionFingerprint });
  window.admin.send({ decision: 'approve' });
  const approved = await pairing;
  expect(stored).not.toBeNull();
  expect(parsePairing(stored ?? '').deviceId).toBe(approved.deviceId);
  const session = await startSession(approved, 'real-mobile', 'sk', open, new AbortController().signal);
  session.push(pcmSeconds(1));
  expect(await session.finish()).toBe('Ahoj z mobilu');
  expect(fake.requests).toEqual([{ language: 'sk', bytes: 32000 }]);
  window.admin.close();
  await server.devices.remove(approved.deviceId);
  await expect(startSession(approved, 'revoked-mobile', 'auto', open, new AbortController().signal)).rejects.toThrow('unknown_device');
}, 15_000);

it('rejection and changed server key preserve the previous protected pairing', async () => {
  const dir = await createTempDir();
  cleanup.push(() => dir.remove());
  const fake = await startFakeSttServer();
  cleanup.push(() => fake.close());
  const server = await startHarness(dir.path, fake.url);
  cleanup.push(() => server.close());
  const old = await server.addDevice();
  const { serializePairing } = await import('../../mobile/src/core/pairing');
  let stored = serializePairing({
    deviceKey: old,
    serverPublicKey: server.serverKey.publicKey,
    endpoint: server.url,
    deviceId: 'old-device',
  });
  const original = stored;
  const vault = {
    load: () => Promise.resolve(stored),
    save: (value: string) => {
      stored = value;
      return Promise.resolve();
    },
    remove: () => Promise.resolve(),
  };
  const window = await openPairingWindow(server.config.adminSocket);
  const pairing = pairDevice({
    token: encodePairingToken({ ...window.token, endpoint: server.url }),
    name: 'Replacement',
    vault,
    open,
    signal: new AbortController().signal,
    awaitingApproval: () => undefined,
  });
  const rejected = expect(pairing).rejects.toThrow('not approved');
  expect(await window.admin.next()).toMatchObject({ event: 'request' });
  window.admin.send({ decision: 'reject' });
  await rejected;
  window.admin.close();
  expect(stored).toBe(original);
  const wrong = { ...parsePairing(original), serverPublicKey: new Uint8Array(32).fill(7) };
  await expect(startSession(wrong, 'wrong-key', 'auto', open, new AbortController().signal)).rejects.toThrow();
  expect(stored).toBe(original);
});

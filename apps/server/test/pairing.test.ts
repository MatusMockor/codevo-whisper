import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fingerprint, generateKeyPair } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminCommand, openPairingWindow } from './support/admin';
import { startFakeSttServer, type FakeSttServer } from './support/fake-stt-server';
import { pcmSeconds } from './support/pcm';
import { sendAudio } from './support/send-audio';
import { startHarness, type Harness } from './support/server-harness';
import { createTempDir } from './support/temp-dir';
import { beginPairing, beginSession } from '@codevo-whisper/protocol';
import { connectSession, pairDevice, runHandshake } from './support/test-client';
import { waitUntil } from './support/wait-until';

let dir: Awaited<ReturnType<typeof createTempDir>>;
let fake: FakeSttServer;
let harness: Harness | undefined;

beforeEach(async () => {
  dir = await createTempDir();
  fake = await startFakeSttServer();
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await fake.close();
  await dir.remove();
});

async function start(options: Parameters<typeof startHarness>[2] = {}): Promise<Harness> {
  harness = await startHarness(dir.path, fake.url, options);
  return harness;
}

async function pairApproved(server: Harness, name = 'MacBook dev'): Promise<{ device: ReturnType<typeof generateKeyPair>; deviceId: string }> {
  const window = await openPairingWindow(server.config.adminSocket);
  const device = generateKeyPair();
  const pairing = pairDevice(server.url, window.token, device, name);
  expect(await window.admin.next()).toMatchObject({ event: 'request', deviceName: name });
  window.admin.send({ decision: 'approve' });
  const outcome = await pairing;
  expect(await window.admin.next()).toEqual({ event: 'paired', deviceId: outcome.deviceId });
  window.admin.close();
  return { device, deviceId: outcome.deviceId ?? '' };
}

describe('pairing', () => {
  it('pairs a device after approval', async () => {
    const server = await start();
    const window = await openPairingWindow(server.config.adminSocket);
    const device = generateKeyPair();
    expect(window.token.serverPublicKey).toEqual(server.serverKey.publicKey);
    expect(window.token.endpoint).toBe('ws://127.0.0.1:8787');

    const pairing = pairDevice(server.url, window.token, device, 'MacBook dev');
    const request = await window.admin.next();
    window.admin.send({ decision: 'approve' });
    const outcome = await pairing;

    expect(request).toEqual({
      event: 'request',
      deviceName: 'MacBook dev',
      deviceFingerprint: fingerprint(device.publicKey),
      handshakeFingerprint: outcome.handshakeFingerprint,
    });
    expect(outcome.status).toBe('approved');
    expect(await window.admin.next()).toEqual({ event: 'paired', deviceId: outcome.deviceId });
    const session = await connectSession(server.url, device, server.serverKey.publicKey);
    expect(await session.next()).toMatchObject({ type: 'ready' });
  });

  it('rejected device cannot connect', async () => {
    const server = await start();
    const window = await openPairingWindow(server.config.adminSocket);
    const device = generateKeyPair();
    const pairing = pairDevice(server.url, window.token, device, 'Cudzí');
    expect(await window.admin.next()).toMatchObject({ event: 'request' });
    window.admin.send({ decision: 'reject' });

    expect((await pairing).status).toBe('rejected');
    expect(await window.admin.next()).toEqual({ event: 'rejected' });
    await expect(connectSession(server.url, device, server.serverKey.publicKey)).rejects.toMatchObject({ code: 'unknown_device' });
  });

  it('token works only once', async () => {
    const server = await start();
    const window = await openPairingWindow(server.config.adminSocket);
    const pairing = pairDevice(server.url, window.token, generateKeyPair(), 'Prvý');
    expect(await window.admin.next()).toMatchObject({ event: 'request' });

    await expect(pairDevice(server.url, window.token, generateKeyPair(), 'Druhý')).rejects.toMatchObject({ code: 'pairing_closed' });
    window.admin.send({ decision: 'approve' });
    expect((await pairing).status).toBe('approved');
    await expect(pairDevice(server.url, window.token, generateKeyPair(), 'Tretí')).rejects.toMatchObject({ code: 'pairing_closed' });
  });

  it('a wrong secret fails without closing the window', async () => {
    const server = await start();
    const window = await openPairingWindow(server.config.adminSocket);
    const wrong = { ...window.token, secret: new Uint8Array(32).fill(7) };

    await expect(pairDevice(server.url, wrong, generateKeyPair(), 'Útočník')).rejects.toMatchObject({ code: 'bad_message' });
    await waitUntil(() => server.pairing.failedAttempts('127.0.0.1') === 1);
    expect(server.pairing.isOpen()).toBe(true);
    const device = generateKeyPair();
    const pairing = pairDevice(server.url, window.token, device, 'Správny');
    expect(await window.admin.next()).toMatchObject({ event: 'request', deviceName: 'Správny' });
    window.admin.send({ decision: 'approve' });

    expect((await pairing).status).toBe('approved');
  });

  it('limits failed pairing attempts per IP', async () => {
    const server = await start();
    const window = await openPairingWindow(server.config.adminSocket);
    const wrong = { ...window.token, secret: new Uint8Array(32).fill(7) };
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(pairDevice(server.url, wrong, generateKeyPair(), 'Útočník')).rejects.toMatchObject({ code: 'bad_message' });
      await waitUntil(() => server.pairing.failedAttempts('127.0.0.1') === attempt);
    }

    await expect(pairDevice(server.url, window.token, generateKeyPair(), 'Správny')).rejects.toMatchObject({ code: 'pairing_closed' });
    expect(server.pairing.isOpen()).toBe(true);
  });

  it('expired window rejects pairing', async () => {
    let now = 5_000_000;
    const server = await start({ clock: () => now });
    const window = await openPairingWindow(server.config.adminSocket, 60_000);
    expect(window.expiresAt).toBe(5_060_000);
    now += 60_001;

    await expect(pairDevice(server.url, window.token, generateKeyPair(), 'Neskoro')).rejects.toMatchObject({ code: 'pairing_closed' });
    expect(await window.admin.next()).toEqual({ event: 'expired' });
  });

  it('pairing token does not survive restart', async () => {
    const first = await start();
    const window = await openPairingWindow(first.config.adminSocket);
    window.admin.close();
    await first.close();
    harness = undefined;

    const second = await start();
    await expect(pairDevice(second.url, window.token, generateKeyPair(), 'Starý token')).rejects.toMatchObject({ code: 'pairing_closed' });
    const { device } = await pairApproved(second);
    const session = await connectSession(second.url, device, second.serverKey.publicKey);
    expect(await session.next()).toMatchObject({ type: 'ready' });
  });

  it('no pairing without an open window', async () => {
    const server = await start();
    const token = { serverPublicKey: server.serverKey.publicKey, secret: new Uint8Array(32), endpoint: 'ws://127.0.0.1:8787' };

    await expect(pairDevice(server.url, token, generateKeyPair(), 'Bez okna')).rejects.toMatchObject({ code: 'pairing_closed' });
  });

  it('closes the window when the admin connection drops', async () => {
    const server = await start();
    const window = await openPairingWindow(server.config.adminSocket);
    window.admin.close();
    await waitUntil(() => !server.pairing.isOpen());

    await expect(pairDevice(server.url, window.token, generateKeyPair(), 'Neskoro')).rejects.toMatchObject({ code: 'pairing_closed' });
  });

  it('revoke closes the active session and cancels its jobs', async () => {
    await fake.close();
    fake = await startFakeSttServer({ delayMs: 5_000 });
    const server = await start();
    const { device, deviceId } = await pairApproved(server);
    const session = await connectSession(server.url, device, server.serverKey.publicKey);
    expect(await session.next()).toMatchObject({ type: 'ready' });
    session.send({ type: 'start', sessionId: 's1', language: 'sk' });
    sendAudio(session, pcmSeconds(1));
    session.send({ type: 'finish' });
    await waitUntil(() => fake.requests.length === 1);

    expect(await adminCommand(server.config.adminSocket, { cmd: 'revoke', deviceId })).toEqual({ revoked: true, closedSessions: 1 });
    expect(await session.next()).toMatchObject({ type: 'error', code: 'revoked' });
    await waitUntil(() => fake.aborted() === 1);
    await expect(connectSession(server.url, device, server.serverKey.publicKey)).rejects.toMatchObject({ code: 'unknown_device' });
    expect(await adminCommand(server.config.adminSocket, { cmd: 'revoke', deviceId })).toEqual({ revoked: false, closedSessions: 0 });
  });

  it('revoke racing a connecting session leaves no live session', async () => {
    const server = await start();
    const { device, deviceId } = await pairApproved(server);
    const connecting = await runHandshake(server.url, beginSession(device, server.serverKey.publicKey));
    expect(await adminCommand(server.config.adminSocket, { cmd: 'revoke', deviceId })).toEqual({ revoked: true, closedSessions: 0 });
    connecting.send({ type: 'hello' });

    expect(await connecting.next()).toMatchObject({ type: 'error', code: 'revoked' });
    await connecting.closed;
    await waitUntil(() => server.gateway.sessions.count() === 0);
  });

  it('rotate-key racing a connecting session leaves no live session', async () => {
    const server = await start();
    const { device } = await pairApproved(server);
    const connecting = await runHandshake(server.url, beginSession(device, server.serverKey.publicKey));
    expect(await adminCommand(server.config.adminSocket, { cmd: 'rotate-key' })).toMatchObject({ rotated: true });
    connecting.send({ type: 'hello' });

    expect(await connecting.next()).toMatchObject({ type: 'error', code: 'server_key_changed' });
    await connecting.closed;
    await waitUntil(() => server.gateway.sessions.count() === 0);
  });

  it('tells the operator when the approved device cannot be stored', async () => {
    const server = await start();
    const window = await openPairingWindow(server.config.adminSocket);
    const session = await runHandshake(server.url, beginPairing(generateKeyPair(), window.token));
    session.send({ type: 'pair-request', deviceName: 'Bez registra' });
    expect(await window.admin.next()).toMatchObject({ event: 'request' });
    await writeFile(join(dir.path, 'devices.json'), '{ not json', { mode: 0o600 });
    window.admin.send({ decision: 'approve' });

    expect(await session.next()).toMatchObject({ type: 'error', code: 'pairing_closed' });
    expect(await window.admin.next()).toEqual({ event: 'failed' });
  });

  it('does not swallow the next admin command after an unanswered request expires', async () => {
    const server = await start();
    const window = await openPairingWindow(server.config.adminSocket, 300);
    const session = await runHandshake(server.url, beginPairing(generateKeyPair(), window.token));
    session.send({ type: 'pair-request', deviceName: 'Bez odpovede' });
    expect(await window.admin.next()).toMatchObject({ event: 'request' });

    expect(await window.admin.next()).toEqual({ event: 'expired' });
    window.admin.send({ cmd: 'devices' });
    expect(await window.admin.next()).toEqual({ devices: [] });
  });

  it('rotate-key cancels a pairing that waits for approval', async () => {
    const server = await start();
    const window = await openPairingWindow(server.config.adminSocket);
    const pairing = runHandshake(server.url, beginPairing(generateKeyPair(), window.token));
    const session = await pairing;
    session.send({ type: 'pair-request', deviceName: 'Počas rotácie' });
    expect(await window.admin.next()).toMatchObject({ event: 'request' });

    expect(await adminCommand(server.config.adminSocket, { cmd: 'rotate-key' })).toMatchObject({ rotated: true });
    window.admin.send({ decision: 'approve' });

    expect(await session.next()).toMatchObject({ type: 'error', code: 'pairing_closed' });
    expect(await window.admin.next()).toEqual({ event: 'expired' });
    expect(await server.devices.list()).toEqual([]);
  });

  it('rotate-key forces re-pairing', async () => {
    const server = await start();
    const { device } = await pairApproved(server);
    const oldKey = server.serverKey.publicKey;
    const session = await connectSession(server.url, device, oldKey);
    expect(await session.next()).toMatchObject({ type: 'ready' });

    const reply = await adminCommand(server.config.adminSocket, { cmd: 'rotate-key' });
    expect(reply).toEqual({ rotated: true, fingerprint: expect.stringMatching(/^[0-9A-F]{4}( [0-9A-F]{4}){7}$/) as string });
    expect(await session.next()).toMatchObject({ type: 'error', code: 'server_key_changed' });
    await expect(connectSession(server.url, device, oldKey)).rejects.toMatchObject({ code: 'bad_message' });
    expect(await server.devices.list()).toEqual([]);

    const window = await openPairingWindow(server.config.adminSocket);
    expect(window.token.serverPublicKey).not.toEqual(oldKey);
    const fresh = generateKeyPair();
    const pairing = pairDevice(server.url, window.token, fresh, 'Znova');
    expect(await window.admin.next()).toMatchObject({ event: 'request' });
    window.admin.send({ decision: 'approve' });
    expect((await pairing).status).toBe('approved');
    const again = await connectSession(server.url, fresh, window.token.serverPublicKey);
    expect(await again.next()).toMatchObject({ type: 'ready' });
  });

  it('admin socket has mode 0600', async () => {
    const server = await start();

    expect((await stat(server.config.adminSocket)).mode & 0o777).toBe(0o600);
  });

  it('answers malformed admin commands with an error', async () => {
    const server = await start();

    expect(await adminCommand(server.config.adminSocket, { cmd: 'explode' })).toMatchObject({ error: expect.any(String) as string });
    expect(await adminCommand(server.config.adminSocket, { cmd: 'pair', ttlMs: -1 })).toMatchObject({ error: expect.any(String) as string });
    expect(await adminCommand(server.config.adminSocket, { cmd: 'revoke' })).toMatchObject({ error: expect.any(String) as string });
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPairingSecret, encodePairingToken, fingerprint, parsePairingToken } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computerName, sanitizeDeviceName } from '../src/main/remote/computer-name';
import { DevicePairing, type PairingStep } from '../src/main/remote/device-pairing';
import { InsecureTestVault } from '../src/main/remote/insecure-test-vault';
import { EncryptedPairingFile } from '../src/main/remote/pairing-repository';
import { ServerConnector } from '../src/main/remote/server-connector';
import type { VaultAvailability } from '../src/main/remote/secret-vault';
import { freePort, startTestGateway, type TestGateway } from './support/gateway';

const DEVICE_NAME = 'Matúšov MacBook Pro';

let dir: string;
let gateway: TestGateway;
let repository: EncryptedPairingFile;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-device-pairing-'));
  repository = new EncryptedPairingFile(join(dir, 'server-pairing.json'), new InsecureTestVault());
  gateway = await startTestGateway();
});

afterEach(async () => {
  await gateway.close();
  await rm(dir, { recursive: true, force: true });
});

function pairing(availability: VaultAvailability = 'available'): DevicePairing {
  return new DevicePairing({
    pairings: repository,
    vault: new InsecureTestVault(availability),
    deviceName: () => Promise.resolve(DEVICE_NAME),
    clock: () => Date.parse('2026-10-26T09:30:00.000Z'),
    timeoutMs: 2000,
  });
}

function connector(): ServerConnector {
  return new ServerConnector({ pairings: repository, observer: { connected: () => undefined, failed: () => undefined }, clock: Date.now, timeoutMs: 2000 });
}

type RequestEvent = { event: 'request'; deviceName: string; deviceFingerprint: string; handshakeFingerprint: string };

describe('DevicePairing', () => {
  it('pairs after the operator approves the fingerprint the app shows', async () => {
    const window = await gateway.openPairingWindow();
    const steps: PairingStep[] = [];

    const outcome = pairing().pair(window.token, (step) => steps.push(step), new AbortController().signal);
    const request = (await window.admin.next()) as RequestEvent;
    window.admin.send({ decision: 'approve' });
    const result = await outcome;

    expect(request.deviceName).toBe(DEVICE_NAME);
    expect(steps).toEqual([
      { kind: 'connecting' },
      { kind: 'awaiting-approval', connectionFingerprint: request.handshakeFingerprint, deviceFingerprint: request.deviceFingerprint, deviceName: DEVICE_NAME },
    ]);
    expect(result.kind).toBe('paired');
    const stored = await repository.load();
    expect(stored).toMatchObject({ endpoint: gateway.url, deviceName: DEVICE_NAME, pairedAt: '2026-10-26T09:30:00.000Z' });
    expect(stored?.serverPublicKey).toEqual(gateway.server.serverKey.publicKey);
    expect(fingerprint(stored?.deviceKey.publicKey ?? new Uint8Array(0))).toBe(request.deviceFingerprint);
    expect(await window.admin.next()).toEqual({ event: 'paired', deviceId: stored?.deviceId });
    const ready = await connector().connect();
    ready.connection.close();
  });

  it('stores nothing when the operator rejects', async () => {
    const window = await gateway.openPairingWindow();

    const outcome = pairing().pair(window.token, () => undefined, new AbortController().signal);
    await window.admin.next();
    window.admin.send({ decision: 'reject' });

    expect(await outcome).toEqual({ kind: 'failed', failure: 'rejected' });
    expect(await repository.load()).toBeNull();
  });

  it('reports a closed pairing window', async () => {
    const window = await gateway.openPairingWindow();
    window.admin.close();
    await expect.poll(() => gateway.server.pairing.isOpen()).toBe(false);

    expect(await pairing().pair(window.token, () => undefined, new AbortController().signal)).toEqual({ kind: 'failed', failure: 'pairing-closed' });
  });

  it('rejects text that is not a pairing token without connecting', async () => {
    const steps: PairingStep[] = [];

    expect(await pairing().pair('cw1:abc', (step) => steps.push(step), new AbortController().signal)).toEqual({ kind: 'failed', failure: 'invalid-token' });
    expect(steps).toEqual([]);
  });

  it('reports an unreachable server', async () => {
    const window = await gateway.openPairingWindow();
    const token = encodePairingToken({ ...parsePairingToken(window.token), endpoint: `ws://127.0.0.1:${await freePort()}` });

    expect(await pairing().pair(token, () => undefined, new AbortController().signal)).toEqual({ kind: 'failed', failure: 'unreachable' });
    window.admin.close();
  });

  it('fails without storing for a token with the wrong secret', async () => {
    const window = await gateway.openPairingWindow();
    const token = encodePairingToken({ ...parsePairingToken(window.token), secret: createPairingSecret() });

    expect(await pairing().pair(token, () => undefined, new AbortController().signal)).toEqual({ kind: 'failed', failure: 'failed' });
    expect(gateway.server.pairing.isOpen()).toBe(true);
    window.admin.close();
  });

  it('cancels while waiting for the approval and the operator sees the device leave', async () => {
    const window = await gateway.openPairingWindow();
    const controller = new AbortController();

    const outcome = pairing().pair(window.token, () => undefined, controller.signal);
    await window.admin.next();
    controller.abort();

    expect(await outcome).toEqual({ kind: 'failed', failure: 'cancelled' });
    window.admin.send({ decision: 'approve' });
    expect(await window.admin.next()).toEqual({ event: 'abandoned' });
    expect(await repository.load()).toBeNull();
  });

  it('refuses before any network call without a secure key store', async () => {
    const window = await gateway.openPairingWindow();
    const steps: PairingStep[] = [];

    expect(await pairing('insecure').pair(window.token, (step) => steps.push(step), new AbortController().signal)).toEqual({ kind: 'failed', failure: 'storage-insecure' });
    expect(steps).toEqual([]);
    expect(gateway.server.pairing.isOpen()).toBe(true);
    window.admin.close();
  });
});

describe('device name', () => {
  it('removes control characters and keeps at most 64 characters', () => {
    expect(sanitizeDeviceName('  Mac\u0007Book\nPro  ')).toBe('Mac Book Pro');
    expect([...sanitizeDeviceName('ž'.repeat(80))]).toHaveLength(64);
    expect(sanitizeDeviceName('\u0001\u0002')).toBe('');
  });

  it('reads a usable computer name', async () => {
    const name = await computerName();

    expect(name.trim()).not.toBe('');
    expect([...name].length).toBeLessThanOrEqual(64);
  });
});

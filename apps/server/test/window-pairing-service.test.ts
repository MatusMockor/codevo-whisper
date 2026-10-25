import { generateKeyPair, parsePairingToken, type KeyPair } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileDeviceRepository } from '../src/devices/file-device-repository';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { connectAdmin, type AdminConnection } from '../src/admin/admin-client';
import { AdminPairingOperator } from '../src/admin/admin-pairing-operator';
import { LineChannel } from '../src/admin/line-channel';
import { WindowPairingService } from '../src/pairing/window-pairing-service';
import { createTempDir } from './support/temp-dir';

let dir: Awaited<ReturnType<typeof createTempDir>>;
let key: KeyPair;

async function adminOperator(): Promise<{ operator: AdminPairingOperator; admin: AdminConnection; close(): Promise<void> }> {
  const path = join(dir.path, 'operator.sock');
  const accepted = new Promise<Socket>((resolve) => {
    server = createServer(resolve);
  });
  await new Promise<void>((resolve) => server?.listen(path, resolve));
  const admin = await connectAdmin(path);
  const operator = new AdminPairingOperator(new LineChannel(await accepted));
  return {
    operator,
    admin,
    close: () =>
      new Promise<void>((resolve) => {
        admin.close();
        server?.close(() => resolve());
      }),
  };
}

let server: Server | undefined;

function service(): WindowPairingService {
  return new WindowPairingService({
    serverKey: () => key,
    endpoint: 'ws://127.0.0.1:8787',
    devices: new FileDeviceRepository(dir.path),
    clock: Date.now,
  });
}

beforeEach(async () => {
  dir = await createTempDir();
  key = generateKeyPair();
});

afterEach(async () => {
  await dir.remove();
});

describe('WindowPairingService during key rotation', () => {
  it('refuses to open a window while the server key rotates', async () => {
    const pairing = service();
    const connected = await adminOperator();
    pairing.beginRotation();

    expect(() => pairing.open(connected.operator)).toThrow(/rotation/);
    key = generateKeyPair();
    pairing.endRotation();
    const { token } = pairing.open(connected.operator);
    expect(parsePairingToken(token).serverPublicKey).toEqual(key.publicKey);
    pairing.close();
    await connected.close();
  });

  it('closes an open window when the rotation begins', async () => {
    const pairing = service();
    const connected = await adminOperator();
    pairing.open(connected.operator);
    pairing.beginRotation();

    expect(pairing.isOpen()).toBe(false);
    expect(pairing.currentSecret('127.0.0.1')).toBeNull();
    expect(await connected.admin.next()).toEqual({ event: 'expired' });
    pairing.endRotation();
    await connected.close();
  });
});

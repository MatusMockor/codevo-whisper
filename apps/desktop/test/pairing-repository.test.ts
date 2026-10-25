import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EncryptedPairingFile, type ServerPairing } from '../src/main/remote/pairing-repository';
import { InsecureTestVault } from '../src/main/remote/insecure-test-vault';
import { RecordingLogger } from './recording-logger';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-pairing-'));
  file = join(dir, 'server-pairing.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function pairing(): ServerPairing {
  return {
    deviceKey: generateKeyPair(),
    serverPublicKey: generateKeyPair().publicKey,
    endpoint: 'wss://whisper.example.com',
    deviceId: 'e255ea96',
    deviceName: 'MacBook Pro',
    pairedAt: '2026-10-26T08:00:00.000Z',
  };
}

describe('EncryptedPairingFile', () => {
  it('saves the pairing encrypted with mode 0600 and loads it in a new instance', async () => {
    const saved = pairing();
    await new EncryptedPairingFile(file, new InsecureTestVault('available')).save(saved);

    const loaded = await new EncryptedPairingFile(file, new InsecureTestVault('available')).load();

    expect(loaded).toEqual(saved);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain(Buffer.from(saved.deviceKey.privateKey).toString('base64url'));
    expect(text).not.toContain(Buffer.from(saved.deviceKey.privateKey).toString('base64'));
    expect(text).not.toContain('whisper.example.com');
    expect(text).not.toContain('e255ea96');
  });

  it('returns null without a file and after clear', async () => {
    const repository = new EncryptedPairingFile(file, new InsecureTestVault('available'));
    expect(await repository.load()).toBeNull();

    await repository.save(pairing());
    await repository.clear();

    expect(await repository.load()).toBeNull();
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats a corrupt or foreign file as no pairing and logs it', async () => {
    const logger = new RecordingLogger();
    await writeFile(file, '{"version":1,"sealed":"bm90IHNlYWxlZA"}');

    expect(await new EncryptedPairingFile(file, new InsecureTestVault('available'), logger).load()).toBeNull();
    expect(logger.errors).toHaveLength(1);

    await writeFile(file, 'not json');
    expect(await new EncryptedPairingFile(file, new InsecureTestVault('available'), logger).load()).toBeNull();
  });

  it('refuses to store keys without a secure storage backend', async () => {
    for (const availability of ['insecure', 'unavailable'] as const) {
      await expect(new EncryptedPairingFile(file, new InsecureTestVault(availability)).save(pairing())).rejects.toMatchObject({ kind: 'storage-insecure' });
    }
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not decrypt a pairing when the storage backend became insecure', async () => {
    await new EncryptedPairingFile(file, new InsecureTestVault('available')).save(pairing());

    await expect(new EncryptedPairingFile(file, new InsecureTestVault('insecure')).load()).rejects.toMatchObject({ kind: 'storage-insecure' });
  });

  it('applies saves and clears in the order they were requested', async () => {
    const repository = new EncryptedPairingFile(file, new InsecureTestVault('available'));
    const saved = pairing();

    await Promise.all([repository.save(saved), repository.clear()]);
    expect(await new EncryptedPairingFile(file, new InsecureTestVault('available')).load()).toBeNull();
    expect(await repository.load()).toBeNull();

    await Promise.all([repository.clear(), repository.save(saved)]);
    expect(await new EncryptedPairingFile(file, new InsecureTestVault('available')).load()).toEqual(saved);
  });
});

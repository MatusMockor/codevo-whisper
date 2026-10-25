import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publicKeyOf } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServerKeyStore } from '../src/keys/server-key-store';
import { createTempDir } from './support/temp-dir';

let dir: Awaited<ReturnType<typeof createTempDir>>;

beforeEach(async () => {
  dir = await createTempDir();
});

afterEach(async () => {
  await dir.remove();
});

describe('ServerKeyStore', () => {
  it('creates a key with mode 0600', async () => {
    const key = await new ServerKeyStore(dir.path).loadOrCreate();
    const info = await stat(join(dir.path, 'server-key.json'));

    expect(info.mode & 0o777).toBe(0o600);
    expect(key.publicKey).toEqual(publicKeyOf(key.privateKey));
  });

  it('returns the same key on second load', async () => {
    const first = await new ServerKeyStore(dir.path).loadOrCreate();
    const second = await new ServerKeyStore(dir.path).loadOrCreate();

    expect(second).toEqual(first);
  });

  it('refuses a world-readable key file', async () => {
    await new ServerKeyStore(dir.path).loadOrCreate();
    await chmod(join(dir.path, 'server-key.json'), 0o644);

    await expect(new ServerKeyStore(dir.path).loadOrCreate()).rejects.toThrow(/permissions/);
  });

  it('refuses a key file whose public key does not match the private key', async () => {
    const file = join(dir.path, 'server-key.json');
    await new ServerKeyStore(dir.path).loadOrCreate();
    const content = JSON.parse(await readFile(file, 'utf8')) as { privateKey: string; publicKey: string };
    await writeFile(file, JSON.stringify({ ...content, publicKey: Buffer.alloc(32, 1).toString('base64url') }), { mode: 0o600 });

    await expect(new ServerKeyStore(dir.path).loadOrCreate()).rejects.toThrow(/server key/);
  });

  it('rotate replaces the key', async () => {
    const store = new ServerKeyStore(dir.path);
    const original = await store.loadOrCreate();
    const rotated = await store.rotate();
    const info = await stat(join(dir.path, 'server-key.json'));

    expect(rotated.publicKey).not.toEqual(original.publicKey);
    expect(await new ServerKeyStore(dir.path).loadOrCreate()).toEqual(rotated);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it('creates the data directory when it is missing', async () => {
    const key = await new ServerKeyStore(join(dir.path, 'nested', 'data')).loadOrCreate();

    expect(key.privateKey).toHaveLength(32);
  });
});

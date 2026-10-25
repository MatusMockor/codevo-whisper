import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, ProtocolError } from '@codevo-whisper/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileIdentityStore, type Identity } from '../src/identity-store';

let dir: string;
let file: string;

function identity(overrides: Partial<Identity> = {}): Identity {
  return {
    deviceKey: generateKeyPair(),
    serverPublicKey: generateKeyPair().publicKey,
    endpoint: 'ws://127.0.0.1:8787',
    deviceId: '7f3a92c1',
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cw-identity-'));
  file = join(dir, 'config', 'identity.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileIdentityStore', () => {
  it('saves with mode 0600', async () => {
    await new FileIdentityStore(file).save(identity());

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('round-trips keys', async () => {
    const saved = identity();
    await new FileIdentityStore(file).save(saved);

    expect(await new FileIdentityStore(file).load()).toEqual(saved);
  });

  it('returns null when missing', async () => {
    expect(await new FileIdentityStore(file).load()).toBeNull();
  });

  it('refuses to overwrite a pinned server key with a different one', async () => {
    const store = new FileIdentityStore(file);
    const first = identity();
    await store.save(first);

    await expect(store.save(identity({ deviceKey: first.deviceKey }))).rejects.toBeInstanceOf(ProtocolError);
    await expect(store.save(identity({ deviceKey: first.deviceKey }))).rejects.toMatchObject({ code: 'server_key_changed' });
    await store.save({ ...first, deviceId: 'abcdef01' });
    expect((await store.load())?.deviceId).toBe('abcdef01');
  });
});

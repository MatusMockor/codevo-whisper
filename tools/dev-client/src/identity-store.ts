import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ProtocolError, publicKeyOf, type KeyPair } from '@codevo-whisper/protocol';

export type Identity = { deviceKey: KeyPair; serverPublicKey: Uint8Array; endpoint: string; deviceId: string };

export interface IdentityStore {
  load(): Promise<Identity | null>;
  save(identity: Identity): Promise<void>;
}

type StoredIdentity = { version: 1; devicePrivateKey: string; serverPublicKey: string; endpoint: string; deviceId: string };

const toText = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const fromText = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64url'));

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function decode(text: string): Identity {
  const stored = JSON.parse(text) as StoredIdentity;
  if (stored.version !== 1) {
    throw new Error('identity file has an unknown format');
  }
  const privateKey = fromText(stored.devicePrivateKey);
  return {
    deviceKey: { privateKey, publicKey: publicKeyOf(privateKey) },
    serverPublicKey: fromText(stored.serverPublicKey),
    endpoint: stored.endpoint,
    deviceId: stored.deviceId,
  };
}

function encode(identity: Identity): string {
  const stored: StoredIdentity = {
    version: 1,
    devicePrivateKey: toText(identity.deviceKey.privateKey),
    serverPublicKey: toText(identity.serverPublicKey),
    endpoint: identity.endpoint,
    deviceId: identity.deviceId,
  };
  return `${JSON.stringify(stored, null, 2)}\n`;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class FileIdentityStore implements IdentityStore {
  constructor(private readonly path: string) {}

  async load(): Promise<Identity | null> {
    try {
      return decode(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
  }

  async save(identity: Identity): Promise<void> {
    const existing = await this.load();
    if (existing !== null && !sameBytes(existing.serverPublicKey, identity.serverPublicKey)) {
      throw new ProtocolError('server_key_changed', `the pinned server key differs; delete ${this.path} to pair with the new server key`);
    }
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temp, encode(identity), { mode: 0o600, flag: 'wx' });
    await rename(temp, this.path);
  }
}

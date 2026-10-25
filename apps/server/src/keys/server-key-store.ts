import { join } from 'node:path';
import { generateKeyPair, publicKeyOf, type KeyPair } from '@codevo-whisper/protocol';
import { equalBytes, fromBase64url, toBase64url } from '../encoding';
import { ensurePrivateDir, readPrivateFile, writePrivateFileAtomic } from '../storage/private-file';

const FILE_NAME = 'server-key.json';
const KEY_BYTES = 32;

type StoredKey = { version: 1; privateKey: string; publicKey: string };

function isStoredKey(value: unknown): value is StoredKey {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && typeof candidate.privateKey === 'string' && typeof candidate.publicKey === 'string';
}

function decode(text: string): KeyPair {
  const parsed: unknown = JSON.parse(text);
  if (!isStoredKey(parsed)) {
    throw new Error('server key file has an unknown format');
  }
  const privateKey = fromBase64url(parsed.privateKey, KEY_BYTES, 'server private key');
  const publicKey = fromBase64url(parsed.publicKey, KEY_BYTES, 'server public key');
  if (!equalBytes(publicKeyOf(privateKey), publicKey)) {
    throw new Error('server key file is inconsistent: the public key does not match the private key');
  }
  return { privateKey, publicKey };
}

function encode(key: KeyPair): string {
  const stored: StoredKey = { version: 1, privateKey: toBase64url(key.privateKey), publicKey: toBase64url(key.publicKey) };
  return `${JSON.stringify(stored)}\n`;
}

export class ServerKeyStore {
  private readonly file: string;

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, FILE_NAME);
  }

  async loadOrCreate(): Promise<KeyPair> {
    await ensurePrivateDir(this.dataDir);
    const existing = await readPrivateFile(this.file, { requirePrivateMode: true });
    if (existing !== null) {
      return decode(existing);
    }
    return this.rotate();
  }

  async rotate(): Promise<KeyPair> {
    await ensurePrivateDir(this.dataDir);
    const key = generateKeyPair();
    await writePrivateFileAtomic(this.file, encode(key));
    return key;
  }
}

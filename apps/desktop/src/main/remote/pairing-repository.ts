import { rm } from 'node:fs/promises';
import type { KeyPair } from '@codevo-whisper/protocol';
import { writeFileAtomic } from '../fs/atomic-write';
import { readOptionalFile } from '../fs/read-optional-file';
import { consoleLogger, type Logger } from '../logging/logger';
import { decodePairing, encodePairing } from './pairing-format';
import { RemoteFailure } from './remote-failure';
import type { SecretVault } from './secret-vault';

export type ServerPairing = {
  deviceKey: KeyPair;
  serverPublicKey: Uint8Array;
  endpoint: string;
  deviceId: string;
  deviceName: string;
  pairedAt: string;
};

export interface PairingRepository {
  load(): Promise<ServerPairing | null>;
  save(pairing: ServerPairing): Promise<void>;
  clear(): Promise<void>;
}

type SealedFile = { version: 1; sealed: string };

function parseSealed(text: string): Uint8Array {
  const value = JSON.parse(text) as Partial<SealedFile>;
  if (value.version !== 1 || typeof value.sealed !== 'string') {
    throw new Error('the pairing file has an unknown format');
  }
  return new Uint8Array(Buffer.from(value.sealed, 'base64'));
}

export class EncryptedPairingFile implements PairingRepository {
  private cached: ServerPairing | null | undefined;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly vault: SecretVault,
    private readonly logger: Logger = consoleLogger,
  ) {}

  async load(): Promise<ServerPairing | null> {
    if (this.cached !== undefined) {
      return this.cached;
    }
    const text = await readOptionalFile(this.file);
    if (text === null) {
      this.cached = null;
      return null;
    }
    this.assertSecure();
    this.cached = this.decode(text);
    return this.cached;
  }

  async save(pairing: ServerPairing): Promise<void> {
    this.assertSecure();
    const sealed: SealedFile = { version: 1, sealed: Buffer.from(this.vault.seal(encodePairing(pairing))).toString('base64') };
    return this.serialize(async () => {
      await writeFileAtomic(this.file, `${JSON.stringify(sealed)}\n`);
      this.cached = pairing;
    });
  }

  clear(): Promise<void> {
    return this.serialize(async () => {
      await rm(this.file, { force: true });
      this.cached = null;
    });
  }

  private serialize(write: () => Promise<void>): Promise<void> {
    const run = this.writes.then(write);
    this.writes = run.catch(() => undefined);
    return run;
  }

  private assertSecure(): void {
    if (this.vault.availability() === 'available') {
      return;
    }
    throw new RemoteFailure('storage-insecure', 'no secure storage for the device key is available');
  }

  private decode(text: string): ServerPairing | null {
    try {
      return decodePairing(this.vault.open(parseSealed(text)));
    } catch (error) {
      this.logger.error('The server pairing could not be read, treating the device as unpaired', error);
      return null;
    }
  }
}

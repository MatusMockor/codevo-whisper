import { rm } from 'node:fs/promises';
import type { AiKeyState } from '../../shared/ai';
import { writeFileAtomic } from '../fs/atomic-write';
import { readOptionalFile } from '../fs/read-optional-file';
import { consoleLogger, type Logger } from '../logging/logger';
import type { SecretVault } from '../remote/secret-vault';

type SealedFile = { version: 1; sealed: string };

function parseSealed(text: string): Uint8Array {
  const value = JSON.parse(text) as Partial<SealedFile>;
  if (value.version !== 1 || typeof value.sealed !== 'string') {
    throw new Error('the AI key file has an unknown format');
  }
  return new Uint8Array(Buffer.from(value.sealed, 'base64'));
}

export class AiKeyStore {
  private cached: string | null | undefined;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly vault: SecretVault,
    private readonly logger: Logger = consoleLogger,
  ) {}

  async state(): Promise<AiKeyState> {
    if (this.vault.availability() !== 'available') {
      return 'vault-unavailable';
    }
    return (await this.get()) === null ? 'none' : 'stored';
  }

  async get(): Promise<string | null> {
    if (this.vault.availability() !== 'available') {
      return null;
    }
    if (this.cached === undefined) {
      this.cached = await this.read();
    }
    return this.cached;
  }

  set(key: string | null): Promise<AiKeyState> {
    const write = this.writes.then(async () => {
      await (key === null ? rm(this.file, { force: true }) : this.write(key));
      this.cached = key;
    });
    this.writes = write.catch(() => undefined);
    return write.then(() => this.state());
  }

  private async write(key: string): Promise<void> {
    if (this.vault.availability() !== 'available') {
      throw new Error('no secure storage for the AI key is available');
    }
    const sealed: SealedFile = { version: 1, sealed: Buffer.from(this.vault.seal(key)).toString('base64') };
    await writeFileAtomic(this.file, `${JSON.stringify(sealed)}\n`);
  }

  private async read(): Promise<string | null> {
    try {
      const text = await readOptionalFile(this.file);
      return text === null ? null : this.vault.open(parseSealed(text));
    } catch (error) {
      this.logger.error('The AI key could not be read, continuing without it', error instanceof Error ? error.name : 'unknown');
      return null;
    }
  }
}

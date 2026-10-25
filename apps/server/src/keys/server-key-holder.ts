import type { KeyPair } from '@codevo-whisper/protocol';
import type { ServerKeyStore } from './server-key-store';

export class ServerKeyHolder {
  private constructor(
    private readonly store: ServerKeyStore,
    private key: KeyPair,
  ) {}

  static async load(store: ServerKeyStore): Promise<ServerKeyHolder> {
    return new ServerKeyHolder(store, await store.loadOrCreate());
  }

  current(): KeyPair {
    return this.key;
  }

  async rotate(): Promise<KeyPair> {
    this.key = await this.store.rotate();
    return this.key;
  }
}

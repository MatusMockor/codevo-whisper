import { InsecureTestVault } from '../../src/main/remote/insecure-test-vault';
import type { SecretVault, VaultAvailability } from '../../src/main/remote/secret-vault';

const TAG_OFFSET = 12;

export type KeychainState = VaultAvailability | 'cannot-decrypt';

export class FlakyKeychain implements SecretVault {
  state: KeychainState = 'available';
  private readonly keychain = new InsecureTestVault('available');

  availability(): VaultAvailability {
    return this.state === 'cannot-decrypt' ? 'available' : this.state;
  }

  seal(text: string): Uint8Array {
    return this.keychain.seal(text);
  }

  open(sealed: Uint8Array): string {
    return this.keychain.open(this.state === 'cannot-decrypt' ? withBrokenTag(sealed) : sealed);
  }
}

function withBrokenTag(sealed: Uint8Array): Uint8Array {
  const broken = new Uint8Array(sealed);
  broken[TAG_OFFSET] = (broken[TAG_OFFSET] ?? 0) ^ 0xff;
  return broken;
}


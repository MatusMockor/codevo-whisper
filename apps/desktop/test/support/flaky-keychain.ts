import { InsecureTestVault } from '../../src/main/remote/insecure-test-vault';
import type { SecretVault, VaultAvailability } from '../../src/main/remote/secret-vault';

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
    if (this.state === 'cannot-decrypt') {
      throw new Error('the keychain refused to decrypt the item');
    }
    return this.keychain.open(sealed);
  }
}

import { safeStorage } from 'electron';
import type { SecretVault, VaultAvailability } from './secret-vault';

const INSECURE_LINUX_BACKENDS: ReadonlySet<string> = new Set(['basic_text', 'unknown']);

export class SafeStorageVault implements SecretVault {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  availability(): VaultAvailability {
    if (!safeStorage.isEncryptionAvailable()) {
      return 'unavailable';
    }
    if (this.platform === 'linux' && INSECURE_LINUX_BACKENDS.has(safeStorage.getSelectedStorageBackend())) {
      return 'insecure';
    }
    return 'available';
  }

  seal(text: string): Uint8Array {
    return new Uint8Array(safeStorage.encryptString(text));
  }

  open(sealed: Uint8Array): string {
    return safeStorage.decryptString(Buffer.from(sealed));
  }
}

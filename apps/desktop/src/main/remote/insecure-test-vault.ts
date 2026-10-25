import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SecretVault, VaultAvailability } from './secret-vault';

const KEY = createHash('sha256').update('codevo-whisper insecure test vault').digest();
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class InsecureTestVault implements SecretVault {
  constructor(private readonly state: VaultAvailability = 'available') {}

  availability(): VaultAvailability {
    return this.state;
  }

  seal(text: string): Uint8Array {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', KEY, iv);
    const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), body]));
  }

  open(sealed: Uint8Array): string {
    const bytes = Buffer.from(sealed);
    const decipher = createDecipheriv('aes-256-gcm', KEY, bytes.subarray(0, IV_BYTES));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  }
}

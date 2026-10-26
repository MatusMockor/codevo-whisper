import type { VaultAvailability } from '../../shared/server';

export type { VaultAvailability } from '../../shared/server';

export interface SecretVault {
  availability(): VaultAvailability;
  seal(text: string): Uint8Array;
  open(sealed: Uint8Array): string;
}

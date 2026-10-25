export type VaultAvailability = 'available' | 'insecure' | 'unavailable';

export interface SecretVault {
  availability(): VaultAvailability;
  seal(text: string): Uint8Array;
  open(sealed: Uint8Array): string;
}

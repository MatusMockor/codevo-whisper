export type VaultKind = 'safe-storage' | 'insecure-test';

export type VaultContext = { e2e: boolean; isPackaged: boolean };

export function vaultKind({ e2e, isPackaged }: VaultContext): VaultKind {
  if (isPackaged || !e2e) {
    return 'safe-storage';
  }
  return 'insecure-test';
}

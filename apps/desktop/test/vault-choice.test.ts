import { describe, expect, it } from 'vitest';
import { vaultKind } from '../src/main/remote/vault-choice';

describe('vaultKind', () => {
  it('uses the system key store in every packaged build, even with e2e hooks requested', () => {
    expect(vaultKind({ e2e: true, isPackaged: true })).toBe('safe-storage');
    expect(vaultKind({ e2e: false, isPackaged: true })).toBe('safe-storage');
  });

  it('uses the test vault only for unpackaged e2e runs', () => {
    expect(vaultKind({ e2e: true, isPackaged: false })).toBe('insecure-test');
    expect(vaultKind({ e2e: false, isPackaged: false })).toBe('safe-storage');
  });
});

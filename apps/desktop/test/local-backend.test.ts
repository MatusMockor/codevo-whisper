import { expect, it } from 'vitest';
import { localBackend } from '../src/main/engines/local-backend';

it('maps Linux acceleration to upstream AUTO and preserves Mac choices', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    for (const arch of ['arm64', 'x64'] as const) {
      expect(localBackend(arch, 'cpu', platform)).toBe('cpu');
      expect(localBackend(arch, 'gpu', platform)).toBe(platform === 'linux' ? 'auto' : platform === 'darwin' ? 'metal' : 'cpu');
      expect(localBackend(arch, 'auto', platform)).toBe(platform === 'linux' ? 'auto' : platform === 'darwin' && arch === 'arm64' ? 'metal' : 'cpu');
    }
  }
});

import { expect, it } from 'vitest';
import { localBackend } from '../src/main/engines/local-backend';

it('maps Auto, GPU and CPU per Mac architecture, with CPU only elsewhere', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    for (const arch of ['arm64', 'x64'] as const) {
      expect(localBackend(arch, 'cpu', platform)).toBe('cpu');
      expect(localBackend(arch, 'gpu', platform)).toBe(platform === 'darwin' ? 'metal' : 'cpu');
      expect(localBackend(arch, 'auto', platform)).toBe(platform === 'darwin' && arch === 'arm64' ? 'metal' : 'cpu');
    }
  }
});

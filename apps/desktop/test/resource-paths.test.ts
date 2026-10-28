import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWorkerBinary } from '../src/main/engines/transcribe-binary';
import { resolveModelCatalog } from '../src/main/models/catalog-path';

describe('resolveWorkerBinary', () => {
  it('uses the bundled resources when packaged', () => {
    const binary = resolveWorkerBinary({ isPackaged: true, resourcesPath: '/App/Contents/Resources', appPath: '/ignored', arch: 'arm64' });

    expect(binary).toBe(join('/App/Contents/Resources', 'bin', 'arm64', 'cw-stt-worker'));
  });

  it('uses the app resources folder in development', () => {
    const binary = resolveWorkerBinary({ isPackaged: false, resourcesPath: '/ignored', appPath: '/repo/apps/desktop', arch: 'x64' });

    expect(binary).toBe(join('/repo/apps/desktop', 'resources', 'bin', 'x64', 'cw-stt-worker'));
  });
});

describe('resolveModelCatalog', () => {
  it('uses the bundled catalog when packaged', () => {
    expect(resolveModelCatalog({ isPackaged: true, resourcesPath: '/App/Contents/Resources', appPath: '/ignored' })).toBe(
      join('/App/Contents/Resources', 'model-catalog.json'),
    );
  });

  it('uses the app resources folder in development', () => {
    expect(resolveModelCatalog({ isPackaged: false, resourcesPath: '/ignored', appPath: '/repo/apps/desktop' })).toBe(
      join('/repo/apps/desktop', 'resources', 'model-catalog.json'),
    );
  });
});

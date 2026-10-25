import { describe, expect, it } from 'vitest';
import { loadSttConfig } from '../src/config';

describe('loadSttConfig', () => {
  it('uses defaults', () => {
    expect(loadSttConfig({})).toEqual({
      binary: '/opt/transcribe/bin/transcribe-cli',
      model: '/models/parakeet-ultra-F16.gguf',
      backend: 'vulkan',
      threads: 4,
      port: 8001,
      host: '0.0.0.0',
    });
  });

  it('reads overrides', () => {
    expect(
      loadSttConfig({ STT_BINARY: '/bin/x', STT_MODEL_PATH: '/m.gguf', STT_BACKEND: 'cpu', STT_THREADS: '8', STT_PORT: '9001', STT_HOST: '127.0.0.1' }),
    ).toEqual({ binary: '/bin/x', model: '/m.gguf', backend: 'cpu', threads: 8, port: 9001, host: '127.0.0.1' });
  });

  it('rejects an unknown backend and invalid numbers', () => {
    expect(() => loadSttConfig({ STT_BACKEND: 'cuda' })).toThrow(/STT_BACKEND/);
    expect(() => loadSttConfig({ STT_THREADS: '0' })).toThrow(/STT_THREADS/);
    expect(() => loadSttConfig({ STT_PORT: 'abc' })).toThrow(/STT_PORT/);
  });
});

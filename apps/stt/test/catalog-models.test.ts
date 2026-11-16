import { describe, expect, it } from 'vitest';
import { pinnedCatalog } from '../src/catalog-models';
import { loadSttConfig } from '../src/config';

function resolveUrl(repo: string, revision: string, file: string): string {
  return `https://huggingface.co/handy-computer/${repo}/resolve/${revision}/${file}`;
}

const PARAKEET_REVISION = 'a1539be1b849ea7463b88343e5277b373d0c4ea9';
const WHISPER_REVISION = '274ad1d1cf680b7ee53cc70f78461394cd3a344b';
const TURBO_REVISION = '18ada752005f5fddef499256f9a458d0b37a203a';

describe('pinned catalog', () => {
  it('pins the default model and the five downloadable alternatives', () => {
    const catalog = pinnedCatalog(loadSttConfig({}));

    expect(catalog.primary).toEqual({
      id: 'parakeet-ultra',
      name: 'Parakeet Ultra (F16)',
      family: 'parakeet',
      url: resolveUrl('parakeet-ultra-gguf', PARAKEET_REVISION, 'parakeet-ultra-F16.gguf'),
      sha256: 'cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d',
      size: 1_256_724_448,
      target: '/models/parakeet-ultra-F16.gguf',
    });
    expect(catalog.alternatives).toEqual([
      {
        id: 'parakeet-ultra-q8',
        name: 'Parakeet Ultra (Q8)',
        family: 'parakeet',
        url: resolveUrl('parakeet-ultra-gguf', PARAKEET_REVISION, 'parakeet-ultra-Q8_0.gguf'),
        sha256: '007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59',
        size: 740_363_168,
        target: '/models/parakeet-ultra-Q8_0.gguf',
      },
      {
        id: 'whisper-large-v3',
        name: 'Whisper Large v3 (F16)',
        family: 'whisper',
        url: resolveUrl('whisper-large-v3-gguf', WHISPER_REVISION, 'whisper-large-v3-F16.gguf'),
        sha256: 'e633ab1d74b0e98f4f57daedaee34291297dbbf01389bda3d890766600c1c584',
        size: 3_107_236_640,
        target: '/models/whisper-large-v3-F16.gguf',
      },
      {
        id: 'whisper-large-v3-q8',
        name: 'Whisper Large v3 (Q8)',
        family: 'whisper',
        url: resolveUrl('whisper-large-v3-gguf', WHISPER_REVISION, 'whisper-large-v3-Q8_0.gguf'),
        sha256: '2fa1a5f179f8a511a53e2108db270aa4af3ce08cd976af4180e2854666bb4ba3',
        size: 1_668_741_440,
        target: '/models/whisper-large-v3-Q8_0.gguf',
      },
      {
        id: 'whisper-large-v3-turbo',
        name: 'Whisper Large v3 Turbo (F16)',
        family: 'whisper',
        url: resolveUrl('whisper-large-v3-turbo-gguf', TURBO_REVISION, 'whisper-large-v3-turbo-F16.gguf'),
        sha256: 'c8506ddfa3d4eb9279170d722a75422db00dbdbd7618531bbb81926e0598eb8f',
        size: 1_625_935_488,
        target: '/models/whisper-large-v3-turbo-F16.gguf',
      },
      {
        id: 'whisper-large-v3-turbo-q8',
        name: 'Whisper Large v3 Turbo (Q8)',
        family: 'whisper',
        url: resolveUrl('whisper-large-v3-turbo-gguf', TURBO_REVISION, 'whisper-large-v3-turbo-Q8_0.gguf'),
        sha256: '257aa7ec9121c22c167d5e2c49e3e76b4ba0e6e27ebc13074eba0a80f8190220',
        size: 886_381_728,
        target: '/models/whisper-large-v3-turbo-Q8_0.gguf',
      },
    ]);
  });

  it('places downloads in the models directory and keeps the configured default and Whisper paths', () => {
    const catalog = pinnedCatalog(loadSttConfig({ STT_MODELS_DIR: '/data/models', STT_MODEL_PATH: '/opt/parakeet-ultra-q8.gguf', STT_WHISPER_MODEL_PATH: '/w/whisper.gguf' }));

    expect(catalog.primary).toMatchObject({ target: '/opt/parakeet-ultra-q8.gguf', name: 'parakeet-ultra-q8' });
    expect(catalog.alternatives.map((model) => model.target)).toEqual([
      '/data/models/parakeet-ultra-Q8_0.gguf',
      '/w/whisper.gguf',
      '/data/models/whisper-large-v3-Q8_0.gguf',
      '/data/models/whisper-large-v3-turbo-F16.gguf',
      '/data/models/whisper-large-v3-turbo-Q8_0.gguf',
    ]);
  });

  it('rejects two catalog models configured at the same path', () => {
    expect(() => pinnedCatalog(loadSttConfig({ STT_WHISPER_MODEL_PATH: '/models/whisper-large-v3-turbo-F16.gguf' }))).toThrow(
      'catalog model targets must be unique: /models/whisper-large-v3-turbo-F16.gguf is the target of both whisper-large-v3 and whisper-large-v3-turbo',
    );
  });
});

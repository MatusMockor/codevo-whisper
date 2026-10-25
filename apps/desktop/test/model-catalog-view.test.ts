import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { catalogView } from '../src/main/models/catalog-view';
import { loadCatalog } from '../src/main/models/model-catalog';

const BUNDLED = fileURLToPath(new URL('../resources/model-catalog.json', import.meta.url));

describe('catalogView', () => {
  it('lists every catalog model with roles, size and license and the Apple Silicon default', () => {
    const view = catalogView(loadCatalog(BUNDLED), { os: 'darwin', arch: 'arm64', gpu: false });

    expect(view.defaultModelId).toBe('parakeet-ultra-q8');
    expect(view.models.map((model) => [model.id, model.roleLabels])).toEqual([
      ['parakeet-ultra-q8', ['Odporúčaný', 'Najrýchlejší', 'Najpresnejší pre angličtinu']],
      ['canary-1b-v2-q8', ['Najpresnejší pre slovenčinu a češtinu']],
      ['parakeet-ultra-q4', ['Pre slabší počítač']],
      ['tc-whisper-turbo-q8', ['Pre ďalšie jazyky (99)']],
    ]);
    expect(view.models[1]).toEqual({
      id: 'canary-1b-v2-q8',
      name: 'Canary 1B v2',
      quantization: 'Q8_0',
      sizeBytes: 1144290016,
      license: 'CC-BY-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      languageHint: 'required',
      roleLabels: ['Najpresnejší pre slovenčinu a češtinu'],
    });
  });

  it('defaults Intel Macs to the small model', () => {
    expect(catalogView(loadCatalog(BUNDLED), { os: 'darwin', arch: 'x64', gpu: false }).defaultModelId).toBe('parakeet-ultra-q4');
  });
});

import { describe, expect, it } from 'vitest';
import { loadSttConfig } from '../src/config';
import { createEngine } from '../src/create-engine';
import { modelName } from '../src/model-names';

describe('modelName', () => {
  it.each([
    ['/models/parakeet-ultra-F16.gguf', 'Parakeet Ultra (F16)'],
    ['/models/canary-1b-v2-Q8_0.gguf', 'Canary 1B v2 (Q8)'],
    ['/models/lang-id-voxlingua107-ecapa-Q8_0.gguf', 'VoxLingua107 (rozpoznanie jazyka)'],
    ['/elsewhere/canary-1b-v2-Q8_0.gguf', 'Canary 1B v2 (Q8)'],
  ])('names the pinned model %s', (path, name) => {
    expect(modelName(path)).toBe(name);
  });

  it.each([
    ['/models/parakeet-ultra-Q4_K.gguf', 'parakeet-ultra-Q4_K'],
    ['/models/custom-model', 'custom-model'],
    ['relative/whisper.bin', 'whisper.bin'],
  ])('falls back to the base name of the unknown file %s', (path, name) => {
    expect(modelName(path)).toBe(name);
  });
});

describe('engine models', () => {
  it('names all three models when routing is available', async () => {
    const engine = createEngine(loadSttConfig({ STT_ENGINE: 'cli', STT_CONDITIONED_MODEL_PATH: '/models/canary-1b-v2-F16.gguf' }), { routing: true });

    expect(engine.models).toEqual({ transcription: 'Parakeet Ultra (F16)', conditioned: 'canary-1b-v2-F16', languageId: 'VoxLingua107 (rozpoznanie jazyka)' });
    await engine.close();
  });

  it('reports no conditioned or language ID model when the language models are missing', async () => {
    const engine = createEngine(loadSttConfig({ STT_ENGINE: 'cli' }), { routing: false });

    expect(engine.models).toEqual({ transcription: 'Parakeet Ultra (F16)', conditioned: null, languageId: null });
    await engine.close();
  });
});

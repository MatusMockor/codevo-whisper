import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CatalogError } from '../src/main/models/catalog-error';
import { huggingFaceUrl, loadCatalog } from '../src/main/models/model-catalog';

const BUNDLED = fileURLToPath(new URL('../resources/model-catalog.json', import.meta.url));

type RawCatalog = { schema: number; defaults: Record<string, { model: string; backend: string }>; models: Array<Record<string, unknown>>; diarizer?: Record<string, unknown>; languageId?: Record<string, unknown> };

let scratch: string;

async function writeVariant(change: (raw: RawCatalog) => void): Promise<string> {
  const raw = JSON.parse(await readFile(BUNDLED, 'utf8')) as RawCatalog;
  change(raw);
  const file = join(scratch, 'catalog.json');
  await writeFile(file, JSON.stringify(raw));
  return file;
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'cw-catalog-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('loadCatalog', () => {
  it('loads the four approved models in order', () => {
    const catalog = loadCatalog(BUNDLED);

    expect(catalog.models.map((model) => model.id)).toEqual(['parakeet-ultra-q8', 'canary-1b-v2-q8', 'parakeet-ultra-q4', 'tc-whisper-turbo-q8']);
    expect(catalog.models[0]).toMatchObject({
      name: 'Parakeet Ultra',
      engine: 'transcribe.cpp',
      sizeBytes: 740363168,
      minRamBytes: 2147483648,
      license: 'CC-BY-4.0',
      sha256: '007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59',
      roles: ['recommended', 'fastest', 'best-english'],
      roleLabels: ['Odporúčaný', 'Najrýchlejší', 'Najpresnejší pre angličtinu'],
    });
  });

  it('loads the Sortformer diarizer as its own entry, never as a dictation model', () => {
    const catalog = loadCatalog(BUNDLED);

    expect(catalog.diarizer).toMatchObject({
      id: 'sortformer-4spk-v2-1-q8',
      name: 'Sortformer 4spk v2.1',
      sizeBytes: 139310336,
      license: 'NVIDIA Open Model License',
      sha256: 'a5dacdc650790266c7a362e54e6bf51952015487edaa606c4e11632bc32442a9',
      roles: ['diarizer'],
    });
    expect(huggingFaceUrl(catalog.diarizer.source)).toBe(
      'https://huggingface.co/handy-computer/diar_streaming_sortformer_4spk-v2.1-gguf/resolve/60ebab3ef7cae9869be0abcde13360347e96ba03/diar_streaming_sortformer_4spk-v2.1-Q8_0.gguf',
    );
    expect(catalog.models.map((model) => model.id)).not.toContain(catalog.diarizer.id);
  });

  it('loads the language ID model as its own pinned entry, never as a dictation model', () => {
    const catalog = loadCatalog(BUNDLED);

    expect(catalog.languageId).toMatchObject({
      id: 'langid-voxlingua107-q8',
      name: 'VoxLingua107 ECAPA',
      quantization: 'Q8_0',
      sizeBytes: 26693632,
      license: 'Apache-2.0',
      sha256: '063e6cb0af3d53085fc7d68356dfde5ecee2ffa7bc79855f7e4ff930081bfe3a',
      roles: ['language-id'],
    });
    expect(huggingFaceUrl(catalog.languageId.source)).toBe(
      'https://huggingface.co/handy-computer/lang-id-voxlingua107-ecapa-gguf/resolve/e59f0f3847e77723b7d58447ef9456fa0c7e9436/lang-id-voxlingua107-ecapa-Q8_0.gguf',
    );
    expect(catalog.models.map((model) => model.id)).not.toContain(catalog.languageId.id);
  });

  it('pins the Canary file the server routes with, so local and server routing give the same text', () => {
    const canary = loadCatalog(BUNDLED).models.find((model) => model.id === 'canary-1b-v2-q8');

    expect(canary).toMatchObject({
      sizeBytes: 1144290016,
      sha256: '224f83d1bc487b3303b495a7d6874912fdece93de19d1a04b550829c30a5d289',
      source: { repo: 'handy-computer/canary-1b-v2-gguf', revision: '692af661b140183b60e44f55ad03c59e1e77d078', file: 'canary-1b-v2-Q8_0.gguf' },
    });
  });

  it('builds the Hugging Face URL', () => {
    const [parakeet] = loadCatalog(BUNDLED).models;

    expect(parakeet && huggingFaceUrl(parakeet.source)).toBe(
      'https://huggingface.co/handy-computer/parakeet-ultra-gguf/resolve/a1539be1b849ea7463b88343e5277b373d0c4ea9/parakeet-ultra-Q8_0.gguf',
    );
  });

  it('default model is parakeet-ultra-q8 on arm64 and parakeet-ultra-q4 on x64', () => {
    const catalog = loadCatalog(BUNDLED);

    expect(catalog.defaultModelId({ os: 'darwin', arch: 'arm64', gpu: true })).toBe('parakeet-ultra-q8');
    expect(catalog.defaultModelId({ os: 'darwin', arch: 'x64', gpu: true })).toBe('parakeet-ultra-q4');
    expect(catalog.defaultModelId({ os: 'linux', arch: 'x64', gpu: false })).toBe('parakeet-ultra-q4');
    expect(catalog.defaultModelId({ os: 'linux', arch: 'arm64', gpu: true })).toBe('parakeet-ultra-q8');
  });

  it('reports the language hint of every model', () => {
    const catalog = loadCatalog(BUNDLED);

    expect(catalog.models.map((model) => catalog.languageHint(model.id))).toEqual(['ignored', 'required', 'ignored', 'optional']);
    expect(() => catalog.languageHint('unknown')).toThrow(CatalogError);
  });

  it('rejects an entry without sha256', async () => {
    const file = await writeVariant((raw) => {
      delete raw.models[1]?.['sha256'];
    });

    expect(() => loadCatalog(file)).toThrow(/canary-1b-v2-q8.*sha256/);
  });

  it('rejects malformed fields', async () => {
    const variants: Array<[(raw: RawCatalog) => void, RegExp]> = [
      [(raw) => void (raw.models[0] = { ...raw.models[0], sha256: 'ABC' }), /sha256/],
      [(raw) => void (raw.models[0] = { ...raw.models[0], sizeBytes: -1 }), /sizeBytes/],
      [(raw) => void (raw.models[0] = { ...raw.models[0], languageHint: 'maybe' }), /languageHint/],
      [(raw) => void (raw.models[0] = { ...raw.models[0], id: '../escape' }), /id/],
      [(raw) => void (raw.models[0] = { ...raw.models[0], roleLabels: ['Odporúčaný'] }), /roleLabels/],
      [(raw) => void (raw.models[0] = { ...raw.models[0], source: { repo: 'a/b', revision: 'main', file: 'x.gguf' } }), /revision/],
      [(raw) => void (raw.models[0] = { ...raw.models[0], source: { repo: 'a/b', revision: 'a'.repeat(40), file: '../x.gguf' } }), /file/],
      [(raw) => void (raw.models[2] = { ...raw.models[2], id: 'parakeet-ultra-q8' }), /duplicate/],
      [(raw) => void (raw.defaults['darwin-x64'] = { model: 'missing', backend: 'cpu' }), /darwin-x64/],
      [(raw) => void delete raw.defaults['linux-cpu'], /linux-cpu/],
      [(raw) => void (raw.schema = 2), /schema/],
      [(raw) => void (raw.defaults['linux-cpu'] = { model: 'sortformer-4spk-v2-1-q8', backend: 'cpu' }), /linux-cpu/],
      [(raw) => void (raw.diarizer = { ...raw.diarizer, sha256: 'ABC' }), /sortformer-4spk-v2-1-q8.*sha256/],
      [(raw) => void delete raw.diarizer, /diarizer/],
      [(raw) => void (raw.languageId = { ...raw.languageId, sha256: 'ABC' }), /langid-voxlingua107-q8.*sha256/],
      [(raw) => void delete raw.languageId, /languageId/],
    ];
    for (const [change, message] of variants) {
      const file = await writeVariant(change);
      expect(() => loadCatalog(file), String(message)).toThrow(message);
    }
  });

  it('rejects a file that is not JSON', async () => {
    const file = join(scratch, 'broken.json');
    await writeFile(file, '{');

    expect(() => loadCatalog(file)).toThrow(CatalogError);
  });
});

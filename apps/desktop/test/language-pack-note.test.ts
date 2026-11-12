import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../src/main/models/catalog-entry';
import { modelInfo } from '../src/main/models/catalog-view';
import { loadCatalog } from '../src/main/models/model-catalog';
import { languagePackNote } from '../src/renderer/settings/language-pack-note';
import type { LanguagePackView, ModelInfo, ModelStatus } from '../src/shared/models';

const BUNDLED = fileURLToPath(new URL('../resources/model-catalog.json', import.meta.url));
const catalog = loadCatalog(BUNDLED);
const canary = catalog.conditionedModel();
const parakeet = modelInfo(catalog.models.find((entry) => entry.id === 'parakeet-ultra-q8') as CatalogEntry);
const OFFER = 'Pre výber jazykov treba stiahnuť Canary 1B v2 (1,1 GB) a rozpoznávanie jazyka (27 MB).';

type PartState = { status: ModelStatus; receivedBytes?: number };

function part(entry: CatalogEntry, { status, receivedBytes }: PartState) {
  const received = receivedBytes ?? (status === 'ready' ? entry.sizeBytes : 0);
  return { model: modelInfo(entry), state: { id: entry.id, status, receivedBytes: received, totalBytes: entry.sizeBytes } };
}

function pack(conditioned: PartState, languageId: PartState, enoughMemory = true): LanguagePackView {
  return { conditioned: part(canary, conditioned), languageId: part(catalog.languageId, languageId), requiredRamBytes: 4_563_402_752, enoughMemory };
}

const MISSING = pack({ status: 'not-downloaded' }, { status: 'not-downloaded' });

describe('local language pack note under Jazyky diktovania', () => {
  it('offers the download of both models with their real sizes', () => {
    expect(languagePackNote(MISSING, ['local'], parakeet)).toEqual({ text: OFFER, warn: false, download: 'offer', progress: null });
    expect(languagePackNote(pack({ status: 'ready' }, { status: 'broken' }), ['server', 'local'], parakeet)).toMatchObject({ text: OFFER, download: 'offer' });
    expect(languagePackNote(MISSING, ['local'], null)).toMatchObject({ download: 'offer' });
  });

  it('shows the progress over both files while they download', () => {
    const downloading = pack({ status: 'downloading', receivedBytes: 572_145_008 }, { status: 'ready' });
    const note = languagePackNote(downloading, ['local'], parakeet);

    expect(note).toMatchObject({ warn: false, download: 'busy' });
    expect(note?.progress).toBeCloseTo((572_145_008 + 26_693_632) / (1_144_290_016 + 26_693_632));
    expect(note?.text).toBe('Sťahujú sa modely pre výber jazykov, 51 %.');
  });

  it('explains instead of offering when the computer has too little memory', () => {
    expect(languagePackNote(pack({ status: 'not-downloaded' }, { status: 'not-downloaded' }, false), ['local'], parakeet)).toEqual({
      text: 'Výber jazykov na tomto počítači nie je dostupný. Potrebuje aspoň 4,6 GB pamäte.',
      warn: true,
      download: 'none',
      progress: null,
    });
  });

  it('says nothing when the local engine is not on the route, the pack is ready or the active model is conditioned', () => {
    const canaryInfo: ModelInfo = modelInfo(canary);
    expect(languagePackNote(MISSING, ['server'], parakeet)).toBeNull();
    expect(languagePackNote(pack({ status: 'ready' }, { status: 'ready' }), ['local'], parakeet)).toBeNull();
    expect(languagePackNote(MISSING, ['local'], canaryInfo)).toBeNull();
    expect(languagePackNote(null, ['local'], parakeet)).toBeNull();
  });
});

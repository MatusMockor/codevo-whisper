import { describe, expect, it } from 'vitest';
import { MODEL_OPERATION_OUTCOMES, UNKNOWN_MODELS, type CatalogEntry, type ModelCatalog } from '@codevo-whisper/protocol';
import { catalogHint, downloadPercent, formatGigabytes, modelOutcomeMessage, serverModelsView } from '../src/renderer/server/server-model-catalog';
import { transcriptionModelPicker } from '../src/renderer/server/transcription-model-picker';
import type { PairedServerView, ServerStatus } from '../src/shared/server';
import type { ServerModelOutcome } from '../src/shared/server-model-catalog';

type CardServer = Pick<PairedServerView, 'status' | 'deviceId' | 'transcriptionModel'>;

const PARAKEET: CatalogEntry = { id: 'parakeet-ultra', name: 'Parakeet Ultra (F16)', family: 'parakeet', sizeBytes: 1_256_724_448, removable: false, state: 'installed', receivedBytes: null };

const TURBO: CatalogEntry = { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo (F16)', family: 'whisper', sizeBytes: 1_625_935_488, removable: true, state: 'missing', receivedBytes: null };

const OPTIONS = [
  { id: 'parakeet-ultra', name: 'Parakeet Ultra (F16)', available: true, default: true },
  { id: 'whisper-large-v3-turbo', name: 'Whisper Large v3 Turbo (F16)', available: false, default: false },
];

function online(catalog: ModelCatalog | null, transcriptionModel: string | null = null): CardServer {
  const status: ServerStatus = { kind: 'online', connectMs: 9, serverVersion: '0.6.0', languages: { kind: 'reported', languages: ['sk'], models: UNKNOWN_MODELS }, transcriptionModels: OPTIONS, modelCatalog: catalog };
  return { status, deviceId: 'a1b2c3d4', transcriptionModel };
}

const REFUSALS: Readonly<Record<string, string>> = {
  forbidden: 'Toto zariadenie nemá povolené spravovať modely na serveri.',
  downloads_disabled: 'Sťahovanie a odstraňovanie modelov je na serveri vypnuté (STT_MODEL_DOWNLOADS=disabled).',
  download_busy: 'Server práve sťahuje model. Skúste to znova, keď sťahovanie skončí.',
  insufficient_space: 'Na serveri nie je dosť miesta pre tento model.',
  model_in_use: 'Model sa práve používa na prepis. Skúste ho odstrániť o chvíľu.',
  model_not_removable: 'Predvolený model sa nedá odstrániť.',
  unknown_model: 'Server tento model nepozná. Skontrolujte, či na serveri beží aktuálna verzia Codevo Whisper.',
  stt_unavailable: 'Služba prepisu na serveri neodpovedá. Skúste to znova o chvíľu.',
  unreachable: 'Server sa nepodarilo kontaktovať. Skontrolujte spojenie a skúste to znova.',
  unsupported: 'Server správu modelov nepodporuje. Aktualizujte ho na verziu 0.6.0 alebo novšiu.',
};

describe('server model catalog view', () => {
  it('maps every refusal to a Slovak message and leaves the successful outcomes to the refreshed catalog', () => {
    const outcomes: ServerModelOutcome[] = [...MODEL_OPERATION_OUTCOMES, 'unreachable', 'unsupported'];

    const messages = Object.fromEntries(outcomes.map((outcome) => [outcome, modelOutcomeMessage(outcome)]));

    expect(messages).toEqual({ ...REFUSALS, started: null, installed: null, removed: null, missing: null, cancelled: null, idle: null });
    expect(Object.values(REFUSALS).some((text) => /[–—]/.test(text))).toBe(false);
  });

  it('formats sizes in gigabytes with a decimal comma and names each family briefly', () => {
    expect([1_256_724_448, 3_107_236_640, 886_381_728, 0].map(formatGigabytes)).toEqual(['1,3 GB', '3,1 GB', '0,9 GB', '0,0 GB']);
    expect(catalogHint(PARAKEET)).toBe('Rýchly, 25 európskych jazykov.');
    expect(catalogHint({ id: 'parakeet-ultra-q8', family: 'parakeet' })).toBe('Rýchly, 25 európskych jazykov. Menší, takmer rovnaká presnosť.');
    expect(catalogHint({ id: 'whisper-large-v3', family: 'whisper' })).toBe('Rozpozná jazyk sám.');
    expect(catalogHint(TURBO)).toBe('Rýchlejší Whisper, rozpozná jazyk sám.');
    expect(catalogHint({ id: 'whisper-large-v3-turbo-q8', family: 'whisper' })).toBe('Rýchlejší Whisper, rozpozná jazyk sám. Menší, takmer rovnaká presnosť.');
  });

  it('shows the progress of a download in whole percent within bounds', () => {
    expect(downloadPercent({ sizeBytes: 1000, receivedBytes: 425 })).toBe(42);
    expect(downloadPercent({ sizeBytes: 1000, receivedBytes: 1000 })).toBe(100);
    expect(downloadPercent({ sizeBytes: 1000, receivedBytes: 5000 })).toBe(100);
    expect(downloadPercent({ sizeBytes: 0, receivedBytes: 0 })).toBe(0);
    expect(downloadPercent({ sizeBytes: 1000, receivedBytes: null })).toBe(0);

    const view = serverModelsView(online({ canManage: true, downloadsEnabled: true, models: [PARAKEET, { ...TURBO, state: 'downloading', receivedBytes: 813_000_000 }] }), false);

    expect(view).toMatchObject({ downloading: { name: 'Whisper Large v3 Turbo (F16)', percent: 50 }, busyHint: null });
    expect(view?.rows[1]).toMatchObject({ status: 'Sťahuje sa, 50 %', percent: 50, action: { kind: 'cancel' } });
  });

  it('keeps cancelling a download possible when downloads were switched off meanwhile', () => {
    const view = serverModelsView(online({ canManage: true, downloadsEnabled: false, models: [PARAKEET, { ...TURBO, state: 'downloading', receivedBytes: 0 }] }), false);

    expect(view?.rows[1]?.action).toEqual({ kind: 'cancel', label: 'Zrušiť', disabled: false });
  });

  it('shows nothing for a server without a catalog, an empty catalog or a server that is not online', () => {
    expect(serverModelsView(online(null), false)).toBeNull();
    expect(serverModelsView(online({ canManage: true, downloadsEnabled: false, models: [] }), false)).toBeNull();
    expect(serverModelsView({ status: { kind: 'checking' }, deviceId: 'a1b2c3d4' }, false)).toBeNull();
  });

  it('describes a catalog model in the picker by its family and points to the model section for missing ones', () => {
    const catalog: ModelCatalog = { canManage: true, downloadsEnabled: true, models: [PARAKEET, { ...TURBO, state: 'installed' }] };
    const installed = { ...online(catalog, 'whisper-large-v3-turbo'), status: { ...online(catalog).status, transcriptionModels: OPTIONS.map((option) => ({ ...option, available: true })) } as ServerStatus };

    expect(transcriptionModelPicker(installed)).toMatchObject({ selected: 'whisper-large-v3-turbo', description: 'Rýchlejší Whisper, rozpozná jazyk sám.', routesLanguages: false, missingNote: null });
    expect(transcriptionModelPicker(online({ ...catalog, models: [PARAKEET, TURBO] }))).toMatchObject({ selected: 'parakeet-ultra', missingNote: 'Ďalšie modely stiahnete cez Spravovať modely.' });
  });
});

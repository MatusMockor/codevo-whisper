import { describe, expect, it } from 'vitest';
import { UNKNOWN_MODELS } from '@codevo-whisper/protocol';
import { PARAKEET_OPTION, ROUTING_MODELS, WHISPER_OPTION } from '../../server/test/support/fake-stt-server';
import { serverLanguageFacts } from '../src/renderer/server/server-language-facts';
import type { PairedServerView, ServerStatus } from '../src/shared/server';
import type { ServerLanguages } from '../src/shared/server-languages';
import type { TranscriptionModelOption } from '../src/shared/transcription-models';

type CardServer = Pick<PairedServerView, 'status' | 'transcriptionModel'>;

const ROUTING: ServerLanguages = { kind: 'reported', languages: ['sk', 'cs', 'en'], models: ROUTING_MODELS };

const PARAKEET_COPY = 'Najrýchlejší, 25 európskych jazykov. Riadi sa jazykmi diktovania z Nastavení.';

const WHISPER_COPY = 'Najpresnejší pre slovenčinu, ale pomalší. Prvé diktovanie trvá dlhšie, server model najprv načíta.';

const BOTH_MODELS = [
  { id: 'parakeet-ultra', label: 'Parakeet Ultra (F16)', disabled: false },
  { id: 'whisper-large-v3', label: 'Whisper Large v3 (F16)', disabled: false },
];

function online(languages: ServerLanguages, transcriptionModels: readonly TranscriptionModelOption[] = [], transcriptionModel: string | null = null): CardServer {
  return { status: { kind: 'online', connectMs: 21, serverVersion: '0.5.0', languages, transcriptionModels, modelCatalog: null }, transcriptionModel };
}

function at(status: ServerStatus): CardServer {
  return { status, transcriptionModel: null };
}

describe('server card language facts', () => {
  it('shows a server that routes languages with its transcription and language models', () => {
    expect(serverLanguageFacts(online(ROUTING))).toEqual([
      { term: 'Výber jazykov', value: 'Podporovaný' },
      { term: 'Model prepisu', value: 'Parakeet Ultra (F16)' },
      { term: 'Modely pre jazyky', value: 'Canary 1B v2 (Q8) + VoxLingua107 (rozpoznanie jazyka)' },
    ]);
  });

  it('shows missing models and a dash for the language models it cannot name', () => {
    expect(serverLanguageFacts(online({ kind: 'reported', languages: [], models: { ...ROUTING_MODELS, languageId: null } }))).toEqual([
      { term: 'Výber jazykov', value: 'Chýbajú modely' },
      { term: 'Model prepisu', value: 'Parakeet Ultra (F16)' },
      { term: 'Modely pre jazyky', value: '-' },
    ]);
    expect(serverLanguageFacts(online({ kind: 'reported', languages: [], models: UNKNOWN_MODELS }))).toEqual([
      { term: 'Výber jazykov', value: 'Chýbajú modely' },
      { term: 'Model prepisu', value: '-' },
      { term: 'Modely pre jazyky', value: '-' },
    ]);
  });

  it('shows an outdated server without model rows, because it reports no models', () => {
    expect(serverLanguageFacts(online({ kind: 'outdated', minVersion: '0.3.0' }))).toEqual([{ term: 'Výber jazykov', value: 'Server je zastaraný' }]);
  });

  it('shows a dash while the server is not verified yet and nothing while it is down', () => {
    expect(serverLanguageFacts(at({ kind: 'checking' }))).toEqual([{ term: 'Výber jazykov', value: '-' }]);
    expect(serverLanguageFacts(at({ kind: 'unknown' }))).toEqual([{ term: 'Výber jazykov', value: '-' }]);
    expect(serverLanguageFacts(at({ kind: 'offline' }))).toEqual([]);
    expect(serverLanguageFacts(at({ kind: 'unavailable', reason: 'busy' }))).toEqual([]);
    expect(serverLanguageFacts(at({ kind: 'repair-needed', reason: 'device-unknown' }))).toEqual([]);
  });
});

describe('server card transcription model picker', () => {
  it('replaces the model fact with a picker on the server default when the device has not chosen yet', () => {
    expect(serverLanguageFacts(online(ROUTING, [PARAKEET_OPTION, WHISPER_OPTION]))).toEqual([
      { term: 'Výber jazykov', value: 'Podporovaný' },
      { term: 'Model prepisu', picker: { options: BOTH_MODELS, selected: 'parakeet-ultra', description: PARAKEET_COPY, missingNote: null, routesLanguages: true } },
      { term: 'Modely pre jazyky', value: 'Canary 1B v2 (Q8) + VoxLingua107 (rozpoznanie jazyka)' },
    ]);
  });

  it('shows the chosen Whisper and that it needs no language models', () => {
    expect(serverLanguageFacts(online(ROUTING, [PARAKEET_OPTION, WHISPER_OPTION], 'whisper-large-v3'))).toEqual([
      { term: 'Výber jazykov', value: 'Podporovaný' },
      { term: 'Model prepisu', picker: { options: BOTH_MODELS, selected: 'whisper-large-v3', description: WHISPER_COPY, missingNote: null, routesLanguages: false } },
      { term: 'Modely pre jazyky', value: 'Nepoužívajú sa, model rozpozná jazyk sám' },
    ]);
  });

  it('disables a model the server has not downloaded and falls back to the default when it was chosen', () => {
    const facts = serverLanguageFacts(online(ROUTING, [PARAKEET_OPTION, { ...WHISPER_OPTION, available: false }], 'whisper-large-v3'));

    expect(facts[1]).toEqual({
      term: 'Model prepisu',
      picker: {
        options: [
          { id: 'parakeet-ultra', label: 'Parakeet Ultra (F16)', disabled: false },
          { id: 'whisper-large-v3', label: 'Whisper Large v3 (F16) - nie je stiahnutý', disabled: true },
        ],
        selected: 'parakeet-ultra',
        description: PARAKEET_COPY,
        missingNote: 'Whisper Large v3 (F16) na serveri nie je stiahnutý. Spustite na serveri stt-provision.',
        routesLanguages: true,
      },
    });
    expect(facts[2]).toEqual({ term: 'Modely pre jazyky', value: 'Canary 1B v2 (Q8) + VoxLingua107 (rozpoznanie jazyka)' });
  });

  it('falls back to the default for a choice the server no longer offers and names every missing model', () => {
    const missing = [
      { ...PARAKEET_OPTION, available: false },
      { ...WHISPER_OPTION, available: false },
    ];

    expect(serverLanguageFacts(online(ROUTING, [PARAKEET_OPTION, WHISPER_OPTION], 'whisper-tiny'))[1]).toMatchObject({ picker: { selected: 'parakeet-ultra' } });
    expect(serverLanguageFacts(online(ROUTING, missing))[1]).toMatchObject({
      picker: { selected: 'parakeet-ultra', missingNote: 'Tieto modely na serveri nie sú stiahnuté: Parakeet Ultra (F16), Whisper Large v3 (F16). Spustite na serveri stt-provision.' },
    });
  });

  it('names a model it does not know by its server name without a description and keeps the language models', () => {
    const facts = serverLanguageFacts(online(ROUTING, [PARAKEET_OPTION, { id: 'canary-1b', name: 'Canary 1B v2 (Q8)', available: true, default: false }], 'canary-1b'));

    expect(facts[1]).toMatchObject({ picker: { selected: 'canary-1b', description: null, routesLanguages: true } });
    expect(facts[2]).toEqual({ term: 'Modely pre jazyky', value: 'Canary 1B v2 (Q8) + VoxLingua107 (rozpoznanie jazyka)' });
  });
});

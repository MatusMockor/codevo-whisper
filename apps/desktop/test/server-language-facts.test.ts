import { describe, expect, it } from 'vitest';
import { UNKNOWN_MODELS } from '@codevo-whisper/protocol';
import { ROUTING_MODELS } from '../../server/test/support/fake-stt-server';
import { serverLanguageFacts } from '../src/renderer/server/server-language-facts';
import type { ServerStatus } from '../src/shared/server';
import type { ServerLanguages } from '../src/shared/server-languages';

function online(languages: ServerLanguages): { status: ServerStatus } {
  return { status: { kind: 'online', connectMs: 21, serverVersion: '0.3.0', languages } };
}

describe('server card language facts', () => {
  it('shows a server that routes languages with its transcription and language models', () => {
    expect(serverLanguageFacts(online({ kind: 'reported', languages: ['sk', 'cs', 'en'], models: ROUTING_MODELS }))).toEqual([
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
    expect(serverLanguageFacts({ status: { kind: 'checking' } })).toEqual([{ term: 'Výber jazykov', value: '-' }]);
    expect(serverLanguageFacts({ status: { kind: 'unknown' } })).toEqual([{ term: 'Výber jazykov', value: '-' }]);
    expect(serverLanguageFacts({ status: { kind: 'offline' } })).toEqual([]);
    expect(serverLanguageFacts({ status: { kind: 'unavailable', reason: 'busy' } })).toEqual([]);
    expect(serverLanguageFacts({ status: { kind: 'repair-needed', reason: 'device-unknown' } })).toEqual([]);
  });
});

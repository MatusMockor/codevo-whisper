import { describe, expect, it } from 'vitest';
import { ROUTING_MODELS } from '../../server/test/support/fake-stt-server';
import { serverAvailabilityNote } from '../src/renderer/settings/language-availability';
import type { ServerStatus } from '../src/shared/server';
import type { ServerLanguages } from '../src/shared/server-languages';

function online(serverVersion: string, languages: ServerLanguages): { status: ServerStatus } {
  return { status: { kind: 'online', connectMs: 21, serverVersion, languages } };
}

const ROUTING = online('0.3.0', { kind: 'reported', languages: ['sk', 'cs', 'en'], models: ROUTING_MODELS });

describe('server availability note under Jazyky diktovania', () => {
  it('confirms a server that routes every selected language', () => {
    expect(serverAvailabilityNote(ROUTING, ['server'], ['sk', 'cs'])).toEqual({ text: 'Server podporuje výber jazykov.', warn: false });
    expect(serverAvailabilityNote(ROUTING, ['local', 'server'], ['en'])).toEqual({ text: 'Server podporuje výber jazykov.', warn: false });
  });

  it('warns about an outdated server with its version and the version that brings the feature', () => {
    expect(serverAvailabilityNote(online('0.2.7', { kind: 'outdated', minVersion: '0.3.0' }), ['server', 'local'], ['sk'])).toEqual({
      text: 'Server je zastaraný (verzia 0.2.7). Výber jazykov funguje od verzie 0.3.0, aktualizujte server.',
      warn: true,
    });
  });

  it('warns about a server without the models or without a selected language', () => {
    const missing = { text: 'Na serveri chýbajú modely pre výber jazykov. Spustite na serveri stt-provision.', warn: true };
    expect(serverAvailabilityNote(online('0.3.0', { kind: 'reported', languages: [], models: ROUTING_MODELS }), ['server'], ['sk'])).toEqual(missing);
    expect(serverAvailabilityNote(ROUTING, ['server'], ['sk', 'de'])).toEqual(missing);
  });

  it('says nothing about the server when it is not on the route, not paired or not verified', () => {
    expect(serverAvailabilityNote(ROUTING, ['local'], ['sk'])).toBeNull();
    expect(serverAvailabilityNote(null, ['server'], ['sk'])).toBeNull();
    expect(serverAvailabilityNote({ status: { kind: 'checking' } }, ['server'], ['sk'])).toBeNull();
    expect(serverAvailabilityNote({ status: { kind: 'offline' } }, ['server'], ['sk'])).toBeNull();
  });
});

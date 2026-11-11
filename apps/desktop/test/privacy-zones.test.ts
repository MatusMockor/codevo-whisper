import { describe, expect, it } from 'vitest';
import { aiZone, localZone, privacyView, privacyViewWithoutServer, serverZone, UNKNOWN_PRIVACY, UNKNOWN_ZONES, voiceRoute } from '../src/renderer/privacy/privacy-zones';
import type { PairedServerView } from '../src/shared/server';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const SERVER_SECTION = { page: 'transcription', section: 'server' };
const AI_SECTION = { page: 'settings', section: 'ai' };

const PAIRED: PairedServerView = {
  host: 'domaci-pc.local:8443',
  endpoint: 'wss://domaci-pc.local:8443',
  deviceId: 'device',
  deviceName: 'MacBook',
  pairedAt: '2026-11-01T10:00:00.000Z',
  serverFingerprint: 'AA',
  deviceFingerprint: 'BB',
  status: { kind: 'online', connectMs: 12, serverVersion: '1.0.0' },
  enabled: true,
};

describe('localZone', () => {
  it('names the role of the local model in the transcription route', () => {
    expect(localZone(['local']).status).toEqual({ tone: 'ok', label: 'Teraz hlavný prepis' });
    expect(localZone(['server', 'local']).status).toEqual({ tone: 'ok', label: 'Teraz záloha prepisu' });
    expect(localZone(['server']).status).toEqual({ tone: 'off', label: 'Lokálny prepis nie je v trase' });
    expect(localZone(['local']).action).toEqual({ label: 'Otvoriť lokálny model', target: { page: 'transcription', section: 'local-model' } });
  });
});

describe('serverZone', () => {
  it('offers pairing when no server is paired', () => {
    expect(serverZone(['local'], null)).toEqual({
      status: { tone: 'off', label: 'Nepoužíva sa, server nie je spárovaný' },
      path: ['Zvuk', 'E2E šifrovanie', 'váš server'],
      action: { label: 'Spárovať server', target: SERVER_SECTION },
    });
  });

  it('shows the paired host and whether audio goes there right now', () => {
    expect(serverZone(['server', 'local'], PAIRED)).toEqual({ status: { tone: 'warn', label: 'Teraz hlavný prepis' }, path: ['Zvuk', 'E2E šifrovanie', 'domaci-pc.local:8443'], action: { label: 'Otvoriť server', target: SERVER_SECTION } });
    expect(serverZone(['local', 'server'], PAIRED).status).toEqual({ tone: 'warn', label: 'Teraz záloha prepisu' });
    expect(serverZone(['local'], PAIRED).status).toEqual({ tone: 'off', label: 'Spárovaný, ale nie je v trase prepisu' });
    expect(serverZone(['server', 'local'], { ...PAIRED, enabled: false }).status).toEqual({ tone: 'off', label: 'Spárovaný, ale odpojený' });
  });
});

describe('aiZone', () => {
  it('links the AI settings group when no provider is set up', () => {
    expect(aiZone(DEFAULT_SETTINGS)).toEqual({
      status: { tone: 'off', label: 'Nepoužíva sa, AI úprava nie je nastavená' },
      path: ['Text', 'AI poskytovateľ'],
      action: { label: 'Nastaviť AI úpravu', target: AI_SECTION },
    });
  });

  it('names Codex CLI as sending text to OpenAI', () => {
    expect(aiZone({ ...DEFAULT_SETTINGS, aiProvider: 'codex', aiPolish: true })).toEqual({
      status: { tone: 'warn', label: 'Teraz diktát aj poznámky zo stretnutí' },
      path: ['Text', 'OpenAI cez Codex CLI'],
      action: { label: 'Otvoriť AI úpravu', target: AI_SECTION },
    });
  });

  it('tells a server on this computer apart from a remote one', () => {
    expect(aiZone({ ...DEFAULT_SETTINGS, aiBaseUrl: 'http://127.0.0.1:11434/v1', aiModel: 'qwen2.5:7b' })).toMatchObject({ status: { tone: 'ok', label: 'Teraz iba poznámky zo stretnutí' }, path: ['Text', '127.0.0.1:11434'] });
    expect(aiZone({ ...DEFAULT_SETTINGS, aiBaseUrl: 'https://ai.example.com/v1', aiModel: 'llama' })).toMatchObject({ status: { tone: 'warn' }, path: ['Text', 'ai.example.com'] });
  });
});

describe('voiceRoute', () => {
  it('follows the transcription order through the engines that are in use', () => {
    expect(voiceRoute(['local'], PAIRED)).toEqual({ primary: 'local', fallback: null });
    expect(voiceRoute(['server', 'local'], PAIRED)).toEqual({ primary: 'server', fallback: 'local' });
    expect(voiceRoute(['local', 'server'], PAIRED)).toEqual({ primary: 'local', fallback: 'server' });
    expect(voiceRoute(['server'], PAIRED)).toEqual({ primary: 'server', fallback: null });
  });

  it('skips a server that is not paired or switched off', () => {
    expect(voiceRoute(['server', 'local'], null)).toEqual({ primary: 'local', fallback: null });
    expect(voiceRoute(['server', 'local'], { ...PAIRED, enabled: false })).toEqual({ primary: 'local', fallback: null });
    expect(voiceRoute(['server'], null)).toBeNull();
  });
});

describe('privacyView', () => {
  it('combines the three zones and the voice route from the settings and the paired server', () => {
    const { zones, route } = privacyView({ ...DEFAULT_SETTINGS, engineOrder: ['server', 'local'] }, PAIRED);

    expect(zones.local.status?.label).toBe('Teraz záloha prepisu');
    expect(zones.server.status?.label).toBe('Teraz hlavný prepis');
    expect(zones.ai.action?.label).toBe('Nastaviť AI úpravu');
    expect(route).toEqual({ primary: 'server', fallback: 'local' });
  });

  it('shows local as the main route when the server ahead of it is disconnected', () => {
    const { zones, route } = privacyView({ ...DEFAULT_SETTINGS, engineOrder: ['server', 'local'] }, { ...PAIRED, enabled: false });

    expect(zones.local.status).toEqual({ tone: 'ok', label: 'Teraz hlavný prepis' });
    expect(route).toEqual({ primary: 'local', fallback: null });
  });

  it('keeps the local and AI zones when only the server state is unknown', () => {
    const { zones, route } = privacyViewWithoutServer({ ...DEFAULT_SETTINGS, engineOrder: ['local'], aiProvider: 'codex' });

    expect(zones.local.status).toEqual({ tone: 'ok', label: 'Teraz hlavný prepis' });
    expect(zones.ai.status?.label).toBe('Teraz iba poznámky zo stretnutí');
    expect(zones.server).toEqual(UNKNOWN_ZONES.server);
    expect(route).toEqual({ primary: 'local', fallback: null });
  });

  it('leaves the voice route unknown when the server is in the order but its state is unknown', () => {
    expect(privacyViewWithoutServer({ ...DEFAULT_SETTINGS, engineOrder: ['server', 'local'] }).route).toBeNull();
  });

  it('keeps the data paths but no live status while the facts are unknown', () => {
    expect(Object.values(UNKNOWN_PRIVACY.zones).map((zone) => [zone.status, zone.action])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
    expect(UNKNOWN_PRIVACY.route).toBeNull();
  });
});

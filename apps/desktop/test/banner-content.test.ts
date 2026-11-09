import { describe, expect, it } from 'vitest';
import { bannerContent, hotkeyVerb } from '../src/renderer/home/banner-content';
import type { EngineIssue } from '../src/renderer/home/engine-issue';
import type { AppStatus } from '../src/shared/app-status';

const READY: AppStatus = { hotkeyLabel: 'Pravý ⌃ Control', mode: 'hold', modelReady: true, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: true, paused: false };
const NO_MODEL: EngineIssue = { problem: 'no-model', remedy: { action: 'download-model', alternative: 'pair-server' }, serverHost: null };

describe('bannerContent', () => {
  it('tells the user to hold the key in hold mode and press it in toggle mode', () => {
    expect(bannerContent(READY, null)).toEqual({ kind: 'ready', hotkeyLabel: 'Pravý ⌃ Control', verb: 'Podržte' });
    expect(bannerContent({ ...READY, mode: 'toggle' }, null)).toEqual({ kind: 'ready', hotkeyLabel: 'Pravý ⌃ Control', verb: 'Stlačte' });
    expect(bannerContent({ ...READY, mode: 'smart' }, null)).toEqual({ kind: 'ready', hotkeyLabel: 'Pravý ⌃ Control', verb: 'Stlačte' });
  });

  it('asks for the missing step first', () => {
    expect(bannerContent({ ...READY, hotkeyLabel: null }, NO_MODEL)).toEqual({ kind: 'action', message: 'Nastavte klávesovú skratku, ktorou budete diktovať.', target: { page: 'settings', section: 'dictation' }, issue: null });
    expect(bannerContent({ ...READY, modelReady: false }, NO_MODEL)).toEqual({ kind: 'action', message: 'Lokálny model nie je stiahnutý.', target: { page: 'settings', section: 'local-model' }, issue: NO_MODEL });
    expect(bannerContent({ ...READY, modelReady: false, pairingNeeded: true }, { problem: 'server-not-paired', remedy: null, serverHost: null })).toMatchObject({ message: 'Server nie je spárovaný.', target: { page: 'server' } });
    expect(bannerContent(READY, { problem: 'server-offline', remedy: null, serverHost: 'domáci-pc' })).toMatchObject({ message: 'Server nie je dostupný.', target: { page: 'server' } });
    expect(bannerContent({ ...READY, modelReady: false, serverRepairNeeded: true }, null)).toEqual({
      kind: 'action',
      target: { page: 'server' },
      message: 'Server treba znova spárovať. Kým to neurobíte, Codevo Whisper naň neposiela zvuk.',
      issue: null,
    });
    expect(bannerContent({ ...READY, permissionsOk: false }, null)).toMatchObject({ kind: 'action', target: { page: 'settings' } });
    expect(bannerContent({ ...READY, paused: true }, null)).toEqual({ kind: 'paused' });
  });

  it('names the verb for each mode', () => {
    expect([hotkeyVerb('hold'), hotkeyVerb('toggle'), hotkeyVerb('smart')]).toEqual(['Podržte', 'Stlačte', 'Stlačte']);
  });
});

import { describe, expect, it } from 'vitest';
import { bannerContent, hotkeyVerb } from '../src/renderer/home/banner-content';
import type { AppStatus } from '../src/shared/app-status';

const READY: AppStatus = { hotkeyLabel: 'Pravý ⌃ Control', mode: 'hold', modelReady: true, pairingNeeded: false, permissionsOk: true, paused: false };

describe('bannerContent', () => {
  it('tells the user to hold the key in hold mode and press it in toggle mode', () => {
    expect(bannerContent(READY)).toEqual({ kind: 'ready', hotkeyLabel: 'Pravý ⌃ Control', verb: 'Podržte' });
    expect(bannerContent({ ...READY, mode: 'toggle' })).toEqual({ kind: 'ready', hotkeyLabel: 'Pravý ⌃ Control', verb: 'Stlačte' });
  });

  it('asks for the missing step first', () => {
    expect(bannerContent({ ...READY, hotkeyLabel: null })).toMatchObject({ kind: 'action', message: 'Nastavte klávesovú skratku, ktorou budete diktovať.' });
    expect(bannerContent({ ...READY, modelReady: false })).toMatchObject({ kind: 'action', message: 'Stiahnite si model na prepis reči.' });
    expect(bannerContent({ ...READY, modelReady: false, pairingNeeded: true })).toMatchObject({ kind: 'action', message: 'Spárujte server na stránke Server alebo zmeňte, kde beží prepis.' });
    expect(bannerContent({ ...READY, permissionsOk: false })).toMatchObject({ kind: 'action' });
    expect(bannerContent({ ...READY, paused: true })).toEqual({ kind: 'paused' });
  });

  it('names the verb for each mode', () => {
    expect([hotkeyVerb('hold'), hotkeyVerb('toggle')]).toEqual(['Podržte', 'Stlačte']);
  });
});

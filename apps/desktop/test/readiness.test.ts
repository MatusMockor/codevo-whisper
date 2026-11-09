import { describe, expect, it } from 'vitest';
import { bannerContent } from '../src/renderer/home/banner-content';
import { pathHeader, railBadges, readinessSummary } from '../src/renderer/home/readiness';
import { readinessActions } from '../src/renderer/home/readiness-actions';
import type { AppStatus } from '../src/shared/app-status';

const READY: AppStatus = { hotkeyLabel: '⌥Space', mode: 'toggle', modelReady: true, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: true, paused: false };

function actions(status: AppStatus) {
  const content = bannerContent(status);
  expect(content.kind).toBe('action');
  return content.kind === 'action' ? readinessActions(content) : [];
}

describe('readinessSummary', () => {
  it('summarises the dictation readiness for the status bar', () => {
    expect(readinessSummary(READY)).toEqual({ state: 'ok', label: 'Pripravené', hint: 'stlačte ⌥Space' });
    expect(readinessSummary({ ...READY, mode: 'hold' })).toMatchObject({ hint: 'podržte ⌥Space' });
    expect(readinessSummary({ ...READY, paused: true })).toEqual({ state: 'off', label: 'Pozastavené', hint: null });
    expect(readinessSummary({ ...READY, hotkeyLabel: null })).toEqual({ state: 'err', label: 'Diktovanie nefunguje', hint: null });
  });
});

describe('pathHeader', () => {
  it('says whether the signal passes', () => {
    expect(pathHeader(READY)).toEqual({ state: 'ok', label: 'signál prechádza' });
    expect(pathHeader({ ...READY, paused: true })).toEqual({ state: 'off', label: 'pozastavené' });
    expect(pathHeader({ ...READY, permissionsOk: false })).toEqual({ state: 'err', label: 'signál sa prerušil' });
  });
});

describe('railBadges', () => {
  it('flags Home when dictation would fail and Server when it needs pairing', () => {
    expect(railBadges(READY)).toEqual({});
    expect(railBadges({ ...READY, paused: true })).toEqual({});
    expect(railBadges({ ...READY, modelReady: false })).toEqual({ home: 'err' });
    expect(railBadges({ ...READY, modelReady: false, pairingNeeded: true })).toEqual({ home: 'err', server: 'err' });
    expect(railBadges({ ...READY, serverRepairNeeded: true })).toEqual({ home: 'err', server: 'err' });
  });
});

describe('readinessActions', () => {
  it('opens the page and section that fixes the problem', () => {
    expect(actions({ ...READY, hotkeyLabel: null })).toEqual([{ id: 'open-settings', label: 'Otvoriť nastavenia', target: { page: 'settings', section: 'Diktovanie' }, primary: true }]);
    expect(actions({ ...READY, modelReady: false })).toEqual([{ id: 'open-settings', label: 'Otvoriť nastavenia', target: { page: 'settings', section: 'Lokálny model' }, primary: true }]);
    expect(actions({ ...READY, permissionsOk: false })).toEqual([{ id: 'open-settings', label: 'Otvoriť nastavenia', target: { page: 'settings' }, primary: true }]);
    expect(actions({ ...READY, serverRepairNeeded: true })).toEqual([{ id: 'open-server', label: 'Otvoriť Server', target: { page: 'server' }, primary: true }]);
    expect(actions({ ...READY, modelReady: false, pairingNeeded: true })).toEqual([{ id: 'open-server', label: 'Otvoriť Server', target: { page: 'server' }, primary: true }]);
  });
});

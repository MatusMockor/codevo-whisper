import { describe, expect, it } from 'vitest';
import { bannerContent } from '../src/renderer/home/banner-content';
import type { EngineIssue } from '../src/renderer/home/engine-issue';
import { pathHeader, railBadges, readinessSummary } from '../src/renderer/home/readiness';
import { readinessActions } from '../src/renderer/home/readiness-actions';
import type { AppStatus } from '../src/shared/app-status';

const READY: AppStatus = { hotkeyLabel: '⌥Space', mode: 'toggle', modelReady: true, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: true, paused: false };
const NO_MODEL: EngineIssue = { problem: 'no-model', remedy: null, serverHost: null };
const NOT_PAIRED: EngineIssue = { problem: 'server-not-paired', remedy: null, serverHost: null };

function actions(status: AppStatus, issue: EngineIssue | null = null) {
  const content = bannerContent(status, issue);
  expect(content.kind).toBe('action');
  return content.kind === 'action' ? readinessActions(content) : [];
}

describe('readinessSummary', () => {
  it('summarises the dictation readiness for the status bar', () => {
    expect(readinessSummary(READY, null)).toEqual({ state: 'ok', label: 'Pripravené', hint: 'stlačte ⌥Space' });
    expect(readinessSummary({ ...READY, mode: 'hold' }, null)).toMatchObject({ hint: 'podržte ⌥Space' });
    expect(readinessSummary({ ...READY, paused: true }, null)).toEqual({ state: 'off', label: 'Pozastavené', hint: null });
    expect(readinessSummary({ ...READY, hotkeyLabel: null }, null)).toEqual({ state: 'err', label: 'Diktovanie nefunguje', hint: null });
    expect(readinessSummary(READY, NO_MODEL)).toMatchObject({ state: 'err', label: 'Diktovanie nefunguje' });
  });
});

describe('pathHeader', () => {
  it('says whether the signal passes', () => {
    expect(pathHeader(READY, null)).toEqual({ state: 'ok', label: 'signál prechádza' });
    expect(pathHeader({ ...READY, paused: true }, null)).toEqual({ state: 'off', label: 'pozastavené' });
    expect(pathHeader({ ...READY, permissionsOk: false }, null)).toEqual({ state: 'err', label: 'signál sa prerušil' });
    expect(pathHeader(READY, NO_MODEL)).toEqual({ state: 'err', label: 'signál sa prerušil' });
  });
});

describe('railBadges', () => {
  it('flags Home when dictation would fail and Server when it needs pairing', () => {
    expect(railBadges(READY, null)).toEqual({});
    expect(railBadges({ ...READY, paused: true }, null)).toEqual({});
    expect(railBadges({ ...READY, modelReady: false }, NO_MODEL)).toEqual({ home: 'err' });
    expect(railBadges({ ...READY, modelReady: false, pairingNeeded: true }, NOT_PAIRED)).toEqual({ home: 'err', server: 'err' });
    expect(railBadges({ ...READY, serverRepairNeeded: true }, null)).toEqual({ home: 'err', server: 'err' });
  });
});

describe('readinessActions', () => {
  it('opens the page and section that fixes the problem', () => {
    expect(actions({ ...READY, hotkeyLabel: null })).toEqual([{ id: 'open-settings', label: 'Otvoriť nastavenia', command: { kind: 'navigate', target: { page: 'settings', section: 'dictation' } }, primary: true }]);
    expect(actions({ ...READY, modelReady: false }, NO_MODEL)).toEqual([{ id: 'open-settings', label: 'Otvoriť nastavenia', command: { kind: 'navigate', target: { page: 'settings', section: 'local-model' } }, primary: true }]);
    expect(actions({ ...READY, permissionsOk: false })).toEqual([{ id: 'open-settings', label: 'Otvoriť nastavenia', command: { kind: 'navigate', target: { page: 'settings' } }, primary: true }]);
    expect(actions({ ...READY, serverRepairNeeded: true })).toEqual([{ id: 'open-server', label: 'Otvoriť Server', command: { kind: 'navigate', target: { page: 'server' } }, primary: true }]);
    expect(actions({ ...READY, modelReady: false, pairingNeeded: true }, NOT_PAIRED)).toEqual([{ id: 'open-server', label: 'Otvoriť Server', command: { kind: 'navigate', target: { page: 'server' } }, primary: true }]);
  });

  it('labels the switch to the server plainly when the host is unknown', () => {
    const content = bannerContent({ ...READY, modelReady: false }, { problem: 'no-model', remedy: { action: 'use-server' }, serverHost: null });
    expect(content.kind === 'action' ? readinessActions(content).map((action) => action.label) : []).toEqual(['Prepisovať na serveri']);
  });
});

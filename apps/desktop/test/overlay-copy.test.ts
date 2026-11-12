import { describe, expect, it } from 'vitest';
import { failureState, MESSAGES, readinessError } from '../src/main/session/overlay-messages';
import { ACTION_LABELS, BLOCKED_BUTTONS, BLOCKED_COPY, copiedLabel, errorButtons, errorDetail, fallbackNotice, PARTIAL_TEXT_DETAIL, REROUTED_DETAIL, REROUTED_TITLES } from '../src/renderer/overlay/overlay-copy';
import type { EngineConditions } from '../src/shared/engine-routing';

const DASHES = /[\u2013\u2014]/;

const PAIRED_ONLINE: EngineConditions = { localReady: false, serverReady: true, serverOffline: false, serverOff: false, serverRepair: false };

describe('overlay copy', () => {
  it('lists the primary fix first and the alternative after it', () => {
    expect(errorButtons({ kind: 'error', message: MESSAGES.noModel, action: 'use-server', alternative: 'download-model' })).toEqual([
      { action: 'use-server', label: 'Prepisovať na serveri', primary: true },
      { action: 'download-model', label: 'Stiahnuť model', primary: false },
    ]);
    expect(errorButtons({ kind: 'error', message: MESSAGES.transcriptionFailed })).toEqual([]);
  });

  it('offers the fixes routing proposes for a missing local model next to a paired server', () => {
    expect(errorButtons(readinessError('no-model', PAIRED_ONLINE))).toEqual([
      { action: 'use-server', label: 'Prepisovať na serveri', primary: true },
      { action: 'download-model', label: 'Stiahnuť model', primary: false },
    ]);
  });

  it('reassures that the text so far is kept only when a failure offers copying it', () => {
    expect(errorDetail(failureState('connection-lost', true))).toBe(PARTIAL_TEXT_DETAIL);
    expect(errorDetail(failureState('connection-lost', false))).toBeNull();
    expect(errorDetail(readinessError('server-languages-outdated', PAIRED_ONLINE))).toBeNull();
  });

  it('keeps the language failures on a server fix with their own wording', () => {
    expect(readinessError('server-languages-missing', PAIRED_ONLINE)).toEqual({ kind: 'error', message: MESSAGES.serverLanguagesMissing, action: 'open-server' });
    expect(errorButtons(failureState('languages-outdated', false))).toEqual([{ action: 'open-server', label: 'Otvoriť server', primary: true }]);
  });

  it('tells which microphone is missing and how to paste on each platform', () => {
    expect(fallbackNotice('AirPods Pro')).toBe('Mikrofón AirPods Pro nie je pripojený, používam predvolený');
    expect(fallbackNotice('')).toBe('Vybraný mikrofón nie je pripojený, používam predvolený');
    expect(copiedLabel(true)).toBe('Skopírované - vlož cez Ctrl+V');
    expect(copiedLabel(false)).toBe('Skopírované - vlož cez ⌘V');
  });

  it('explains blocked insertion and rerouting and offers copying when blocked', () => {
    expect(BLOCKED_COPY.focus.title).toBe('Okno sa zmenilo, text nebol vložený');
    expect(BLOCKED_COPY.secure.title).toBe('Zabezpečené zadávanie, text nebol vložený');
    expect(BLOCKED_BUTTONS).toEqual([{ action: 'copy-last', label: 'Kopírovať', primary: true }]);
    expect(REROUTED_TITLES).toEqual({ server: 'Prepis teraz beží na serveri', local: 'Prepis teraz beží lokálne' });
  });

  it('never uses the long dashes in its Slovak copy', () => {
    const copy = [...Object.values(ACTION_LABELS), ...Object.values(BLOCKED_COPY).flatMap((entry) => [entry.title, entry.detail]), ...Object.values(REROUTED_TITLES), REROUTED_DETAIL, PARTIAL_TEXT_DETAIL, fallbackNotice(''), copiedLabel(true), copiedLabel(false)];
    expect(copy.filter((text) => DASHES.test(text))).toEqual([]);
  });
});

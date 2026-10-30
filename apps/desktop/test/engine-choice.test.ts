import { describe, expect, it } from 'vitest';
import { ENGINE_CHOICES, engineOrderFor, initialEngineChoice, serverNeedsPairing, stickyEngineChoice, TRY_HINTS, tryHint } from '../src/renderer/onboarding/engine-choice';
import type { AppStatus } from '../src/shared/app-status';
import type { ModelState } from '../src/shared/models';
import type { PairedServerView } from '../src/shared/server';

const FRESH = { engineOrder: ['local' as const], localModelId: null };

const READY: AppStatus = { hotkeyLabel: 'Pravý ⌃ Control', mode: 'hold', modelReady: true, pairingNeeded: false, serverRepairNeeded: false, permissionsOk: true, paused: false };

const PAIRED: PairedServerView = {
  host: 'gpu.local',
  endpoint: 'gpu.local:7443',
  deviceId: 'dev-1',
  deviceName: 'MacBook',
  pairedAt: '2026-10-01T10:00:00.000Z',
  serverFingerprint: 'AAAA',
  deviceFingerprint: 'BBBB',
  status: { kind: 'online', connectMs: 12, serverVersion: '0.1.0' },
};

function modelState(status: ModelState['status']): ModelState {
  return { id: 'tiny', status, receivedBytes: 0, totalBytes: 10 };
}

describe('ENGINE_CHOICES', () => {
  it('offers this device, an own server and deciding later on every platform', () => {
    expect(ENGINE_CHOICES.map((option) => option.title)).toEqual(['Na tomto zariadení', 'Na vlastnom serveri', 'Nastavím neskôr']);
  });
});

describe('initialEngineChoice', () => {
  it('preselects nothing for a fresh install so no option is pushed', () => {
    expect(initialEngineChoice(FRESH, [])).toBeNull();
    expect(initialEngineChoice(FRESH, [modelState('not-downloaded'), modelState('broken')])).toBeNull();
  });

  it('reflects a server-first order', () => {
    expect(initialEngineChoice({ engineOrder: ['server'], localModelId: null }, [])).toBe('server');
    expect(initialEngineChoice({ engineOrder: ['server', 'local'], localModelId: 'tiny' }, [modelState('ready')])).toBe('server');
  });

  it('reflects a chosen or started local model', () => {
    expect(initialEngineChoice({ ...FRESH, localModelId: 'tiny' }, [])).toBe('local');
    expect(initialEngineChoice(FRESH, [modelState('downloading')])).toBe('local');
    expect(initialEngineChoice(FRESH, [modelState('paused')])).toBe('local');
    expect(initialEngineChoice({ engineOrder: ['local', 'server'], localModelId: null }, [modelState('ready')])).toBe('local');
  });
});

describe('stickyEngineChoice', () => {
  it('keeps an implicitly derived choice once it appeared, even when the model state later changes', () => {
    const derived = initialEngineChoice(FRESH, [modelState('paused')]);
    const kept = stickyEngineChoice(null, derived);
    expect(kept).toBe('local');

    const afterBrokenDownload = initialEngineChoice(FRESH, [modelState('broken')]);
    expect(afterBrokenDownload).toBeNull();
    expect(stickyEngineChoice(kept, afterBrokenDownload)).toBe('local');
  });

  it('waits for a derivable choice and never overrides an explicit one', () => {
    expect(stickyEngineChoice(null, null)).toBeNull();
    expect(stickyEngineChoice('later', 'server')).toBe('later');
  });
});

describe('engineOrderFor', () => {
  it('writes exactly the chosen engine so a local choice never falls back to the server', () => {
    expect(engineOrderFor('local')).toEqual(['local']);
    expect(engineOrderFor('server')).toEqual(['server']);
  });

  it('keeps the order untouched when the user decides later', () => {
    expect(engineOrderFor('later')).toBeNull();
  });
});

describe('serverNeedsPairing', () => {
  it('asks for pairing when no server is paired or the pairing needs repair', () => {
    expect(serverNeedsPairing({ server: null })).toBe(true);
    expect(serverNeedsPairing({ server: PAIRED })).toBe(false);
    expect(serverNeedsPairing({ server: { ...PAIRED, status: { kind: 'repair-needed', reason: 'device-unknown' } } })).toBe(true);
  });
});

describe('tryHint', () => {
  it('says nothing while the status loads or once an engine is ready', () => {
    expect(tryHint('later', null)).toBeNull();
    expect(tryHint('server', READY)).toBeNull();
    expect(tryHint(null, READY)).toBeNull();
  });

  it('points a server user to pairing, never to a model download', () => {
    expect(tryHint('server', { ...READY, modelReady: false, pairingNeeded: true })).toBe(TRY_HINTS.server);
    expect(tryHint('server', { ...READY, modelReady: false, serverRepairNeeded: true })).toBe(TRY_HINTS.repair);
    expect(tryHint('server', { ...READY, modelReady: true, serverRepairNeeded: true })).toBe(TRY_HINTS.repair);
    expect(TRY_HINTS.server).not.toMatch(/model/i);
  });

  it('mentions the model only for the local choice and stays neutral otherwise', () => {
    const notReady = { ...READY, modelReady: false };
    expect(tryHint('local', notReady)).toBe(TRY_HINTS.model);
    expect(tryHint('later', notReady)).toBe(TRY_HINTS.unset);
    expect(tryHint(null, notReady)).toBe(TRY_HINTS.unset);
    expect(TRY_HINTS.unset).toMatch(/^Prepis zatiaľ nie je nastavený/);
  });
});

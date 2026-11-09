import { describe, expect, it } from 'vitest';
import { changeAfterPairing, engineRemedy, isEngineId, orderFix, orderProblem, preferredOrder } from '../src/shared/engine-routing';

const NOTHING = { localReady: false, serverReady: false } as const;
const LOCAL = { localReady: true, serverReady: false } as const;
const SERVER = { localReady: false, serverReady: true } as const;
const BOTH = { localReady: true, serverReady: true } as const;

function now(capabilities: { localReady: boolean; serverReady: boolean }, serverOffline = false) {
  return { ...capabilities, serverOffline };
}

describe('engine routing policy', () => {
  it('keeps the local engine as the server fallback only when its model is ready', () => {
    expect(preferredOrder('server', SERVER)).toEqual(['server']);
    expect(preferredOrder('server', BOTH)).toEqual(['server', 'local']);
  });

  it('never adds a server fallback when local transcription is chosen', () => {
    expect(preferredOrder('local', LOCAL)).toEqual(['local']);
    expect(preferredOrder('local', BOTH)).toEqual(['local']);
  });

  it('suggests the one-click fix only when no engine in the order can transcribe', () => {
    expect(orderFix(['local'], SERVER)).toBe('use-server');
    expect(orderFix(['local', 'server'], SERVER)).toBeNull();
    expect(orderFix(['server'], LOCAL)).toBe('use-local');
    expect(orderFix(['server', 'local'], LOCAL)).toBeNull();
    expect(orderFix(['local'], NOTHING)).toBe('download-model');
    expect(orderFix(['local'], LOCAL)).toBeNull();
  });

  it('names the problem of the first engine only when no engine in the order can transcribe', () => {
    expect(orderProblem(['local'], now(SERVER))).toBe('no-model');
    expect(orderProblem(['local', 'server'], now(SERVER))).toBeNull();
    expect(orderProblem(['local', 'server'], now(SERVER, true))).toBe('no-model');
    expect(orderProblem(['server'], now(LOCAL))).toBe('server-not-paired');
    expect(orderProblem(['server'], now(BOTH, true))).toBe('server-offline');
    expect(orderProblem(['server', 'local'], now(BOTH, true))).toBeNull();
    expect(orderProblem([], now(NOTHING))).toBe('no-model');
  });

  it('remedies each problem with the engine that can take over, then the setup step', () => {
    expect(engineRemedy('no-model', now(SERVER))).toEqual({ action: 'use-server', alternative: 'download-model' });
    expect(engineRemedy('no-model', now(NOTHING))).toEqual({ action: 'download-model', alternative: 'pair-server' });
    expect(engineRemedy('server-not-paired', now(LOCAL))).toEqual({ action: 'use-local', alternative: 'pair-server' });
    expect(engineRemedy('server-not-paired', now(NOTHING))).toEqual({ action: 'pair-server', alternative: 'download-model' });
    expect(engineRemedy('server-offline', now(BOTH, true))).toEqual({ action: 'use-local' });
    expect(engineRemedy('server-offline', now(SERVER, true))).toBeNull();
  });

  it('never offers a paired server that is offline right now as the remedy', () => {
    expect(engineRemedy('no-model', now(SERVER, true))).toEqual({ action: 'download-model', alternative: 'open-server' });
  });

  it('switches to the server after pairing only when the local engine cannot transcribe', () => {
    expect(changeAfterPairing(['local'], false)).toEqual({ kind: 'switched', previous: ['local'], current: ['server'] });
    expect(changeAfterPairing(['local', 'server'], false)).toEqual({ kind: 'switched', previous: ['local', 'server'], current: ['server'] });
    expect(changeAfterPairing(['local'], true)).toEqual({ kind: 'available' });
    expect(changeAfterPairing(['server'], false)).toEqual({ kind: 'unchanged' });
    expect(changeAfterPairing(['server', 'local'], true)).toEqual({ kind: 'unchanged' });
  });

  it('recognises only known engine ids', () => {
    expect(isEngineId('local')).toBe(true);
    expect(isEngineId('server')).toBe(true);
    expect(isEngineId('cloud')).toBe(false);
    expect(isEngineId(['server'])).toBe(false);
  });
});

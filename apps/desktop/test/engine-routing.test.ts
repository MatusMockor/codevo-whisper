import { describe, expect, it } from 'vitest';
import { changeAfterPairing, engineRemedy, isEngineId, orderFix, orderProblem, preferredOrder } from '../src/shared/engine-routing';

const NOTHING = { localReady: false, serverReady: false } as const;
const LOCAL = { localReady: true, serverReady: false } as const;
const SERVER = { localReady: false, serverReady: true } as const;
const BOTH = { localReady: true, serverReady: true } as const;

describe('engine routing policy', () => {
  it('keeps the local engine in the order only when its model is ready', () => {
    expect(preferredOrder('server', SERVER)).toEqual(['server']);
    expect(preferredOrder('server', BOTH)).toEqual(['server', 'local']);
    expect(preferredOrder('local', LOCAL)).toEqual(['local']);
    expect(preferredOrder('local', BOTH)).toEqual(['local', 'server']);
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
    expect(orderProblem(['local'], SERVER, false)).toBe('no-model');
    expect(orderProblem(['local', 'server'], SERVER, false)).toBeNull();
    expect(orderProblem(['local', 'server'], SERVER, true)).toBe('no-model');
    expect(orderProblem(['server'], LOCAL, false)).toBe('server-not-paired');
    expect(orderProblem(['server'], BOTH, true)).toBe('server-offline');
    expect(orderProblem(['server', 'local'], BOTH, true)).toBeNull();
    expect(orderProblem([], NOTHING, false)).toBe('no-model');
  });

  it('remedies each problem with the engine that can take over, then the setup step', () => {
    expect(engineRemedy('no-model', SERVER)).toEqual({ action: 'use-server', alternative: 'download-model' });
    expect(engineRemedy('no-model', NOTHING)).toEqual({ action: 'download-model', alternative: 'pair-server' });
    expect(engineRemedy('server-not-paired', LOCAL)).toEqual({ action: 'use-local', alternative: 'pair-server' });
    expect(engineRemedy('server-not-paired', NOTHING)).toEqual({ action: 'pair-server', alternative: 'download-model' });
    expect(engineRemedy('server-offline', BOTH)).toEqual({ action: 'use-local' });
    expect(engineRemedy('server-offline', SERVER)).toBeNull();
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

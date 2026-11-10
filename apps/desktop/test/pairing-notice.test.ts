import { describe, expect, it } from 'vitest';
import { AVAILABLE_MESSAGE, pairingNotice, switchedMessage } from '../src/renderer/server/pairing-notice';
import { engineConditions } from '../src/renderer/settings/engine-conditions';
import type { PairedServerView, PairingView, ServerView } from '../src/shared/server';

const SERVER: PairedServerView = {
  host: 'gpu.local:8443',
  endpoint: 'wss://gpu.local:8443',
  deviceId: 'dev-1',
  deviceName: 'Mac',
  pairedAt: '2026-11-09T10:00:00.000Z',
  serverFingerprint: 'AAAA',
  deviceFingerprint: 'BBBB',
  status: { kind: 'online', connectMs: 12, serverVersion: '1.0.0' },
  enabled: true,
};

function view(pairing: PairingView, server: PairedServerView | null = SERVER): ServerView {
  return { storage: 'available', server, pairing };
}

const SWITCHED = view({ kind: 'paired', deviceId: 'dev-1', engine: { kind: 'switched', previous: ['local'], current: ['server'] } });
const AVAILABLE = view({ kind: 'paired', deviceId: 'dev-1', engine: { kind: 'available' } });
const NONE: ReadonlySet<string> = new Set();

describe('pairingNotice', () => {
  it('announces the automatic switch with the server host while the switched order is active', () => {
    expect(pairingNotice(SWITCHED, ['server'], NONE)).toEqual({ kind: 'switched', deviceId: 'dev-1', previous: ['local'], message: switchedMessage('gpu.local:8443') });
    expect(switchedMessage('gpu.local:8443')).toBe('Spárované. Prepis sa prepol na server gpu.local:8443. Lokálny model nemáte stiahnutý, takže bez tohto kroku by diktovanie nefungovalo.');
    expect(pairingNotice(SWITCHED, ['local'], NONE)).toBeNull();
    expect(pairingNotice(SWITCHED, ['server'], new Set(['dev-1']))).toBeNull();
  });

  it('offers the server only while the local engine stays first', () => {
    expect(pairingNotice(AVAILABLE, ['local'], NONE)).toEqual({ kind: 'available', deviceId: 'dev-1', message: AVAILABLE_MESSAGE });
    expect(pairingNotice(AVAILABLE, ['server', 'local'], NONE)).toBeNull();
    expect(pairingNotice(AVAILABLE, [], NONE)).toBeNull();
  });

  it('stays silent without a finished pairing of the shown server', () => {
    expect(pairingNotice(view({ kind: 'idle' }), ['server'], NONE)).toBeNull();
    expect(pairingNotice(view({ kind: 'paired', deviceId: 'dev-1', engine: { kind: 'unchanged' } }), ['server'], NONE)).toBeNull();
    expect(pairingNotice(view(SWITCHED.pairing, null), ['server'], NONE)).toBeNull();
    expect(pairingNotice(view(SWITCHED.pairing, { ...SERVER, deviceId: 'dev-2' }), ['server'], NONE)).toBeNull();
  });
});

describe('engineConditions', () => {
  const READY_MODEL = { states: [{ id: 'tiny', status: 'ready', receivedBytes: 4, totalBytes: 4 }], statesLoaded: true } as const;

  it('waits until the model states and the server are loaded', () => {
    expect(engineConditions('tiny', { states: [], statesLoaded: false }, AVAILABLE)).toBeNull();
    expect(engineConditions('tiny', READY_MODEL, null)).toBeNull();
  });

  it('treats a server that needs re-pairing as unusable', () => {
    expect(engineConditions('tiny', READY_MODEL, AVAILABLE)).toEqual({ localReady: true, serverReady: true, serverOffline: false, serverOff: false, serverRepair: false });
    expect(engineConditions(null, READY_MODEL, view({ kind: 'idle' }, { ...SERVER, status: { kind: 'repair-needed', reason: 'device-unknown' } }))).toEqual({ localReady: false, serverReady: false, serverOffline: false, serverOff: false, serverRepair: true });
  });

  it('reports a paired server that is offline right now', () => {
    expect(engineConditions('tiny', READY_MODEL, view({ kind: 'idle' }, { ...SERVER, status: { kind: 'offline' } }))).toEqual({ localReady: true, serverReady: true, serverOffline: true, serverOff: false, serverRepair: false });
    expect(engineConditions('tiny', READY_MODEL, view({ kind: 'idle' }, null))).toEqual({ localReady: true, serverReady: false, serverOffline: false, serverOff: false, serverRepair: false });
  });

  it('treats a switched off server as paired but not usable', () => {
    expect(engineConditions('tiny', READY_MODEL, view({ kind: 'idle' }, { ...SERVER, enabled: false }))).toEqual({ localReady: true, serverReady: false, serverOffline: false, serverOff: true, serverRepair: false });
    expect(engineConditions('tiny', READY_MODEL, view({ kind: 'idle' }, { ...SERVER, enabled: false, status: { kind: 'offline' } }))).toEqual({ localReady: true, serverReady: false, serverOffline: false, serverOff: true, serverRepair: false });
  });
});

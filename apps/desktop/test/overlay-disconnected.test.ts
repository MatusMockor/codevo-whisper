import { describe, expect, it } from 'vitest';
import { MESSAGES, readinessError } from '../src/main/session/overlay-messages';
import type { EngineConditions } from '../src/shared/engine-routing';

function conditions(patch: Partial<EngineConditions>): EngineConditions {
  return { localReady: false, serverReady: false, serverOffline: false, serverOff: false, serverRepair: false, ...patch };
}

describe('server disconnected while preparing a dictation', () => {
  it('offers to connect the server again while it is paired but disconnected', () => {
    expect(readinessError('server-disconnected', conditions({ serverOff: true }))).toEqual({ kind: 'error', message: MESSAGES.serverDisconnected, action: 'enable-server' });
  });

  it('offers pairing when the pairing was removed in the meantime', () => {
    expect(readinessError('server-disconnected', conditions({}))).toEqual({ kind: 'error', message: MESSAGES.serverDisconnected, action: 'pair-server', alternative: 'download-model' });
  });

  it('offers the local engine and pairing when the pairing was removed and a local model is ready', () => {
    expect(readinessError('server-disconnected', conditions({ localReady: true }))).toEqual({ kind: 'error', message: MESSAGES.serverDisconnected, action: 'use-local', alternative: 'pair-server' });
  });

  it('offers no action when a new pairing already replaced the old one', () => {
    expect(readinessError('server-disconnected', conditions({ serverReady: true }))).toEqual({ kind: 'error', message: MESSAGES.serverDisconnected });
  });
});

import { beginPairing, fingerprint, generateKeyPair, parsePairingToken, type KeyPair, type PairingToken, type ServerMessage } from '@codevo-whisper/protocol';
import type { PairingFailure, PairingStep } from '../../shared/server';
import type { PairingRepository } from './pairing-repository';
import { asRemoteFailure, failureForCode, RemoteFailure, type RemoteFailureKind } from './remote-failure';
import type { SecretVault } from './secret-vault';
import { SecureConnection } from './secure-connection';

export type { PairingFailure, PairingStep } from '../../shared/server';

export type PairingOutcome = { kind: 'paired'; deviceId: string } | { kind: 'failed'; failure: PairingFailure };

export type DevicePairingDeps = {
  pairings: Pick<PairingRepository, 'save'>;
  vault: Pick<SecretVault, 'availability'>;
  deviceName: () => Promise<string>;
  clock: () => number;
  timeoutMs: number;
};

const APPROVAL_TIMEOUT_MS = 11 * 60_000;

const FAILURE_BY_KIND: Partial<Record<RemoteFailureKind, PairingFailure>> = {
  offline: 'unreachable',
  timeout: 'unreachable',
  'pairing-closed': 'pairing-closed',
  'pairing-rejected': 'rejected',
  'storage-insecure': 'storage-insecure',
};

function failed(failure: PairingFailure): PairingOutcome {
  return { kind: 'failed', failure };
}

function parseToken(text: string): PairingToken | null {
  try {
    return parsePairingToken(text);
  } catch {
    return null;
  }
}

function approvedDeviceId(message: ServerMessage): string {
  if (message.type === 'pair-result' && message.status === 'approved' && message.deviceId !== undefined) {
    return message.deviceId;
  }
  if (message.type === 'pair-result') {
    throw new RemoteFailure('pairing-rejected');
  }
  if (message.type === 'error') {
    throw new RemoteFailure(failureForCode(message.code), message.code);
  }
  throw new RemoteFailure('protocol', `expected pair-result, got ${message.type}`);
}

function untilAborted(signal: AbortSignal, connection: SecureConnection): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = (): void => {
      connection.close();
      reject(new DOMException('The pairing was cancelled', 'AbortError'));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

export class DevicePairing {
  constructor(private readonly deps: DevicePairingDeps) {}

  async pair(tokenText: string, onStep: (step: PairingStep) => void, signal: AbortSignal): Promise<PairingOutcome> {
    const token = parseToken(tokenText);
    if (token === null) {
      return failed('invalid-token');
    }
    if (this.deps.vault.availability() !== 'available') {
      return failed('storage-insecure');
    }
    onStep({ kind: 'connecting' });
    try {
      return await this.exchange(token, onStep, signal);
    } catch (error) {
      if (signal.aborted) {
        return failed('cancelled');
      }
      return failed(FAILURE_BY_KIND[asRemoteFailure(error, 'protocol').kind] ?? 'failed');
    }
  }

  private async exchange(token: PairingToken, onStep: (step: PairingStep) => void, signal: AbortSignal): Promise<PairingOutcome> {
    const deviceKey = generateKeyPair();
    const connection = await SecureConnection.open(token.endpoint, beginPairing(deviceKey, token), { handshakeTimeoutMs: this.deps.timeoutMs });
    try {
      const deviceName = await this.deps.deviceName();
      onStep({
        kind: 'awaiting-approval',
        connectionFingerprint: fingerprint(connection.handshakeHash),
        deviceFingerprint: fingerprint(deviceKey.publicKey),
        deviceName,
      });
      connection.send({ type: 'pair-request', deviceName });
      const deviceId = approvedDeviceId(await Promise.race([connection.next(APPROVAL_TIMEOUT_MS), untilAborted(signal, connection)]));
      await this.store(token, deviceKey, deviceId, deviceName);
      return { kind: 'paired', deviceId };
    } finally {
      connection.close();
    }
  }

  private store(token: PairingToken, deviceKey: KeyPair, deviceId: string, deviceName: string): Promise<void> {
    return this.deps.pairings.save({
      deviceKey,
      serverPublicKey: token.serverPublicKey,
      endpoint: token.endpoint,
      deviceId,
      deviceName,
      pairedAt: new Date(this.deps.clock()).toISOString(),
    });
  }
}

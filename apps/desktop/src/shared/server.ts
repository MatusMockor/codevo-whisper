import type { PairingEngineChange } from './engine-routing';

export type VaultAvailability = 'available' | 'insecure' | 'unavailable';

export type ServerStatus =
  | { kind: 'unknown' }
  | { kind: 'checking' }
  | { kind: 'online'; connectMs: number; serverVersion: string }
  | { kind: 'offline' }
  | { kind: 'unavailable'; reason: 'busy' | 'failed' | 'storage' }
  | { kind: 'repair-needed'; reason: 'server-key-changed' | 'device-unknown' };

export type PairedServerView = {
  host: string;
  endpoint: string;
  deviceId: string;
  deviceName: string;
  pairedAt: string;
  serverFingerprint: string;
  deviceFingerprint: string;
  status: ServerStatus;
  enabled: boolean;
};

export type PairingStep =
  | { kind: 'connecting' }
  | { kind: 'awaiting-approval'; connectionFingerprint: string; deviceFingerprint: string; deviceName: string };

export type PairingFailure = 'invalid-token' | 'unreachable' | 'pairing-closed' | 'rejected' | 'storage-insecure' | 'cancelled' | 'failed';

export type PairingView = { kind: 'idle' } | PairingStep | { kind: 'paired'; deviceId: string; engine: PairingEngineChange } | { kind: 'failed'; failure: PairingFailure };

export type ServerView = { storage: VaultAvailability; server: PairedServerView | null; pairing: PairingView };

export type DisconnectResult = { revokeCommand: string | null };

export function isServerDown(status: ServerStatus): boolean {
  return status.kind === 'offline' || status.kind === 'unavailable';
}

export const MAX_PAIRING_TOKEN_CHARS = 1024;

export const PAIR_COMMAND = 'docker compose -f infrastructure/compose/compose.yaml exec gateway codevo-whisper pair';

export function revokeCommand(deviceId: string, linux = false): string {
  if (linux) return `codevo-whisper-server revoke ${deviceId}`;
  return `docker compose -f infrastructure/compose/compose.yaml exec gateway codevo-whisper revoke ${deviceId}`;
}

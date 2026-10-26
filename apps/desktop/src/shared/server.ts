export type VaultAvailability = 'available' | 'insecure' | 'unavailable';

export type ServerStatus =
  | { kind: 'unknown' }
  | { kind: 'checking' }
  | { kind: 'online'; connectMs: number; serverVersion: string }
  | { kind: 'offline' }
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
};

export type PairingStep =
  | { kind: 'connecting' }
  | { kind: 'awaiting-approval'; connectionFingerprint: string; deviceFingerprint: string; deviceName: string };

export type PairingFailure = 'invalid-token' | 'unreachable' | 'pairing-closed' | 'rejected' | 'storage-insecure' | 'cancelled' | 'failed';

export type PairingView = { kind: 'idle' } | PairingStep | { kind: 'paired'; deviceId: string } | { kind: 'failed'; failure: PairingFailure };

export type ServerView = { storage: VaultAvailability; server: PairedServerView | null; pairing: PairingView };

export type DisconnectResult = { revokeCommand: string | null };

export const MAX_PAIRING_TOKEN_CHARS = 1024;

export const PAIR_COMMAND = 'docker compose -f infrastructure/compose/compose.yaml exec gateway codevo-whisper pair';

export function revokeCommand(deviceId: string): string {
  return `docker compose -f infrastructure/compose/compose.yaml exec gateway codevo-whisper revoke ${deviceId}`;
}

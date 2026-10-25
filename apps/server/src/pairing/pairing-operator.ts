export type PairingRequest = { deviceName: string; deviceFingerprint: string; handshakeFingerprint: string };

export type PairingDecision = 'approve' | 'reject';

export type PairingEvent = { event: 'paired'; deviceId: string } | { event: 'rejected' } | { event: 'expired' } | { event: 'abandoned' };

export interface PairingOperator {
  decide(request: PairingRequest): Promise<PairingDecision>;
  notify(event: PairingEvent): void;
  onDisconnect(listener: () => void): void;
}

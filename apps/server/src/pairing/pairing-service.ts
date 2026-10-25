import type { HandshakeResult } from '@codevo-whisper/protocol';
import type { SecureChannel } from '../gateway/secure-channel';

export interface PairingService {
  currentSecret(ip: string): Uint8Array | null;
  handle(channel: SecureChannel, handshake: HandshakeResult, ip: string): Promise<void>;
}

export class ClosedPairingService implements PairingService {
  currentSecret(): Uint8Array | null {
    return null;
  }

  handle(channel: SecureChannel): Promise<void> {
    channel.fail('pairing_closed');
    return Promise.resolve();
  }
}

import {
  closeCodeFor,
  decodeOpeningFrame,
  HandshakeMode,
  ProtocolError,
  SecureTransport,
  type ClientMessage,
  type ErrorCode,
  type HandshakeState,
  type KeyPair,
} from '@codevo-whisper/protocol';
import WebSocket from 'ws';
import type { DeviceRepository } from '../devices/device-repository';
import type { Logger } from '../logging/logger';
import type { PairingService } from '../pairing/pairing-service';
import type { TranscriptionQueue } from '../stt/transcription-queue';
import { SERVER_VERSION } from '../version';
import { respondToPairing, respondToSession } from './handshake-responder';
import { closeSocket } from './close-socket';
import type { DeviceAudioBudget } from './device-audio-budget';
import { CLOSE_INTERNAL_ERROR, CLOSE_UNSUPPORTED_DATA } from './limits';
import { WebSocketSecureChannel } from './secure-channel';
import { SessionHandler } from './session-handler';
import type { SessionRegistry } from './session-registry';

export type ConnectionDeps = {
  serverKey: () => KeyPair;
  devices: DeviceRepository;
  queue: TranscriptionQueue;
  pairing: PairingService;
  sessions: SessionRegistry;
  clock: () => number;
  beforeReady: (deviceId: string) => Promise<void>;
  logger: Logger;
  budget: DeviceAudioBudget;
};

const EMPTY = new Uint8Array(0);

type PendingSession = { channel: WebSocketSecureChannel; deviceId: string; publicKey: Uint8Array; serverKey: KeyPair };

export class GatewayConnection {
  private route: (bytes: Uint8Array) => void = (bytes) => {
    this.onOpening(bytes).catch(() => closeSocket(this.socket, CLOSE_INTERNAL_ERROR));
  };

  constructor(
    private readonly socket: WebSocket,
    private readonly ip: string,
    private readonly deps: ConnectionDeps,
    private readonly confirmAdmission: () => void,
  ) {
    socket.on('error', () => undefined);
    socket.on('message', (data: Buffer, isBinary: boolean) => this.onMessage(data, isBinary));
  }

  private onMessage(data: Buffer, isBinary: boolean): void {
    if (!isBinary) {
      closeSocket(this.socket, CLOSE_UNSUPPORTED_DATA);
      return;
    }
    this.route(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  private reject(code: ErrorCode): void {
    closeSocket(this.socket, closeCodeFor(code), code);
  }

  private async onOpening(bytes: Uint8Array): Promise<void> {
    this.route = () => this.reject('bad_message');
    try {
      const frame = decodeOpeningFrame(bytes);
      if (frame.mode === HandshakeMode.Session) {
        await this.acceptSession(frame.noiseMessage);
        return;
      }
      this.acceptPairing(frame.noiseMessage);
    } catch (error) {
      if (error instanceof ProtocolError) {
        this.reject(error.code);
        return;
      }
      closeSocket(this.socket, CLOSE_INTERNAL_ERROR);
    }
  }

  private async acceptSession(noiseMessage: Uint8Array): Promise<void> {
    const serverKey = this.deps.serverKey();
    const handshake = respondToSession(serverKey, noiseMessage);
    const remoteKey = handshake.remoteStaticKey();
    const device = remoteKey === null ? null : await this.deps.devices.findByPublicKey(remoteKey);
    if (this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (device === null) {
      this.reject('unknown_device');
      return;
    }
    const channel = this.establish(handshake);
    const pending: PendingSession = { channel, deviceId: device.id, publicKey: device.publicKey, serverKey };
    channel.onMessage((message) => {
      this.startSession(pending, message).catch(() => channel.close(CLOSE_INTERNAL_ERROR));
    });
  }

  private async startSession(pending: PendingSession, first: ClientMessage): Promise<void> {
    const { channel, deviceId } = pending;
    if (first.type !== 'hello') {
      channel.fail('bad_message');
      return;
    }
    channel.onMessage(() => channel.fail('bad_message'));
    const unregister = this.deps.sessions.add(deviceId, (code) => channel.fail(code));
    channel.onClose(unregister);
    const revocation = await this.revocationOf(pending);
    if (revocation !== null) {
      channel.fail(revocation);
      return;
    }
    await this.deps.devices.touch(deviceId, new Date(this.deps.clock())).catch(() => undefined);
    await this.deps.beforeReady(deviceId);
    if (!channel.isOpen()) {
      return;
    }
    new SessionHandler(channel, deviceId, {
      queue: this.deps.queue,
      clock: this.deps.clock,
      logger: this.deps.logger,
      budget: this.deps.budget,
    });
    channel.send({ type: 'ready', serverVersion: SERVER_VERSION });
  }

  private async revocationOf(pending: PendingSession): Promise<ErrorCode | null> {
    const device = await this.deps.devices.findByPublicKey(pending.publicKey);
    if (this.deps.serverKey() !== pending.serverKey) {
      return 'server_key_changed';
    }
    if (device?.id !== pending.deviceId) {
      return 'revoked';
    }
    return null;
  }

  private acceptPairing(noiseMessage: Uint8Array): void {
    const secret = this.deps.pairing.currentSecret(this.ip);
    if (secret === null) {
      this.reject('pairing_closed');
      return;
    }
    const handshake = respondToPairing(this.deps.serverKey(), secret, noiseMessage);
    const channel = this.establish(handshake);
    void this.deps.pairing.handle(channel, handshake.result(), this.ip).catch(() => channel.fail('pairing_closed'));
  }

  private establish(handshake: HandshakeState): WebSocketSecureChannel {
    this.socket.send(handshake.writeMessage(EMPTY));
    const channel = new WebSocketSecureChannel(this.socket, new SecureTransport(handshake.result()), () => this.confirm());
    this.route = (bytes) => channel.receive(bytes);
    return channel;
  }

  private confirm(): void {
    this.confirmAdmission();
  }
}

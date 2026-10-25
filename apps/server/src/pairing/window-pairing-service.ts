import {
  createPairingSecret,
  encodePairingToken,
  fingerprint,
  type HandshakeResult,
  type KeyPair,
} from '@codevo-whisper/protocol';
import type { DeviceRepository } from '../devices/device-repository';
import type { SecureChannel } from '../gateway/secure-channel';
import { nextPairRequest } from './pair-request';
import type { PairingDecision, PairingOperator } from './pairing-operator';
import type { PairingService } from './pairing-service';
import { TIMED_OUT, withTimeout } from './with-timeout';

export const DEFAULT_PAIRING_TTL_MS = 600_000;
export const MAX_FAILURES_PER_IP = 5;
export const MAX_FAILURES_PER_WINDOW = 20;

export type WindowPairingDeps = {
  serverKey: () => KeyPair;
  endpoint: string;
  devices: DeviceRepository;
  clock: () => number;
};

type PairingWindow = {
  secret: Uint8Array;
  expiresAt: number;
  ttlMs: number;
  operator: PairingOperator;
  timer: NodeJS.Timeout;
  failures: Map<string, number>;
  totalFailures: number;
};

export class WindowPairingService implements PairingService {
  private window: PairingWindow | null = null;
  private generation = 0;

  constructor(private readonly deps: WindowPairingDeps) {}

  open(operator: PairingOperator, ttlMs = DEFAULT_PAIRING_TTL_MS): { token: string; expiresAt: number } {
    this.close();
    const secret = createPairingSecret();
    const expiresAt = this.deps.clock() + ttlMs;
    const timer = setTimeout(() => this.expire(window), ttlMs);
    timer.unref();
    const window: PairingWindow = { secret, expiresAt, ttlMs, operator, timer, failures: new Map(), totalFailures: 0 };
    this.window = window;
    operator.onDisconnect(() => this.discard(window));
    const token = encodePairingToken({ serverPublicKey: this.deps.serverKey().publicKey, secret, endpoint: this.deps.endpoint });
    return { token, expiresAt };
  }

  isOpen(): boolean {
    return this.active() !== null;
  }

  close(): void {
    this.generation += 1;
    const window = this.window;
    if (window === null) {
      return;
    }
    this.discard(window);
    window.operator.notify({ event: 'expired' });
  }

  currentSecret(ip: string): Uint8Array | null {
    const window = this.active();
    if (window === null || this.failedAttempts(ip) >= MAX_FAILURES_PER_IP) {
      return null;
    }
    return window.secret;
  }

  failedAttempts(ip: string): number {
    return this.window?.failures.get(ip) ?? 0;
  }

  async handle(channel: SecureChannel, handshake: HandshakeResult, ip: string): Promise<void> {
    const window = this.active();
    if (window === null) {
      channel.fail('pairing_closed');
      return;
    }
    const deviceName = await nextPairRequest(channel);
    if (deviceName === null) {
      this.recordFailure(window, ip);
      return;
    }
    if (this.active() !== window) {
      channel.fail('pairing_closed');
      return;
    }
    this.discard(window);
    const generation = this.generation;
    const decision = await withTimeout(this.ask(window, handshake, deviceName), window.ttlMs);
    if (decision === TIMED_OUT) {
      channel.fail('pairing_closed');
      window.operator.notify({ event: 'expired' });
      return;
    }
    if (!channel.isOpen()) {
      window.operator.notify({ event: 'abandoned' });
      return;
    }
    if (this.generation !== generation) {
      channel.fail('pairing_closed');
      window.operator.notify({ event: 'expired' });
      return;
    }
    await this.conclude(channel, window.operator, decision, { name: deviceName, publicKey: handshake.remoteStaticKey });
  }

  private ask(window: PairingWindow, handshake: HandshakeResult, deviceName: string): Promise<PairingDecision> {
    return window.operator.decide({
      deviceName,
      deviceFingerprint: fingerprint(handshake.remoteStaticKey),
      handshakeFingerprint: fingerprint(handshake.handshakeHash),
    });
  }

  private async conclude(
    channel: SecureChannel,
    operator: PairingOperator,
    decision: PairingDecision,
    device: { name: string; publicKey: Uint8Array },
  ): Promise<void> {
    if (decision === 'reject') {
      channel.send({ type: 'pair-result', status: 'rejected' });
      channel.close();
      operator.notify({ event: 'rejected' });
      return;
    }
    const added = await this.deps.devices.add(device.name, device.publicKey);
    channel.send({ type: 'pair-result', status: 'approved', deviceId: added.id });
    channel.close();
    operator.notify({ event: 'paired', deviceId: added.id });
  }

  private recordFailure(window: PairingWindow, ip: string): void {
    if (this.window !== window) {
      return;
    }
    window.failures.set(ip, (window.failures.get(ip) ?? 0) + 1);
    window.totalFailures += 1;
    if (window.totalFailures < MAX_FAILURES_PER_WINDOW) {
      return;
    }
    this.discard(window);
    window.operator.notify({ event: 'failed' });
  }

  private active(): PairingWindow | null {
    const window = this.window;
    if (window === null) {
      return null;
    }
    if (this.deps.clock() >= window.expiresAt) {
      this.expire(window);
      return null;
    }
    return window;
  }

  private expire(window: PairingWindow): void {
    if (this.window !== window) {
      return;
    }
    this.discard(window);
    window.operator.notify({ event: 'expired' });
  }

  private discard(window: PairingWindow): void {
    clearTimeout(window.timer);
    if (this.window === window) {
      this.window = null;
    }
  }
}

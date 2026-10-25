import { fingerprint } from '@codevo-whisper/protocol';
import type { DeviceRepository } from '../devices/device-repository';
import type { SessionRegistry } from '../gateway/session-registry';
import type { ServerKeyHolder } from '../keys/server-key-holder';
import type { WindowPairingService } from '../pairing/window-pairing-service';
import type { SttHealthCheck } from '../stt/stt-client';
import { SERVER_VERSION } from '../version';
import { AdminPairingOperator } from './admin-pairing-operator';
import type { LineChannel } from './line-channel';

export interface PendingJobs {
  pendingJobs(): number;
}

export type AdminDeps = {
  pairing: WindowPairingService;
  devices: DeviceRepository;
  sessions: SessionRegistry;
  jobs: PendingJobs;
  keys: ServerKeyHolder;
  stt: SttHealthCheck;
};

export class AdminCommands {
  constructor(private readonly deps: AdminDeps) {}

  async pair(channel: LineChannel, ttlMs?: number): Promise<void> {
    const operator = new AdminPairingOperator(channel);
    const { token, expiresAt } = this.deps.pairing.open(operator, ttlMs);
    channel.send({ event: 'token', token, expiresAt });
    await operator.finished;
  }

  async devices(): Promise<object> {
    const devices = await this.deps.devices.list();
    return {
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        pairedAt: device.pairedAt,
        lastSeenAt: device.lastSeenAt,
        fingerprint: fingerprint(device.publicKey),
      })),
    };
  }

  async revoke(deviceId: string): Promise<object> {
    const revoked = await this.deps.devices.remove(deviceId);
    const closedSessions = this.deps.sessions.closeDevice(deviceId, 'revoked');
    return { revoked, closedSessions };
  }

  async rotateKey(): Promise<object> {
    this.deps.pairing.beginRotation();
    try {
      const key = await this.deps.keys.rotate();
      this.deps.sessions.closeAll('server_key_changed');
      await this.deps.devices.removeAll();
      return { rotated: true, fingerprint: fingerprint(key.publicKey) };
    } finally {
      this.deps.pairing.endRotation();
    }
  }

  async status(): Promise<object> {
    const devices = await this.deps.devices.list();
    return {
      version: SERVER_VERSION,
      devices: devices.length,
      activeSessions: this.deps.sessions.count(),
      queue: this.deps.jobs.pendingJobs(),
      stt: await this.deps.stt.health(),
    };
  }
}

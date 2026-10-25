import type { KeyPair } from '@codevo-whisper/protocol';
import { AdminCommands } from './admin/admin-commands';
import { startAdminServer } from './admin/admin-server';
import type { ServerConfig } from './config';
import type { DeviceRepository } from './devices/device-repository';
import { FileDeviceRepository } from './devices/file-device-repository';
import { startGateway, type Gateway } from './gateway/gateway';
import { ServerKeyHolder } from './keys/server-key-holder';
import { ServerKeyStore } from './keys/server-key-store';
import { silentLogger, type Logger } from './logging/logger';
import { WindowPairingService } from './pairing/window-pairing-service';
import { HttpSttClient } from './stt/http-stt-client';
import { DEFAULT_WAIT_TIMEOUT_MS, TranscriptionQueue } from './stt/transcription-queue';

export type ServerOptions = {
  clock?: () => number;
  handshakeTimeoutMs?: number;
  waitTimeoutMs?: number;
  logger?: Logger;
  beforeReady?: (deviceId: string) => Promise<void>;
};

export type RunningServer = {
  config: ServerConfig;
  gateway: Gateway;
  readonly serverKey: KeyPair;
  devices: DeviceRepository;
  queue: TranscriptionQueue;
  pairing: WindowPairingService;
  close(): Promise<void>;
};

export async function startServer(config: ServerConfig, options: ServerOptions = {}): Promise<RunningServer> {
  const clock = options.clock ?? Date.now;
  const keys = await ServerKeyHolder.load(new ServerKeyStore(config.dataDir));
  const devices = new FileDeviceRepository(config.dataDir);
  const stt = new HttpSttClient(config.sttUrl);
  const queue = new TranscriptionQueue(stt, { waitTimeoutMs: options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS });
  const pairing = new WindowPairingService({ serverKey: () => keys.current(), endpoint: config.publicEndpoint, devices, clock });
  const gateway = await startGateway({
    config,
    serverKey: () => keys.current(),
    devices,
    queue,
    pairing,
    clock,
    logger: options.logger ?? silentLogger,
    ...(options.handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    ...(options.beforeReady === undefined ? {} : { beforeReady: options.beforeReady }),
  });
  const commands = new AdminCommands({ pairing, devices, sessions: gateway.sessions, queue, keys, stt });
  const admin = await startAdminServer(config.adminSocket, commands).catch(async (error: unknown) => {
    await gateway.close();
    throw error;
  });
  return {
    config,
    gateway,
    get serverKey() {
      return keys.current();
    },
    devices,
    queue,
    pairing,
    close: async () => {
      pairing.close();
      await admin.close();
      await gateway.close();
    },
  };
}

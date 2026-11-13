import { TranscriptionDispatcher } from '@codevo-whisper/audio';
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
import { refreshEvery, SttCapabilityCache } from './stt/capability-cache';
import { HttpSttClient } from './stt/http-stt-client';
import type { GatewayDispatcher } from './stt/gateway-context';
import { SttSegmentTranscriber } from './stt/stt-segment-transcriber';
import { DeviceGuardedTranscriber } from './stt/device-guarded-transcriber';
import { CAPABILITY_REFRESH_MS, ENGINE_GUARD_LIMITS } from './gateway/limits';

export type ServerOptions = {
  clock?: () => number;
  handshakeTimeoutMs?: number;
  logger?: Logger;
  beforeReady?: (deviceId: string) => Promise<void>;
  serverVersion?: string;
};

export type RunningServer = {
  config: ServerConfig;
  gateway: Gateway;
  readonly serverKey: KeyPair;
  devices: DeviceRepository;
  dispatcher: GatewayDispatcher;
  pairing: WindowPairingService;
  close(): Promise<void>;
};

export async function startServer(config: ServerConfig, options: ServerOptions = {}): Promise<RunningServer> {
  const clock = options.clock ?? Date.now;
  const keys = await ServerKeyHolder.load(new ServerKeyStore(config.dataDir));
  const devices = new FileDeviceRepository(config.dataDir);
  const stt = new HttpSttClient(config.sttUrl);
  const transcriber = new DeviceGuardedTranscriber(new SttSegmentTranscriber(stt), clock, ENGINE_GUARD_LIMITS);
  const dispatcher: GatewayDispatcher = new TranscriptionDispatcher({ transcriber, clock: { now: clock } });
  const capabilities = new SttCapabilityCache(stt);
  const pairing = new WindowPairingService({ serverKey: () => keys.current(), endpoint: config.publicEndpoint, devices, clock });
  const gateway = await startGateway({
    config,
    serverKey: () => keys.current(),
    devices,
    dispatcher,
    pairing,
    capabilities,
    clock,
    logger: options.logger ?? silentLogger,
    ...(options.handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    ...(options.beforeReady === undefined ? {} : { beforeReady: options.beforeReady }),
    ...(options.serverVersion === undefined ? {} : { serverVersion: options.serverVersion }),
  });
  const commands = new AdminCommands({ pairing, devices, sessions: gateway.sessions, jobs: dispatcher, keys, stt });
  const admin = await startAdminServer(config.adminSocket, commands).catch(async (error: unknown) => {
    await gateway.close();
    throw error;
  });
  const stopRefreshing = refreshEvery(capabilities, CAPABILITY_REFRESH_MS);
  return {
    config,
    gateway,
    get serverKey() {
      return keys.current();
    },
    devices,
    dispatcher,
    pairing,
    close: async () => {
      const stopped = stopRefreshing();
      pairing.close();
      try {
        await admin.close();
        await gateway.close();
      } finally {
        await stopped;
      }
    },
  };
}

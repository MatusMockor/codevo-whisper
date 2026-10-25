import type { KeyPair } from '@codevo-whisper/protocol';
import type { ServerConfig } from './config';
import type { DeviceRepository } from './devices/device-repository';
import { FileDeviceRepository } from './devices/file-device-repository';
import { startGateway, type Gateway } from './gateway/gateway';
import { ServerKeyStore } from './keys/server-key-store';
import { silentLogger, type Logger } from './logging/logger';
import { ClosedPairingService } from './pairing/pairing-service';
import { HttpSttClient } from './stt/http-stt-client';
import { DEFAULT_WAIT_TIMEOUT_MS, TranscriptionQueue } from './stt/transcription-queue';

export type ServerOptions = {
  clock?: () => number;
  handshakeTimeoutMs?: number;
  waitTimeoutMs?: number;
  logger?: Logger;
};

export type RunningServer = {
  gateway: Gateway;
  serverKey: KeyPair;
  devices: DeviceRepository;
  queue: TranscriptionQueue;
  close(): Promise<void>;
};

export async function startServer(config: ServerConfig, options: ServerOptions = {}): Promise<RunningServer> {
  const serverKey = await new ServerKeyStore(config.dataDir).loadOrCreate();
  const devices = new FileDeviceRepository(config.dataDir);
  const queue = new TranscriptionQueue(new HttpSttClient(config.sttUrl), {
    waitTimeoutMs: options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
  });
  const gateway = await startGateway({
    config,
    serverKey,
    devices,
    queue,
    pairing: new ClosedPairingService(),
    logger: options.logger ?? silentLogger,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
  });
  return { gateway, serverKey, devices, queue, close: () => gateway.close() };
}

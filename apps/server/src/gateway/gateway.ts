import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { KeyPair } from '@codevo-whisper/protocol';
import { WebSocketServer } from 'ws';
import type { ServerConfig } from '../config';
import type { DeviceRepository } from '../devices/device-repository';
import { silentLogger, type Logger } from '../logging/logger';
import type { PairingService } from '../pairing/pairing-service';
import type { TranscriptionQueue } from '../stt/transcription-queue';
import { GatewayConnection } from './connection';
import { CLOSE_GOING_AWAY, HANDSHAKE_TIMEOUT_MS, MAX_AUDIO_SECONDS, MAX_WS_PAYLOAD, PRE_AUTH_LIMITS } from './limits';
import { BYTES_PER_SECOND } from '../stt/chunk-audio';
import { DeviceAudioBudget } from './device-audio-budget';
import { PreAuthLimiter } from './pre-auth-limiter';
import { TcpAdmission } from './tcp-admission';
import { SessionRegistry } from './session-registry';

export type GatewayDeps = {
  config: ServerConfig;
  serverKey: KeyPair | (() => KeyPair);
  devices: DeviceRepository;
  queue: TranscriptionQueue;
  pairing: PairingService;
  clock?: () => number;
  handshakeTimeoutMs?: number;
  logger?: Logger;
  beforeReady?: (deviceId: string) => Promise<void>;
};

export type Gateway = { port: number; close(): Promise<void>; sessions: SessionRegistry; limiter: PreAuthLimiter };

function keyProvider(serverKey: GatewayDeps['serverKey']): () => KeyPair {
  if (typeof serverKey === 'function') {
    return serverKey;
  }
  return () => serverKey;
}

export async function startGateway(deps: GatewayDeps): Promise<Gateway> {
  const sessions = new SessionRegistry();
  const limiter = new PreAuthLimiter(PRE_AUTH_LIMITS);
  const server = createServer((_request, response) => {
    response.writeHead(426, { 'content-type': 'text/plain' });
    response.end('WebSocket upgrade required\n');
  });
  const admission = new TcpAdmission(limiter, deps.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS);
  server.headersTimeout = deps.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  server.requestTimeout = deps.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  server.on('connection', (socket) => admission.admit(socket));
  const sockets = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: MAX_WS_PAYLOAD, maxFragments: 1 });
  const connectionDeps = {
    serverKey: keyProvider(deps.serverKey),
    devices: deps.devices,
    queue: deps.queue,
    pairing: deps.pairing,
    sessions,
    clock: deps.clock ?? Date.now,
    beforeReady: deps.beforeReady ?? (() => Promise.resolve()),
    budget: new DeviceAudioBudget(MAX_AUDIO_SECONDS * BYTES_PER_SECOND),
    logger: deps.logger ?? silentLogger,
  };
  sockets.on('error', () => undefined);
  sockets.on('connection', (socket, request) => {
    admission.attach(request.socket, socket);
    new GatewayConnection(socket, request.socket.remoteAddress ?? 'unknown', connectionDeps, () => admission.confirm(request.socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(deps.config.port, deps.config.bind, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    port,
    sessions,
    limiter,
    close: async () => {
      sockets.clients.forEach((socket) => socket.close(CLOSE_GOING_AWAY));
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

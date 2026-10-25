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
import { CLOSE_GOING_AWAY, HANDSHAKE_TIMEOUT_MS, MAX_WS_PAYLOAD, PRE_AUTH_LIMITS } from './limits';
import { PreAuthLimiter } from './pre-auth-limiter';
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
  const sockets = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: MAX_WS_PAYLOAD });
  const connectionDeps = {
    serverKey: keyProvider(deps.serverKey),
    devices: deps.devices,
    queue: deps.queue,
    pairing: deps.pairing,
    sessions,
    limiter,
    clock: deps.clock ?? Date.now,
    handshakeTimeoutMs: deps.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS,
    logger: deps.logger ?? silentLogger,
  };
  sockets.on('error', () => undefined);
  sockets.on('connection', (socket, request) => GatewayConnection.accept(socket, request.socket.remoteAddress ?? 'unknown', connectionDeps));
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

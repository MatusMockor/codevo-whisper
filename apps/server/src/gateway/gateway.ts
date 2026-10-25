import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { KeyPair } from '@codevo-whisper/protocol';
import { WebSocketServer } from 'ws';
import type { ServerConfig } from '../config';
import type { DeviceRepository } from '../devices/device-repository';
import { silentLogger, type Logger } from '../logging/logger';
import type { PairingService } from '../pairing/pairing-service';
import type { GatewayDispatcher } from '../stt/gateway-context';
import { GatewayConnection } from './connection';
import { ClientAdmission } from './client-admission';
import { HANDSHAKE_TIMEOUT_MS, INGESTION_LIMITS, MAX_AUDIO_SECONDS, MAX_WS_PAYLOAD, PRE_AUTH_LIMITS, PROXIED_TCP_LIMITS } from './limits';
import { BYTES_PER_SECOND } from './pcm';
import { IngestionLimiter } from './ingestion-limiter';
import { DeviceAudioBudget } from './device-audio-budget';
import { PreAuthLimiter } from './pre-auth-limiter';
import { TcpAdmission } from './tcp-admission';
import { SessionRegistry } from './session-registry';
import { closeClients } from './shutdown';

export type GatewayDeps = {
  config: ServerConfig;
  serverKey: KeyPair | (() => KeyPair);
  devices: DeviceRepository;
  dispatcher: GatewayDispatcher;
  pairing: PairingService;
  clock?: () => number;
  handshakeTimeoutMs?: number;
  logger?: Logger;
  beforeReady?: (deviceId: string) => Promise<void>;
};

export type Gateway = {
  port: number;
  close(): Promise<void>;
  sessions: SessionRegistry;
  limiter: PreAuthLimiter;
  clientLimiter: PreAuthLimiter | null;
};

function keyProvider(serverKey: GatewayDeps['serverKey']): () => KeyPair {
  if (typeof serverKey === 'function') {
    return serverKey;
  }
  return () => serverKey;
}

export async function startGateway(deps: GatewayDeps): Promise<Gateway> {
  const sessions = new SessionRegistry();
  const clock = deps.clock ?? Date.now;
  const trustedHeader = deps.config.trustedProxyHeader;
  const limiter = new PreAuthLimiter(trustedHeader === null ? PRE_AUTH_LIMITS : PROXIED_TCP_LIMITS);
  const clientLimiter = trustedHeader === null ? null : new PreAuthLimiter(PRE_AUTH_LIMITS);
  const server = createServer((_request, response) => {
    response.writeHead(426, { 'content-type': 'text/plain' });
    response.end('WebSocket upgrade required\n');
  });
  const admission = new TcpAdmission(limiter, deps.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS);
  server.headersTimeout = deps.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  server.requestTimeout = deps.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  server.on('connection', (socket) => admission.admit(socket));
  const clients = new ClientAdmission(trustedHeader, clientLimiter);
  const sockets = new WebSocketServer({
    server,
    perMessageDeflate: false,
    maxPayload: MAX_WS_PAYLOAD,
    maxFragments: 1,
    verifyClient: (info, done) => done(clients.admit(info.req), 503),
  });
  const connectionDeps = {
    serverKey: keyProvider(deps.serverKey),
    devices: deps.devices,
    dispatcher: deps.dispatcher,
    pairing: deps.pairing,
    sessions,
    clock,
    beforeReady: deps.beforeReady ?? (() => Promise.resolve()),
    budget: new DeviceAudioBudget(MAX_AUDIO_SECONDS * BYTES_PER_SECOND),
    ingestion: new IngestionLimiter(clock, INGESTION_LIMITS),
    logger: deps.logger ?? silentLogger,
  };
  sockets.on('error', () => undefined);
  sockets.on('connection', (socket, request) => {
    const ip = clients.addressOf(request);
    admission.attach(request.socket, socket);
    new GatewayConnection(socket, ip, connectionDeps, () => {
      admission.confirm(request.socket);
      clients.confirm(request);
    });
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
    clientLimiter,
    close: async () => {
      await closeClients(sockets.clients);
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

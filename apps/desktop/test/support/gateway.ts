import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, parsePairingToken, type KeyPair } from '@codevo-whisper/protocol';
import { expect } from 'vitest';
import { connectAdmin, type AdminConnection } from '../../../server/src/admin/admin-client';
import { startServer, type RunningServer, type ServerOptions } from '../../../server/src/app';
import { startFakeSttServer, type FakeSttBehaviour, type FakeSttServer } from '../../../server/test/support/fake-stt-server';
import type { ServerPairing } from '../../src/main/remote/pairing-repository';
import { freePort } from './free-port';

export { freePort } from './free-port';

export type TestGatewayOptions = { stt?: FakeSttBehaviour; publicEndpoint?: (port: number) => string; server?: ServerOptions };

export type PairingWindow = { admin: AdminConnection; token: string };

export type TestGateway = {
  server: RunningServer;
  stt: FakeSttServer;
  port: number;
  url: string;
  dataDir: string;
  addDevice(name?: string): Promise<ServerPairing>;
  openPairingWindow(ttlMs?: number): Promise<PairingWindow>;
  admin(command: object): Promise<unknown>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  close(): Promise<void>;
};

function pairingFor(server: RunningServer, endpoint: string, deviceKey: KeyPair, deviceId: string, deviceName: string): ServerPairing {
  return { deviceKey, serverPublicKey: server.serverKey.publicKey, endpoint, deviceId, deviceName, pairedAt: '2026-10-26T08:00:00.000Z' };
}

function isTokenEvent(value: unknown): value is { event: 'token'; token: string } {
  return typeof value === 'object' && value !== null && (value as { event?: unknown }).event === 'token';
}

export async function startTestGateway(options: TestGatewayOptions = {}): Promise<TestGateway> {
  const dataDir = await mkdtemp(join(tmpdir(), 'cw-desktop-gw-'));
  const stt = await startFakeSttServer(options.stt);
  const port = await freePort();
  const url = `ws://127.0.0.1:${port}`;
  const publicEndpoint = options.publicEndpoint?.(port) ?? url;
  const config = { bind: '127.0.0.1', port, dataDir, adminSocket: join(dataDir, 'admin.sock'), sttUrl: stt.url, publicEndpoint, trustedProxyHeader: null };
  let server = await startServer(config, options.server);
  let running = true;
  const gateway: TestGateway = {
    get server() {
      return server;
    },
    stt,
    port,
    url,
    dataDir,
    addDevice: async (name = 'Test Mac') => {
      const deviceKey = generateKeyPair();
      const device = await server.devices.add(name, deviceKey.publicKey);
      return pairingFor(server, publicEndpoint, deviceKey, device.id, name);
    },
    openPairingWindow: async (ttlMs) => {
      const admin = await connectAdmin(config.adminSocket);
      admin.send(ttlMs === undefined ? { cmd: 'pair' } : { cmd: 'pair', ttlMs });
      const event = await admin.next();
      expect(isTokenEvent(event)).toBe(true);
      const token = isTokenEvent(event) ? event.token : '';
      expect(parsePairingToken(token).endpoint).toBe(publicEndpoint);
      return { admin, token };
    },
    admin: async (command) => {
      const admin = await connectAdmin(config.adminSocket);
      admin.send(command);
      const reply = await admin.next();
      admin.close();
      return reply;
    },
    stop: async () => {
      if (!running) {
        return;
      }
      running = false;
      await server.close();
    },
    restart: async () => {
      await gateway.stop();
      server = await startServer(config, options.server);
      running = true;
    },
    close: async () => {
      await gateway.stop();
      await stt.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
  return gateway;
}

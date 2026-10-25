import { join } from 'node:path';
import { generateKeyPair, type KeyPair } from '@codevo-whisper/protocol';
import { startServer, type RunningServer, type ServerOptions } from '../../src/app';
import type { ServerConfig } from '../../src/config';

export type Harness = RunningServer & { url: string; addDevice(name?: string): Promise<KeyPair> };

export function testConfig(dataDir: string, sttUrl: string): ServerConfig {
  return {
    bind: '127.0.0.1',
    port: 0,
    dataDir,
    adminSocket: join(dataDir, 'admin.sock'),
    sttUrl,
    publicEndpoint: 'ws://127.0.0.1:8787',
  };
}

export async function startHarness(dataDir: string, sttUrl: string, options: ServerOptions = {}): Promise<Harness> {
  const server = await startServer(testConfig(dataDir, sttUrl), options);
  return {
    ...server,
    url: `ws://127.0.0.1:${server.gateway.port}`,
    addDevice: async (name = 'Test device') => {
      const device = generateKeyPair();
      await server.devices.add(name, device.publicKey);
      return device;
    },
  };
}

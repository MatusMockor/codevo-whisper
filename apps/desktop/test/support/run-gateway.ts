import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../../server/src/app';
import { ROUTING_STT, startFakeSttServer, type FakeSttRequest, type FakeSttResponse } from '../../../server/test/support/fake-stt-server';
import { freePort } from './free-port';

type GatewayOptions = { serverVersion?: string; languageModels?: boolean; failWhileFile?: string; sttDelayMs?: number };

function transcript(request: FakeSttRequest): FakeSttResponse {
  if (request.languages === undefined) {
    return { status: 200, body: { text: 'prepis zo servera' } };
  }
  return { status: 200, body: { text: `prepis v jazykoch ${request.languages.join(' ')}`, language: request.languages[0] ?? null, route: 'conditioned' } };
}

const options = JSON.parse(process.argv[2] ?? '{}') as GatewayOptions;

function respond(_pcm: Uint8Array, _language: string, request: FakeSttRequest): FakeSttResponse {
  process.stdout.write(`${JSON.stringify(request)}\n`);
  if (options.failWhileFile !== undefined && existsSync(options.failWhileFile)) return { status: 500, body: {} };
  return transcript(request);
}
const dataDir = await mkdtemp(join(tmpdir(), 'cw-e2e-gw-'));
const stt = await startFakeSttServer({ respond, delayMs: options.sttDelayMs ?? 0, ...(options.languageModels === true ? { capabilities: ROUTING_STT } : {}) });
const port = await freePort();
const url = `ws://127.0.0.1:${port}`;
const adminSocket = join(dataDir, 'admin.sock');
const server = await startServer({ bind: '127.0.0.1', port, dataDir, adminSocket, sttUrl: stt.url, publicEndpoint: url, trustedProxyHeader: null }, options.serverVersion === undefined ? {} : { serverVersion: options.serverVersion });

process.stdout.write(`${JSON.stringify({ port, url, adminSocket })}\n`);

async function shutdown(): Promise<void> {
  await server.close();
  await stt.close();
  await rm(dataDir, { recursive: true, force: true });
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown());
process.stdin.on('end', () => void shutdown());
process.stdin.resume();

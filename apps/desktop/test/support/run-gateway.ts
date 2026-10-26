import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../../server/src/app';
import { startFakeSttServer } from '../../../server/test/support/fake-stt-server';
import { freePort } from './free-port';

const dataDir = await mkdtemp(join(tmpdir(), 'cw-e2e-gw-'));
const stt = await startFakeSttServer({ respond: () => ({ status: 200, body: { text: 'prepis zo servera' } }) });
const port = await freePort();
const url = `ws://127.0.0.1:${port}`;
const adminSocket = join(dataDir, 'admin.sock');
const server = await startServer({ bind: '127.0.0.1', port, dataDir, adminSocket, sttUrl: stt.url, publicEndpoint: url, trustedProxyHeader: null });

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

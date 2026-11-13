import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { FakeSttRequest } from '../../server/test/support/fake-stt-server';

const runner = fileURLToPath(new URL('../test/support/run-gateway.ts', import.meta.url));
const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

export type LocalGatewayOptions = { serverVersion?: string; languageModels?: boolean; failWhileFile?: string };

export type AdminConnection = { send(value: object): void; next(): Promise<unknown>; close(): void };

export type LocalGateway = {
  port: number;
  url: string;
  openPairingWindow(): Promise<{ admin: AdminConnection; token: string }>;
  admin(command: object): Promise<unknown>;
  sttRequests(): readonly FakeSttRequest[];
  close(): Promise<void>;
};

type Started = { port: number; url: string; adminSocket: string };

async function connectAdmin(path: string): Promise<AdminConnection> {
  const socket = connect(path);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  const lines: string[] = [];
  const waiters: Array<(line: string | null) => void> = [];
  const reader = createInterface({ input: socket });
  reader.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter === undefined) {
      lines.push(line);
      return;
    }
    waiter(line);
  });
  reader.on('close', () => waiters.splice(0).forEach((waiter) => waiter(null)));
  return {
    send: (value) => socket.write(`${JSON.stringify(value)}\n`),
    next: async () => {
      const line = lines.shift() ?? (await new Promise<string | null>((resolve) => waiters.push(resolve)));
      return line === null ? null : (JSON.parse(line) as unknown);
    },
    close: () => socket.end(),
  };
}

function tokenOf(event: unknown): string {
  const token = (event as { token?: unknown } | null)?.token;
  return typeof token === 'string' ? token : '';
}

function readOutput(child: ChildProcessWithoutNullStreams, sttRequests: FakeSttRequest[]): Promise<Started> {
  return new Promise((resolve, reject) => {
    const reader = createInterface({ input: child.stdout });
    reader.once('line', (line) => {
      resolve(JSON.parse(line) as Started);
      reader.on('line', (request) => sttRequests.push(JSON.parse(request) as FakeSttRequest));
    });
    child.once('exit', (code) => reject(new Error(`the gateway exited with ${code}`)));
  });
}

export async function startLocalGateway(options: LocalGatewayOptions = {}): Promise<LocalGateway> {
  const child = spawn(tsx, [runner, JSON.stringify(options)], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  const sttRequests: FakeSttRequest[] = [];
  const started = await readOutput(child, sttRequests);
  const admin = async (command: object): Promise<unknown> => {
    const connection = await connectAdmin(started.adminSocket);
    connection.send(command);
    const reply = await connection.next();
    connection.close();
    return reply;
  };
  return {
    port: started.port,
    url: started.url,
    admin,
    sttRequests: () => sttRequests,
    openPairingWindow: async () => {
      const connection = await connectAdmin(started.adminSocket);
      connection.send({ cmd: 'pair' });
      return { admin: connection, token: tokenOf(await connection.next()) };
    },
    close: async () => {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.stdin.end();
      await exited;
    },
  };
}

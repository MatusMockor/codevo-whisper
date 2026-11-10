import { connect, createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

export type DropProxy = {
  url: string;
  port: number;
  connections(): number;
  clientBytes(): number;
  heldReplies(): number;
  holdRepliesAfter(passed: number): void;
  releaseReplies(): void;
  stallClients(): void;
  resumeClients(): void;
  dropAll(): void;
  freezeAll(): void;
  blackhole(): void;
  close(): Promise<void>;
};

const WEBSOCKET_UPGRADE = /^GET [^\r\n]* HTTP\/1\.1\r\n(?:[^\r\n]+\r\n)*upgrade:\s*websocket\r\n/i;

const HEAD_END = '\r\n\r\n';

const MAX_HEAD_BYTES = 16 * 1024;

function isWebSocketRequest(request: Buffer): boolean {
  return WEBSOCKET_UPGRADE.test(request.toString('latin1'));
}

function readRequestHead(client: Socket, onHead: (head: Buffer) => void): void {
  let buffered = Buffer.alloc(0);
  const abort = (): void => {
    client.off('data', onData);
    client.destroy();
  };
  const onData = (chunk: Buffer): void => {
    buffered = Buffer.concat([buffered, chunk]);
    const end = buffered.indexOf(HEAD_END);
    if (end === -1 && buffered.length >= MAX_HEAD_BYTES) {
      abort();
      return;
    }
    if (end === -1) {
      return;
    }
    if (end + HEAD_END.length > MAX_HEAD_BYTES) {
      abort();
      return;
    }
    client.off('data', onData);
    client.off('end', abort);
    client.pause();
    onHead(buffered);
  };
  client.on('data', onData);
  client.once('end', abort);
}

export async function startDropProxy(targetPort: number, port = 0): Promise<DropProxy> {
  const sockets = new Set<Socket>();
  let connections = 0;
  let clientBytes = 0;
  let swallowing = false;
  let replyLimit: number | null = null;
  const clients = new Map<Socket, Socket>();
  const held: Array<{ client: Socket; chunk: Buffer }> = [];
  const countFrom = (client: Socket): void => {
    client.on('data', (chunk: Buffer) => {
      clientBytes += chunk.length;
    });
  };
  const track = (socket: Socket): void => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  };
  const relay = (client: Socket, request: Buffer): void => {
    const upstream = connect(targetPort, '127.0.0.1');
    track(upstream);
    upstream.write(request);
    countFrom(client);
    clients.set(client, upstream);
    client.on('close', () => clients.delete(client));
    client.pipe(upstream);
    let passed = 0;
    upstream.on('data', (chunk: Buffer) => {
      if (replyLimit !== null && passed >= replyLimit) {
        held.push({ client, chunk });
        return;
      }
      passed += 1;
      client.write(chunk);
    });
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  };
  const server = createServer((client) => {
    track(client);
    readRequestHead(client, (request) => {
      if (!isWebSocketRequest(request)) {
        client.destroy();
        return;
      }
      connections += 1;
      if (swallowing) {
        countFrom(client);
        client.resume();
        return;
      }
      relay(client, request);
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = (server.address() as AddressInfo).port;
  return {
    url: `ws://127.0.0.1:${actual}`,
    port: actual,
    connections: () => connections,
    clientBytes: () => clientBytes,
    heldReplies: () => held.length,
    holdRepliesAfter: (passed) => {
      replyLimit = passed;
    },
    releaseReplies: () => {
      replyLimit = null;
      held.splice(0).forEach(({ client, chunk }) => client.write(chunk));
    },
    stallClients: () =>
      clients.forEach((upstream, client) => {
        client.unpipe(upstream);
        client.pause();
      }),
    resumeClients: () => clients.forEach((upstream, client) => client.pipe(upstream)),
    dropAll: () => sockets.forEach((socket) => socket.destroy()),
    blackhole: () => {
      swallowing = true;
    },
    freezeAll: () =>
      sockets.forEach((socket) => {
        socket.unpipe();
        socket.pause();
      }),
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((socket) => socket.destroy());
        server.close(() => resolve());
      }),
  };
}

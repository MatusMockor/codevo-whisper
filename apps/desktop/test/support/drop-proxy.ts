import { connect, createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

export type DropProxy = { url: string; port: number; connections(): number; dropAll(): void; freezeAll(): void; close(): Promise<void> };

export async function startDropProxy(targetPort: number, port = 0): Promise<DropProxy> {
  const sockets = new Set<Socket>();
  let connections = 0;
  const track = (socket: Socket): void => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  };
  const server = createServer((client) => {
    connections += 1;
    const upstream = connect(targetPort, '127.0.0.1');
    track(client);
    track(upstream);
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = (server.address() as AddressInfo).port;
  return {
    url: `ws://127.0.0.1:${actual}`,
    port: actual,
    connections: () => connections,
    dropAll: () => sockets.forEach((socket) => socket.destroy()),
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

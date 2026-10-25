import { createServer, connect, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

export type RecordingProxy = { port: number; bytes(): Uint8Array; close(): Promise<void> };

export async function startRecordingProxy(targetPort: number): Promise<RecordingProxy> {
  const recorded: Buffer[] = [];
  const sockets = new Set<Socket>();
  const track = (socket: Socket): void => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  };
  const server = createServer((client) => {
    const upstream = connect(targetPort, '127.0.0.1');
    track(client);
    track(upstream);
    client.on('data', (chunk: Buffer) => recorded.push(Buffer.from(chunk)));
    upstream.on('data', (chunk: Buffer) => recorded.push(Buffer.from(chunk)));
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    bytes: () => new Uint8Array(Buffer.concat(recorded)),
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((socket) => socket.destroy());
        server.close(() => resolve());
      }),
  };
}

import { connect } from 'node:net';
import { LineChannel } from './line-channel';

export type AdminConnection = { send(value: object): void; next(): Promise<unknown>; close(): void };

export async function connectAdmin(path: string): Promise<AdminConnection> {
  const socket = connect(path);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', reject);
  });
  const channel = new LineChannel(socket);
  return {
    send: (value) => channel.send(value),
    next: async () => {
      const line = await channel.nextLine();
      return line === null ? null : (JSON.parse(line) as unknown);
    },
    close: () => channel.close(),
  };
}

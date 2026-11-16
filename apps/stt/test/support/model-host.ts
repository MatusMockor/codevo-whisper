import { createHash } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type ModelHost = {
  url(file: string): string;
  host(file: string, content: Buffer): void;
  hold(file: string): void;
  release(file: string): void;
  requests(): string[];
  close(): Promise<void>;
};

export function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function startModelHost(): Promise<ModelHost> {
  const files = new Map<string, Buffer>();
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  const requested: string[] = [];

  const serveHeld = (file: string, content: Buffer, response: ServerResponse): void => {
    const half = Math.floor(content.length / 2);
    response.write(content.subarray(0, half));
    const finish = (): void => {
      response.end(content.subarray(half));
    };
    waiting.set(file, [...(waiting.get(file) ?? []), finish]);
  };

  const server = createServer((request, response) => {
    const file = (request.url ?? '/').slice(1);
    requested.push(file);
    const content = files.get(file);
    if (content === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-length': String(content.length) });
    if (held.has(file)) {
      serveHeld(file, content, response);
      return;
    }
    response.end(content);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (file) => `http://127.0.0.1:${port}/${file}`,
    host: (file, content) => {
      files.set(file, content);
    },
    hold: (file) => {
      held.add(file);
    },
    release: (file) => {
      held.delete(file);
      (waiting.get(file) ?? []).forEach((finish) => finish());
      waiting.delete(file);
    },
    requests: () => [...requested],
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

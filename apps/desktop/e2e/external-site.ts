import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type ExternalSite = { url: string; requestCount: () => number; close: () => Promise<void> };

export async function startExternalSite(): Promise<ExternalSite> {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>external</title>');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    requestCount: () => requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

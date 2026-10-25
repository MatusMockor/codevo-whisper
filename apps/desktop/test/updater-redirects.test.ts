import { createServer, request, type ClientRequest, type IncomingMessage, type RequestOptions, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CancellationToken, HttpExecutor } from 'builder-util-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

class NodeExecutor extends HttpExecutor<ClientRequest> {
  createRequest(options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest {
    return request(options, callback);
  }
}

let server: Server;
let base: string;
let hits = 0;

beforeEach(async () => {
  hits = 0;
  server = createServer((incoming, response) => {
    hits += 1;
    const path = incoming.url ?? '/';
    if (path.startsWith('/loop')) {
      response.writeHead(302, { location: `${base}/loop/${hits}` });
      response.end();
      return;
    }
    const hops = /^\/hops\/(\d+)$/.exec(path);
    if (hops !== null && Number(hops[1]) > 0) {
      response.writeHead(302, { location: `${base}/hops/${Number(hops[1]) - 1}` });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('version: 1.2.0');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function options(path: string): RequestOptions {
  const url = new URL(path, base);
  return { protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname, headers: {} };
}

describe('patched builder-util-runtime redirects', () => {
  it('stops an endless redirect loop of an API request', async () => {
    await expect(new NodeExecutor().request(options('/loop'))).rejects.toThrow('Too many redirects (> 10)');
    expect(hits).toBeLessThanOrEqual(12);
  });

  it('stops an endless redirect loop of a download', async () => {
    const download = new NodeExecutor().downloadToBuffer(new URL('/loop', base), { cancellationToken: new CancellationToken() });

    await expect(download).rejects.toThrow('Too many redirects (> 10)');
    expect(hits).toBeLessThanOrEqual(12);
  });

  it('still follows a few redirects like the GitHub release CDN', async () => {
    const executor = new NodeExecutor();

    expect(await executor.request(options('/hops/3'))).toBe('version: 1.2.0');
    expect((await executor.downloadToBuffer(new URL('/hops/3', base), { cancellationToken: new CancellationToken() })).toString()).toBe('version: 1.2.0');
  });

  it('refuses a redirect from HTTPS to HTTP and allows the other directions', () => {
    const https: RequestOptions = { protocol: 'https:', hostname: 'github.com', path: '/MatusMockor/codevo-whisper/releases/download/v1.2.0/a.zip', headers: {} };

    expect(() => HttpExecutor.prepareRedirectUrlOptions('http://objects.githubusercontent.com/a.zip', https)).toThrow('Refusing a redirect from HTTPS to HTTP');
    expect(HttpExecutor.prepareRedirectUrlOptions('https://release-assets.githubusercontent.com/a.zip', https)).toMatchObject({
      protocol: 'https:',
      hostname: 'release-assets.githubusercontent.com',
    });
    expect(HttpExecutor.prepareRedirectUrlOptions('https://github.com/b.zip', { ...https, protocol: 'http:' })).toMatchObject({ protocol: 'https:' });
  });
});

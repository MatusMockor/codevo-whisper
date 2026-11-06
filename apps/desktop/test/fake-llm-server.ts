import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type RecordedRequest = { method: string; url: string; headers: IncomingHttpHeaders; body: string };

export type FakeLlmServer = { baseUrl: string; requests: RecordedRequest[]; close(): Promise<void> };

export async function startFakeLlmServer(respond: (request: RecordedRequest, response: ServerResponse) => void): Promise<FakeLlmServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const request = { method: incoming.method ?? '', url: incoming.url ?? '', headers: incoming.headers, body: Buffer.concat(chunks).toString('utf8') };
      requests.push(request);
      respond(request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export function completion(content: string): unknown {
  return { id: 'chatcmpl-1', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] };
}

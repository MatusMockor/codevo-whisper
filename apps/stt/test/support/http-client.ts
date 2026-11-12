import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SttServer } from '../../src/server';

export type Reply = { status: number; body: unknown };

export type SendOptions = { method?: 'GET' | 'POST'; body?: Uint8Array };

export function send(server: SttServer, path: string, options: SendOptions = {}): Promise<Reply> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, path, method: options.method ?? 'POST', headers: { 'content-type': 'application/octet-stream' } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode ?? 0, body: text === '' ? null : (JSON.parse(text) as unknown) });
      });
    });
    outgoing.on('error', reject);
    outgoing.end(options.body === undefined ? undefined : Buffer.from(options.body));
  });
}

export function pcm(samples: number): Uint8Array {
  return new Uint8Array(samples * 2);
}

import type { IncomingMessage } from 'node:http';

export const MIN_PCM_BYTES = 640;
export const MAX_PCM_BYTES = 960_000;

export type PcmBody = { kind: 'ok'; pcm: Uint8Array } | { kind: 'too-long' } | { kind: 'invalid' } | { kind: 'aborted' };

async function collect(request: IncomingMessage): Promise<PcmBody> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_PCM_BYTES) {
      return { kind: 'too-long' };
    }
    chunks.push(buffer);
  }
  if (total < MIN_PCM_BYTES || total % 2 !== 0) {
    return { kind: 'invalid' };
  }
  return { kind: 'ok', pcm: new Uint8Array(Buffer.concat(chunks)) };
}

export async function readPcm(request: IncomingMessage): Promise<PcmBody> {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > MAX_PCM_BYTES) {
    return { kind: 'too-long' };
  }
  try {
    return await collect(request);
  } catch {
    return { kind: 'aborted' };
  }
}

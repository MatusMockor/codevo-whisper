import { createHash, type Hash } from 'node:crypto';
import { open, rename, rm, stat } from 'node:fs/promises';
import { hashFile } from './file-hash';
import { ModelError } from './model-error';
import type { ModelFiles } from './model-files';

export type DownloadRequest = {
  url: string;
  files: ModelFiles;
  sha256: string;
  sizeBytes: number;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
  onProgress(receivedBytes: number): void;
};

async function partialSize(file: string): Promise<number> {
  const info = await stat(file).catch(() => null);
  return info?.size ?? 0;
}

async function startingOffset(request: DownloadRequest): Promise<number> {
  const size = await partialSize(request.files.partial);
  if (size > request.sizeBytes) {
    await rm(request.files.partial, { force: true });
    return 0;
  }
  return size;
}

function requestHeaders(offset: number): Record<string, string> {
  if (offset === 0) {
    return {};
  }
  return { Range: `bytes=${offset}-` };
}

function acceptedOffset(response: Response, offset: number, sizeBytes: number): number {
  if (!response.ok) {
    throw new ModelError('http', `Model download failed with HTTP ${response.status}`);
  }
  const start = response.status === 206 ? offset : 0;
  const length = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(length) && start + length !== sizeBytes) {
    throw new ModelError('size', `Model download has ${start + length} bytes, expected ${sizeBytes}`);
  }
  return start;
}

function bodyOf(response: Response): AsyncIterable<Uint8Array> {
  if (response.body === null) {
    throw new ModelError('incomplete', 'Model download returned no body');
  }
  return response.body;
}

async function writeBody(body: AsyncIterable<Uint8Array>, request: DownloadRequest, start: number, hash: Hash): Promise<number> {
  const handle = await open(request.files.partial, start > 0 ? 'a' : 'w', 0o600);
  let received = start;
  try {
    for await (const chunk of body) {
      received += chunk.byteLength;
      if (received > request.sizeBytes) {
        throw new ModelError('size', `Model download exceeds ${request.sizeBytes} bytes`);
      }
      await handle.write(chunk);
      hash.update(chunk);
      request.onProgress(received);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  return received;
}

async function fetchRest(request: DownloadRequest, offset: number, hash: Hash): Promise<Hash> {
  const response = await request.fetchImpl(request.url, { headers: requestHeaders(offset), signal: request.signal });
  const start = acceptedOffset(response, offset, request.sizeBytes);
  const active = start === offset ? hash : createHash('sha256');
  const received = await writeBody(bodyOf(response), request, start, active);
  if (received !== request.sizeBytes) {
    throw new ModelError('incomplete', `Model download stopped at ${received} of ${request.sizeBytes} bytes`);
  }
  return active;
}

async function hashedDownload(request: DownloadRequest): Promise<string> {
  const offset = await startingOffset(request);
  const hash = offset > 0 ? await hashFile(request.files.partial) : createHash('sha256');
  if (offset === request.sizeBytes) {
    return hash.digest('hex');
  }
  return (await fetchRest(request, offset, hash)).digest('hex');
}

async function discardOnBadContent<T>(file: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ModelError && error.reason === 'size') {
      await rm(file, { force: true });
    }
    throw error;
  }
}

export async function downloadFile(request: DownloadRequest): Promise<void> {
  const digest = await discardOnBadContent(request.files.partial, () => hashedDownload(request));
  if (digest !== request.sha256) {
    await rm(request.files.partial, { force: true });
    throw new ModelError('checksum', 'Downloaded model does not match its SHA-256');
  }
  await rename(request.files.partial, request.files.model);
}

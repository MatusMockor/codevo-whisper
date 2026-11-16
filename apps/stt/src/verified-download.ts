import { createHash, type Hash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { syncDirectory } from './sync-directory';

export type DownloadProgress = (bytes: number, total: number | null) => void;

export type VerifiedDownloadOptions = {
  url: string;
  sha256: string;
  size?: number;
  target: string;
  temp: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: DownloadProgress;
};

function declaredLength(response: Response): number | null {
  const total = Number(response.headers.get('content-length') ?? Number.NaN);
  return Number.isFinite(total) ? total : null;
}

function hashing(hash: Hash, limit: number | undefined, onBytes: (bytes: number) => void): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (limit !== undefined && seen > limit) {
        callback(new Error(`model download is larger than the expected ${limit} bytes`));
        return;
      }
      hash.update(chunk);
      onBytes(seen);
      callback(null, chunk);
    },
  });
}

async function stream(options: VerifiedDownloadOptions): Promise<{ digest: string; bytes: number }> {
  const response = await (options.fetchImpl ?? fetch)(options.url, { signal: options.signal ?? null });
  if (!response.ok || response.body === null) {
    throw new Error(`model download failed with HTTP ${response.status}`);
  }
  const total = declaredLength(response);
  if (options.size !== undefined && total !== null && total !== options.size) {
    await response.body.cancel().catch(() => undefined);
    throw new Error(`model download has ${total} bytes, expected ${options.size}`);
  }
  const hash = createHash('sha256');
  let bytes = 0;
  const progress = (seen: number): void => {
    bytes = seen;
    options.onProgress?.(seen, total);
  };
  const source = Readable.fromWeb(response.body);
  await pipeline(source, hashing(hash, options.size, progress), createWriteStream(options.temp, { mode: 0o644, flush: true }), { signal: options.signal });
  return { digest: hash.digest('hex'), bytes };
}

export async function downloadVerified(options: VerifiedDownloadOptions): Promise<void> {
  const expected = options.sha256.toLowerCase();
  const directory = dirname(options.target);
  await mkdir(directory, { recursive: true });
  try {
    const { digest, bytes } = await stream(options);
    if (options.size !== undefined && bytes !== options.size) {
      throw new Error(`model download has ${bytes} bytes, expected ${options.size}`);
    }
    if (digest !== expected) {
      throw new Error(`SHA-256 mismatch: expected ${expected}, got ${digest}`);
    }
    await rename(options.temp, options.target);
    await syncDirectory(directory);
  } finally {
    await rm(options.temp, { force: true });
  }
}

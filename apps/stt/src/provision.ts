import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MODEL_REVISION = 'a1539be1b849ea7463b88343e5277b373d0c4ea9';
export const MODEL_URL = `https://huggingface.co/handy-computer/parakeet-ultra-gguf/resolve/${MODEL_REVISION}/parakeet-ultra-F16.gguf`;
export const MODEL_SHA256 = 'cd97f94fa50a034a9019a47e2ed7a2de3963eed8316d1df4de9efdccca6fe78d';

export type ProvisionOptions = {
  url: string;
  sha256: string;
  target: string;
  fetchImpl?: typeof fetch;
  onProgress?: (bytes: number, total: number | null) => void;
};

async function sha256Of(path: string): Promise<string | null> {
  const hash = createHash('sha256');
  try {
    await pipeline(createReadStream(path), hash);
    return hash.digest('hex');
  } catch {
    return null;
  }
}

function hashing(hash: ReturnType<typeof createHash>, onBytes: (bytes: number) => void): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      seen += chunk.length;
      onBytes(seen);
      callback(null, chunk);
    },
  });
}

async function download(options: ProvisionOptions, temp: string): Promise<string> {
  const response = await (options.fetchImpl ?? fetch)(options.url);
  if (!response.ok || response.body === null) {
    throw new Error(`model download failed with HTTP ${response.status}`);
  }
  const total = Number(response.headers.get('content-length') ?? Number.NaN);
  const hash = createHash('sha256');
  const progress = (bytes: number): void => options.onProgress?.(bytes, Number.isFinite(total) ? total : null);
  await pipeline(Readable.fromWeb(response.body), hashing(hash, progress), createWriteStream(temp, { mode: 0o644 }));
  return hash.digest('hex');
}

export async function provision(options: ProvisionOptions): Promise<'present' | 'downloaded'> {
  const expected = options.sha256.toLowerCase();
  if ((await sha256Of(options.target)) === expected) {
    return 'present';
  }
  await mkdir(dirname(options.target), { recursive: true });
  const temp = `${options.target}.download`;
  try {
    const actual = await download(options, temp);
    if (actual !== expected) {
      throw new Error(`SHA-256 mismatch: expected ${expected}, got ${actual}`);
    }
    await rename(temp, options.target);
    return 'downloaded';
  } finally {
    await rm(temp, { force: true });
  }
}

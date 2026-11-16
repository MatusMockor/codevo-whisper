import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { ModelFile, ServerModelManifest } from './model-manifest';
import { downloadVerified, type DownloadProgress } from './verified-download';

export type ProvisionResult = 'present' | 'downloaded';

export type ProvisionOptions = {
  url: string;
  sha256: string;
  size?: number;
  target: string;
  fetchImpl?: typeof fetch;
  onProgress?: DownloadProgress;
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

export async function provision(options: ProvisionOptions): Promise<ProvisionResult> {
  if ((await sha256Of(options.target)) === options.sha256.toLowerCase()) {
    return 'present';
  }
  await downloadVerified({ ...options, temp: `${options.target}.download` });
  return 'downloaded';
}

export type ProvisionedFile = { file: ModelFile; result: ProvisionResult };

export type ManifestProgress = (file: ModelFile, bytes: number, total: number | null) => void;

export async function provisionManifest(manifest: ServerModelManifest, onProgress?: ManifestProgress): Promise<ProvisionedFile[]> {
  const provisioned: ProvisionedFile[] = [];
  for (const file of manifest.files) {
    const { url, sha256, size, target } = file;
    const result = await provision({ url, sha256, size, target, onProgress: (bytes, total) => onProgress?.(file, bytes, total) });
    provisioned.push({ file, result });
  }
  return provisioned;
}

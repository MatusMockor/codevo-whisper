import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { CatalogEntry } from '../src/main/models/catalog-entry';

export const TEST_REVISION = 'a'.repeat(40);

export function sha256Of(body: Uint8Array | string): string {
  return createHash('sha256').update(body).digest('hex');
}

export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

export function modelUrlPath(id: string): string {
  return `/test/models/resolve/${TEST_REVISION}/${id}.gguf`;
}

export function testEntry(id: string, body: Uint8Array | string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id,
    name: id,
    engine: 'transcribe.cpp',
    quantization: 'Q8_0',
    languages: ['sk', 'cs', 'en'],
    languageHint: 'ignored',
    sizeBytes: Buffer.byteLength(body),
    minRamBytes: 1024,
    license: 'MIT',
    licenseUrl: 'https://example.test/license',
    attribution: `${id} test model`,
    upstream: 'https://example.test/upstream',
    source: { repo: 'test/models', revision: TEST_REVISION, file: `${id}.gguf` },
    sha256: sha256Of(body),
    roles: ['recommended'],
    roleLabels: ['Odporúčaný'],
    ...overrides,
  };
}

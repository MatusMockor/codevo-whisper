import { statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { ModelState } from '../../shared/models';
import type { CatalogEntry } from './catalog-entry';

export const PARTIAL_SUFFIX = '.download';

export type ModelFiles = { model: string; partial: string };

export function modelFiles(dir: string, entry: CatalogEntry): ModelFiles {
  const model = join(dir, `${entry.id}${extname(entry.source.file)}`);
  return { model, partial: `${model}${PARTIAL_SUFFIX}` };
}

function sizeOf(file: string): number | null {
  return statSync(file, { throwIfNoEntry: false })?.size ?? null;
}

export function scanModelState(entry: CatalogEntry, files: ModelFiles): ModelState {
  const base = { id: entry.id, totalBytes: entry.sizeBytes };
  const modelSize = sizeOf(files.model);
  if (modelSize === entry.sizeBytes) {
    return { ...base, status: 'ready', receivedBytes: entry.sizeBytes };
  }
  if (modelSize !== null) {
    return { ...base, status: 'broken', receivedBytes: 0 };
  }
  const partialSize = sizeOf(files.partial);
  if (partialSize !== null) {
    return { ...base, status: 'paused', receivedBytes: Math.min(partialSize, entry.sizeBytes) };
  }
  return { ...base, status: 'not-downloaded', receivedBytes: 0 };
}

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createTempDir(prefix = 'cw-server-test-'): Promise<{ path: string; remove(): Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}
